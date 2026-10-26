import { q, one } from './db';

export async function spaceStats(spaceId: string) {
  const counts = await one<{
    nodes: string;
    edges: string;
    clusters: string;
    members: string;
    duplicates: string;
    authors: string;
  }>(
    `select
       (select count(*) from nodes where space_id = $1) as nodes,
       (select count(*) from edges where space_id = $1) as edges,
       (select count(*) from clusters where space_id = $1) as clusters,
       (select count(*) from space_members where space_id = $1) as members,
       (select count(*) from nodes where space_id = $1 and status = 'duplicate') as duplicates,
       (select count(distinct author_id) from nodes where space_id = $1) as authors`,
    [spaceId],
  );

  const tasks = await q<{ status: string; count: string }>(
    'select status, count(*)::text as count from tasks where space_id = $1 group by status',
    [spaceId],
  );
  const taskCounts: Record<string, number> = { open: 0, claimed: 0, submitted: 0, approved: 0, rejected: 0 };
  for (const row of tasks) taskCounts[row.status] = Number(row.count);

  const daily = await q<{ day: string; count: string }>(
    `select to_char(date_trunc('day', created_at), 'MM-DD') as day, count(*)::text as count
     from nodes where space_id = $1 and created_at > now() - interval '14 days'
     group by 1, date_trunc('day', created_at) order by date_trunc('day', created_at)`,
    [spaceId],
  );

  const topTags = await q<{ tag: string; count: string }>(
    `select tag, count(*)::text as count from nodes n, jsonb_array_elements_text(n.tags) as tag
     where n.space_id = $1 group by tag order by count(*) desc limit 12`,
    [spaceId],
  );

  const contributors = await q<{ id: string; nickname: string; color: string; count: string }>(
    `select u.id, u.nickname, u.color, count(n.id)::text as count
     from nodes n join users u on u.id = n.author_id
     where n.space_id = $1 group by u.id, u.nickname, u.color order by count(n.id) desc limit 10`,
    [spaceId],
  );

  const audits = await q(
    `select id, model, status, stats, notes, started_at, finished_at
     from audit_runs where space_id = $1 order by started_at desc limit 5`,
    [spaceId],
  );

  const activity = await q<{ type: string; payload: Record<string, unknown>; created_at: string }>(
    `select type, payload, created_at from space_events where space_id = $1 order by id desc limit 40`,
    [spaceId],
  );

  return {
    nodes: Number(counts?.nodes ?? 0),
    edges: Number(counts?.edges ?? 0),
    clusters: Number(counts?.clusters ?? 0),
    members: Number(counts?.members ?? 0),
    duplicates: Number(counts?.duplicates ?? 0),
    authors: Number(counts?.authors ?? 0),
    tasks: taskCounts,
    daily: daily.map((d) => ({ day: d.day, count: Number(d.count) })),
    topTags: topTags.map((t) => ({ tag: t.tag, count: Number(t.count) })),
    contributors: contributors.map((c) => ({ ...c, count: Number(c.count) })),
    audits,
    activity,
  };
}

export async function members(spaceId: string) {
  return q<{ id: string; nickname: string; color: string; role: string; joined_at: string; nodes: string }>(
    `select u.id, u.nickname, u.color, m.role, m.joined_at,
            (select count(*) from nodes n where n.space_id = m.space_id and n.author_id = u.id)::text as nodes
     from space_members m join users u on u.id = m.user_id
     where m.space_id = $1 order by
       case m.role when 'owner' then 0 when 'collector' then 1 else 2 end, m.joined_at`,
    [spaceId],
  );
}

export async function exportSpace(spaceId: string, format: 'json' | 'csv' | 'md') {
  const space = await one<{ title: string; direction: string; slug: string }>(
    'select title, direction, slug from spaces where id = $1',
    [spaceId],
  );
  const nodes = await q<{
    id: string;
    content: string;
    kind: string;
    tags: string[];
    attributes: Record<string, string>;
    cluster_id: string | null;
    status: string;
    created_at: string;
    nickname: string;
  }>(
    `select n.id, n.content, n.kind, n.tags, n.attributes, n.cluster_id, n.status, n.created_at, u.nickname
     from nodes n join users u on u.id = n.author_id where n.space_id = $1 order by n.created_at`,
    [spaceId],
  );
  const edges = await q<{ source_id: string; target_id: string; strength: number; relation: string }>(
    'select source_id, target_id, strength, relation from edges where space_id = $1',
    [spaceId],
  );
  const clusters = await q<{ id: string; label: string; summary: string; node_count: number }>(
    'select id, label, summary, node_count from clusters where space_id = $1 order by node_count desc',
    [spaceId],
  );
  const tasks = await q('select * from tasks where space_id = $1 order by created_at desc', [spaceId]);

  if (format === 'json') {
    return JSON.stringify({ space, exported_at: new Date().toISOString(), nodes, edges, clusters, tasks }, null, 2);
  }

  if (format === 'csv') {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['id', 'content', 'author', 'kind', 'tags', 'domain', 'type', 'cluster', 'status', 'created_at'];
    const clusterLabel = new Map(clusters.map((c) => [c.id, c.label]));
    const rows = nodes.map((n) =>
      [
        n.id,
        n.content,
        n.nickname,
        n.kind,
        (n.tags ?? []).join('|'),
        n.attributes?.domain ?? '',
        n.attributes?.type ?? '',
        n.cluster_id ? (clusterLabel.get(n.cluster_id) ?? '') : '',
        n.status,
        n.created_at,
      ]
        .map(escape)
        .join(','),
    );
    return `﻿${header.join(',')}\n${rows.join('\n')}`;
  }

  const lines: string[] = [`# ${space?.title ?? '思维空间'}`, '', `方向：${space?.direction ?? ''}`, ''];
  const byCluster = new Map<string | null, typeof nodes>();
  for (const node of nodes) {
    const list = byCluster.get(node.cluster_id) ?? [];
    list.push(node);
    byCluster.set(node.cluster_id, list);
  }
  for (const cluster of clusters) {
    const list = byCluster.get(cluster.id) ?? [];
    lines.push(`## ${cluster.label}（${list.length}）`);
    if (cluster.summary) lines.push(`> ${cluster.summary}`);
    for (const node of list) {
      const tags = (node.tags ?? []).map((t) => `\`${t}\``).join(' ');
      lines.push(`- ${node.content} — ${node.nickname} ${tags}`);
    }
    lines.push('');
  }
  const loose = byCluster.get(null) ?? [];
  if (loose.length) {
    lines.push(`## 未归类（${loose.length}）`);
    for (const node of loose) lines.push(`- ${node.content} — ${node.nickname}`);
    lines.push('');
  }
  if (tasks.length) {
    lines.push('## 派发任务');
    for (const task of tasks as Array<{ title: string; status: string; assignee?: string; result?: string }>) {
      lines.push(`- [${task.status}] ${task.title}${task.assignee ? ` @${task.assignee}` : ''}`);
      if (task.result) lines.push(`  - 结果：${task.result.slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}
