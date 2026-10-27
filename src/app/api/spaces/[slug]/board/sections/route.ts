import { actorAuthorId, requireSpaceActor } from '@/lib/auth';
import { createSection } from '@/lib/board';
import { fail, json } from '@/lib/http';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug, { manage: true });
    const body = (await req.json().catch(() => ({}))) as { title?: string; description?: string; parentId?: string | null };
    const section = await createSection({
      spaceId: space.id,
      parentId: body.parentId ?? null,
      title: String(body.title ?? ''),
      description: body.description,
      createdBy: await actorAuthorId(actor, space.id),
    });
    return json({ section }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
