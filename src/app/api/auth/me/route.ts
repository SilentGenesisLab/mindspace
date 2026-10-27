import { currentSession, getActor, refreshSessionIfStale } from '@/lib/auth';
import { one } from '@/lib/db';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor) return json({ user: null });
  if (actor.kind === 'agent') return json({ user: null, agent: { name: actor.name } });

  const session = await currentSession();
  const refreshed = session ? await refreshSessionIfStale(session) : false;
  const row = await one<{ has_password: boolean }>('select password_hash is not null as has_password from users where id = $1', [
    actor.user.id,
  ]);
  const freshOtp = session?.method === 'otp' && Date.now() / 1000 - session.iat < 15 * 60;

  return json({
    user: actor.user,
    hasPassword: Boolean(row?.has_password),
    // 刚用验证码登录：改密码不需要旧密码
    canSetWithoutCurrent: !row?.has_password || freshOtp,
    refreshed,
  });
}
