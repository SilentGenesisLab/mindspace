import { q, one } from './db';
import { chat, extractJson, LlmError, JEV_MODEL } from './llm';
import { stableUuid, clamp } from './text';
import { publish } from './events';

export const CLUSTER_COLORS = ['#57d4ff', '#3ef0b0', '#b58cff', '#ffb547', '#ff7ad9', '#7aa7ff', '#ff8f6b', '#6ee7d7'];

type GraphNode = { id: string; tags: string[]; cluster_id: string | null };
type GraphEdge = { source_id: string; target_id: string; strength: number };

/**
 * 带权标签传播。关系越强越容易把两个节点并到同一簇。
 * 少于 3 个节点的组不单独成簇（返回 null），避免图例被碎片淹没。
 */
export async function recomputeClusters(spaceId: string): Promise<{ clusters: number; assigned: number }> {
  const nodes = await q<GraphNode>('select id, tags, cluster_id from nodes where space_id = $1', [spaceId]);
  if (nodes.length === 0) return { clusters: 0, assigned: 0 };

  const edges = await q<GraphEdge>(
    'select source_id, target_id, strength from edges where space_id = $1 and strength >= 30',
    [spaceId],
  );

  const adjacency = new Map<string, Array<{ id: string; w: number }>>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.source_id)?.push({ id: edge.target_id, w: edge.strength });
    adjacency.get(edge.target_id)?.push({ id: edge.source_id, w: edge.strength });
  }

  const labels = new Map<string, string>();
  for (const node of nodes) labels.set(node.id, node.id);

  for (let iter = 0; iter < 16; iter++) {
    let changed = 0;
    for (const node of nodes) {
      const totals = new Map<string, number>();
      for (const nb of adjacency.get(node.id) ?? []) {
        const label = labels.get(nb.id)!;
        totals.set(label, (totals.get(label) ?? 0) + nb.w);
      }
      if (totals.size === 0) continue;
      let bestLabel = labels.get(node.id)!;
      let bestScore = totals.get(bestLabel) ?? 0;
      for (const [label, score] of totals) {
        if (score > bestScore * 1.12) {
          bestLabel = label;
          bestScore = score;
        }
      }
      if (bestLabel !== labels.get(node.id)) {
        labels.set(node.id, bestLabel);
        changed++;
      }
    }
    if (changed === 0) break;
  }

  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const label = labels.get(node.id)!;
    const bucket = groups.get(label);
    if (bucket) bucket.push(node);
    else groups.set(label, [node]);
  }

  const existing = new Map(
    (await q<{ id: string; label: string; summary: string }>('select id, label, summary from clusters where space_id = $1', [spaceId])).map(
      (row) => [row.id, row],
    ),
  );

  const assignments = new Map<string, string[]>();
  const nextClusters: Array<{ id: string; label: string; summary: string; nodeCount: number }> = [];

  for (const members of groups.values()) {
    if (members.length < 3) {
      for (const member of members) {
        const key = '';
        const bucket = assignments.get(key) ?? [];
        bucket.push(member.id);
        assignments.set(key, bucket);
      }
      continue;
    }

    const degree = (id: string) => (adjacency.get(id) ?? []).length;
    const anchor = [...members].sort((a, b) => degree(b.id) - degree(a.id) || a.id.localeCompare(b.id))[0];
    const clusterId = stableUuid(`${spaceId}:${anchor.id}`);

    const tagCounts = new Map<string, number>();
    for (const member of members) {
      for (const tag of member.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
    const fallbackLabel = topTags.join(' · ') || '聚类';

    const prior = existing.get(clusterId);
    nextClusters.push({
      id: clusterId,
      label: prior?.label && prior.label !== '聚类' ? prior.label : fallbackLabel,
      summary: prior?.summary ?? '',
      nodeCount: members.length,
    });

    const bucket = assignments.get(clusterId) ?? [];
    for (const member of members) bucket.push(member.id);
    assignments.set(clusterId, bucket);
  }

  // 所有节点先清空，再按分组写回（空 key 表示不归类）。
  await q('update nodes set cluster_id = null where space_id = $1', [spaceId]);
  for (const [clusterId, ids] of assignments) {
    if (!clusterId) continue;
    await q('update nodes set cluster_id = $2 where space_id = $1 and id = any($3::uuid[])', [spaceId, clusterId, ids]);
  }

  await q('delete from clusters where space_id = $1', [spaceId]);
  for (let i = 0; i < nextClusters.length; i++) {
    const cluster = nextClusters[i];
    await q(
      `insert into clusters (id, space_id, label, summary, color, node_count, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [cluster.id, spaceId, cluster.label, cluster.summary, CLUSTER_COLORS[i % CLUSTER_COLORS.length], cluster.nodeCount],
    );
  }

  const assigned = [...assignments.entries()].filter(([k]) => k).reduce((sum, [, ids]) => sum + ids.length, 0);
  return { clusters: nextClusters.length, assigned };
}

/** 用 jev 给还没名字的聚类起名。失败不影响主流程。 */
export async function ensureClusterNames(spaceId: string): Promise<void> {
  const clusters = await q<{ id: string; label: string; summary: string; node_count: number }>(
    `select id, label, summary, node_count from clusters
     where space_id = $1 and summary = '' order by node_count desc limit 6`,
    [spaceId],
  );
  if (clusters.length === 0) return;

  const samples = await q<{ cluster_id: string; content: string }>(
    `select cluster_id, content from (
       select cluster_id, content, row_number() over (partition by cluster_id order by created_at desc) as rn
       from nodes where space_id = $1 and cluster_id = any($2::uuid[])
     ) t where rn <= 8`,
    [spaceId, clusters.map((c) => c.id)],
  );
  const byCluster = new Map<string, string[]>();
  for (const row of samples) {
    const list = byCluster.get(row.cluster_id) ?? [];
    list.push(row.content);
    byCluster.set(row.cluster_id, list);
  }

  const payload = clusters.map((cluster) => ({
    id: cluster.id,
    nodes: (byCluster.get(cluster.id) ?? []).map((c) => c.slice(0, 120)),
  }));

  try {
    const result = await chat(
      [
        { role: 'system', content: '你为思维网络里的问题聚类命名。只输出 JSON。' },
        {
          role: 'user',
          content: `下面是若干问题聚类，每组是一起被判定为强关联的问题。给每组一个 2-6 个汉字的标签式名字，和一句 20 字以内的概括（说清这组人在纠结什么）。\n${JSON.stringify(
            payload,
          )}\n输出：{"clusters":[{"id":"...","label":"...","summary":"..."}]}`,
        },
      ],
      { model: JEV_MODEL(), json: true, maxTokens: 600, timeoutMs: 20_000, title: 'Mindspace cluster naming' },
    );
    const parsed = extractJson<{ clusters?: Array<{ id: string; label: string; summary: string }> }>(result.text);
    for (const item of parsed?.clusters ?? []) {
      if (!item?.id || !item.label) continue;
      await q('update clusters set label = $2, summary = $3 where id = $1 and space_id = $4', [
        item.id,
        String(item.label).slice(0, 20),
        String(item.summary || '').slice(0, 60),
        spaceId,
      ]);
    }
  } catch (err) {
    if (!(err instanceof LlmError)) console.error('[cluster naming]', err);
  }
}

type PlacedNode = { id: string; x: number; y: number; z: number; cluster_id: string | null };

/**
 * 新节点落在强关联邻居的重心附近，再对局部邻域做一次力导松弛：
 * 边越强、弹簧静止长度越短 → 关联越强距离越近。
 */
export async function placeNode(spaceId: string, nodeId: string): Promise<void> {
  const self = await one<PlacedNode>('select id, x, y, z, cluster_id from nodes where id = $1 and space_id = $2', [
    nodeId,
    spaceId,
  ]);
  if (!self) return;

  const direct = await q<{ id: string; x: number; y: number; z: number; cluster_id: string | null; strength: number }>(
    `select n.id, n.x, n.y, n.z, n.cluster_id, e.strength
     from edges e
     join nodes n on n.id = case when e.source_id = $2 then e.target_id else e.source_id end
     where e.space_id = $1 and (e.source_id = $2 or e.target_id = $2)`,
    [spaceId, nodeId],
  );

  if (direct.length === 0) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 90 + Math.random() * 70;
    await q('update nodes set x = $2, y = $3, z = $4 where id = $1', [
      nodeId,
      Math.cos(angle) * radius,
      (Math.random() - 0.5) * 160,
      Math.sin(angle) * radius,
    ]);
    return;
  }

  let weight = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const nb of direct) {
    weight += nb.strength;
    sx += nb.x * nb.strength;
    sy += nb.y * nb.strength;
    sz += nb.z * nb.strength;
  }
  const start = {
    x: sx / weight + (Math.random() - 0.5) * 26,
    y: sy / weight + (Math.random() - 0.5) * 26,
    z: sz / weight + (Math.random() - 0.5) * 26,
  };
  await q('update nodes set x = $2, y = $3, z = $4 where id = $1', [nodeId, start.x, start.y, start.z]);

  // 采集 1~2 跳邻域（上限 140 个），只在这个子图里松弛。
  const ids = new Set<string>([nodeId]);
  for (const nb of direct) ids.add(nb.id);
  const hop2 = await q<{ source_id: string; target_id: string }>(
    `select source_id, target_id from edges
     where space_id = $1 and (source_id = any($2::uuid[]) or target_id = any($2::uuid[])) limit 900`,
    [spaceId, [...ids]],
  );
  for (const edge of hop2) {
    if (ids.size >= 140) break;
    ids.add(edge.source_id);
    ids.add(edge.target_id);
  }

  const members = await q<PlacedNode>(
    'select id, x, y, z, cluster_id from nodes where space_id = $1 and id = any($2::uuid[])',
    [spaceId, [...ids]],
  );
  const subEdges = await q<GraphEdge>(
    'select source_id, target_id, strength from edges where space_id = $1 and source_id = any($2::uuid[]) and target_id = any($2::uuid[])',
    [spaceId, [...ids]],
  );
  const centroids = await q<{ cluster_id: string; cx: number; cy: number; cz: number }>(
    `select cluster_id, avg(x) as cx, avg(y) as cy, avg(z) as cz
     from nodes where space_id = $1 and cluster_id is not null group by cluster_id`,
    [spaceId],
  );

  const pos = new Map(members.map((m) => [m.id, { x: m.x, y: m.y, z: m.z }]));
  const anchor = new Map(members.map((m) => [m.id, { x: m.x, y: m.y, z: m.z }]));
  const centroidMap = new Map(centroids.map((c) => [c.cluster_id, c]));

  for (let iter = 0; iter < 70; iter++) {
    const delta = new Map(members.map((m) => [m.id, { x: 0, y: 0, z: 0 }]));
    const add = (id: string, x: number, y: number, z: number) => {
      const d = delta.get(id);
      if (!d) return;
      d.x += x;
      d.y += y;
      d.z += z;
    };

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = pos.get(members[i].id)!;
        const b = pos.get(members[j].id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const dist2 = dx * dx + dy * dy + dz * dz + 1;
        const dist = Math.sqrt(dist2);
        const force = Math.min(900 / dist2, 8);
        const ux = dx / dist;
        const uy = dy / dist;
        const uz = dz / dist;
        add(members[i].id, ux * force, uy * force, uz * force);
        add(members[j].id, -ux * force, -uy * force, -uz * force);
      }
    }

    for (const edge of subEdges) {
      const a = pos.get(edge.source_id);
      const b = pos.get(edge.target_id);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const rest = clamp(150 - edge.strength, 36, 130);
      const force = ((dist - rest) / dist) * 0.16;
      add(edge.source_id, dx * force, dy * force, dz * force);
      add(edge.target_id, -dx * force, -dy * force, -dz * force);
    }

    for (const member of members) {
      const p = pos.get(member.id)!;
      const a = anchor.get(member.id)!;
      const isNew = member.id === nodeId;
      const anchorPull = isNew ? 0.0 : 0.02;
      p.x += (a.x - p.x) * anchorPull;
      p.y += (a.y - p.y) * anchorPull;
      p.z += (a.z - p.z) * anchorPull;

      if (member.cluster_id) {
        const c = centroidMap.get(member.cluster_id);
        if (c) {
          p.x += (c.cx - p.x) * 0.006;
          p.y += (c.cy - p.y) * 0.006;
          p.z += (c.cz - p.z) * 0.006;
        }
      }

      const d = delta.get(member.id)!;
      p.x += clamp(d.x, -10, 10);
      p.y += clamp(d.y, -10, 10);
      p.z += clamp(d.z, -10, 10);
    }
  }

  for (const member of members) {
    const p = pos.get(member.id)!;
    await q('update nodes set x = $2, y = $3, z = $4 where id = $1', [member.id, p.x, p.y, p.z]);
  }
}

export async function recomputeAllPositions(spaceId: string): Promise<number> {
  const nodes = await q<{ id: string }>('select id from nodes where space_id = $1 order by created_at', [spaceId]);
  for (const node of nodes) {
    await placeNode(spaceId, node.id);
  }
  return nodes.length;
}

/** 收集者手动触发的整体重排（节点多时拒绝，避免一次请求跑太久）。 */
export async function collectSpacePositions(
  spaceId: string,
): Promise<{ nodes: number; clusters: number; error?: string }> {
  const count = await one<{ n: string }>('select count(*)::text as n from nodes where space_id = $1', [spaceId]);
  const total = Number(count?.n ?? 0);
  if (total > 800) return { nodes: total, clusters: 0, error: '节点超过 800，暂不支持整体重排' };
  await recomputeClusters(spaceId);
  await recomputeAllPositions(spaceId);
  const clusters = await recomputeClusters(spaceId);
  await ensureClusterNames(spaceId).catch(() => {});
  publish(spaceId, 'graph.relayout', { nodes: total });
  return { nodes: total, clusters: clusters.clusters };
}
