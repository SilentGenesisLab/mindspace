import { getActor } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { fail, json } from '@/lib/http';

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const actor = await getActor(req);
    if (!actor) return json({ error: '请先登录再加入' }, { status: 401 });
    if (actor.kind === 'agent') return json({ error: 'Agent Key 不能加入空间' }, { status: 403 });

    const space = await one<{ id: string; slug: string; title: string }>(
      'select id, slug, title from spaces where invite_code = $1 and archived = false',
      [code],
    );
    if (!space) return json({ error: '邀请链接已失效' }, { status: 404 });

    await q(
      `insert into space_members (space_id, user_id, role) values ($1, $2, 'brainstormer')
       on conflict (space_id, user_id) do nothing`,
      [space.id, actor.user.id],
    );
    return json({ space });
  } catch (err) {
    return fail(err);
  }
}
