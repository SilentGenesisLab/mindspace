import { one, q } from './db';
import { chat, extractJson, LlmError } from './llm';
import { publish } from './events';
import { createTask } from './tasks';
import { acceptanceList, autoReviewTask, runTaskHosted, RUN_MODEL } from './execution';
import type { IssueTree } from './types';

/**
 * 表单视图：核心命题 → 分支/子模块（可嵌套）→ 具体问题 + 验收标准。
 * 每次「AI 执行」是一条带 board_item_id 的任务，跑完自动交给验收 Agent，
 * 所以执行、验收、人工复核都落在同一条任务反馈链路里。
 */

export type BoardHeader = { need: string; proposition: string; principles: string; kpi: string; model: string };

export type BoardAutomation = {
  enabled: boolean;
  interval_minutes: number;
  max_attempts: number;
  last_run_at: string | null;
  last_result: Record<string, unknown> | null;
  updated_at: string | null;
};

export type BoardSection = {
  id: string;
  parent_id: string | null;
  title: string;
  description: string;
  position: number;
  created_by: string | null;
};

export type BoardAttempt = {
  taskId: string;
  n: number;
  status: 'open' | 'claimed' | 'submitted' | 'approved' | 'rejected';
  executor: string | null;
  score: number | null;
  reasons: string[];
  missing: string[];
  checks: Array<{ criterion: string; pass: boolean; note: string }>;
  error: string | null;
  manual: boolean;
  chars: number;
  created_at: string;
  updated_at: string;
};

export type ItemState = 'todo' | 'queued' | 'running' | 'reviewing' | 'passed' | 'failed';

export type BoardItem = {
  id: string;
  section_id: string;
  raw: string;
  rewrite: string;
  urgency: string;
  acceptance: string;
  feedback: string;
  position: number;
  node_id: string | null;
  created_by: string | null;
  author: string | null;
  created_at: string;
  updated_at: string;
  attempts: BoardAttempt[];
  state: ItemState;
};

export const URGENCY = ['P0', 'P1', 'P2'] as const;
const STALE_MINUTES = 12;
const RUN_CONCURRENCY = 2;

