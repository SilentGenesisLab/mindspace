import { requireSpaceActor } from '@/lib/auth';
import { opsSnapshot } from '@/lib/execution';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    return json(await opsSnapshot(space.id));
  } catch (err) {
    return fail(err);
  }
}
