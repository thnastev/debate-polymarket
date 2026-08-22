/**
 * UI checks that a typechecker cannot make.
 *
 * Renders the real board components (via preview/) in Chromium and asserts the
 * §13 criteria that are about pixels rather than types:
 *
 *   - traders see NO percentage anywhere
 *   - the quadrant's cell AREAS actually track the probabilities
 *   - nothing overflows horizontally at 380px
 *   - every tap target is big enough to hit one-handed
 *
 * Run with: npm run test:ui   (builds preview/, serves it, screenshots it)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const DIR = new URL('../dist-preview/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  try {
    const p = join(DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const fails = [];
const ok = (cond, label) => {
  if (cond) console.log(`  ok    ${label}`);
  else { console.error(`  FAIL  ${label}`); fails.push(label); }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const [w, h, name] of [[380, 1400, 'mobile 380px'], [1280, 1600, 'desktop 1280px']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
    // Google Fonts and the favicon are unreachable in a sandbox; not app errors.
    if (m.type() === 'error' && !/CONNECTION_RESET|404|VITE_SUPABASE|fonts\./.test(t)) errors.push(t);
  });
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('[data-view="trader"] .room');
  await page.waitForTimeout(900);

  console.log(`\n── ${name}`);
  ok(errors.length === 0, `renders with no page errors${errors.length ? ` — ${errors[0]}` : ''}`);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 0, `no horizontal overflow (${overflow}px)`);

  // §13: "Traders see no percentage anywhere in the UI."
  const traderPcts = await page.evaluate(() => {
    const t = document.querySelector('[data-view="trader"]');
    return (t?.textContent ?? '').match(/\d+(\.\d+)?\s?%/g) ?? [];
  });
  ok(traderPcts.length === 0,
    `traders see no percentage anywhere${traderPcts.length ? ` — found ${JSON.stringify(traderPcts.slice(0, 4))}` : ''}`);

  const adminPcts = await page.evaluate(() => {
    const a = document.querySelector('[data-view="admin"]');
    return ((a?.textContent ?? '').match(/\d+(\.\d+)?\s?%/g) ?? []).length;
  });
  ok(adminPcts > 0, `the game maker DOES see probabilities (${adminPcts} of them)`);

  const odds = await page.evaluate(() => {
    const t = document.querySelector('[data-view="trader"]');
    return ((t?.textContent ?? '').match(/×\d+\.\d+/g) ?? []).length;
  });
  ok(odds >= 4, `traders see odds instead (${odds} × figures)`);

  // §9: each quadrant cell's AREA is its probability.
  const geom = await page.evaluate(() => {
    const root = document.querySelector('[data-view="trader"] .room');
    const R = root.getBoundingClientRect();
    const cells = [...root.querySelectorAll('.cell')].map((c) => {
      const b = c.getBoundingClientRect();
      return {
        label: c.querySelector('.pos')?.textContent,
        area: (b.width * b.height) / (R.width * R.height),
      };
    });
    const cols = [...root.querySelectorAll('.col')]
      .map((c) => c.getBoundingClientRect().width / R.width);
    return { cells, cols };
  });
  // The fixture prices, from preview/main.tsx.
  const expected = { OG: 0.3324, OO: 0.2546, CG: 0.1824, CO: 0.2304 };
  let worst = 0;
  for (const c of geom.cells) worst = Math.max(worst, Math.abs(c.area - expected[c.label]));
  ok(worst < 0.01,
    `quadrant cell areas track their probabilities (worst Δ ${(worst * 100).toFixed(2)} points)`);
  ok(Math.abs(geom.cols[0] - (expected.OG + expected.CG)) < 0.01,
    'the vertical split line is the Gov-vs-Opp market');

  // One-handed in a corridor: nothing tiny to poke at.
  const small = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('[data-view="trader"] button')) {
      const b = el.getBoundingClientRect();
      if (b.height > 0 && b.height < 30) bad.push(`${el.className}@${Math.round(b.height)}px`);
    }
    return bad;
  });
  ok(small.length === 0,
    `every tap target is at least 30px tall${small.length ? ` — ${small.join(', ')}` : ''}`);

  // §13: "The bet preview shows effective odds, not headline odds."
  // The fixture is a 25 ƀ stake on an outcome trading at ×3.01; the stake moves
  // the price, so the trader's own odds must come back WORSE than the headline.
  const bet = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('[data-view="trader"] .card')]
      .find((c) => c.querySelector('.prev'));
    if (!panel) return null;
    const rows = [...panel.querySelectorAll('.prev .r')].map((r) => r.textContent ?? '');
    const headline = panel.querySelector('.selrow .o')?.textContent ?? '';
    const button = panel.querySelector('.go');
    const b = button?.getBoundingClientRect();
    return { rows, headline, buttonHeight: b ? Math.round(b.height) : 0,
             buttonText: button?.textContent ?? '' };
  });
  ok(bet !== null, 'the bet panel renders');
  if (bet) {
    const yourOdds = bet.rows.find((r) => /Your odds/.test(r)) ?? '';
    const eff = Number((yourOdds.match(/×([\d.]+)/) ?? [])[1]);
    const head = Number((bet.headline.match(/×([\d.]+)/) ?? [])[1]);
    ok(Number.isFinite(eff), `the preview shows the trader's own odds (${yourOdds.trim()})`);
    ok(eff < head,
      `effective odds ×${eff} are worse than the headline ×${head} — the stake moved the price`);
    ok(bet.rows.some((r) => /Returns if/.test(r)), 'and what the bet returns if it lands');
    ok(bet.buttonHeight >= 44,
      `the bet button is thumb-sized (${bet.buttonHeight}px) and says "${bet.buttonText.trim()}"`);
  }

  await page.screenshot({ path: `dist-preview/${name.split(' ')[0]}.png`, fullPage: true });
  await page.close();
}

await browser.close();
server.close();
if (fails.length) { console.error(`\n  ${fails.length} UI check(s) failed`); process.exit(1); }
console.log('\n  UI checks passed.');
