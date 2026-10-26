export type LlmModel = string;

export type ChatResult = { text: string; model: string; ms: number; usage?: Record<string, unknown> };

export class LlmError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const BASE = () => process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1';

export async function chat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: { model: string; json?: boolean; maxTokens?: number; temperature?: number; timeoutMs?: number; title?: string },
): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new LlmError('OPENROUTER_API_KEY 未配置');

  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE()}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'https://mindspace.sligenai.cn',
          'X-Title': opts.title || 'Mindspace',
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          temperature: opts.temperature ?? 0.1,
          max_tokens: opts.maxTokens ?? 800,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 429 || res.status >= 500) {
          lastError = new LlmError(`上游 ${res.status}: ${body.slice(0, 200)}`, res.status);
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw new LlmError(`上游 ${res.status}: ${body.slice(0, 300)}`, res.status);
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: Record<string, unknown>;
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) throw new LlmError('模型返回为空');
      return { text, model: data.model || opts.model, ms: Date.now() - started, usage: data.usage };
    } catch (err) {
      lastError = err;
      if (err instanceof LlmError && err.status && err.status < 500 && err.status !== 429) throw err;
      if (attempt === 2) break;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new LlmError(String(lastError));
}

/** 模型偶尔会包 ```json 或加解释，这里只取出第一个完整 JSON 对象。 */
export function extractJson<T = unknown>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const candidates: string[] = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try next */
    }
  }
  return null;
}

export const JEV_MODEL = () => process.env.JEV_MODEL || 'typesafe/jev-router';
export const AUDIT_MODEL = () => process.env.AUDIT_MODEL || 'deepseek/deepseek-v4.1-flash';
