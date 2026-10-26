import { one, q } from './db';
import { chat, extractJson, AUDIT_MODEL, LlmError } from './llm';
import { publish } from './events';
import { createTask, taskDetail } from './tasks';
import type { IssueTree } from './types';

// 默认走地区可达的模型；Anthropic 模型在部分区域会被 OpenRouter 拒绝，
// 需要时用 RUN_MODEL / REVIEW_MODEL 显式覆盖。
const RUN_MODEL = () => process.env.RUN_MODEL || 'deepseek/deepseek-v4.1-flash';
const REVIEW_MODEL = () => process.env.REVIEW_MODEL || 'z-ai/glm-5.3-flash';

type ItemTaskRow = {
  id: string;
  tree_item_id: string | null;
  node_id: string | null;
  title: string;
  status: string;
  assignee: string | null;
  executor: string | null;
  updated_at: string;
};

function findTaskForItem(item: { nodeId: string | null; question: string }, tasks: ItemTaskRow[]) {
  return tasks.find(
    (task) => (item.nodeId && task.node_id === item.nodeId) || task.title === item.question,
  );
}

/** 每个树节点最近一条任务。跨树版本按 nodeId / 问题原文匹配，重新收束后状态不丢。 */
export async function treeTaskMap(spaceId: string, treeId: string) {
  const treeRow = await one<{ tree: IssueTree }>('select tree from space_trees where space_id = $1 and id = $2', [
    spaceId,
    treeId,
  ]);
  if (!treeRow) return {};

  const tasks = await q<ItemTaskRow>(
    `select id, tree_item_id, node_id, title, status, assignee, executor, updated_at
     from tasks where space_id = $1 order by created_at desc limit 500`,
    [spaceId],
  );

  const map: Record<string, ItemTaskRow> = {};
  for (const branch of treeRow.tree.branches) {
    for (const child of branch.children) {
      const task = findTaskForItem({ nodeId: child.nodeId, question: child.question }, tasks);
      if (task) map[child.id] = { ...task, tree_item_id: child.id };
    }
  }
  return map;
}

export type DispatchMode = 'gaps' | 'missing' | 'all' | 'selected';

/**
 * 把问题树的叶子派成任务。只派还没有"活跃任务"（open/claimed/submitted/approved）的条目。
 * 缺口（gap）没有 nodeId，任务只带树上下文；代表问题会同时挂到原节点上。
 */
export async function dispatchTree(opts: {
  spaceId: string;
  treeId: string;
  mode: DispatchMode;
  itemIds?: string[];
  createdBy: string | null;
  assignee?: string | null;
}) {
  const tree = await one<{ tree: IssueTree }>('select tree from space_trees where space_id = $1 and id = $2', [
    opts.spaceId,
    opts.treeId,
  ]);
  if (!tree) throw new Error('问题树不存在');

  const existingTasks = await q<ItemTaskRow>(
    `select id, tree_item_id, node_id, title, status, assignee, executor, updated_at
     from tasks where space_id = $1 order by created_at desc limit 500`,
    [opts.spaceId],
  );

  const selected = new Set(opts.itemIds ?? []);
  const created: Array<{ id: string; treeItemId: string; title: string }> = [];

  for (const branch of tree.tree.branches) {
    for (const child of branch.children) {
      const existing = findTaskForItem({ nodeId: child.nodeId, question: child.question }, existingTasks);
      // 已有进行中/待验收/已通过的同一问题，就不重复派
      if (existing && ['open', 'claimed', 'submitted', 'approved'].includes(existing.status)) continue;
      if (opts.mode === 'missing' && existing) continue;
      if (opts.mode === 'gaps' && child.kind !== 'gap') continue;
      if (opts.mode === 'selected' && !selected.has(child.id)) continue;

      const prompt = `命题：${tree.tree.root.question}
分支：${branch.title} —— ${branch.question}
要回答的问题：${child.question}
${child.solve ? `已有线索：${child.solve}` : ''}
${child.kind === 'gap' ? '注意：这是当前问题集没有覆盖到的盲区，请先给出判断，再说明依据。' : ''}

交付要求：直接回答，不要复述问题；给出结论、依据/例子、以及可落地的下一步，控制在 600 字以内。`;

      const task = await createTask({
        spaceId: opts.spaceId,
        nodeId: child.nodeId,
        title: child.question,
        prompt,
        priority: child.kind === 'gap' ? 1 : 2,
        createdBy: opts.createdBy,
        assignee: opts.assignee ?? null,
        treeId: opts.treeId,
        treeItemId: child.id,
        context: {
          treeId: opts.treeId,
          branchId: branch.id,
          branchTitle: branch.title,
          branchQuestion: branch.question,
          proposition: tree.tree.root.question,
          kind: child.kind,
          solve: child.solve,
        },
      });
      created.push({ id: task.id, treeItemId: child.id, title: task.title });
    }
  }

  return { created: created.length, tasks: created };
}

