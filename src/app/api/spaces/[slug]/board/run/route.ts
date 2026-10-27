import { actorAuthorId, requireSpaceActor } from '@/lib/auth';
import { runItems } from '@/lib/board';
import { fail, json, rateLimit } from '@/lib/http';

/** 让 AI 执行一个或多个条目。立即返回；执行和验收在后台跑，进度走 SSE（task.updated / board.updated）。 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug, { manage: true });
    if (!rateLimit(`board-run:${space.id}`, 10, 60_000)) return json({ error: '执行请求太频繁，等一分钟' }, { status: 429 });
    const body = (await req.json().catch(() => ({}))) as { itemIds?: unknown };
    const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((v): v is string => typeof v === 'string') : [];
    if (!itemIds.length) return json({ error: '没有选中条目' }, { status: 400 });
    return json(await runItems({ spaceId: space.id, itemIds, createdBy: await actorAuthorId(actor, space.id) }));
  } catch (err) {
    return fail(err);
  }
}
