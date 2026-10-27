import { actorAuthorId, requireSpaceActor } from '@/lib/auth';
import { saveAutomation } from '@/lib/board';
import { fail, json } from '@/lib/http';

/** 自动执行设置：开关、间隔分钟、单条最多试几次。 */
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { actor, space } = await requireSpaceActor(req, slug, { manage: true });
    const body = (await req.json().catch(() => ({}))) as {
      enabled?: unknown;
      intervalMinutes?: unknown;
      maxAttempts?: unknown;
    };
    const automation = await saveAutomation(
      space.id,
      {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        intervalMinutes: typeof body.intervalMinutes === 'number' ? body.intervalMinutes : undefined,
        maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined,
      },
      await actorAuthorId(actor, space.id),
    );
    return json({ automation });
  } catch (err) {
    return fail(err);
  }
}
