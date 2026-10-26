import { requireSpaceActor } from '@/lib/auth';
import { collectSpacePositions } from '@/lib/graph';
import { fail, json } from '@/lib/http';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    const result = await collectSpacePositions(space.id);
    if (result.error) return json({ error: result.error }, { status: 400 });
    return json({ ok: true, ...result });
  } catch (err) {
    return fail(err);
  }
}
