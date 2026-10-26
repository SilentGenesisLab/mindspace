import { requireSpaceActor } from '@/lib/auth';
import { createTask, listTasks } from '@/lib/tasks';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug);
    const status = new URL(req.url).searchParams.get('status') || undefined;
    return json({ tasks: await listTasks(space.id, status) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug, { manage: true });
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      prompt?: string;
      nodeId?: string;
      priority?: number;
      assignee?: string;
    };
    const task = await createTask({
      spaceId: space.id,
      nodeId: body.nodeId || null,
      title: String(body.title ?? ''),
      prompt: String(body.prompt ?? ''),
      priority: Number(body.priority) || 2,
      createdBy: actor.kind === 'user' ? actor.user.id : null,
      assignee: body.assignee || null,
    });
    return json({ task }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
