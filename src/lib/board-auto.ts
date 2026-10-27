import { q } from './db';
import { getAutomation, getBoard, reviewItem, runItems } from './board';

/**
 * 表单自动执行：每 N 分钟挑一批「还没开始 / 没通过且次数没用完」的条目，
 * 用这块板选的模型跑一轮 AI，跑完照常交给验收 Agent。
 */

const TICK_MS = 30_000;
const BATCH = 10;
const STUCK_REVIEW_MINUTES = 10;

const globalForAuto = globalThis as unknown as { __msBoardAuto?: { started: boolean; timer?: NodeJS.Timeout } };

let busy = false;

function eligible(item: { state: string; attempts: Array<{ updated_at: string }> }, maxAttempts: number) {
  const attempts = item.attempts.length;
  if (item.state === 'todo') return true;
  if (item.state === 'failed') return attempts < maxAttempts;
  // 执行中断（服务重启/超时）的条目也重新派；runItems 会把旧尝试标成失败再开新的一轮
  if (item.state === 'queued' || item.state === 'running') {
    const last = item.attempts.at(-1);
    if (!last) return true;
    return Date.now() - new Date(last.updated_at).getTime() > 15 * 60_000;
  }
  return false;
}

async function recordRun(spaceId: string, result: Record<string, unknown>) {
  await q(
    `insert into board_automations (space_id, last_run_at, last_result)
     values ($1, now(), $2)
     on conflict (space_id) do update set last_run_at = now(), last_result = $2`,
    [spaceId, JSON.stringify(result)],
  );
}

/** 验收卡住（模型空返回/超时）的条目会一直停在「验收中」，自动重跑一次验收把它解开。 */
async function retryStuckReviews(spaceId: string, items: Array<{ id: string; state: string; attempts: Array<{ updated_at: string }> }>) {
  const cutoff = Date.now() - STUCK_REVIEW_MINUTES * 60_000;
  const stuck = items
    .filter((item) => item.state === 'reviewing' && item.attempts.length)
    .filter((item) => new Date(item.attempts.at(-1)!.updated_at).getTime() < cutoff)
    .slice(0, 5);
  let reviewed = 0;
  for (const item of stuck) {
    try {
      await reviewItem(spaceId, item.id);
      reviewed++;
    } catch (err) {
      console.error(`[board-auto] review retry failed item=${item.id}`, err instanceof Error ? err.message : err);
    }
  }
  return reviewed;
}

/** 跑一轮：手动触发时不受开关限制；定时触发只跑 enabled 的板。 */
export async function runAutomation(spaceId: string, trigger: 'manual' | 'scheduled') {
  const automation = await getAutomation(spaceId);
  if (trigger === 'scheduled' && !automation.enabled) return { started: 0, skipped: 0, reason: '自动执行未开启' };

  const board = await getBoard(spaceId);
  const reviewed = await retryStuckReviews(spaceId, board.items);
  const items = board.items
    .filter((item) => eligible(item, automation.max_attempts))
    .slice(0, BATCH)
    .map((item) => item.id);

  if (!items.length) {
    await recordRun(spaceId, { trigger, started: 0, reviewed, at: new Date().toISOString() });
    return { started: 0, skipped: 0, reviewed, reason: '没有待执行的条目' };
  }

  const result = await runItems({
    spaceId,
    itemIds: items,
    createdBy: null,
    model: board.header.model || undefined,
  });
  await recordRun(spaceId, {
    trigger,
    started: result.started.length,
    skipped: result.skipped.length,
    reviewed,
    model: board.header.model || 'default',
    at: new Date().toISOString(),
  });
  return { started: result.started.length, skipped: result.skipped.length, reviewed, tasks: result.started };
}

/** 到点的板逐个跑，同一时刻只跑一个，避免把队列和模型额度打满。 */
export async function automationTick() {
  if (busy) return;
  busy = true;
  try {
    const due = await q<{ space_id: string }>(
      `select a.space_id
       from board_automations a join spaces s on s.id = a.space_id
       where a.enabled and s.archived = false
         and (a.last_run_at is null or a.last_run_at <= now() - make_interval(mins => a.interval_minutes))
       order by a.last_run_at nulls first
       limit 5`,
    );
    for (const row of due) {
      try {
        const result = await runAutomation(row.space_id, 'scheduled');
        console.log(`[board-auto] space=${row.space_id} started=${result.started}`);
      } catch (err) {
        console.error(`[board-auto] space=${row.space_id} failed`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[board-auto] tick failed', err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

export function startBoardAutomation() {
  if (globalForAuto.__msBoardAuto?.started) return;
  const timer = setInterval(() => void automationTick(), TICK_MS);
  timer.unref?.();
  globalForAuto.__msBoardAuto = { started: true, timer };
  setTimeout(() => void automationTick(), 30_000).unref?.();
  console.log('[board-auto] 表单定时执行已启动（每 30 秒检查一次到点的板）');
}
