import { requireSpaceActor, canManage } from '@/lib/auth';
import { q } from '@/lib/db';
import { fail, json } from '@/lib/http';
import { members } from '@/lib/space';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug);
    return json({ members: await members(space.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space, role } = await requireSpaceActor(req, slug);
    if (role !== 'owner') return json({ error: '只有空间创建者可以调整成员' }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { userId?: string; role?: string };
    if (!body.userId || !['collector', 'brainstormer'].includes(String(body.role))) {
      return json({ error: '参数不对' }, { status: 400 });
    }
    await q('update space_members set role = $3 where space_id = $1 and user_id = $2 and role <> $4', [
      space.id,
      body.userId,
      body.role,
      'owner',
    ]);
    return json({ ok: true, canManage: canManage(role) });
  } catch (err) {
    return fail(err);
  }
}
