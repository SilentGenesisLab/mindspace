import { requireSpaceActor } from '@/lib/auth';
import { getGraph } from '@/lib/nodes';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug);
    return json(await getGraph(space.id));
  } catch (err) {
    return fail(err);
  }
}
