import { requireSpaceActor } from '@/lib/auth';
import { nodeDetail } from '@/lib/nodes';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await params;
    const { space } = await requireSpaceActor(req, slug);
    const detail = await nodeDetail(space.id, id);
    if (!detail) return json({ error: '节点不存在' }, { status: 404 });
    return json(detail);
  } catch (err) {
    return fail(err);
  }
}
