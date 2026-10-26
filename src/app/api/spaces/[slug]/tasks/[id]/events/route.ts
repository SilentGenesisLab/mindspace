import { requireSpaceActor } from '@/lib/auth';
import { taskAction, type TaskAction } from '@/lib/tasks';
import { fail, json } from '@/lib/http';

const ACTIONS = new Set(['claim', 'report', 'result', 'approve', 'reject', 'note']);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await params;
    const { actor, space, role } = await requireSpaceActor(req, slug);
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      message?: string;
      result?: string;
      meta?: Record<string, unknown>;
    };
    const action = String(body.action ?? '') as TaskAction;
    if (!ACTIONS.has(action)) return json({ error: '未知操作' }, { status: 400 });

    const detail = await taskAction({
      spaceId: space.id,
      taskId: id,
      action,
      actor,
      role,
      message: body.message,
      result: body.result,
      meta: body.meta,
    });
    return json(detail);
  } catch (err) {
    return fail(err);
  }
}
