import { getActor } from '@/lib/auth';
import { json } from '@/lib/http';

export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor) return json({ user: null });
  if (actor.kind === 'agent') return json({ user: null, agent: { name: actor.name } });
  return json({ user: actor.user });
}
