import { q } from '@/lib/db';
import { sendSmsCode, smsConfigured } from '@/lib/sms';
import { fail, json, rateLimit, clientIp } from '@/lib/http';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { phone?: string };
    const phone = String(body.phone ?? '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return json({ error: '手机号格式不对' }, { status: 400 });

    const ip = clientIp(req);
    if (!rateLimit(`sms:phone:${phone}`, 1, 60_000)) return json({ error: '一分钟内只能发送一次' }, { status: 429 });
    if (!rateLimit(`sms:phone:hour:${phone}`, 8, 3_600_000)) return json({ error: '该手机号请求过于频繁' }, { status: 429 });
    if (!rateLimit(`sms:ip:${ip}`, 20, 3_600_000)) return json({ error: '请求过于频繁' }, { status: 429 });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await q(
      `insert into otp_codes (phone, code, expires_at) values ($1, $2, now() + interval '10 minutes')`,
      [phone, code],
    );

    const result = await sendSmsCode(phone, code);
    if (!result.sent) {
      console.warn(`[sms] ${phone} 发送失败: ${result.detail}`);
      if (process.env.ALLOW_DEV_CODE === '1') {
        return json({ ok: true, sent: false, hint: '短信未发出，当前为验收模式，使用固定验证码' });
      }
      return json({ error: `验证码发送失败：${result.detail}` }, { status: 502 });
    }
    return json({ ok: true, sent: true, channel: smsConfigured() ? 'sms' : 'none' });
  } catch (err) {
    return fail(err);
  }
}
