import { requireSpaceActor, actorAuthorId } from '@/lib/auth';
import { createNode, listNodes, publicNode } from '@/lib/nodes';
import { fail, json, rateLimit } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug);
    const url = new URL(req.url);
    const result = await listNodes(space.id, {
      q: url.searchParams.get('q') || undefined,
      tag: url.searchParams.get('tag') || undefined,
      author: url.searchParams.get('author') || undefined,
      cluster: url.searchParams.get('cluster') || undefined,
      domain: url.searchParams.get('domain') || undefined,
      type: url.searchParams.get('type') || undefined,
      kind: url.searchParams.get('kind') || undefined,
      limit: Number(url.searchParams.get('limit')) || 100,
      offset: Number(url.searchParams.get('offset')) || 0,
    });
    return json(result);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space, role } = await requireSpaceActor(req, slug);
    if (!rateLimit(`node:${space.id}:${actor.kind === 'user' ? actor.user.id : actor.name}`, 40, 60_000)) {
      return json({ error: '提交太快了，休息一下' }, { status: 429 });
    }
    const body = (await req.json().catch(() => ({}))) as { content?: string; kind?: string };
    const content = String(body.content ?? '').trim();
    if (content.length < 2) return json({ error: '至少写两个字' }, { status: 400 });
    if (content.length > 500) return json({ error: '最多 500 字' }, { status: 400 });

    const authorId = await actorAuthorId(actor, space.id);
    const { node, analysis } = await createNode({ spaceId: space.id, authorId, content, kind: body.kind });
    const fresh = await listNodes(space.id, { q: node.content.slice(0, 20), limit: 1 });
    return json(
      {
        node: fresh.nodes.find((n) => n.id === node.id) ?? publicNode(node),
        analysis,
        role,
      },
      { status: 201 },
    );
  } catch (err) {
    return fail(err);
  }
}
