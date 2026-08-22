/**
 * Inline the preview build into one self-contained .html file, so it can be
 * opened straight from disk or handed to someone with no server, no install
 * and no Supabase project.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'dist-preview';
const assets = await readdir(join(DIR, 'assets'));
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));

let html = await readFile(join(DIR, 'index.html'), 'utf8');
const jsBody = await readFile(join(DIR, 'assets', js), 'utf8');
const cssBody = await readFile(join(DIR, 'assets', css), 'utf8');

// Drop the whole tag that references each asset, whatever attribute order
// Vite emitted it with, then inline the contents.
const dropTagContaining = (s, needle, open, close) => {
  const at = s.indexOf(needle);
  if (at < 0) throw new Error(`asset reference not found: ${needle}`);
  const start = s.lastIndexOf(open, at);
  const end = s.indexOf(close, at) + close.length;
  return s.slice(0, start) + s.slice(end);
};

html = dropTagContaining(html, js, '<script', '</script>');
html = dropTagContaining(html, css, '<link', '>');
// NOTE the replacer FUNCTIONS. A string replacement would treat `$&`, `` $` ``
// and `$'` inside the bundle as substitution patterns and silently corrupt the
// JavaScript — a minified bundle is full of `$` sequences, and the result is a
// page that loads and then dies on "Unexpected token '<'". A function
// replacement is taken literally.
html = html
  .replace('</head>', () => `<style>\n${cssBody}\n</style>\n</head>`)
  .replace('</body>', () => `<script type="module">\n${jsBody}\n</script>\n</body>`);

if (html.includes('assets/')) throw new Error('an asset reference survived inlining');

const out = 'biser-market-preview.html';
await writeFile(out, html);
console.log(`  ok    ${out} — ${(html.length / 1024).toFixed(0)} kB, self-contained`);
