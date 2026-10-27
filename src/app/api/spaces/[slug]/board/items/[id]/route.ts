import { actorAuthorId, canManage, HttpError, requireSpaceActor } from '@/lib/auth';
import { deleteItem, getItemOwner, itemDetail, updateItem } from '@/lib/board';
import { fail, json } from '@/lib/http';

type Ctx = { params: Promise<{ slug: string; id: string }> };

async function requireEditable(req: Request, slug: string, id: string) {
  const { actor, space, role } = await requireSpaceActor(req, slug);
  const owner = await getItemOwner(space.id, id);
  if (!owner) throw new HttpError(404, '条目不存在');
  if (!canManage(role) && owner.created_by !== (await actorAuthorId(actor, space.id))) {
    throw new HttpError(403, '只能改自己提的条目');
  }
  return { space, role };
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { slug, id } = await params;
    const { space } = await requireSpaceActor(req, slug);
    const detail = await itemDetail(space.id, id);
    if (!detail) return json({ error: '条目不存在' }, { status: 404 });
    return json(detail);
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { slug, id } = await params;
    const { space, role } = await requireEditable(req, slug, id);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const manage = canManage(role);
    const input = {
      raw: typeof body.raw === 'string' ? body.raw : undefined,
      rewrite: typeof body.rewrite === 'string' ? body.rewrite : undefined,
      urgency: typeof body.urgency === 'string' ? body.urgency : undefined,
      acceptance: typeof body.acceptance === 'string' ? body.acceptance : undefined,
      // 补充要求、挪分支、排序属于收集者
      feedback: manage && typeof body.feedback === 'string' ? body.feedback : undefined,
      sectionId: manage && typeof body.sectionId === 'string' ? body.sectionId : undefined,
      position: manage && typeof body.position === 'number' ? body.position : undefined,
    };
    return json({ item: await updateItem(space.id, id, input) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { slug, id } = await params;
    const { space } = await requireEditable(req, slug, id);
    await deleteItem(space.id, id);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