type ExecContext = {
  title: string;
  prompt: string;
  status: string;
  assignee: string | null;
  result: string | null;
  context: Record<string, unknown> | null;
  node_content: string | null;
  space_title: string;
  space_direction: string;
};

async function execContext(spaceId: string, taskId: string): Promise<ExecContext | null> {
  return one<ExecContext>(
    `select t.title, t.prompt, t.status, t.assignee, t.result, t.context,
            n.content as node_content, s.title as space_title, s.direction as space_direction
     from tasks t
     join spaces s on s.id = t.space_id
     left join nodes n on n.id = t.node_id
     where t.space_id = $1 and t.id = $2`,
    [spaceId, taskId],
  );
}

/** 托管执行：服务端直接调 Claude 模型把任务做掉，结果回到同一条反馈链路。 */
export async function runTaskHosted(opts: { spaceId: string; taskId: string; model?: string; actorName: string }) {
  const ctx = await execContext(opts.spaceId, opts.taskId);
  if (!ctx) throw new Error('任务不存在');
  if (ctx.status === 'approved') throw new Error('任务已验收，不再执行');

  const model = opts.model || RUN_MODEL();
  const assignee = opts.actorName;

  await q(
    `update tasks set status = 'claimed', assignee = $2, executor = $3, started_at = now(), updated_at = now()
     where id = $1`,
    [opts.taskId, assignee, `hosted:${model}`],
  );
  await q(
    `insert into task_events (task_id, actor_type, actor_name, type, message, payload)
     values ($1, 'agent', $2, 'claim', $3, $4)`,
    [opts.taskId, assignee, `托管执行 · ${model}`, JSON.stringify({ executor: 'hosted', model })],
  );
  publish(opts.spaceId, 'task.updated', { taskId: opts.taskId });

  const branchTitle = typeof ctx.context?.branchTitle === 'string' ? ctx.context.branchTitle : '';
  const proposition = typeof ctx.context?.proposition === 'string' ? ctx.context.proposition : ctx.space_direction;

  const started = Date.now();
  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            '你是思维空间里的执行 Agent。你收到的是一个具体问题，直接交付可执行结论：先给答案，再给依据，最后给下一步。不要复述问题，不要写"作为一个 AI"。中文输出，600 字以内。',
        },
        {
          role: 'user',
          content: `空间：${ctx.space_title}
命题：${proposition || ctx.space_title}
${branchTitle ? `所属分支：${branchTitle}` : ''}
${ctx.node_content ? `空间中原始问题：${ctx.node_content}` : ''}

任务：${ctx.title}

${ctx.prompt}`,
        },
      ],
      { model, maxTokens: 6000, temperature: 0.35, timeoutMs: 150_000, title: 'Mindspace hosted executor' },
    );

    const text = result.text.trim().slice(0, 20_000);
    if (!text) throw new LlmError('执行结果为空');

    await q(
      `update tasks set result = $2, result_meta = $3, status = 'submitted', updated_at = now() where id = $1`,
      [
        opts.taskId,
        text,
        JSON.stringify({
          executor: 'hosted',
          model: result.model,
          ms: Date.now() - started,
          usage: result.usage ?? {},
        }),
      ],
    );
    await q(
      `insert into task_events (task_id, actor_type, actor_name, type, message, payload)
       values ($1, 'agent', $2, 'result', $3, $4)`,
      [
        opts.taskId,
        assignee,
        `已交付 ${text.length} 字 · ${result.model}`,
        JSON.stringify({ executor: 'hosted', model: result.model, ms: Date.now() - started }),
      ],
    );
    publish(opts.spaceId, 'task.updated', { taskId: opts.taskId });
    return taskDetail(opts.spaceId, opts.taskId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await q(
      `insert into task_events (task_id, actor_type, actor_name, type, message) values ($1, 'agent', $2, 'progress', $3)`,
      [opts.taskId, assignee, `执行失败：${message.slice(0, 500)}`],
    );
    await q(`update tasks set status = 'claimed', updated_at = now() where id = $1`, [opts.taskId]);
    publish(opts.spaceId, 'task.updated', { taskId: opts.taskId });
    throw err;
  }
}

