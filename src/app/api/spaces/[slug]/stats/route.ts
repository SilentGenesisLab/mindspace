import { requireSpaceActor } from '@/lib/auth';
import { spaceStats } from '@/lib/space';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    return json(await spaceStats(space.id));
  } catch (err) {
    return fail(err);
  }
}
