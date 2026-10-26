import { q, one } from './db';
import { chat, extractJson, AUDIT_MODEL, LlmError } from './llm';
import { publish } from './events';
import type { IssueTree, IssueTreeBranch, IssueTreeNode } from './types';

type TreeNodeRow = { id: string; content: string; tags: string[]; cluster_id: string | null; degree: string };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * 思维收束：把空间里的发散问题压成一棵面向解题的议题树。
 * 只把模型生成的叶子和真实节点对齐；对不上的明确标成"缺口"。
 */
export async function generateTree(spaceId: string, userId: string | null) {
  const space = await one<{ title: string; direction: string }>('select title, direction from spaces where id = $1', [spaceId]);
  if (!space) throw new Error('空间不存在');

  const clusters = await q<{ label: string; node_count: string }>(
    'select label, node_count from clusters where space_id = $1 order by node_count desc',
    [spaceId],
  );

  const nodes = await q<TreeNodeRow>(
    `select n.id, n.content, n.tags, n.cluster_id,
            (select count(*) from edges e where e.space_id = n.space_id and (e.source_id = n.id or e.target_id = n.id))::text as degree
     from nodes n
     where n.space_id = $1 and n.status <> 'duplicate'
     order by (select count(*) from edges e where e.space_id = n.space_id and (e.source_id = n.id or e.target_id = n.id)) desc,
              n.created_at desc
     limit 60`,
    [spaceId],
  );
  if (nodes.length === 0) throw new Error('空间里还没有问题，先收一点再收束');

  const listing = nodes
    .map(
      (n, i) =>
        `[${i}] ${n.content.replace(/\s+/g, ' ').slice(0, 100)}${
          n.tags?.length ? `（标签：${n.tags.join('/')}）` : ''
        }`,
    )
    .join('\n');

  const clusterText = clusters.map((c) => `${c.label}(${c.node_count})`).join('、') || '尚未成簇';

  const started = Date.now();
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content:
        '你是资深产品与研究负责人，擅长把发散的问题集收束成互斥且合起来覆盖命题的议题树，并给出可执行的解题路径。只输出 JSON，不要解释。',
    },
    {
      role: 'user',
      content: `空间：${space.title}
命题：${space.direction || space.title}
现有聚类：${clusterText}

现有问题（编号是索引，用于对齐真实节点）：
${listing}

请把这堆问题收束成一棵"怎么解决这个命题"的议题树。要求：
1. 2-6 个一级分支，彼此互斥、合起来覆盖命题（MECE），按对结果的影响从大到小排序。
2. 每个分支 2-4 个具体问题。能对应到现有问题的用 nodeIndex 写它的索引；现有问题没覆盖到的关键盲区，写成 gap。
3. 每个问题给一句 solve：怎么验证它 / 怎么解（要具体到可执行，不要空话）。
4. 叶子必须是可以直接派给一个人或 Agent 去做的问题，不要出现"深入研究"这种空泛表述。
5. 分支给一句 why：为什么这条分支决定成败。
6. 最后给 3-5 条 next_actions：按顺序，谁先做什么。

输出 JSON：
{"root":{"question":"一句话把命题变成要回答的问题","summary":"30 字内说清收束思路"},
 "branches":[{"title":"分支名（2-8 字）","question":"这条分支要回答的问题","why":"为什么关键","children":[{"question":"具体问题","nodeIndex":0,"solve":"怎么解或怎么验证"},{"question":"现有问题没覆盖的盲区","nodeIndex":null,"solve":"..."}]}],
 "next_actions":["..."]}`,
    },
  ];

  // 收束比判关系更需要"想"，但推理型模型容易把 token 花在 reasoning 上。
  // 默认用快且便宜的 glm-5.3-flash；失败时退回 ds4.1 并放大预算。
  let result: Awaited<ReturnType<typeof chat>>;
  try {
    result = await chat(messages, {
      model: process.env.TREE_MODEL || 'z-ai/glm-5.3-flash',
      json: true,
      maxTokens: 4000,
      temperature: 0.2,
      timeoutMs: 90_000,
      title: 'Mindspace converge tree',
    });
  } catch {
    result = await chat(messages, {
      model: AUDIT_MODEL(),
      json: true,
      maxTokens: 7000,
      temperature: 0.2,
      timeoutMs: 120_000,
      title: 'Mindspace converge tree (fallback)',
    });
  }

  const parsed = extractJson<{
    root?: { question?: string; summary?: string };
    branches?: Array<{
      title?: string;
      question?: string;
      why?: string;
      children?: Array<{ question?: string; nodeIndex?: number | null; solve?: string }>;
    }>;
    next_actions?: unknown[];
  }>(result.text);
  if (!parsed) throw new LlmError('模型没有返回可解析的 JSON');

  const seen = new Set<string>();
  const branches: IssueTreeBranch[] = [];

  for (const [index, raw] of (parsed.branches ?? []).slice(0, 6).entries()) {
    const title = text(raw.title, 24);
    const branchQuestion = text(raw.question, 100);
    if (!title || !branchQuestion) continue;

    const children: IssueTreeNode[] = [];
    for (const [childIndex, child] of (Array.isArray(raw.children) ? raw.children : []).slice(0, 4).entries()) {
      const question = text(child.question, 120);
      if (!question || seen.has(question)) continue;
      seen.add(question);

      const nodeIndex = child.nodeIndex;
      const matched =
        typeof nodeIndex === 'number' && Number.isInteger(nodeIndex) && nodeIndex >= 0 && nodeIndex < nodes.length
          ? nodes[nodeIndex]
          : null;

      children.push({
        id: `b${index + 1}-${childIndex + 1}`,
        question,
        solve: text(child.solve, 160),
        kind: matched ? 'existing' : 'gap',
        nodeId: matched?.id ?? null,
      });
    }
    if (children.length === 0) continue;

    branches.push({
      id: `b${index + 1}`,
      title,
      question: branchQuestion,
      why: text(raw.why, 140),
      children,
    });
  }

  if (branches.length < 2) throw new LlmError('收束结果不成树，请稍后重试');

  const nextActions = (Array.isArray(parsed.next_actions) ? parsed.next_actions : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 120))
    .slice(0, 5);

  const tree: IssueTree = {
    root: {
      question: text(parsed.root?.question, 120) || space.direction || space.title,
      summary: text(parsed.root?.summary, 80),
    },
    branches,
    nextActions,
  };

  const existing = branches.reduce((sum, b) => sum + b.children.filter((c) => c.kind === 'existing').length, 0);
  const gaps = branches.reduce((sum, b) => sum + b.children.filter((c) => c.kind === 'gap').length, 0);
  const stats = {
    branches: branches.length,
    questions: existing + gaps,
    existing,
    gaps,
    considered: nodes.length,
    model: result.model,
    ms: Date.now() - started,
  };

  const row = await one<{ id: string; created_at: string }>(
    `insert into space_trees (space_id, model, tree, stats, created_by)
     values ($1, $2, $3, $4, $5) returning id, created_at`,
    [spaceId, result.model, JSON.stringify(tree), JSON.stringify(stats), userId],
  );

  publish(spaceId, 'tree.updated', { treeId: row?.id, stats });
  return { id: row?.id, tree, stats, created_at: row?.created_at };
}

