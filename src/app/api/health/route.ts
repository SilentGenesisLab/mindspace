import { one } from '@/lib/db';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const row = await one<{ now: string }>('select now()::text as now');
    return json({
      ok: true,
      service: 'mindspace',
      db: Boolean(row),
      time: row?.now,
      models: { jev: process.env.JEV_MODEL || 'typesafe/jev-router', audit: process.env.AUDIT_MODEL || 'deepseek/deepseek-v4.1-flash' },
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'db down' }, { status: 503 });
  }
}
