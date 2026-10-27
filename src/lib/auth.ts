import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { one, q } from './db';

export const SESSION_COOKIE = 'ms_session';

export type User = {
  id: string;
  phone: string;
  nickname: string;
  color: string;
  created_at: string;
};

export type Space = {
  id: string;
  slug: string;
  title: string;
  direction: string;
  invite_code: string;
  owner_id: string;
  archived: boolean;
  created_at: string;
};

export type SpaceRole = 'owner' | 'collector' | 'brainstormer';

export type Actor =
  | { kind: 'user'; user: User }
  | { kind: 'agent'; keyId: string; name: string; spaceId: string };

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET || 'mindspace-dev-secret-do-not-use-in-prod';
  return new TextEncoder().encode(value);
}

/** 会话 90 天；活跃用户每 7 天自动续一次，常用设备基本不会再被要求登录。 */
const SESSION_DAYS = 90;
const REFRESH_AFTER_SECONDS = 60 * 60 * 24 * 7;

export type SessionMethod = 'otp' | 'password' | 'refresh';
export type SessionPayload = { uid: string; method: SessionMethod; iat: number };

export async function signSession(userId: string, method: SessionMethod = 'otp'): Promise<string> {
  return new SignJWT({ uid: userId, m: method })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function sessionFromToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.uid !== 'string') return null;
    const method = payload.m === 'password' || payload.m === 'refresh' ? payload.m : 'otp';
    return { uid: payload.uid, method, iat: Number(payload.iat) || 0 };
  } catch {
    return null;
  }
}

export async function userIdFromToken(token: string | undefined | null): Promise<string | null> {
  return (await sessionFromToken(token))?.uid ?? null;
}

export async function setSessionCookie(userId: string, method: SessionMethod = 'otp') {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(userId, method), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

/** 当前浏览器会话（含登录方式与签发时间），用于续期和"刚用验证码登录可直接改密码"。 */
export async function currentSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return sessionFromToken(jar.get(SESSION_COOKIE)?.value);
}

/** 签发超过 7 天就换一张新的 90 天会话，保留原登录方式。 */
export async function refreshSessionIfStale(session: SessionPayload): Promise<boolean> {
  const age = Math.floor(Date.now() / 1000) - session.iat;
  if (age < REFRESH_AFTER_SECONDS) return false;
  // 续期后的会话不再算"刚用验证码登录"，免得改密码的窗口被无限延长
  await setSessionCookie(session.uid, session.method === 'otp' ? 'refresh' : session.method);
  return true;
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  const uid = await userIdFromToken(jar.get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  return one<User>('select id, phone, nickname, color, created_at from users where id = $1', [uid]);
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(`${process.env.AUTH_SECRET || 'dev'}:${key}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 同一套 API 同时接受浏览器 Cookie 和 Agent Bearer Key。 */
export async function getActor(req: Request): Promise<Actor | null> {
  const auth = req.headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const raw = auth.slice(7).trim();
    if (!raw) return null;
    const row = await one<{ id: string; name: string; space_id: string; key_hash: string }>(
      'select id, name, space_id, key_hash from api_keys where revoked_at is null and key_hash = $1',
      [hashApiKey(raw)],
    );
    if (!row || !safeEqual(row.key_hash, hashApiKey(raw))) return null;
    q('update api_keys set last_used_at = now() where id = $1', [row.id]).catch(() => {});
    return { kind: 'agent', keyId: row.id, name: row.name, spaceId: row.space_id };
  }

  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
  const uid = await userIdFromToken(token);
  if (!uid) return null;
  const user = await one<User>('select id, phone, nickname, color, created_at from users where id = $1', [uid]);
  return user ? { kind: 'user', user } : null;
}

export async function roleFor(actor: Actor, spaceId: string): Promise<SpaceRole | null> {
  if (actor.kind === 'agent') return actor.spaceId === spaceId ? 'collector' : null;
  const row = await one<{ role: SpaceRole }>('select role from space_members where space_id = $1 and user_id = $2', [
    spaceId,
    actor.user.id,
  ]);
  return row?.role ?? null;
}

export async function findSpace(slug: string): Promise<Space | null> {
  return one<Space>('select * from spaces where slug = $1 and archived = false', [slug]);
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireSpaceActor(req: Request, slug: string, opts: { manage?: boolean } = {}) {
  const actor = await getActor(req);
  if (!actor) throw new HttpError(401, '请先登录');
  const space = await findSpace(slug);
  if (!space) throw new HttpError(404, '空间不存在');
  const role = await roleFor(actor, space.id);
  if (!role) throw new HttpError(403, '你不在这个空间里');
  if (opts.manage && role === 'brainstormer') throw new HttpError(403, '需要收集者权限');
  return { actor, space, role };
}

export function canManage(role: SpaceRole | null): boolean {
  return role === 'owner' || role === 'collector';
}

export function actorLabel(actor: Actor): string {
  return actor.kind === 'agent' ? `agent:${actor.name}` : actor.user.nickname;
}

/** Agent 也能投稿，用一条影子用户记录承载作者信息。 */
export async function actorAuthorId(actor: Actor, spaceId: string): Promise<string> {
  if (actor.kind === 'user') return actor.user.id;
  const phone = `agent:${spaceId}:${actor.name}`.slice(0, 40);
  const existing = await one<{ id: string }>('select id from users where phone = $1', [phone]);
  if (existing) return existing.id;
  const created = await one<{ id: string }>(
    `insert into users (phone, nickname, color) values ($1, $2, '#b58cff')
     on conflict (phone) do update set nickname = excluded.nickname returning id`,
    [phone, actor.name.slice(0, 16)],
  );
  return created!.id;
}
