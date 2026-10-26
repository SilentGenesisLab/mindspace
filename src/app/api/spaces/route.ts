import { getActor, findSpace, type Space } from '@/lib/auth';
import { q, tx } from '@/lib/db';
import { fail, json } from '@/lib/http';
import { shortCode, slugify } from '@/lib/text';

export async function GET(req: Request) {
  try {
    const actor = await getActor(req);
    if (!actor) return json({ error: '请先登录' }, { status: 401 });

    if (actor.kind === 'agent') {
      const rows = await q(
        `select s.*, 'collector' as role,
                (select count(*)::int from nodes n where n.space_id = s.id) as node_count,
                (select count(*)::int from space_members m where m.space_id = s.id) as member_count
         from spaces s where s.id = $1`,
        [actor.spaceId],
      );
      return json({ spaces: rows });
    }

    const rows = await q(
      `select s.*, m.role,
              (select count(*)::int from nodes n where n.space_id = s.id) as node_count,
              (select count(*)::int from space_members m2 where m2.space_id = s.id) as member_count,
              (select count(*)::int from nodes n where n.space_id = s.id and n.created_at > now() - interval '7 days') as recent_count
       from spaces s join space_members m on m.space_id = s.id
       where m.user_id = $1 and s.archived = false
       order by s.created_at desc`,
      [actor.user.id],
    );
    return json({ spaces: rows });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor(req);
    if (!actor) return json({ error: '请先登录' }, { status: 401 });
    if (actor.kind === 'agent') return json({ error: 'Agent Key 不能创建空间' }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as { title?: string; direction?: string };
    const title = String(body.title ?? '').trim().slice(0, 40);
    const direction = String(body.direction ?? '').trim().slice(0, 300);
    if (title.length < 2) return json({ error: '空间名至少 2 个字' }, { status: 400 });

    let slug = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      slug = `${slugify(title)}-${shortCode(4)}`;
      if (!(await findSpace(slug))) break;
      slug = '';
    }
    if (!slug) return json({ error: '生成空间地址失败，请重试' }, { status: 500 });

    const invite = shortCode(12);
    const space = await tx<Space>(async (client) => {
      const inserted = await client.query<Space>(
        `insert into spaces (slug, title, direction, invite_code, owner_id)
         values ($1, $2, $3, $4, $5) returning *`,
        [slug, title, direction, invite, actor.user.id],
      );
      const row = inserted.rows[0];
      await client.query(`insert into space_members (space_id, user_id, role) values ($1, $2, 'owner')`, [
        row.id,
        actor.user.id,
      ]);
      return row;
    });

    return json({ space });
  } catch (err) {
    return fail(err);
  }
}
