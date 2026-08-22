/**
 * The Edge Function cannot import from the Vite app's src/, so the Tabbycat
 * parsers are mirrored. This fails if the two copies drift apart in anything
 * but their header comment.
 */
import { readFileSync } from 'node:fs';

const strip = (s) => s.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();
const a = strip(readFileSync('src/lib/tab.ts', 'utf8'));
const b = strip(readFileSync('supabase/functions/_shared/parse.ts', 'utf8'));

if (a !== b) {
  console.error('  FAIL  src/lib/tab.ts and supabase/functions/_shared/parse.ts have drifted.');
  console.error('        Copy one over the other (only the header comment may differ).');
  process.exit(1);
}
console.log('  ok    the shared Tabbycat parsers are identical');
