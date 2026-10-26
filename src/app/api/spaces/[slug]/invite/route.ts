import { requireSpaceActor } from '@/lib/auth';
import { q } from '@/lib/db';
import { fail, json } from '@/lib/http';
import { shortCode } from '@/lib/text';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    const invite = shortCode(12);
    await q('update spaces set invite_code = $2 where id = $1', [space.id, invite]);
    const origin = new URL(req.url).origin;
    return json({ invite_code: invite, url: `${origin}/join/${invite}` });
  } catch (err) {
    return fail(err);
  }
}
