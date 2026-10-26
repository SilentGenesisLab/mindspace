import { requireSpaceActor } from '@/lib/auth';
import { taskDetail } from '@/lib/tasks';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await params;
    const { space } = await requireSpaceActor(req, slug);
    const detail = await taskDetail(space.id, id);
    if (!detail) return json({ error: '任务不存在' }, { status: 404 });
    return json(detail);
  } catch (err) {
    return fail(err);
  }
}
