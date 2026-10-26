import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const file = await readFile(path.join(process.cwd(), 'cli', 'mindspace.mjs'), 'utf8');
    return new Response(file, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('cli not found', { status: 404 });
  }
}
