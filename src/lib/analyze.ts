import { q, one } from './db';
import { chat, extractJson, LlmError, JEV_MODEL } from './llm';
import { keywords, similarity, clamp } from './text';

export type Candidate = { id: string; content: string; tags: string[] };

export type Analysis = {
  relations: Array<{ id: string; strength: number; relation: string }>;
  tags: string[];
  attributes: Record<string, string>;
  summary: string;
  duplicateOf: string | null;
  model: string;
  ms: number;
  degraded: boolean;
};

const RELATIONS = new Set(['同题', '追问', '因果', '回答', '对照', '子话题', '重复', '相关']);

function localScore(content: string, candidate: Candidate): number {
  const base = similarity(content, candidate.content);
  let bonus = 0;
  for (const tag of candidate.tags ?? []) {
    if (tag && content.includes(tag)) bonus += 0.12;
  }
  return base + Math.min(bonus, 0.36);
}

function normalizeAttributes(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (Object.keys(out).length >= 5) break;
    out[key.slice(0, 16)] = value.slice(0, 40);
  }
  return out;
}

function fallbackAnalysis(content: string, kind: string, candidates: Array<{ candidate: Candidate; score: number }>): Analysis {
  const relations = candidates
    .filter((c) => c.score >= 0.22)
    .slice(0, 3)
    .map((c) => ({ id: c.candidate.id, strength: Math.round(clamp(c.score * 130, 35, 72)), relation: '相关' }));
  return {
    relations,
    tags: keywords(content, 3),
    attributes: { domain: '未分类', type: kind === 'idea' ? '想法' : '问题' },
    summary: content.slice(0, 40),
    duplicateOf: null,
    model: 'local-fallback',
    ms: 0,
    degraded: true,
  };
}

/** 调 jev 判断新问题与既有节点的关系强度；失败时退回字面相似度，保证提交不丢。 */
export async function analyzeContent(spaceId: string, content: string, kind: string, excludeId: string): Promise<Analysis> {
  const all = await q<Candidate>(
    'select id, content, tags from nodes where space_id = $1 and id <> $2 and status <> $3 order by created_at desc limit 2000',
    [spaceId, excludeId, 'duplicate'],
  );

  const scored = all
    .map((candidate) => ({ candidate, score: localScore(content, candidate) }))
    .sort((a, b) => b.score - a.score);

  const picked = scored.filter((s) => s.score > 0.04).slice(0, 14);
  const candidates = picked.length > 0 ? picked : scored.slice(0, 6);

  const listing =
    candidates.length > 0
      ? candidates.map(({ candidate }, i) => `[${i}] ${candidate.content.replace(/\s+/g, ' ').slice(0, 110)}`).join('\n')
      : '（空间里还没有其他问题，这是第一个。）';

  const started = Date.now();
  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            '你是思维网络的关系判断器。判断新问题与候选问题的语义关系强度，只输出 JSON。宁缺毋滥：措辞像但主题不同，强度要低。',
        },
        {
          role: 'user',
          content: `新问题：${content}

候选节点：
${listing}

强度标准：
- 90-100 同一个问题的不同说法，或几乎重复
- 70-89 直接相关：追问、因果、回答、同一子话题
- 45-69 同一领域，共享核心主题
- 35-44 弱相关，仅共享一个概念
- <35 不输出

同时给出：
- tags：2-4 个标签，每个 2-6 个汉字，是这个问题真正的内容标签（不要"问题""思考"这类空词）
- attributes：{"domain":"业务/技术/用户/商业/组织/其他","type":"问题/假设/痛点/想法/风险"}
- summary：20 字内说清它到底在问什么
- duplicate_of：如果和某个候选几乎是同一个问题，填它的序号，否则 null

输出 JSON：
{"relations":[{"i":0,"strength":82,"relation":"追问"}],"tags":["..."],"attributes":{"domain":"...","type":"..."},"summary":"...","duplicate_of":null}`,
        },
      ],
      { model: JEV_MODEL(), json: true, maxTokens: 900, temperature: 0.1, timeoutMs: 30_000, title: 'Mindspace relation judge' },
    );

    const parsed = extractJson<{
      relations?: Array<{ i?: number; strength?: number; relation?: string }>;
      tags?: unknown[];
      attributes?: unknown;
      summary?: string;
      duplicate_of?: number | null;
    }>(result.text);
    if (!parsed) throw new LlmError('无法解析模型 JSON');

    const relations = (parsed.relations ?? [])
      .filter((r) => typeof r.i === 'number' && r.i >= 0 && r.i < candidates.length)
      .map((r) => ({
        id: candidates[r.i!].candidate.id,
        strength: Math.round(clamp(Number(r.strength) || 0, 0, 100)),
        relation: RELATIONS.has(String(r.relation)) ? String(r.relation) : '相关',
      }))
      .filter((r) => r.strength >= 35)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 8);

    const tags = Array.from(
      new Set(
        (Array.isArray(parsed.tags) ? parsed.tags : [])
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().slice(0, 8)),
      ),
    ).slice(0, 4);

    const duplicateIndex = parsed.duplicate_of;
    const duplicateOf =
      typeof duplicateIndex === 'number' && duplicateIndex >= 0 && duplicateIndex < candidates.length
        ? candidates[duplicateIndex].candidate.id
        : null;

    return {
      relations,
      tags: tags.length ? tags : keywords(content, 3),
      attributes: normalizeAttributes(parsed.attributes),
      summary: String(parsed.summary || '').slice(0, 60) || content.slice(0, 40),
      duplicateOf,
      model: result.model,
      ms: Date.now() - started,
      degraded: false,
    };
  } catch (err) {
    console.error('[analyze] LLM failed, falling back:', err instanceof Error ? err.message : err);
    const fallback = fallbackAnalysis(content, kind, candidates);
    return { ...fallback, ms: Date.now() - started };
  }
}

