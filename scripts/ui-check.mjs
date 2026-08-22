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
  await page.waitForSelector('.room');
  await page.waitForTimeout(900);

  console.log(`\n── ${name}`);
  ok(errors.length === 0, `renders with no page errors${errors.length ? ` — ${errors[0]}` : ''}`);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 0, `no horizontal overflow (${overflow}px)`);

  // §13: "Traders see no percentage anywhere in the UI."
  const pctsIn = () => page.evaluate(() =>
    (document.body.textContent ?? '').match(/\d+(\.\d+)?\s?%/g) ?? []);

  const traderPcts = await pctsIn();
  ok(traderPcts.length === 0,
    `traders see no percentage anywhere${traderPcts.length ? ` — found ${JSON.stringify(traderPcts.slice(0, 4))}` : ''}`);

  const odds = await page.evaluate(() =>
    ((document.body.textContent ?? '').match(/×\d+\.\d+/g) ?? []).length);
  ok(odds >= 4, `traders see odds instead (${odds} × figures)`);

  // Flip the real toggle rather than rendering a second fixture panel: this
  // exercises the control the operator actually presses.
  await page.click('.admbtn');
  await page.waitForTimeout(400);
  const adminPcts = await pctsIn();
  ok(adminPcts.length > 0, `the game maker DOES see probabilities (${adminPcts.length} of them)`);

  // §9: each quadrant cell's AREA is its probability. The expected values are
  // read off the game-maker view rather than hardcoded, so this stays true
  // whatever the fixture prices are.
  const geom = await page.evaluate(() => {
    const root = document.querySelector('.room');
    const R = root.getBoundingClientRect();
    const cells = [...root.querySelectorAll('.cell')].map((c) => {
      const b = c.getBoundingClientRect();
      const pct = (c.querySelector('.sub')?.textContent ?? '').match(/([\d.]+)\s?%/);
      return {
        label: c.querySelector('.pos')?.textContent,
        area: (b.width * b.height) / (R.width * R.height),
        stated: pct ? Number(pct[1]) / 100 : null,
      };
    });
    const cols = [...root.querySelectorAll('.col')]
      .map((c) => c.getBoundingClientRect().width / R.width);
    return { cells, cols };
  });
  let worst = 0;
  for (const c of geom.cells) {
    if (c.stated === null) { worst = 1; break; }
    worst = Math.max(worst, Math.abs(c.area - c.stated));
  }
  ok(worst < 0.012,
    `quadrant cell areas track their stated probabilities (worst Δ ${(worst * 100).toFixed(2)} points)`);
  const govStated = (geom.cells.find((c) => c.label === 'OG')?.stated ?? 0)
                  + (geom.cells.find((c) => c.label === 'CG')?.stated ?? 0);
  ok(Math.abs(geom.cols[0] - govStated) < 0.012,
    'the vertical split line is the Gov-vs-Opp market');

  await page.click('.admbtn');   // back to the trader view
  await page.waitForTimeout(300);
  ok((await pctsIn()).length === 0, 'and the percentages go away again on the way back');

  // One-handed in a corridor: nothing tiny to poke at.
  const small = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('button, a.pill')) {
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
    const panel = [...document.querySelectorAll('.card')]
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
