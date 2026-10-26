import { randomBytes } from 'node:crypto';
import { requireSpaceActor, hashApiKey } from '@/lib/auth';
import { q } from '@/lib/db';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    const keys = await q(
      `select id, name, prefix, created_at, last_used_at, revoked_at from api_keys
       where space_id = $1 order by created_at desc`,
      [space.id],
    );
    return json({ keys });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug, { manage: true });
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name ?? '').trim().slice(0, 40) || 'agent';
    const raw = `ms_live_${randomBytes(20).toString('hex')}`;
    const createdBy = actor.kind === 'user' ? actor.user.id : null;
    const row = await q<{ id: string }>(
      `insert into api_keys (space_id, name, prefix, key_hash, created_by)
       values ($1, $2, $3, $4, $5) returning id`,
      [space.id, name, raw.slice(0, 16), hashApiKey(raw), createdBy],
    );
    return json({ id: row[0]?.id, name, key: raw }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return json({ error: '缺少 id' }, { status: 400 });
    await q('update api_keys set revoked_at = now() where id = $1 and space_id = $2', [id, space.id]);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