export async function applyAnalysis(
  spaceId: string,
  nodeId: string,
  analysis: Analysis,
): Promise<void> {
  for (const relation of analysis.relations) {
    const [a, b] = [nodeId, relation.id].sort();
    await q(
      `insert into edges (space_id, source_id, target_id, strength, relation, origin)
       values ($1, $2, $3, $4, $5, 'jev')
       on conflict (space_id, source_id, target_id)
       do update set strength = greatest(edges.strength, excluded.strength), relation = excluded.relation, updated_at = now()`,
      [spaceId, a, b, relation.strength, relation.relation],
    );
  }

  if (analysis.duplicateOf) {
    const [a, b] = [nodeId, analysis.duplicateOf].sort();
    await q(
      `insert into edges (space_id, source_id, target_id, strength, relation, origin)
       values ($1, $2, $3, 100, '重复', 'jev')
       on conflict (space_id, source_id, target_id)
       do update set strength = 100, relation = '重复', updated_at = now()`,
      [spaceId, a, b],
    );
  }

  await q(
    `update nodes set tags = $2, attributes = $3, status = $4, duplicate_of = $5, analysis = $6, updated_at = now()
     where id = $1 and space_id = $7`,
    [
      nodeId,
      JSON.stringify(analysis.tags),
      JSON.stringify(analysis.attributes),
      analysis.duplicateOf ? 'duplicate' : 'ready',
      analysis.duplicateOf,
      JSON.stringify({
        model: analysis.model,
        ms: analysis.ms,
        degraded: analysis.degraded,
        summary: analysis.summary,
        relations: analysis.relations.length,
      }),
      spaceId,
    ],
  );
}

export async function analysisOf(nodeId: string): Promise<Record<string, unknown> | null> {
  const row = await one<{ analysis: Record<string, unknown> }>('select analysis from nodes where id = $1', [nodeId]);
  return row?.analysis ?? null;
}
