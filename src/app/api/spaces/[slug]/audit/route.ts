import { requireSpaceActor } from '@/lib/auth';
import { listAudits, runAudit } from '@/lib/audit';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    return json({ audits: await listAudits(space.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    const result = await runAudit(space.id, { trigger: 'manual' });
    return json({ ok: true, ...result });
  } catch (err) {
    return fail(err);
  }
}
