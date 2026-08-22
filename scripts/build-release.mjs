/**
 * Build the drag-and-drop release.
 *
 * Produces biser-market-site.zip containing the built site plus the two things
 * the operator needs that are not code: one combined SQL file to paste into
 * Supabase, and a plain-text setup guide. The point is that nothing in the zip
 * requires Node, a terminal, or a rebuild — config.js is read at runtime.
 */
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = 'release/biser-market-site';
await rm('release', { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// 1. the built site
await cp('dist', OUT, { recursive: true });

// 2. every migration, in order, as one paste
const dir = 'supabase/migrations';
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
let sql = `-- ============================================================
-- Biser Market — complete database setup
--
-- Paste this whole file into the Supabase SQL Editor and press Run, ONCE.
-- It builds every table, the market maker, the security rules and the
-- game-maker functions, in the right order.
--
-- It is the ${files.length} migration files from supabase/migrations/
-- concatenated: ${files.join(', ')}.
--
-- If it reports an error, stop and send the error rather than running it
-- again — a half-applied schema is harder to fix than a failed one.
-- ============================================================

`;
for (const f of files) {
  sql += `\n-- ─────────────────────────────────────────────────────────\n`;
  sql += `-- ${f}\n`;
  sql += `-- ─────────────────────────────────────────────────────────\n`;
  sql += await readFile(join(dir, f), 'utf8');
  sql += '\n';
}
await writeFile(join(OUT, 'database-setup.sql'), sql);

// 3. the guide
await cp('scripts/release-README.txt', join(OUT, 'READ-ME-FIRST.txt'));

// 4. zip it — the archive lands at the repo root, beside the folder it came
// from, so it is easy to find and easy to send.
const ZIP = 'biser-market-site.zip';
await rm(ZIP, { force: true });
execFileSync('zip', ['-r', '-q', join('..', ZIP), 'biser-market-site'], { cwd: 'release' });

const size = (await readFile(ZIP)).length;
console.log(`  ok    ${ZIP} — ${(size / 1024).toFixed(0)} kB`);
console.log(`        site + database-setup.sql (${files.length} migrations) + READ-ME-FIRST.txt`);