/** Agent 验收：Claude 按任务要求给分和理由；可以按阈值直接落验收结果。 */
export async function autoReviewTask(opts: {
  spaceId: string;
  taskId: string;
  apply?: boolean;
  threshold?: number;
  reviewer?: string;
}) {
  const ctx = await execContext(opts.spaceId, opts.taskId);
  if (!ctx) throw new Error('任务不存在');
  if (!ctx.result) throw new Error('任务还没有结果可验收');
  if (ctx.status === 'approved') throw new Error('已经通过验收');

  const reviewer = opts.reviewer || 'reviewer';
  const model = REVIEW_MODEL();
  const started = Date.now();

  const result = await chat(
    [
      {
        role: 'system',
        content:
          '你是严格的验收 Agent。判断交付结果是否真正回答了任务，是否具体、可执行、有依据。只输出 JSON，不要客套。',
      },
      {
        role: 'user',
        content: `空间命题：${ctx.space_direction || ctx.space_title}
任务：${ctx.title}
任务要求：
${ctx.prompt}

交付结果：
${ctx.result.slice(0, 8000)}

请打分并判断：
- score 0-100：90+ 可直接采用；70-89 基本可用但需补充；<70 不通过
- decision: "approve" 或 "reject"
- reasons: 2-3 条（为什么给这个分）
- missing: 还缺什么（没有就给空数组）

输出：{"score":82,"decision":"approve","reasons":["..."],"missing":["..."]}`,
      },
    ],
    { model, json: true, maxTokens: 1200, temperature: 0.1, timeoutMs: 90_000, title: 'Mindspace auto review' },
  );

  const parsed = extractJson<{ score?: number; decision?: string; reasons?: unknown[]; missing?: unknown[] }>(result.text);
  if (!parsed) throw new LlmError('验收结果无法解析');

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const decision = parsed.decision === 'approve' && score >= (opts.threshold ?? 70) ? 'approve' : 'reject';
  const reasons = (Array.isArray(parsed.reasons) ? parsed.reasons : [])
    .filter((r): r is string => typeof r === 'string')
    .slice(0, 4);
  const missing = (Array.isArray(parsed.missing) ? parsed.missing : [])
    .filter((r): r is string => typeof r === 'string')
    .slice(0, 4);

  await q(
    `insert into task_events (task_id, actor_type, actor_name, type, message, payload)
     values ($1, 'agent', $2, 'review_suggestion', $3, $4)`,
    [
      opts.taskId,
      `agent:${reviewer}`,
      `AI 预审 ${score} 分 · ${decision === 'approve' ? '建议通过' : '建议退回'}`,
      JSON.stringify({ score, decision, reasons, missing, model: result.model, ms: Date.now() - started }),
    ],
  );

  let applied = false;
  if (opts.apply && decision === 'approve') {
    await q(
      `update tasks set status = 'approved', closed_at = now(), updated_at = now() where id = $1`,
      [opts.taskId],
    );
    await q(
      `insert into task_events (task_id, actor_type, actor_name, type, message, payload)
       values ($1, 'agent', $2, 'review', $3, $4)`,
      [
        opts.taskId,
        `agent:${reviewer}`,
        `AI 验收通过（${score} 分）`,
        JSON.stringify({ decision: 'approve', score, auto: true, model: result.model }),
      ],
    );
    applied = true;
  }

  publish(opts.spaceId, 'task.updated', { taskId: opts.taskId });
  return { score, decision, reasons, missing, applied, model: result.model };
}

