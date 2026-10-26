#!/usr/bin/env node
// 小迁移器：按顺序执行 db/*.sql（幂等）。服务器部署时在应用启动前跑一次。
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dbDir = path.join(root, 'db');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL 未设置');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const files = (await readdir(dbDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(path.join(dbDir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('commit');
      console.log(`[migrate] ok ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }
  console.log('[migrate] done');
} finally {
  await client.end();
}
