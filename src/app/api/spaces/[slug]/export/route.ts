import { requireSpaceActor } from '@/lib/auth';
import { exportSpace } from '@/lib/space';
import { fail } from '@/lib/http';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { space } = await requireSpaceActor(req, slug, { manage: true });
    const format = (new URL(req.url).searchParams.get('format') || 'json') as 'json' | 'csv' | 'md';
    const safeFormat = ['json', 'csv', 'md'].includes(format) ? format : 'json';
    const body = await exportSpace(space.id, safeFormat);
    const types: Record<string, string> = {
      json: 'application/json; charset=utf-8',
      csv: 'text/csv; charset=utf-8',
      md: 'text/markdown; charset=utf-8',
    };
    return new Response(body, {
      headers: {
        'Content-Type': types[safeFormat],
        'Content-Disposition': `attachment; filename="${space.slug}-${new Date().toISOString().slice(0, 10)}.${safeFormat}"`,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