/** 运维视图：谁在跑、什么卡住、树是否过期。 */
export async function opsSnapshot(spaceId: string) {
  const counts = await q<{ status: string; count: string }>(
    'select status, count(*)::text as count from tasks where space_id = $1 group by status',
    [spaceId],
  );
  const statusCounts: Record<string, number> = { open: 0, claimed: 0, submitted: 0, approved: 0, rejected: 0 };
  for (const row of counts) statusCounts[row.status] = Number(row.count);

  const active = await q<{
    id: string;
    title: string;
    status: string;
    assignee: string | null;
    executor: string | null;
    updated_at: string;
    minutes: string;
  }>(
    `select id, title, status, assignee, executor, updated_at,
            round(extract(epoch from (now() - updated_at)) / 60)::text as minutes
     from tasks
     where space_id = $1 and status in ('claimed','submitted')
     order by updated_at asc limit 50`,
    [spaceId],
  );

  const stale = active.filter((task) => task.status === 'claimed' && Number(task.minutes) >= 15);
  const awaiting = active.filter((task) => task.status === 'submitted');

  const agents = await q<{ assignee: string; count: string; last_at: string }>(
    `select assignee, count(*)::text as count, max(updated_at) as last_at
     from tasks where space_id = $1 and assignee is not null group by assignee order by max(updated_at) desc`,
    [spaceId],
  );

  const tree = await one<{ id: string; created_at: string; stats: Record<string, unknown> }>(
    'select id, created_at, stats from space_trees where space_id = $1 order by created_at desc limit 1',
    [spaceId],
  );
  const treeTasks = tree ? await treeTaskMap(spaceId, tree.id) : {};
  const nodeCount = await one<{ n: string }>('select count(*)::text as n from nodes where space_id = $1', [spaceId]);
  const nodesAfter = tree
    ? await one<{ n: string }>('select count(*)::text as n from nodes where space_id = $1 and created_at > $2', [
        spaceId,
        tree.created_at,
      ])
    : null;

  const lastAudit = await one<{ started_at: string; stats: Record<string, unknown> }>(
    'select started_at, stats from audit_runs where space_id = $1 order by started_at desc limit 1',
    [spaceId],
  );

  const recent = await q<{
    id: string;
    type: string;
    actor_name: string;
    message: string;
    created_at: string;
    task_id: string;
  }>(
    `select e.id, e.type, e.actor_name, e.message, e.created_at, e.task_id
     from task_events e join tasks t on t.id = e.task_id
     where t.space_id = $1 order by e.id desc limit 20`,
    [spaceId],
  );

  return {
    counts: statusCounts,
    agents: agents.map((a) => ({ ...a, count: Number(a.count) })),
    active: active.map((t) => ({ ...t, minutes: Number(t.minutes) })),
    stale,
    awaiting,
    tree: tree
      ? {
          id: tree.id,
          created_at: tree.created_at,
          nodes_after: Number(nodesAfter?.n ?? 0),
          dispatched: Object.keys(treeTasks).length,
          approved: Object.values(treeTasks).filter((t) => t.status === 'approved').length,
          stale: Number(nodesAfter?.n ?? 0) >= 5,
        }
      : null,
    nodes: Number(nodeCount?.n ?? 0),
    last_audit: lastAudit,
    recent,
  };
}
