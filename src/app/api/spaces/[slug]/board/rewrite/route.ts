import { requireSpaceActor } from '@/lib/auth';
import { rewriteItems } from '@/lib/board';
import { fail, json, rateLimit } from '@/lib/http';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    if (!rateLimit(`board-rewrite:${space.id}`, 1, 10_000)) return json({ error: '正在改写，等 10 秒' }, { status: 429 });
    const body = (await req.json().catch(() => ({}))) as { itemIds?: unknown };
    const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((v): v is string => typeof v === 'string') : [];
    if (!itemIds.length) return json({ error: '没有选中条目' }, { status: 400 });
    return json(await rewriteItems(space.id, itemIds));
  } catch (err) {
    return fail(err);
  }
}
