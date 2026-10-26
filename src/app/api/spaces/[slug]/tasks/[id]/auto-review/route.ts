import { requireSpaceActor } from '@/lib/auth';
import { autoReviewTask } from '@/lib/execution';
import { fail, json, rateLimit } from '@/lib/http';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    if (!rateLimit(`review:${id}`, 1, 8_000)) return json({ error: '刚验收过，等 8 秒' }, { status: 429 });

    const body = (await req.json().catch(() => ({}))) as { apply?: boolean; threshold?: number };
    const result = await autoReviewTask({
      spaceId: space.id,
      taskId: id,
      apply: Boolean(body.apply),
      threshold: Number(body.threshold) || 70,
      reviewer: 'auto-reviewer',
    });
    return json(result);
  } catch (err) {
    return fail(err);
  }
}
