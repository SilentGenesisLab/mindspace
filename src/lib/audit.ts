import { q, one } from './db';
import { chat, extractJson, AUDIT_MODEL, LlmError } from './llm';
import { ensureClusterNames, recomputeClusters } from './graph';
import { publish } from './events';
import { clamp } from './text';

type AuditNode = { id: string; content: string; tags: string[] };
type AuditEdge = { source_id: string; target_id: string; strength: number; relation: string };

type AuditPayload = {
  duplicates?: Array<{ a?: number; b?: number; confidence?: number }>;
  bad_edges?: Array<{ a?: number; b?: number; reason?: string }>;
  retag?: Array<{ i?: number; tags?: unknown[] }>;
  new_edges?: Array<{ a?: number; b?: number; strength?: number; relation?: string }>;
  note?: string;
};

/**
 * ds4.1 定期审校：在最近变化的节点样本里找重复、错边、漏边和坏标签。
 * 应用策略偏保守：只删低强度边，只加高强度边。
 */
export async function runAudit(spaceId: string, opts: { limit?: number; trigger?: string } = {}) {
  const model = AUDIT_MODEL();
  const limit = Math.min(Math.max(opts.limit ?? (Number(process.env.AUDIT_BATCH) || 15), 5), 40);

  const run = await one<{ id: string }>(
    `insert into audit_runs (space_id, model, status, notes) values ($1, $2, 'running', $3) returning id`,
    [spaceId, model, `trigger:${opts.trigger ?? 'manual'}`],
  );
  if (!run) throw new Error('无法创建审校记录');

  const stats = { checked: 0, duplicates: 0, edgesRemoved: 0, edgesAdded: 0, retagged: 0, clusters: 0, degraded: false };

  try {
    const nodes = await q<AuditNode>(
      `select id, content, tags from nodes
       where space_id = $1 and status <> 'duplicate'
       order by updated_at desc limit $2`,
      [spaceId, limit],
    );

    if (nodes.length < 2) {
      await finish(run.id, 'ok', stats, '样本不足');
      return { runId: run.id, stats };
    }

    const ids = nodes.map((n) => n.id);
    const edges = await q<AuditEdge>(
      `select source_id, target_id, strength, relation from edges
       where space_id = $1 and source_id = any($2::uuid[]) and target_id = any($2::uuid[])`,
      [spaceId, ids],
    );

    const listing = nodes
      .map((n, i) => `[${i}] (标签:${(n.tags ?? []).join('/') || '无'}) ${n.content.replace(/\s+/g, ' ').slice(0, 110)}`)
      .join('\n');
    const edgeListing = edges
      .map((e) => `${ids.indexOf(e.source_id)} --(${e.strength}, ${e.relation})-- ${ids.indexOf(e.target_id)}`)
      .join('\n');

    let payload: AuditPayload | null = null;
    try {
      const result = await chat(
        [
          {
            role: 'system',
            content: '你是思维网络的审校员。只输出 JSON，不要解释。判断要保守：拿不准就不要改。',
          },
          {
            role: 'user',
            content: `这是一个集体脑暴空间里最近的 ${nodes.length} 条问题和已有关系。序号即节点。

节点：
${listing}

已有关系：
${edgeListing || '（无）'}

请找出：
1. duplicates：实质是同一个问题、应该合并的 (a,b)，confidence 0-1
2. bad_edges：关系明显不成立、应该删掉的 (a,b)，只报你能确定错的
3. retag：标签明显不准的节点 i，给出更准的 2-4 个标签
4. new_edges：样本内明显相关但没连上的 (a,b)，strength 60-95
5. note：一句话说明这一批的主要问题

输出：
{"duplicates":[{"a":0,"b":3,"confidence":0.9}],"bad_edges":[{"a":1,"b":2,"reason":"..."}],"retag":[{"i":4,"tags":["..."]}],"new_edges":[{"a":5,"b":6,"strength":78}],"note":"..."}`,
          },
        ],
        { model, json: true, maxTokens: 1100, temperature: 0.1, timeoutMs: 45_000, title: 'Mindspace audit' },
      );
      payload = extractJson<AuditPayload>(result.text);
    } catch (err) {
      if (!(err instanceof LlmError)) console.error('[audit]', err);
      stats.degraded = true;
    }

    if (payload) {
      const valid = (i: unknown): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < nodes.length;
      const edgeKey = (a: string, b: string) => [a, b].sort().join('|');
      const existing = new Set(edges.map((e) => edgeKey(e.source_id, e.target_id)));
      const edgeStrength = new Map(edges.map((e) => [edgeKey(e.source_id, e.target_id), e.strength]));

      for (const dup of payload.duplicates ?? []) {
        if (!valid(dup.a) || !valid(dup.b) || dup.a === dup.b) continue;
        if ((dup.confidence ?? 0) < 0.75) continue;
        const target = nodes[dup.a].id;
        const source = nodes[dup.b].id;
        await q(
          `insert into edges (space_id, source_id, target_id, strength, relation, origin)
           values ($1, $2, $3, 100, '重复', 'ds')
           on conflict (space_id, source_id, target_id)
           do update set strength = 100, relation = '重复', updated_at = now()`,
          [spaceId, ...[source, target].sort()],
        );
        await q(`update nodes set duplicate_of = $2, status = 'duplicate', updated_at = now() where id = $1 and space_id = $3`, [
          source,
          target,
          spaceId,
        ]);
        stats.duplicates++;
      }

      for (const bad of payload.bad_edges ?? []) {
        if (!valid(bad.a) || !valid(bad.b)) continue;
        const key = edgeKey(nodes[bad.a].id, nodes[bad.b].id);
        if ((edgeStrength.get(key) ?? 100) >= 60) continue;
        await q(`delete from edges where space_id = $1 and source_id = $2 and target_id = $3`, [
          spaceId,
          ...[nodes[bad.a].id, nodes[bad.b].id].sort(),
        ]);
        stats.edgesRemoved++;
      }

      for (const retag of payload.retag ?? []) {
        if (!valid(retag.i)) continue;
        const tags = Array.from(
          new Set(
            (Array.isArray(retag.tags) ? retag.tags : [])
              .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
              .map((t) => t.trim().slice(0, 8)),
          ),
        ).slice(0, 4);
        if (!tags.length) continue;
        await q('update nodes set tags = $2, updated_at = now() where id = $1', [nodes[retag.i].id, JSON.stringify(tags)]);
        stats.retagged++;
      }

      for (const edge of payload.new_edges ?? []) {
        if (!valid(edge.a) || !valid(edge.b) || edge.a === edge.b) continue;
        const strength = Math.round(clamp(Number(edge.strength) || 0, 0, 100));
        if (strength < 60) continue;
        const key = edgeKey(nodes[edge.a].id, nodes[edge.b].id);
        if (existing.has(key)) continue;
        await q(
          `insert into edges (space_id, source_id, target_id, strength, relation, origin)
           values ($1, $2, $3, $4, $5, 'ds')
           on conflict (space_id, source_id, target_id) do nothing`,
          [spaceId, ...[nodes[edge.a].id, nodes[edge.b].id].sort(), strength, '相关'],
        );
        stats.edgesAdded++;
      }
    }

    stats.checked = nodes.length;
    const clusters = await recomputeClusters(spaceId);
    stats.clusters = clusters.clusters;
    await ensureClusterNames(spaceId).catch(() => {});

    const note = (payload?.note ?? '').slice(0, 200) || (stats.degraded ? '模型不可用，仅做聚类重算' : '');
    await finish(run.id, 'ok', stats, note);
    publish(spaceId, 'audit.completed', { runId: run.id, stats, note });
    return { runId: run.id, stats, note };
  } catch (err) {
    await finish(run.id, 'error', stats, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function finish(runId: string, status: string, stats: Record<string, unknown>, note: string) {
  await q(
    `update audit_runs set status = $2, stats = $3, notes = $4, finished_at = now() where id = $1`,
    [runId, status, JSON.stringify(stats), note],
  );
}

export async function listAudits(spaceId: string, limit = 20) {
  return q(
    `select id, model, status, stats, notes, started_at, finished_at
     from audit_runs where space_id = $1 order by started_at desc limit $2`,
    [spaceId, limit],
  );
}
