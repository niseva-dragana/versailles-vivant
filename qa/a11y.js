#!/usr/bin/env node
'use strict';
/**
 * Browser checks for every page x language x viewport width, as a first-time visitor (cookie notice showing):
 *   - axe-core: WCAG 2.0/2.1/2.2 A and AA rules plus best practices
 *   - no horizontal scrolling (reflow at 320 px), <html lang> matches the chosen language
 *   - no JavaScript errors, no failed requests to the site itself
 *   - the site header never wraps onto a second row on desktop
 *   - the page heading is visible as soon as the page has loaded (nothing waits for an animation)
 * Three kinds of visit are checked:
 *   1. language chosen earlier (stored in the browser: lang-init.js moves the page to its ?lang= address; the 404 page is
 *      translated in place by script.js), reduced motion, every width
 *   2. a shared ?lang=fr|mk address (translated by the server before it is sent), at 390 and 1280 px
 *   3. with animations on (no reduced-motion preference), English, 1280 px, after the scroll-in effects have run
 *
 * Setup (once):   cd qa && npm install
 * Run:            npm run a11y            (from the project folder; starts its own copy of the server)
 *                 CHROME_PATH=/usr/bin/chromium npm run a11y
 *                 BASE=https://example.org node qa/a11y.js    (check a deployed copy instead)
 *                 WIDTHS=320,1280 LANGS=fr node qa/a11y.js     (narrow the matrix)
 * Exit code is 1 when anything is found, so it can run in CI.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const ROOT = path.resolve(__dirname, '..');
const LANGS = (process.env.LANGS || 'en,fr,mk').split(',');
const WIDTHS = (process.env.WIDTHS || '320,390,768,1280').split(',').map(Number);
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();

function runs() {
  const list = [];
  for (const lang of LANGS) for (const width of WIDTHS) list.push({ lang, width, motion: 'reduce', how: 'stored', url: (f) => '/' + f });
  for (const lang of LANGS.filter((l) => l !== 'en')) for (const width of WIDTHS.filter((w) => w === 390 || w === 1280)) {
    list.push({ lang, width, motion: 'reduce', how: '?lang', url: (f) => '/' + f + '?lang=' + lang });
  }
  if (LANGS.includes('en') && WIDTHS.includes(1280)) list.push({ lang: 'en', width: 1280, motion: 'no-preference', how: 'animated', url: (f) => '/' + f });
  return list;
}

async function main() {
  let base = (process.env.BASE || '').replace(/\/+$/, '');
  let server;
  if (!base) {
    const { createServer } = require('../server');
    server = createServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vv-a11y-')), log: false });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  const baseOrigin = new URL(base).origin;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const problems = [];
  let checked = 0;
  const note = (key, what) => problems.push(key + '  ' + what);

  for (const run of runs()) {
    const { lang, width } = run;
    {
      // bypassCSP only so that axe can be injected; the page itself is still served with its own CSP header
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: run.motion, bypassCSP: true });
      if (run.how === 'stored') await ctx.addInitScript((l) => { try { localStorage.setItem('vv_language', l); } catch (e) { /* storage unavailable */ } }, lang);
      // only the site itself is checked (the OpenStreetMap map, which loads on request, is left out)
      await ctx.route('**/*', (route) => (new URL(route.request().url()).origin === baseOrigin ? route.continue() : route.abort()));
      for (const f of PAGES) {
        const key = `${f} [${lang} ${width}px ${run.how}]`;
        const page = await ctx.newPage();
        page.on('pageerror', (e) => note(key, 'script error: ' + String(e).slice(0, 160)));
        // the status of the last page the tab landed on (a returning visitor's language moves the tab to that language's address)
        let status = 0;
        page.on('response', (r) => { if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status(); });
        const movesToLanguage = run.how === 'stored' && lang !== 'en' && f !== '404.html';
        // when the page moves to its language address, the first copy's unfinished downloads are cancelled: that is expected
        page.on('requestfailed', (r) => {
          if (new URL(r.url()).origin !== baseOrigin) return;
          if (movesToLanguage && /ERR_ABORTED/.test((r.failure() || {}).errorText || '')) return;
          note(key, 'request failed: ' + r.url());
        });
        await page.goto(base + run.url(f), { waitUntil: 'load' }).catch((e) => { if (!movesToLanguage) note(key, 'navigation failed: ' + e.message.split('\n')[0]); });
        if (movesToLanguage) {
          // lang-init.js sends the visitor to about.html?lang=mk, so the address, the canonical link and the text agree
          await page.waitForURL((u) => u.searchParams.get('lang') === lang, { waitUntil: 'load', timeout: 10000 })
            .catch(() => note(key, 'the stored language did not lead to the ?lang=' + lang + ' address (' + page.url() + ')'));
        }
        // 404.html is also a normal file when asked for by name; unknown addresses return 404 with the same page
        if (![200, f === '404.html' ? 404 : 0].includes(status)) note(key, 'HTTP ' + status);
        const h1 = await page.evaluate(() => { const h = document.querySelector('h1'); return h ? Number(getComputedStyle(h).opacity) : 1; });
        if (h1 < 1) note(key, 'page heading not fully visible at load (opacity ' + h1 + ')');
        if (run.how === 'animated') {
          // let every scroll-in effect run before checking colours and overlaps
          await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
          await page.waitForTimeout(1200);
        } else await page.waitForTimeout(300);
        const facts = await page.evaluate(() => {
          const header = document.querySelector('.site-header .nav');
          let rows = 0;
          if (header && window.innerWidth >= 1281) {
            // one row = every item vertically centred on the same line and no menu label broken over two lines
            const centres = Array.from(header.querySelectorAll('.brand, .nav-links > li > a, .lang-toggle a'))
              .map((el) => el.getBoundingClientRect()).filter((r) => r.width).map((r) => r.top + r.height / 2);
            const brokenLabel = Array.from(header.querySelectorAll('.nav-links > li > a')).some((a) => {
              const range = document.createRange(); range.selectNodeContents(a);
              return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size > 1;
            });
            rows = Math.max(...centres) - Math.min(...centres) > 20 || brokenLabel ? 2 : 1;
          }
          return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, rows };
        });
        if (facts.lang !== lang) note(key, `<html lang="${facts.lang}">`);
        if (facts.overflow) note(key, 'horizontal scrolling');
        if (facts.rows > 1) note(key, 'header wraps onto ' + facts.rows + ' rows');
        await page.evaluate(axeSource);
        const result = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
        for (const v of result.violations) note(key, `axe ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help} -> ${v.nodes[0].target.join(' ').slice(0, 90)}`);
        checked++;
        await page.close();
      }
      await ctx.close();
    }
  }
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (problems.length) {
    console.log(problems.join('\n'));
    console.log(`\n${problems.length} problem(s) in ${checked} page views.`);
    process.exit(1);
  }
  console.log(`OK: ${checked} page views (${PAGES.length} pages; ${LANGS.length} languages x ${WIDTHS.length} widths, plus server-rendered ?lang= pages and an animated pass), no axe violations, no overflow, no script errors.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
