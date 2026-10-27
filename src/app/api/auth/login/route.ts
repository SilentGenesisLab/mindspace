import { one, q } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { fail, json, rateLimit, clientIp } from '@/lib/http';

const GENERIC = '手机号或密码不对；没设过密码请用验证码登录';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { phone?: string; password?: string };
    const phone = String(body.phone ?? '').trim();
    const password = String(body.password ?? '');
    if (!/^1[3-9]\d{9}$/.test(phone)) return json({ error: '手机号格式不对' }, { status: 400 });
    if (!password) return json({ error: '请输入密码' }, { status: 400 });

    const ip = clientIp(req);
    if (!rateLimit(`pwd:phone:${phone}`, 8, 900_000)) return json({ error: '尝试次数过多，15 分钟后再试或用验证码登录' }, { status: 429 });
    if (!rateLimit(`pwd:ip:${ip}`, 30, 900_000)) return json({ error: '尝试过于频繁，请稍后再试' }, { status: 429 });

    const user = await one<{ id: string; phone: string; nickname: string; color: string; password_hash: string | null }>(
      'select id, phone, nickname, color, password_hash from users where phone = $1',
      [phone],
    );

    // 不存在 / 没设密码 / 密码错 统一一个提示，不暴露账号是否存在
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!user || !ok) return json({ error: GENERIC }, { status: 400 });

    await q('update users set last_login_at = now() where id = $1', [user.id]);
    await setSessionCookie(user.id, 'password');
    return json({ user: { id: user.id, phone: user.phone, nickname: user.nickname, color: user.color } });
  } catch (err) {
    return fail(err);
  }
}