export async function latestTree(spaceId: string) {
  return one<{ id: string; model: string; tree: IssueTree; stats: Record<string, unknown>; created_at: string }>(
    `select id, model, tree, stats, created_at from space_trees
     where space_id = $1 order by created_at desc limit 1`,
    [spaceId],
  );
}

export function treeToMarkdown(
  space: { title: string; direction: string },
  tree: IssueTree,
  meta: { created_at: string; stats: Record<string, unknown> },
): string {
  const lines: string[] = [];
  lines.push(`# ${space.title} · 问题树`, '');
  lines.push(`> 命题：${space.direction || space.title}`, '');
  lines.push(`**要回答的问题**：${tree.root.question}`, '');
  if (tree.root.summary) lines.push(`${tree.root.summary}`, '');
  lines.push(`_生成于 ${meta.created_at}${meta.stats?.model ? ` · ${meta.stats.model}` : ''}_`, '');

  for (const branch of tree.branches) {
    lines.push(`## ${branch.id.replace('b', '')}. ${branch.title}`);
    lines.push('');
    lines.push(`**核心问题**：${branch.question}`);
    if (branch.why) lines.push(`**为什么关键**：${branch.why}`);
    lines.push('');
    for (const child of branch.children) {
      const mark = child.kind === 'gap' ? '（缺口）' : '';
      lines.push(`- **${child.question}**${mark}`);
      if (child.solve) lines.push(`  - 怎么解：${child.solve}`);
    }
    lines.push('');
  }

  if (tree.nextActions.length) {
    lines.push('## 下一步');
    lines.push('');
    tree.nextActions.forEach((action, i) => lines.push(`${i + 1}. ${action}`));
    lines.push('');
  }
  return lines.join('\n');
}
