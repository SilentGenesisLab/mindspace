import { requireSpaceActor } from '@/lib/auth';
import { runTaskHosted } from '@/lib/execution';
import { fail, json, rateLimit } from '@/lib/http';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    if (!rateLimit(`run:${id}`, 1, 10_000)) return json({ error: '这个任务刚执行过，等 10 秒' }, { status: 429 });

    const body = (await req.json().catch(() => ({}))) as { model?: string };
    const model = String(body.model || process.env.RUN_MODEL || 'deepseek/deepseek-v4.1-flash');
    const actorName = `hosted:${model.split('/').pop()}`;

    const detail = await runTaskHosted({ spaceId: space.id, taskId: id, model, actorName });
    return json(detail);
  } catch (err) {
    return fail(err);
  }
}
