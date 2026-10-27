import { actorAuthorId, requireSpaceActor } from '@/lib/auth';
import { createItem } from '@/lib/board';
import { fail, json, rateLimit } from '@/lib/http';

/** 任何成员都能在分支下提问题/需求；非收集者提的条目只有本人和收集者能改。 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug);
    const authorId = await actorAuthorId(actor, space.id);
    if (!rateLimit(`board-item:${authorId}`, 30, 60_000)) return json({ error: '提得太快了，歇一分钟' }, { status: 429 });
    const body = (await req.json().catch(() => ({}))) as Record<string, string>;
    const item = await createItem({
      spaceId: space.id,
      sectionId: String(body.sectionId ?? ''),
      raw: body.raw,
      rewrite: body.rewrite,
      urgency: body.urgency,
      acceptance: body.acceptance,
      feedback: body.feedback,
      createdBy: authorId,
    });
    return json({ item }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
