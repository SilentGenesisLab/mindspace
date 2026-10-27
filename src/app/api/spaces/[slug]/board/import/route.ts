import { actorAuthorId, requireSpaceActor } from '@/lib/auth';
import { importTree } from '@/lib/board';
import { fail, json } from '@/lib/http';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug, { manage: true });
    return json(await importTree(space.id, await actorAuthorId(actor, space.id)));
  } catch (err) {
    return fail(err);
  }
}