function text(value: unknown, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizeHeader(input: Partial<BoardHeader> | null | undefined): BoardHeader {
  return {
    need: text(input?.need, 2000),
    proposition: text(input?.proposition, 600),
    principles: text(input?.principles, 2000),
    kpi: text(input?.kpi, 1000),
    model: text(input?.model, 120),
  };
}

function stateOf(attempts: BoardAttempt[]): ItemState {
  const last = attempts[attempts.length - 1];
  if (!last) return 'todo';
  switch (last.status) {
    case 'open':
      return 'queued';
    case 'claimed':
      return 'running';
    case 'submitted':
      return 'reviewing';
    case 'approved':
      return 'passed';
    default:
      return 'failed';
  }
}

type AttemptRow = {
  id: string;
  board_item_id: string;
  status: BoardAttempt['status'];
  executor: string | null;
  result_len: number;
  created_at: string;
  updated_at: string;
  review: Record<string, unknown> | null;
  verdict: Record<string, unknown> | null;
  verdict_auto: boolean | null;
  last_error: string | null;
};

async function attemptsFor(spaceId: string, itemIds?: string[]) {
  const params: unknown[] = [spaceId];
  let clause = 'and t.board_item_id is not null';
  if (itemIds) {
    params.push(itemIds);
    clause = 'and t.board_item_id = any($2::uuid[])';
  }
  const rows = await q<AttemptRow>(
    `select t.id, t.board_item_id, t.status, t.executor, coalesce(length(t.result), 0)::int as result_len,
            t.created_at, t.updated_at,
            (select e.payload from task_events e where e.task_id = t.id and e.type = 'review_suggestion'
              order by e.id desc limit 1) as review,
            (select e.payload from task_events e where e.task_id = t.id and e.type = 'review'
              order by e.id desc limit 1) as verdict,
            (select (e.payload->>'auto')::boolean from task_events e where e.task_id = t.id and e.type = 'review'
              order by e.id desc limit 1) as verdict_auto,
            (select e.message from task_events e where e.task_id = t.id and e.type = 'progress'
               and e.message like '执行失败%' order by e.id desc limit 1) as last_error
     from tasks t
     where t.space_id = $1 ${clause}
     order by t.created_at asc`,
    params,
  );

  const byItem = new Map<string, BoardAttempt[]>();
  for (const row of rows) {
    const list = byItem.get(row.board_item_id) ?? [];
    const review = row.review ?? {};
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    list.push({
      taskId: row.id,
      n: list.length + 1,
      status: row.status,
      executor: row.executor,
      score: typeof review.score === 'number' ? review.score : null,
      reasons: strings(review.reasons),
      missing: strings(review.missing),
      checks: Array.isArray(review.checks) ? (review.checks as BoardAttempt['checks']) : [],
      error: row.status === 'rejected' && !row.review ? row.last_error : null,
      manual: Boolean(row.verdict) && row.verdict_auto !== true,
      chars: row.result_len,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    byItem.set(row.board_item_id, list);
  }
  return byItem;
}

export async function getBoard(spaceId: string) {
  const space = await one<{ title: string; direction: string; board: Partial<BoardHeader> }>(
    'select title, direction, board from spaces where id = $1',
    [spaceId],
  );
  const header = normalizeHeader(space?.board);
  if (!header.proposition && space?.direction) header.proposition = space.direction;
  const sections = await q<BoardSection>(
    `select id, parent_id, title, description, position, created_by
     from board_sections where space_id = $1 order by position asc, created_at asc`,
    [spaceId],
  );
  const items = await q<Omit<BoardItem, 'attempts' | 'state'>>(
    `select i.id, i.section_id, i.raw, i.rewrite, i.urgency, i.acceptance, i.feedback, i.position, i.node_id,
            i.created_by, u.nickname as author, i.created_at, i.updated_at
     from board_items i left join users u on u.id = i.created_by
     where i.space_id = $1 order by i.position asc, i.created_at asc`,
    [spaceId],
  );
  const attempts = await attemptsFor(spaceId);
  const full: BoardItem[] = items.map((item) => {
    const list = attempts.get(item.id) ?? [];
    return { ...item, attempts: list, state: stateOf(list) };
  });

  const stats = { items: full.length, passed: 0, failed: 0, running: 0, todo: 0 };
  for (const item of full) {
    if (item.state === 'passed') stats.passed++;
    else if (item.state === 'failed') stats.failed++;
    else if (item.state === 'todo') stats.todo++;
    else stats.running++;
  }

  return { header, sections, items: full, stats, automation: await getAutomation(spaceId) };
}

export const AUTOMATION_DEFAULTS = { enabled: false, interval_minutes: 5, max_attempts: 3 };

export async function getAutomation(spaceId: string): Promise<BoardAutomation> {
  const row = await one<BoardAutomation>(
    `select enabled, interval_minutes, max_attempts, last_run_at, last_result, updated_at
     from board_automations where space_id = $1`,
    [spaceId],
  );
  return row ?? { ...AUTOMATION_DEFAULTS, last_run_at: null, last_result: null, updated_at: null };
}

export async function saveAutomation(
  spaceId: string,
  input: { enabled?: boolean; intervalMinutes?: number; maxAttempts?: number },
  updatedBy: string | null,
) {
  const current = await getAutomation(spaceId);
  const interval = Math.min(1440, Math.max(1, Math.round(Number(input.intervalMinutes ?? current.interval_minutes) || 5)));
  const attempts = Math.min(10, Math.max(1, Math.round(Number(input.maxAttempts ?? current.max_attempts) || 3)));
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : current.enabled;
  const row = await one<BoardAutomation>(
    `insert into board_automations (space_id, enabled, interval_minutes, max_attempts, updated_by)
     values ($1, $2, $3, $4, $5)
     on conflict (space_id) do update set
       enabled = excluded.enabled, interval_minutes = excluded.interval_minutes,
       max_attempts = excluded.max_attempts, updated_by = excluded.updated_by, updated_at = now()
     returning enabled, interval_minutes, max_attempts, last_run_at, last_result, updated_at`,
    [spaceId, enabled, interval, attempts, updatedBy],
  );
  publish(spaceId, 'board.updated', { part: 'automation' });
  return row!;
}

export async function saveHeader(spaceId: string, input: Partial<BoardHeader>) {
  const header = normalizeHeader(input);
  await q('update spaces set board = $2 where id = $1', [spaceId, JSON.stringify(header)]);
  publish(spaceId, 'board.updated', { part: 'header' });
  return header;
}

async function nextPosition(table: 'board_sections' | 'board_items', column: string, spaceId: string, scope: string | null) {
  const row = await one<{ p: number | null }>(
    `select max(position) as p from ${table} where space_id = $1 and ${column} is not distinct from $2`,
    [spaceId, scope],
  );
  return (row?.p ?? 0) + 1;
}

async function sectionDepth(spaceId: string, sectionId: string) {
  const row = await one<{ depth: number }>(
    `with recursive up as (
       select id, parent_id, 1 as depth from board_sections where space_id = $1 and id = $2
       union all
       select s.id, s.parent_id, up.depth + 1 from board_sections s join up on s.id = up.parent_id
     ) select max(depth)::int as depth from up`,
    [spaceId, sectionId],
  );
  return row?.depth ?? 0;
}

export async function createSection(opts: {
  spaceId: string;
  parentId?: string | null;
  title: string;
  description?: string;
  createdBy: string | null;
}) {
  const title = text(opts.title, 120);
  if (title.length < 1) throw new Error('分支名不能为空');
  const parentId = opts.parentId || null;
  if (parentId) {
    const depth = await sectionDepth(opts.spaceId, parentId);
    if (depth === 0) throw new Error('上级分支不存在');
    if (depth >= 3) throw new Error('最多三层：分支 → 子模块 → 子模块');
  }
  const section = await one<BoardSection>(
    `insert into board_sections (space_id, parent_id, title, description, position, created_by)
     values ($1, $2, $3, $4, $5, $6)
     returning id, parent_id, title, description, position, created_by`,
    [
      opts.spaceId,
      parentId,
      title,
      text(opts.description, 1000),
      await nextPosition('board_sections', 'parent_id', opts.spaceId, parentId),
      opts.createdBy,
    ],
  );
  publish(opts.spaceId, 'board.updated', { part: 'section' });
  return section!;
}

export async function updateSection(spaceId: string, id: string, input: { title?: string; description?: string; position?: number }) {
  const section = await one<BoardSection>(
    `update board_sections set
       title = coalesce($3, title),
       description = coalesce($4, description),
       position = coalesce($5, position),
       updated_at = now()
     where space_id = $1 and id = $2
     returning id, parent_id, title, description, position, created_by`,
    [
      spaceId,
      id,
      input.title === undefined ? null : text(input.title, 120) || null,
      input.description === undefined ? null : text(input.description, 1000),
      typeof input.position === 'number' && Number.isFinite(input.position) ? input.position : null,
    ],
  );
  if (!section) throw new Error('分支不存在');
  publish(spaceId, 'board.updated', { part: 'section' });
  return section;
}

export async function deleteSection(spaceId: string, id: string) {
  const res = await q<{ id: string }>('delete from board_sections where space_id = $1 and id = $2 returning id', [spaceId, id]);
  if (!res.length) throw new Error('分支不存在');
  publish(spaceId, 'board.updated', { part: 'section' });
}

type ItemInput = { raw?: string; rewrite?: string; urgency?: string; acceptance?: string; feedback?: string; position?: number };

function itemFields(input: ItemInput) {
  return {
    raw: input.raw === undefined ? undefined : text(input.raw, 1000),
    rewrite: input.rewrite === undefined ? undefined : text(input.rewrite, 1000),
    urgency:
      input.urgency === undefined ? undefined : (URGENCY as readonly string[]).includes(input.urgency) ? input.urgency : 'P1',
    acceptance: input.acceptance === undefined ? undefined : text(input.acceptance, 2000),
    feedback: input.feedback === undefined ? undefined : text(input.feedback, 2000),
  };
}

export async function createItem(opts: { spaceId: string; sectionId: string; createdBy: string | null; nodeId?: string | null } & ItemInput) {
  const fields = itemFields(opts);
  if (!fields.raw || fields.raw.length < 2) throw new Error('问题/需求至少 2 个字');
  const section = await one('select id from board_sections where space_id = $1 and id = $2', [opts.spaceId, opts.sectionId]);
  if (!section) throw new Error('分支不存在');
  const item = await one<{ id: string }>(
    `insert into board_items (space_id, section_id, raw, rewrite, urgency, acceptance, feedback, position, node_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      opts.spaceId,
      opts.sectionId,
      fields.raw,
      fields.rewrite ?? '',
      fields.urgency ?? 'P1',
      fields.acceptance ?? '',
      fields.feedback ?? '',
      await nextPosition('board_items', 'section_id', opts.spaceId, opts.sectionId),
      opts.nodeId ?? null,
      opts.createdBy,
    ],
  );
  publish(opts.spaceId, 'board.updated', { part: 'item', itemId: item!.id });
  return item!;
}

export async function getItemOwner(spaceId: string, id: string) {
  return one<{ id: string; created_by: string | null }>('select id, created_by from board_items where space_id = $1 and id = $2', [
    spaceId,
    id,
  ]);
}

export async function updateItem(spaceId: string, id: string, input: ItemInput & { sectionId?: string }) {
  const fields = itemFields(input);
  if (fields.raw !== undefined && fields.raw.length < 2) throw new Error('问题/需求至少 2 个字');
  if (input.sectionId) {
    const section = await one('select id from board_sections where space_id = $1 and id = $2', [spaceId, input.sectionId]);
    if (!section) throw new Error('目标分支不存在');
  }
  const row = await one<{ id: string }>(
    `update board_items set
       raw = coalesce($3, raw), rewrite = coalesce($4, rewrite), urgency = coalesce($5, urgency),
       acceptance = coalesce($6, acceptance), feedback = coalesce($7, feedback),
       section_id = coalesce($8, section_id), position = coalesce($9, position), updated_at = now()
     where space_id = $1 and id = $2 returning id`,
    [
      spaceId,
      id,
      fields.raw ?? null,
      fields.rewrite ?? null,
      fields.urgency ?? null,
      fields.acceptance ?? null,
      fields.feedback ?? null,
      input.sectionId ?? null,
      typeof input.position === 'number' && Number.isFinite(input.position) ? input.position : null,
    ],
  );
  if (!row) throw new Error('条目不存在');
  publish(spaceId, 'board.updated', { part: 'item', itemId: id });
  return row;
}

export async function deleteItem(spaceId: string, id: string) {
  const res = await q<{ id: string }>('delete from board_items where space_id = $1 and id = $2 returning id', [spaceId, id]);
  if (!res.length) throw new Error('条目不存在');
  publish(spaceId, 'board.updated', { part: 'item', itemId: id });
}

type ItemContext = {
  id: string;
  raw: string;
  rewrite: string;
  urgency: string;
  acceptance: string;
  feedback: string;
  node_id: string | null;
  section_id: string;
};

async function sectionPath(spaceId: string, sectionId: string) {
  const rows = await q<{ title: string; description: string }>(
    `with recursive up as (
       select id, parent_id, title, description, 0 as d from board_sections where space_id = $1 and id = $2
       union all
       select s.id, s.parent_id, s.title, s.description, up.d + 1 from board_sections s join up on s.id = up.parent_id
     ) select title, description from up order by d desc`,
    [spaceId, sectionId],
  );
  return rows;
}

// 进程内执行队列：同一时刻最多 RUN_CONCURRENCY 个托管执行，避免一次点「全部执行」把模型打满。
const globalForQueue = globalThis as unknown as {
  __msBoardQueue?: {
    pending: Array<{ spaceId: string; taskId: string; model: string }>;
    running: Set<string>;
    active: number;
  };
};
const queue = (globalForQueue.__msBoardQueue ??= { pending: [], running: new Set(), active: 0 });

function pump() {
  while (queue.active < RUN_CONCURRENCY && queue.pending.length) {
    const job = queue.pending.shift()!;
    queue.active++;
    void executeAttempt(job.spaceId, job.taskId, job.model).finally(() => {
      queue.active--;
      queue.running.delete(job.taskId);
      pump();
    });
  }
}

async function executeAttempt(spaceId: string, taskId: string, model: string) {
  try {
    await runTaskHosted({ spaceId, taskId, actorName: 'board-runner', model });
  } catch (err) {
    // 执行失败算这一次尝试失败，下次点执行会开新的一次
    await q(`update tasks set status = 'rejected', closed_at = now(), updated_at = now() where id = $1`, [taskId]);
    publish(spaceId, 'task.updated', { taskId });
    console.error('[board] run failed', taskId, err instanceof Error ? err.message : err);
    return;
  }
  try {
    await autoReviewTask({ spaceId, taskId, apply: true, applyReject: true, threshold: 70, reviewer: 'acceptance-agent' });
  } catch (err) {
    // 验收失败不改状态，停在「待验收」，页面上可以再点一次验收
    const message = err instanceof Error ? err.message : String(err);
    await q(
      `insert into task_events (task_id, actor_type, actor_name, type, message) values ($1, 'agent', 'agent:acceptance-agent', 'note', $2)`,
      [taskId, `验收 Agent 没能给出结论：${message.slice(0, 300)}`],
    );
    publish(spaceId, 'task.updated', { taskId });
  }
}

function attemptIsLive(attempt: BoardAttempt) {
  if (queue.running.has(attempt.taskId)) return true;
  if (attempt.status === 'submitted') return true;
  if (attempt.status === 'open' || attempt.status === 'claimed') {
    // 外部 Agent 领走的任务，或刚派出去的，都算还在跑；托管任务掉出队列（比如服务重启）就当中断
    const minutes = (Date.now() - new Date(attempt.updated_at).getTime()) / 60_000;
    const hosted = !attempt.executor || attempt.executor.startsWith('hosted:');
    return hosted ? false : minutes < STALE_MINUTES;
  }
  return false;
}

function buildPrompt(opts: {
  header: BoardHeader;
  spaceTitle: string;
  path: Array<{ title: string; description: string }>;
  item: ItemContext;
  previous: BoardAttempt[];
}) {
  const { header, item } = opts;
  const criteria = acceptanceList(item.acceptance);
  const lastFailed = [...opts.previous].reverse().find((a) => a.status === 'rejected');
  const lines = [
    header.need ? `核心需求：${header.need}` : '',
    `核心命题：${header.proposition || opts.spaceTitle}`,
    header.principles ? `提问和验收原则：${header.principles}` : '',
    header.kpi ? `核心 KPI：${header.kpi}` : '',
    opts.path.length ? `所属分支：${opts.path.map((p) => p.title).join(' › ')}` : '',
    ...opts.path.filter((p) => p.description).map((p) => `分支说明（${p.title}）：${p.description}`),
    '',
    `原始问题：${item.raw}`,
    item.rewrite ? `改写后的问题：${item.rewrite}` : '',
    `紧急程度：${item.urgency}`,
    criteria.length ? `\n验收标准（交付必须逐条满足）：\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : '',
    item.feedback ? `\n收集者补充要求：${item.feedback}` : '',
    lastFailed
      ? `\n这是第 ${opts.previous.length + 1} 次尝试。上一次没通过验收（${lastFailed.score ?? '—'} 分），原因：${
          [...lastFailed.missing, ...lastFailed.checks.filter((c) => !c.pass).map((c) => `${c.criterion}：${c.note}`)]
            .slice(0, 5)
            .join('；') || lastFailed.error || '未说明'
        }。这次要针对这些缺口补齐。`
      : '',
    '',
    '交付要求：直接给结论，再给依据/例子，最后给可落地的下一步；按验收标准逐条对应作答。',
  ];
  return lines.filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== '')).join('\n');
}

/** 「AI 执行」：为每个条目开一次新尝试，进队列跑，跑完自动交给验收 Agent。 */
export async function runItems(opts: { spaceId: string; itemIds: string[]; createdBy: string | null; model?: string }) {
  const space = await one<{ title: string; direction: string; board: Partial<BoardHeader> }>(
    'select title, direction, board from spaces where id = $1',
    [opts.spaceId],
  );
  if (!space) throw new Error('空间不存在');
  const header = normalizeHeader(space.board);
  if (!header.proposition) header.proposition = space.direction;
  const model = (opts.model || header.model || RUN_MODEL()).trim().slice(0, 120);

  const ids = [...new Set(opts.itemIds)].slice(0, 50);
  const items = await q<ItemContext>(
    `select id, raw, rewrite, urgency, acceptance, feedback, node_id, section_id
     from board_items where space_id = $1 and id = any($2::uuid[])`,
    [opts.spaceId, ids],
  );
  const attempts = await attemptsFor(opts.spaceId, ids);

  const started: Array<{ itemId: string; taskId: string; attempt: number }> = [];
  const skipped: Array<{ itemId: string; reason: string }> = [];

  for (const item of items) {
    const previous = attempts.get(item.id) ?? [];
    const last = previous[previous.length - 1];
    if (last?.status === 'approved') {
      skipped.push({ itemId: item.id, reason: '已通过验收' });
      continue;
    }
    if (last && attemptIsLive(last)) {
      skipped.push({ itemId: item.id, reason: last.status === 'submitted' ? '待验收' : '正在执行' });
      continue;
    }
    if (last && (last.status === 'open' || last.status === 'claimed')) {
      await q(`update tasks set status = 'rejected', closed_at = now(), updated_at = now() where id = $1`, [last.taskId]);
      await q(
        `insert into task_events (task_id, actor_type, actor_name, type, message) values ($1, 'agent', 'board-runner', 'progress', $2)`,
        [last.taskId, '执行失败：上一次执行中断（服务重启或超时），已作废'],
      );
    }

    const path = await sectionPath(opts.spaceId, item.section_id);
    const title = (item.rewrite || item.raw).slice(0, 200);
    const task = await createTask({
      spaceId: opts.spaceId,
      nodeId: item.node_id,
      title,
      prompt: buildPrompt({ header, spaceTitle: space.title, path, item, previous }),
      priority: item.urgency === 'P0' ? 1 : item.urgency === 'P2' ? 3 : 2,
      createdBy: opts.createdBy,
      boardItemId: item.id,
      context: {
        source: 'board',
        boardItemId: item.id,
        attempt: previous.length + 1,
        proposition: header.proposition,
        branchTitle: path.map((p) => p.title).join(' › '),
        acceptance: acceptanceList(item.acceptance),
        model,
      },
    });
    queue.running.add(task.id);
    queue.pending.push({ spaceId: opts.spaceId, taskId: task.id, model });
    started.push({ itemId: item.id, taskId: task.id, attempt: previous.length + 1 });
  }

  pump();
  if (started.length) publish(opts.spaceId, 'board.updated', { part: 'run', items: started.map((s) => s.itemId) });
  return { started, skipped };
}

/** 对最近一次待验收的尝试重新跑验收 Agent（外部 Agent 交付、或验收中途失败时用）。 */
export async function reviewItem(spaceId: string, itemId: string) {
  const attempts = (await attemptsFor(spaceId, [itemId])).get(itemId) ?? [];
  const last = attempts[attempts.length - 1];
  if (!last) throw new Error('这个条目还没执行过');
  if (last.status !== 'submitted') throw new Error('最近一次尝试不在待验收状态');
  return autoReviewTask({ spaceId, taskId: last.taskId, apply: true, applyReject: true, threshold: 70, reviewer: 'acceptance-agent' });
}

/**
 * 「AI 改写」：把原始问题改成可直接执行、可验收的表述；验收标准为空时顺带起草。
 * 只写 rewrite 和空着的 acceptance，不动人填过的内容。
 */
export async function rewriteItems(spaceId: string, itemIds: string[]) {
  const space = await one<{ title: string; direction: string; board: Partial<BoardHeader> }>(
    'select title, direction, board from spaces where id = $1',
    [spaceId],
  );
  if (!space) throw new Error('空间不存在');
  const header = normalizeHeader(space.board);
  const items = await q<ItemContext>(
    `select id, raw, rewrite, urgency, acceptance, feedback, node_id, section_id
     from board_items where space_id = $1 and id = any($2::uuid[]) order by position asc`,
    [spaceId, [...new Set(itemIds)].slice(0, 20)],
  );
  if (!items.length) throw new Error('没有可改写的条目');

  const paths = await Promise.all(items.map((item) => sectionPath(spaceId, item.section_id)));
  const listing = items
    .map(
      (item, i) =>
        `[${i}] 分支：${paths[i].map((p) => p.title).join(' › ') || '未分组'}\n原始问题：${item.raw}${
          item.acceptance ? `\n已有验收标准：${item.acceptance.replace(/\s+/g, ' ')}` : ''
        }`,
    )
    .join('\n\n');

  const result = await chat(
    [
      {
        role: 'system',
        content:
          '你帮团队把脑暴出来的原始问题改写成"能派给 AI 执行、能被验收"的任务。只输出 JSON。',
      },
      {
        role: 'user',
        content: `核心命题：${header.proposition || space.direction || space.title}
${header.need ? `核心需求：${header.need}\n` : ''}${header.principles ? `提问和验收原则：${header.principles}\n` : ''}${header.kpi ? `核心 KPI：${header.kpi}\n` : ''}
待改写：
${listing}

对每一条：
- rewrite：一句话，明确对象、范围、产出形式（例如"给出 3 个…，每个附…"），不超过 80 字，不要丢掉原意
- acceptance：3 条以内可判断真假的验收标准（只在"已有验收标准"缺失时给，否则给空数组）

输出：{"items":[{"i":0,"rewrite":"...","acceptance":["...","..."]}]}`,
      },
    ],
    {
      model: process.env.TREE_MODEL || 'z-ai/glm-5.3-flash',
      json: true,
      maxTokens: 4500,
      temperature: 0.2,
      timeoutMs: 90_000,
      title: 'Mindspace board rewrite',
    },
  );
  const parsed = extractJson<{ items?: Array<{ i?: unknown; rewrite?: unknown; acceptance?: unknown }> }>(result.text);
  if (!parsed?.items?.length) throw new LlmError('改写结果无法解析');

  let updated = 0;
  for (const entry of parsed.items) {
    const index = typeof entry.i === 'number' && Number.isInteger(entry.i) ? entry.i : -1;
    const item = items[index];
    if (!item) continue;
    const rewrite = text(entry.rewrite, 1000);
    const acceptance = item.acceptance ? '' : acceptanceList(entry.acceptance).slice(0, 3).join('\n');
    if (!rewrite && !acceptance) continue;
    await q(
      `update board_items set rewrite = coalesce(nullif($3, ''), rewrite),
         acceptance = case when acceptance = '' then $4 else acceptance end, updated_at = now()
       where space_id = $1 and id = $2`,
      [spaceId, item.id, rewrite, acceptance],
    );
    updated++;
  }
  publish(spaceId, 'board.updated', { part: 'rewrite' });
  return { updated, model: result.model };
}

/** 把最新的问题树导进表单：分支 → 一级分支，树叶 → 条目。同名分支/同文条目不重复导。 */
export async function importTree(spaceId: string, createdBy: string | null) {
  const row = await one<{ tree: IssueTree }>(
    'select tree from space_trees where space_id = $1 order by created_at desc limit 1',
    [spaceId],
  );
  if (!row) throw new Error('还没有问题树，先在「问题树」里收束一次');
  const tree = row.tree;

  const space = await one<{ board: Partial<BoardHeader> }>('select board from spaces where id = $1', [spaceId]);
  const header = normalizeHeader(space?.board);
  if (!header.proposition && tree.root.question) {
    await saveHeader(spaceId, { ...header, proposition: tree.root.question, need: header.need || tree.root.summary });
  }

  const existingSections = await q<{ id: string; title: string }>(
    'select id, title from board_sections where space_id = $1 and parent_id is null',
    [spaceId],
  );
  let sections = 0;
  let items = 0;
  for (const branch of tree.branches) {
    let section = existingSections.find((s) => s.title === branch.title);
    if (!section) {
      section = await createSection({
        spaceId,
        title: branch.title,
        description: [branch.question, branch.why].filter(Boolean).join(' —— '),
        createdBy,
      });
      sections++;
    }
    const known = await q<{ raw: string }>('select raw from board_items where space_id = $1 and section_id = $2', [
      spaceId,
      section.id,
    ]);
    const seen = new Set(known.map((k) => k.raw));
    for (const child of branch.children) {
      if (seen.has(child.question)) continue;
      await createItem({
        spaceId,
        sectionId: section.id,
        raw: child.question,
        urgency: child.kind === 'gap' ? 'P0' : 'P1',
        feedback: child.solve ? `已有线索：${child.solve}` : '',
        nodeId: child.nodeId,
        createdBy,
      });
      seen.add(child.question);
      items++;
    }
  }
  publish(spaceId, 'board.updated', { part: 'import' });
  return { sections, items };
}

export async function boardToCsv(spaceId: string) {
  const board = await getBoard(spaceId);
  const byId = new Map(board.sections.map((s) => [s.id, s]));
  const pathOf = (id: string) => {
    const parts: string[] = [];
    let cur = byId.get(id);
    while (cur) {
      parts.unshift(cur.title);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join(' › ');
  };
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const STATE: Record<ItemState, string> = {
    todo: '未开始',
    queued: '排队中',
    running: '执行中',
    reviewing: '验收中',
    passed: '已通过',
    failed: '未通过',
  };
  const head = ['问题大类目', '原生问题', 'AI 改写', '紧急程度', '第一次尝试', '第二次尝试', '第三次尝试', '验收标准', 'AI 完成情况', '进行状态'];
  const lines = [head.map(cell).join(',')];
  for (const item of board.items) {
    const attempt = (n: number) => {
      const a = item.attempts[n];
      if (!a) return '';
      return `${a.status === 'approved' ? '通过' : a.status === 'rejected' ? '未通过' : '进行中'}${a.score !== null ? ` ${a.score}分` : ''}`;
    };
    const last = item.attempts[item.attempts.length - 1];
    lines.push(
      [
        pathOf(item.section_id),
        item.raw,
        item.rewrite,
        item.urgency,
        attempt(0),
        attempt(1),
        attempt(2),
        item.acceptance,
        last ? `${item.attempts.length} 次尝试${last.score !== null ? ` · 最近 ${last.score} 分` : ''}` : '',
        STATE[item.state],
      ]
        .map(cell)
        .join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

/** 单个条目的全部尝试 + 每次的反馈链路，给详情抽屉用。 */
export async function itemDetail(spaceId: string, itemId: string) {
  const item = await one<ItemContext & { created_at: string }>(
    `select id, raw, rewrite, urgency, acceptance, feedback, node_id, section_id, created_at
     from board_items where space_id = $1 and id = $2`,
    [spaceId, itemId],
  );
  if (!item) return null;
  const attempts = (await attemptsFor(spaceId, [itemId])).get(itemId) ?? [];
  const taskIds = attempts.map((a) => a.taskId);
  const tasks = taskIds.length
    ? await q<{ id: string; result: string | null; prompt: string; assignee: string | null }>(
        'select id, result, prompt, assignee from tasks where id = any($1::uuid[])',
        [taskIds],
      )
    : [];
  const events = taskIds.length
    ? await q<{ id: number; task_id: string; actor_type: string; actor_name: string; type: string; message: string; created_at: string }>(
        `select id, task_id, actor_type, actor_name, type, message, created_at
         from task_events where task_id = any($1::uuid[]) order by id asc`,
        [taskIds],
      )
    : [];
  return {
    item: { ...item, path: await sectionPath(spaceId, item.section_id), state: stateOf(attempts) },
    attempts: attempts.map((a) => {
      const task = tasks.find((t) => t.id === a.taskId);
      return {
        ...a,
        result: task?.result ?? null,
        prompt: task?.prompt ?? '',
        assignee: task?.assignee ?? null,
        events: events.filter((e) => e.task_id === a.taskId),
      };
    }),
  };
}
