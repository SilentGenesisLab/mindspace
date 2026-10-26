import { requireSpaceActor, canManage } from '@/lib/auth';
import { one } from '@/lib/db';
import { fail, json } from '@/lib/http';
import { members } from '@/lib/space';

 export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space, role } = await requireSpaceActor(req, slug);
    const counts = await one<{ nodes: string; edges: string; members: string }>(
      `select (select count(*) from nodes where space_id = $1) as nodes,
              (select count(*) from edges where space_id = $1) as edges,
              (select count(*) from space_members where space_id = $1) as members`,
      [space.id],
    );
    const people = await members(space.id);
    return json({
      space: {
        ...space,
        invite_code: canManage(role) ? space.invite_code : undefined,
      },
      role,
      canManage: canManage(role),
      counts: { nodes: Number(counts?.nodes ?? 0), edges: Number(counts?.edges ?? 0), members: Number(counts?.members ?? 0) },
      members: people,
      me: actor.kind === 'user' ? actor.user : { id: '', nickname: `agent:${actor.name}`, color: '#b58cff' },
    });
  } catch (err) {
    return fail(err);
  }
}
