import { requireSpaceActor } from '@/lib/auth';
import { reviewItem } from '@/lib/board';
import { fail, json, rateLimit } from '@/lib/http';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    if (!rateLimit(`board-review:${id}`, 1, 8_000)) return json({ error: '刚验收过，等 8 秒' }, { status: 429 });
    return json(await reviewItem(space.id, id));
  } catch (err) {
    return fail(err);
  }
}
