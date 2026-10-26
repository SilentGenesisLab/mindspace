import { q, one } from './db';
import { publish } from './events';
import { actorLabel, canManage, type Actor, type SpaceRole } from './auth';

export type Task = {
  id: string;
  space_id: string;
  node_id: string | null;
  title: string;
  prompt: string;
  status: 'open' | 'claimed' | 'submitted' | 'approved' | 'rejected';
  assignee: string | null;
  priority: number;
  result: string | null;
  result_meta: Record<string, unknown>;
  created_by: string | null;
  tree_id: string | null;
  tree_item_id: string | null;
  context: Record<string, unknown>;
  started_at: string | null;
  executor: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type TaskEvent = {
  id: number;
  task_id: string;
  actor_type: string;
  actor_name: string;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export async function listTasks(spaceId: string, status?: string) {
  const params: unknown[] = [spaceId];
  let clause = '';
  if (status) {
    params.push(status);
    clause = ` and t.status = $${params.length}`;
  }
  const rows = await q<Task & { node_content: string | null; event_count: string; last_event: string | null }>(
    `select t.*, n.content as node_content,
            (select count(*) from task_events e where e.task_id = t.id)::text as event_count,
            (select max(created_at)::text from task_events e where e.task_id = t.id) as last_event
     from tasks t left join nodes n on n.id = t.node_id
     where t.space_id = $1${clause}
     order by case t.status when 'submitted' then 0 when 'open' then 1 when 'claimed' then 2 when 'rejected' then 3 else 4 end,
              t.priority asc, t.created_at desc
     limit 200`,
    params,
  );
  return rows.map((row) => ({ ...row, event_count: Number(row.event_count) }));
}

export async function taskDetail(spaceId: string, taskId: string) {
  const task = await one<Task & { node_content: string | null }>(
    `select t.*, n.content as node_content from tasks t left join nodes n on n.id = t.node_id
     where t.space_id = $1 and t.id = $2`,
    [spaceId, taskId],
  );
  if (!task) return null;
  const events = await q<TaskEvent>('select * from task_events where task_id = $1 order by id asc', [taskId]);
  return { task, events };
}

export async function createTask(opts: {
  spaceId: string;
  nodeId?: string | null;
  title: string;
  prompt?: string;
  priority?: number;
  createdBy: string | null;
  assignee?: string | null;
  treeId?: string | null;
  treeItemId?: string | null;
  context?: Record<string, unknown>;
}) {
  const title = opts.title.trim().slice(0, 200);
  if (title.length < 2) throw new Error('任务标题太短');
  const task = await one<Task>(
    `insert into tasks (space_id, node_id, title, prompt, priority, created_by, assignee, status, tree_id, tree_item_id, context)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
    [
      opts.spaceId,
      opts.nodeId || null,
      title,
      (opts.prompt ?? '').slice(0, 4000),
      Math.min(Math.max(opts.priority ?? 2, 1), 3),
      opts.createdBy,
      opts.assignee ?? null,
      opts.assignee ? 'claimed' : 'open',
      opts.treeId || null,
      opts.treeItemId || null,
      JSON.stringify(opts.context ?? {}),
    ],
  );
  if (!task) throw new Error('创建任务失败');
  await q(
    `insert into task_events (task_id, actor_type, actor_name, type, message) values ($1, 'user', '收集者', 'create', $2)`,
    [task.id, `发布任务：${title}`],
  );
  if (opts.assignee) {
    await q(
      `insert into task_events (task_id, actor_type, actor_name, type, message) values ($1, 'user', '收集者', 'claim', $2)`,
      [task.id, `指派给 ${opts.assignee}`],
    );
  }
  publish(opts.spaceId, 'task.updated', { taskId: task.id });
  return task;
}

export type TaskAction = 'claim' | 'report' | 'result' | 'approve' | 'reject' | 'note';

export async function taskAction(opts: {
  spaceId: string;
  taskId: string;
  action: TaskAction;
  actor: Actor;
  role: SpaceRole;
  message?: string;
  result?: string;
  meta?: Record<string, unknown>;
}) {
  const task = await one<Task>('select * from tasks where space_id = $1 and id = $2', [opts.spaceId, opts.taskId]);
  if (!task) throw new Error('任务不存在');

  const actorName = actorLabel(opts.actor);
  const actorType = opts.actor.kind === 'agent' ? 'agent' : 'user';
  const message = (opts.message ?? '').slice(0, 2000);

  const transition = async (status: Task['status'], type: string, payload: Record<string, unknown> = {}) => {
    await q(
      `update tasks set status = $2, assignee = coalesce(assignee, $3), updated_at = now(),
         closed_at = case when $2 in ('approved','rejected') then now() else closed_at end
       where id = $1`,
      [task.id, status, opts.actor.kind === 'agent' ? actorName : null],
    );
    await q(
      `insert into task_events (task_id, actor_type, actor_name, type, message, payload)
       values ($1, $2, $3, $4, $5, $6)`,
      [task.id, actorType, actorName, type, message, JSON.stringify(payload)],
    );
  };

  switch (opts.action) {
    case 'claim': {
      if (!['open', 'rejected', 'claimed'].includes(task.status)) throw new Error(`当前状态 ${task.status} 不能认领`);
      if (task.assignee && task.assignee !== actorName && !canManage(opts.role)) throw new Error('任务已被认领');
      await q(`update tasks set status = 'claimed', assignee = $2, updated_at = now() where id = $1`, [task.id, actorName]);
      await q(
        `insert into task_events (task_id, actor_type, actor_name, type, message) values ($1, $2, $3, 'claim', $4)`,
        [task.id, actorType, actorName, message || `认领了任务`],
      );
      break;
    }
    case 'report': {
      if (!message) throw new Error('缺少进度内容');
      await q(
        `insert into task_events (task_id, actor_type, actor_name, type, message) values ($1, $2, $3, 'progress', $4)`,
        [task.id, actorType, actorName, message],
      );
      await q(`update tasks set assignee = coalesce(assignee, $2), updated_at = now() where id = $1`, [task.id, actorName]);
      break;
    }
    case 'result': {
      const result = (opts.result ?? message).slice(0, 20_000);
      if (!result.trim()) throw new Error('缺少交付结果');
      await q(
        `update tasks set result = $2, result_meta = $3, status = 'submitted', assignee = coalesce(assignee, $4),
           updated_at = now() where id = $1`,
        [task.id, result, JSON.stringify(opts.meta ?? {}), actorName],
      );
      await q(
        `insert into task_events (task_id, actor_type, actor_name, type, message, payload)
         values ($1, $2, $3, 'result', $4, $5)`,
        [task.id, actorType, actorName, result.slice(0, 2000), JSON.stringify(opts.meta ?? {})],
      );
      break;
    }
    case 'approve':
    case 'reject': {
      if (!canManage(opts.role)) throw new Error('只有收集者可以验收');
      if (!['submitted', 'approved', 'rejected'].includes(task.status)) throw new Error('任务还没提交结果');
      await transition(opts.action === 'approve' ? 'approved' : 'rejected', 'review', {
        decision: opts.action,
        note: message,
      });
      break;
    }
    case 'note': {
      if (!message) throw new Error('缺少备注内容');
      await q(
        `insert into task_events (task_id, actor_type, actor_name, type, message) values ($1, $2, $3, 'note', $4)`,
        [task.id, actorType, actorName, message],
      );
      break;
    }
    default:
      throw new Error('未知操作');
  }

  publish(opts.spaceId, 'task.updated', { taskId: task.id });
  return taskDetail(opts.spaceId, task.id);
}
