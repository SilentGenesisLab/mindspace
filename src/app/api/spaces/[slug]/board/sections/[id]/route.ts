import { requireSpaceActor } from '@/lib/auth';
import { deleteSection, updateSection } from '@/lib/board';
import { fail, json } from '@/lib/http';

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { slug, id } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    const body = (await req.json().catch(() => ({}))) as { title?: string; description?: string; position?: number };
    return json({ section: await updateSection(space.id, id, body) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { slug, id } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    await deleteSection(space.id, id);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
