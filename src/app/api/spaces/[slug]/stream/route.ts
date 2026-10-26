import { requireSpaceActor } from '@/lib/auth';
import { subscribe } from '@/lib/events';
import { fail } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug);

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            /* closed */
          }
        };
        send('ready', { space: space.slug, at: new Date().toISOString() });
        unsubscribe = subscribe(space.id, (event) => send(event.type, event.data));
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            /* closed */
          }
        }, 25_000);
      },
      cancel() {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    return fail(err);
  }
}
