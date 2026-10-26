import { requireSpaceActor } from '@/lib/auth';
import { latestTree } from '@/lib/tree';
import { dispatchTree, type DispatchMode } from '@/lib/execution';
import { fail, json } from '@/lib/http';

const MODES = new Set(['gaps', 'missing', 'all', 'selected']);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug, { manage: true });
    const body = (await req.json().catch(() => ({}))) as {
      treeId?: string;
      mode?: string;
      itemIds?: string[];
      assignee?: string;
    };

    let treeId = body.treeId;
    if (!treeId) {
      const tree = await latestTree(space.id);
      treeId = tree?.id;
    }
    if (!treeId) return json({ error: '还没有问题树，先收束' }, { status: 400 });

    const mode = (body.mode || 'missing') as DispatchMode;
    if (!MODES.has(mode)) return json({ error: '未知派发模式' }, { status: 400 });
    if (mode === 'selected' && (!body.itemIds || body.itemIds.length === 0)) {
      return json({ error: '没有选中条目' }, { status: 400 });
    }

    const result = await dispatchTree({
      spaceId: space.id,
      treeId,
      mode,
      itemIds: body.itemIds,
      createdBy: actor.kind === 'user' ? actor.user.id : null,
      assignee: body.assignee || null,
    });
    return json({ ...result, treeId }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
