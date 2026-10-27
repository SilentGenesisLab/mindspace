import { currentSession } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/password';
import { fail, json, rateLimit } from '@/lib/http';

/** 刚用验证码登录（15 分钟内）可以直接设/重置密码；其它情况必须验证当前密码。 */
const OTP_GRACE_SECONDS = 15 * 60;

export async function POST(req: Request) {
  try {
    const session = await currentSession();
    if (!session) return json({ error: '请先登录' }, { status: 401 });
    if (!rateLimit(`pwdset:${session.uid}`, 6, 900_000)) return json({ error: '操作太频繁，请稍后再试' }, { status: 429 });

    const body = (await req.json().catch(() => ({}))) as { password?: string; currentPassword?: string };
    const password = String(body.password ?? '');
    const problem = passwordProblem(password);
    if (problem) return json({ error: problem }, { status: 400 });

    const user = await one<{ id: string; password_hash: string | null }>('select id, password_hash from users where id = $1', [
      session.uid,
    ]);
    if (!user) return json({ error: '账号不存在' }, { status: 404 });

    const freshOtp = session.method === 'otp' && Date.now() / 1000 - session.iat < OTP_GRACE_SECONDS;
    if (user.password_hash && !freshOtp) {
      const ok = await verifyPassword(String(body.currentPassword ?? ''), user.password_hash);
      if (!ok) return json({ error: '当前密码不对；忘了可以退出后用验证码登录再重设' }, { status: 400 });
    }

    await q('update users set password_hash = $2, password_set_at = now() where id = $1', [
      user.id,
      await hashPassword(password),
    ]);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
