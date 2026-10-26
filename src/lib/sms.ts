import { createHmac, randomUUID } from 'node:crypto';

const ENDPOINT = 'https://dysmsapi.aliyuncs.com/';

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function signature(params: Record<string, string>, secret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  return createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64');
}

export function smsConfigured(): boolean {
  return Boolean(process.env.ALIYUN_SMS_KEY_ID && process.env.ALIYUN_SMS_KEY_SECRET && process.env.ALIYUN_SMS_TEMPLATE_CODE);
}

export async function sendSmsCode(phone: string, code: string): Promise<{ sent: boolean; detail: string }> {
  if (!smsConfigured()) return { sent: false, detail: '短信通道未配置' };

  const params: Record<string, string> = {
    AccessKeyId: process.env.ALIYUN_SMS_KEY_ID!,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: process.env.ALIYUN_SMS_SIGN_NAME || '深圳市洞墟科技',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE!,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };
  const sig = signature(params, process.env.ALIYUN_SMS_KEY_SECRET!);
  const query = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

  try {
    const res = await fetch(`${ENDPOINT}?Signature=${percentEncode(sig)}&${query}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as { Code?: string; Message?: string };
    if (data.Code === 'OK') return { sent: true, detail: 'ok' };
    return { sent: false, detail: `${data.Code || res.status}: ${data.Message || ''}` };
  } catch (err) {
    return { sent: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
