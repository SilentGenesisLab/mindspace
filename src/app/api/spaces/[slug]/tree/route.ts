import { requireSpaceActor } from '@/lib/auth';
import { generateTree, latestTree, treeToMarkdown } from '@/lib/tree';
import { treeTaskMap } from '@/lib/execution';
import { fail, json, rateLimit } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug);
    const row = await latestTree(space.id);
    const format = new URL(req.url).searchParams.get('format');

    if (!row) {
      if (format === 'md') return new Response('还没有生成问题树。', { status: 404 });
      return json({ tree: null, meta: null });
    }

    if (format === 'md') {
      const body = treeToMarkdown(space, row.tree, { created_at: row.created_at, stats: row.stats });
      return new Response(body, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${space.slug}-tree.md"`,
        },
      });
    }

    return json({
      tree: row.tree,
      meta: { id: row.id, model: row.model, stats: row.stats, created_at: row.created_at },
      tasks: await treeTaskMap(space.id, row.id),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug, { manage: true });
    if (!rateLimit(`tree:${space.id}`, 1, 20_000)) {
      return json({ error: '刚收束过，稍等 20 秒再试' }, { status: 429 });
    }
    const userId = actor.kind === 'user' ? actor.user.id : null;
    const result = await generateTree(space.id, userId);
    return json(result, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
