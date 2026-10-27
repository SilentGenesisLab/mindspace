import { canManage, requireSpaceActor } from '@/lib/auth';
import { boardToCsv, getBoard, saveHeader } from '@/lib/board';
import { fail, json } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space, role } = await requireSpaceActor(req, slug);
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      return new Response(await boardToCsv(space.id), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${space.slug}-board-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return json({ ...(await getBoard(space.id)), canManage: canManage(role) });
  } catch (err) {
    return fail(err);
  }
}

/** 改表头：核心需求 / 核心命题 / 提问和验收原则 / 核心 KPI */
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    const body = (await req.json().catch(() => ({}))) as Record<string, string>;
    return json({ header: await saveHeader(space.id, body) });
  } catch (err) {
    return fail(err);
  }
}
