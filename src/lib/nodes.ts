import { q, one } from './db';
import { analyzeContent, applyAnalysis } from './analyze';
import { ensureClusterNames, placeNode, recomputeClusters } from './graph';
import { publish } from './events';

export type NodeRow = {
  id: string;
  space_id: string;
  author_id: string;
  content: string;
  kind: string;
  tags: string[];
  attributes: Record<string, string>;
  cluster_id: string | null;
  status: string;
  duplicate_of: string | null;
  analysis: Record<string, unknown>;
  x: number;
  y: number;
  z: number;
  created_at: string;
  updated_at: string;
};

export const NODE_KINDS = new Set(['question', 'idea', 'concern']);

export async function createNode(opts: {
  spaceId: string;
  authorId: string;
  content: string;
  kind?: string;
}): Promise<{ node: NodeRow; analysis: Record<string, unknown> }> {
  const content = opts.content.trim();
  if (content.length < 2) throw new Error('内容太短');
  const kind = opts.kind && NODE_KINDS.has(opts.kind) ? opts.kind : 'question';

  const node = await one<NodeRow>(
    `insert into nodes (space_id, author_id, content, kind, status)
     values ($1, $2, $3, $4, 'pending') returning *`,
    [opts.spaceId, opts.authorId, content.slice(0, 500), kind],
  );
  if (!node) throw new Error('写入节点失败');

  const analysis = await analyzeContent(opts.spaceId, content, kind, node.id);
  await applyAnalysis(opts.spaceId, node.id, analysis);
  await recomputeClusters(opts.spaceId);
  await placeNode(opts.spaceId, node.id);
  await q('update nodes set updated_at = now() where id = $1', [node.id]);

  const fresh = (await one<NodeRow>('select * from nodes where id = $1', [node.id]))!;
  publish(opts.spaceId, 'node.created', { node: publicNode(fresh), analysis });
  ensureClusterNames(opts.spaceId).catch(() => {});

  return { node: fresh, analysis: analysis as unknown as Record<string, unknown> };
}

export function publicNode(row: NodeRow & { author_nickname?: string; author_color?: string; degree?: number }) {
  return {
    id: row.id,
    content: row.content,
    kind: row.kind,
    tags: row.tags ?? [],
    attributes: row.attributes ?? {},
    cluster_id: row.cluster_id,
    status: row.status,
    duplicate_of: row.duplicate_of,
    analysis: row.analysis ?? {},
    x: Number(row.x),
    y: Number(row.y),
    z: Number(row.z),
    created_at: row.created_at,
    author: {
      id: row.author_id,
      nickname: row.author_nickname ?? '未知',
      color: row.author_color ?? '#57d4ff',
    },
    degree: Number(row.degree ?? 0),
  };
}

const NODE_SELECT = `
  select n.*, u.nickname as author_nickname, u.color as author_color,
         (select count(*) from edges e where e.space_id = n.space_id and (e.source_id = n.id or e.target_id = n.id)) as degree
  from nodes n join users u on u.id = n.author_id
`;

export async function listNodes(
  spaceId: string,
  filters: { q?: string; tag?: string; author?: string; cluster?: string; domain?: string; type?: string; kind?: string; status?: string; limit?: number; offset?: number },
) {
  const where: string[] = ['n.space_id = $1'];
  const params: unknown[] = [spaceId];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.q) {
    const a = bind(`%${filters.q}%`);
    const b = bind(`%${filters.q}%`);
    where.push(`(n.content ilike ${a} or n.tags::text ilike ${b})`);
  }
  if (filters.tag) where.push(`n.tags ? ${bind(filters.tag)}`);
  if (filters.author) where.push(`n.author_id = ${bind(filters.author)}`);
  if (filters.cluster) where.push(`n.cluster_id = ${bind(filters.cluster)}`);
  if (filters.domain) where.push(`n.attributes->>'domain' = ${bind(filters.domain)}`);
  if (filters.type) where.push(`n.attributes->>'type' = ${bind(filters.type)}`);
  if (filters.kind) where.push(`n.kind = ${bind(filters.kind)}`);
  if (filters.status) where.push(`n.status = ${bind(filters.status)}`);

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await q<NodeRow & { author_nickname: string; author_color: string; degree: number }>(
    `${NODE_SELECT} where ${where.join(' and ')} order by n.created_at desc limit ${limit} offset ${offset}`,
    params,
  );
  const total = await one<{ count: string }>(
    `select count(*)::text as count from nodes n where ${where.join(' and ')}`,
    params,
  );

  return { nodes: rows.map(publicNode), total: Number(total?.count ?? 0) };
}

