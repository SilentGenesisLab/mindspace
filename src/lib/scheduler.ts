import { q, one } from './db';
import { runAudit } from './audit';
import { clamp } from './text';

const globalForScheduler = globalThis as unknown as { __msScheduler?: { timer: NodeJS.Timeout; started: boolean } };

let busy = false;

async function tick(trigger: string) {
  if (busy) return;
  busy = true;
  try {
    const spaces = await q<{ id: string }>(
      `select distinct s.id from spaces s
       join nodes n on n.space_id = s.id
       where s.archived = false and n.updated_at > now() - interval '6 hours'
       limit 20`,
    );
    for (const space of spaces) {
      const recent = await one<{ ok: number }>(
        `select 1 as ok from audit_runs
         where space_id = $1 and started_at > now() - interval '10 minutes' limit 1`,
        [space.id],
      );
      if (recent) continue;
      try {
        const result = await runAudit(space.id, { trigger });
        console.log(`[audit] space=${space.id} trigger=${trigger}`, result.stats);
      } catch (err) {
        console.error(`[audit] space=${space.id} failed`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[scheduler] tick failed', err);
  } finally {
    busy = false;
  }
}

export function startScheduler() {
  if (globalForScheduler.__msScheduler?.started) return;
  const minutes = clamp(Number(process.env.AUDIT_INTERVAL_MIN || 30), 5, 1440);
  const timer = setInterval(() => void tick('scheduled'), minutes * 60_000);
  timer.unref?.();
  globalForScheduler.__msScheduler = { timer, started: true };
  setTimeout(() => void tick('startup'), 120_000).unref?.();
  console.log(`[scheduler] ds4.1 审校每 ${minutes} 分钟运行一次`);
}
