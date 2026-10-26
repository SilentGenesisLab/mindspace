import { HttpError } from './auth';

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function fail(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
  console.error('[api]', err);
  const message = err instanceof Error ? err.message : '服务器错误';
  return json({ error: message }, { status: 500 });
}

const globalForLimit = globalThis as unknown as { __msLimits?: Map<string, number[]> };

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const store: Map<string, number[]> = (globalForLimit.__msLimits ??= new Map<string, number[]>());
  const now = Date.now();
  const hits = (store.get(key) ?? []).filter((t: number) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return false;
  }
  hits.push(now);
  store.set(key, hits);
  if (store.size > 5000) {
    for (const [k, v] of store) if (v.every((t: number) => now - t > windowMs)) store.delete(k);
  }
  return true;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip')) || 'local';
}
