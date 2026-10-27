import { requireSpaceActor } from '@/lib/auth';
import { runAutomation } from '@/lib/board-auto';
import { fail, json, rateLimit } from '@/lib/http';

/** 不等定时，立刻跑一轮自动执行（未开启也能手动跑）。 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    if (!rateLimit(`board-auto-run:${space.id}`, 3, 60_000)) return json({ error: '刚跑过，等一分钟' }, { status: 429 });
    return json(await runAutomation(space.id, 'manual'));
  } catch (err) {
    return fail(err);
  }
}