export async function facetCounts(spaceId: string) {
  const tags = await q<{ tag: string; count: string }>(
    `select tag, count(*)::text as count from nodes n, jsonb_array_elements_text(n.tags) as tag
     where n.space_id = $1 group by tag order by count(*) desc limit 40`,
    [spaceId],
  );
  const authors = await q<{ id: string; nickname: string; color: string; count: string }>(
    `select u.id, u.nickname, u.color, count(n.id)::text as count
     from nodes n join users u on u.id = n.author_id
     where n.space_id = $1 group by u.id, u.nickname, u.color order by count(n.id) desc limit 50`,
    [spaceId],
  );
  const domains = await q<{ value: string; count: string }>(
    `select attributes->>'domain' as value, count(*)::text as count from nodes
     where space_id = $1 and attributes ? 'domain' group by 1 order by count(*) desc`,
    [spaceId],
  );
  const types = await q<{ value: string; count: string }>(
    `select attributes->>'type' as value, count(*)::text as count from nodes
     where space_id = $1 and attributes ? 'type' group by 1 order by count(*) desc`,
    [spaceId],
  );
  return {
    tags: tags.map((t) => ({ tag: t.tag, count: Number(t.count) })),
    authors: authors.map((a) => ({ ...a, count: Number(a.count) })),
    domains: domains.map((d) => ({ value: d.value, count: Number(d.count) })),
    types: types.map((t) => ({ value: t.value, count: Number(t.count) })),
  };
}

export async function getGraph(spaceId: string) {
  const nodes = await q<NodeRow & { author_nickname: string; author_color: string; degree: number }>(
    `${NODE_SELECT} where n.space_id = $1 order by n.created_at desc limit 3000`,
    [spaceId],
  );
  const edges = await q<{ source_id: string; target_id: string; strength: number; relation: string }>(
    'select source_id, target_id, strength, relation from edges where space_id = $1 order by strength desc limit 9000',
    [spaceId],
  );
  const clusters = await q<{ id: string; label: string; summary: string; color: string; node_count: number }>(
    'select id, label, summary, color, node_count from clusters where space_id = $1 order by node_count desc',
    [spaceId],
  );
  return {
    nodes: nodes.map(publicNode),
    edges: edges.map((e) => ({ source: e.source_id, target: e.target_id, strength: e.strength, relation: e.relation })),
    clusters: clusters.map((c) => ({ ...c, node_count: Number(c.node_count) })),
  };
}

export async function nodeDetail(spaceId: string, nodeId: string) {
  const node = await one<NodeRow & { author_nickname: string; author_color: string; degree: number }>(
    `${NODE_SELECT} where n.space_id = $1 and n.id = $2`,
    [spaceId, nodeId],
  );
  if (!node) return null;
  const neighbors = await q<NodeRow & { author_nickname: string; author_color: string; degree: number; strength: number; relation: string }>(
    `select n.*, u.nickname as author_nickname, u.color as author_color, e.strength, e.relation,
            (select count(*) from edges e2 where e2.space_id = n.space_id and (e2.source_id = n.id or e2.target_id = n.id)) as degree
     from edges e
     join nodes n on n.id = case when e.source_id = $2 then e.target_id else e.source_id end
     join users u on u.id = n.author_id
     where e.space_id = $1 and (e.source_id = $2 or e.target_id = $2)
     order by e.strength desc limit 40`,
    [spaceId, nodeId],
  );
  return {
    node: publicNode(node),
    neighbors: neighbors.map((n) => ({ ...publicNode(n), strength: n.strength, relation: n.relation })),
  };
}

export async function clusterDetail(spaceId: string, clusterId: string) {
  const cluster = await one('select * from clusters where space_id = $1 and id = $2', [spaceId, clusterId]);
  if (!cluster) return null;
  const nodes = await q<NodeRow & { author_nickname: string; author_color: string; degree: number }>(
    `${NODE_SELECT} where n.space_id = $1 and n.cluster_id = $2 order by n.created_at desc limit 200`,
    [spaceId, clusterId],
  );
  return { cluster, nodes: nodes.map(publicNode) };
}
