import { one, q } from '@/lib/db';
import { setSessionCookie, type User } from '@/lib/auth';
import { fail, json, rateLimit, clientIp } from '@/lib/http';
import { CLUSTER_COLORS } from '@/lib/graph';
import { hashPassword, passwordProblem } from '@/lib/password';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      phone?: string;
      code?: string;
      nickname?: string;
      password?: string;
    };
    const phone = String(body.phone ?? '').trim();
    const code = String(body.code ?? '').trim();
    const password = String(body.password ?? '');
    if (!/^1[3-9]\d{9}$/.test(phone)) return json({ error: '手机号格式不对' }, { status: 400 });
    if (!/^\d{6}$/.test(code)) return json({ error: '验证码是 6 位数字' }, { status: 400 });
    // 验证码本身证明了手机号归属，所以顺带设密码 / 重置密码都在这里完成
    if (password) {
      const problem = passwordProblem(password);
      if (problem) return json({ error: problem }, { status: 400 });
    }

    const ip = clientIp(req);
    if (!rateLimit(`verify:ip:${ip}`, 30, 900_000)) return json({ error: '尝试过于频繁，请稍后再试' }, { status: 429 });

    const latest = await one<{ id: string; code: string; attempts: number }>(
      `select id, code, attempts from otp_codes
       where phone = $1 and consumed_at is null and expires_at > now()
       order by created_at desc limit 1`,
      [phone],
    );

    const devCode = process.env.ALLOW_DEV_CODE === '1' ? process.env.DEV_LOGIN_CODE || '888888' : null;
    const isDev = devCode !== null && code === devCode;

    if (!latest) return json({ error: '验证码已过期，请重新获取' }, { status: 400 });
    if (latest.attempts >= 5) return json({ error: '尝试次数过多，请重新获取验证码' }, { status: 429 });
    if (!isDev && latest.code !== code) {
      await q('update otp_codes set attempts = attempts + 1 where id = $1', [latest.id]);
      return json({ error: '验证码不对' }, { status: 400 });
    }

    await q('update otp_codes set consumed_at = now() where id = $1', [latest.id]);

    let user = await one<User>('select * from users where phone = $1', [phone]);
    if (!user) {
      const nickname = String(body.nickname ?? '').trim().slice(0, 16) || `探索者${phone.slice(-4)}`;
      const color = CLUSTER_COLORS[Math.floor(Math.random() * CLUSTER_COLORS.length)];
      user = await one<User>(
        'insert into users (phone, nickname, color, last_login_at) values ($1, $2, $3, now()) returning *',
        [phone, nickname, color],
      );
    } else {
      await q('update users set last_login_at = now() where id = $1', [user.id]);
    }
    if (!user) return json({ error: '创建用户失败' }, { status: 500 });

    if (password) {
      await q('update users set password_hash = $2, password_set_at = now() where id = $1', [
        user.id,
        await hashPassword(password),
      ]);
    }

    await setSessionCookie(user.id, 'otp');
    return json({
      user: { id: user.id, phone: user.phone, nickname: user.nickname, color: user.color },
      passwordSet: Boolean(password),
    });
  } catch (err) {
    return fail(err);
  }
}
