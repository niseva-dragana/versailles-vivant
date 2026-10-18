'use strict';
// Runs the real server on a random port and checks what a browser, a crawler or an attacker would see.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, pages, startServer } = require('./helpers');

let app;
test.before(async () => { app = await startServer({ rateLimit: { max: 6, windowMs: 60000 } }); });
test.after(async () => { await app.close(); });

test('every page answers 200 as HTML, with and without .html', async () => {
  for (const f of pages().filter((p) => p !== '404.html')) {
    const r = await app.get('/' + f);
    assert.strictEqual(r.status, 200, f);
    assert.match(r.headers['content-type'], /text\/html/);
    const pretty = await app.get('/' + f.replace('.html', ''));
    assert.strictEqual(pretty.status, 200, 'pretty URL for ' + f);
  }
  assert.strictEqual((await app.get('/')).status, 200);
});

test('unknown URLs give a styled 404 whose links work from any depth', async () => {
  const r = await app.get('/no/such/page');
  assert.strictEqual(r.status, 404);
  assert.match(r.body, /<h1[^>]*>Page not found/);
  assert.match(r.body, /href="\/styles\.css"/);
  assert.match(r.body, /<meta name="robots" content="noindex">/);
  assert.strictEqual((await app.get('/api/nothing')).status, 404);
});

test('security headers are sent', async () => {
  const r = await app.get('/');
  const csp = r.headers['content-security-policy'];
  assert.ok(csp.includes("default-src 'self'") && csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  // the no-JavaScript form fallback is a mailto: link, which a bare form-action 'self' would block
  assert.ok(/form-action 'self' mailto:/.test(csp));
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(r.headers['x-frame-options'], 'DENY');
  assert.ok(r.headers['referrer-policy']);
  assert.ok(r.headers['permissions-policy']);
  assert.ok(!r.headers['x-powered-by']);
  assert.ok(!r.headers['set-cookie'], 'the site must not set cookies');
});

test('source, tooling and hidden files are not served', async () => {
  for (const p of ['/server.js', '/package.json', '/test/server.test.js', '/scripts/build-pages.js', '/server/render-lang.js', '/server/documents.js', '/scripts/build-static.js', '/qa/a11y.js', '/qa/package.json', '/partials/head.html',
    '/.git/config', '/.env', '/Dockerfile', '/%2e%2e/etc/passwd', '/..%2fserver.js', '/fonts/../server.js', '/data/messages.jsonl']) {
    const r = await app.get(p);
    assert.strictEqual(r.status, 404, p);
  }
});

test('static assets are served with the right types and caching', async () => {
  const css = await app.get('/styles.css');
  assert.match(css.headers['content-type'], /text\/css/);
  const font = await app.get('/fonts/work-sans-400.woff2');
  assert.strictEqual(font.status, 200);
  assert.match(font.headers['cache-control'], /immutable/);
  const again = await app.get('/styles.css', { 'If-None-Match': css.headers.etag });
  assert.strictEqual(again.status, 304);
  const gz = await app.get('/i18n/common.js', { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(gz.headers['content-encoding'], 'gzip');
});

test('sitemap, robots and feed are generated for the requesting host', async () => {
  const sm = await app.get('/sitemap.xml', { Host: 'example.org' });
  assert.strictEqual(sm.status, 200);
  for (const f of pages().filter((p) => p !== '404.html' && p !== 'index.html')) {
    for (const loc of [f, f + '?lang=fr', f + '?lang=mk']) assert.ok(sm.body.includes('<loc>http://example.org/' + loc + '</loc>'), loc);
    // English is the plain address, never ?lang=en
    assert.ok(sm.body.includes('<xhtml:link rel="alternate" hreflang="en" href="http://example.org/' + f + '"/>'), f);
  }
  assert.ok(!sm.body.includes('404.html'));
  assert.ok(!sm.body.includes('lang=en'));
  assert.strictEqual((sm.body.match(/<url>/g) || []).length, 3 * (pages().length - 1));
  const robots = await app.get('/robots.txt', { Host: 'example.org' });
  assert.ok(robots.body.includes('Sitemap: http://example.org/sitemap.xml'));
  const feed = await app.get('/feed.xml', { Host: 'example.org' });
  assert.match(feed.headers['content-type'], /atom\+xml/);
  assert.ok(!feed.body.includes('{{ORIGIN}}') && feed.body.includes('http://example.org/journal.html#hedges'));
  const home = await app.get('/', { Host: 'example.org' });
  assert.ok(home.body.includes('<link rel="canonical" href="http://example.org/">'));
  assert.ok(!home.body.includes('{{ORIGIN}}'));
});

test('a hostile Host header cannot inject markup', async () => {
  const r = await app.get('/', { Host: 'evil.example"><script>alert(1)</script>' });
  assert.strictEqual(r.status, 200); // served normally, with a safe host name in the links
  assert.ok(!r.body.includes('<script>alert'));
  assert.ok(r.body.includes('rel="canonical" href="http://localhost/"'));
});

test('?lang= returns a genuinely translated document', async () => {
  const en = await app.get('/about.html');
  const fr = await app.get('/about.html?lang=fr');
  const mk = await app.get('/about.html?lang=mk');
  assert.match(fr.body, /<html lang="fr">/);
  assert.match(mk.body, /<html lang="mk">/);
  const title = (b) => /<title[^>]*>([^<]*)<\/title>/.exec(b)[1];
  assert.notStrictEqual(title(fr.body), title(en.body));
  assert.match(title(mk.body), /[Ѐ-ӿ]/);
  assert.ok(fr.body.includes('rel="canonical" href="http://127.0.0.1:' + app.port + '/about.html?lang=fr"'));
  // the language switch is made of links; the current language is marked with aria-current, in both copies of the switch
  assert.strictEqual((fr.body.match(/<a href="\?lang=fr" hreflang="fr" data-lang="fr"[^>]*aria-current="true"/g) || []).length, 2);
  assert.ok(!/<a [^>]*data-lang="en"[^>]*aria-current/.test(fr.body), 'English is no longer marked as current');
  assert.ok(/[Ѐ-ӿ]{4,}/.test(mk.body));
  assert.strictEqual((await app.get('/about.html?lang=xx')).body, en.body); // unknown language falls back to English
});

test('translated pages keep the language in internal links and in structured data', async () => {
  const jsonld = (b) => [].concat(...[...b.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])));
  // English stays plain
  const en = await app.get('/faq.html');
  assert.ok(!/<a\b[^>]*href="[a-z0-9-]+\.html\?lang=/.test(en.body), 'English links carry no ?lang=');
  // French and Macedonian: every link to a page of the site carries the language, fragments survive
  for (const lang of ['fr', 'mk']) {
    const r = await app.get('/index.html?lang=' + lang);
    assert.ok(r.body.includes('href="about.html?lang=' + lang + '"'));
    assert.ok(r.body.includes('href="privacy.html?lang=' + lang + '#cookies"'), 'link inside a translated text keeps the fragment');
    assert.deepStrictEqual(r.body.match(/<a\b[^>]*\shref="[a-z0-9-]+\.html(?!\?lang=)[^"]*"/g), null, 'no page link without the language');
    assert.ok(!/href="[^"]*\?lang=[a-z]+\?lang=/.test(r.body));
  }
  // structured data follows the page language; types, URLs and the list of available languages do not change
  const fr = jsonld((await app.get('/faq.html?lang=fr')).body);
  const faq = fr.find((x) => x['@type'] === 'FAQPage');
  assert.ok(faq && /[éèàç]/.test(JSON.stringify(faq.mainEntity[0])), 'FAQ structured data is French');
  const enFaq = jsonld(en.body).find((x) => x['@type'] === 'FAQPage');
  assert.notStrictEqual(faq.mainEntity[0].name, enFaq.mainEntity[0].name);
  assert.strictEqual(faq.mainEntity.length, enFaq.mainEntity.length);
  const mkEvents = jsonld((await app.get('/events.html?lang=mk')).body).filter((x) => x['@type'] === 'Event');
  assert.ok(mkEvents.length >= 9);
  assert.ok(mkEvents.every((e) => e.inLanguage === 'mk'));
  assert.ok(mkEvents.every((e) => /[Ѐ-ӿ]/.test(e.name)), 'event names are Macedonian');
  assert.ok(mkEvents.every((e) => /^http:\/\/127\.0\.0\.1:\d+\/events\.html\?lang=mk#[a-z0-9-]+$/.test(e.url)), 'event URLs lead to the Macedonian page');
  const site = jsonld((await app.get('/index.html?lang=fr')).body).find((x) => x['@type'] === 'WebSite');
  assert.deepStrictEqual(site.inLanguage, ['en', 'fr', 'mk']);
  const ngo = jsonld((await app.get('/index.html?lang=fr')).body).find((x) => x['@type'] === 'NGO');
  assert.match(ngo.description, /Association fictive/);
});

test('contact API: validation, storage, honeypot, same-origin and size limits', async () => {
  const good = { form: 'contact-form', name: 'Test Person', email: 'test@example.org', topic: 'Press', message: 'Hello, this is a test message.', lang: 'fr' };
  const ok = await app.post('/api/contact', good);
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(JSON.parse(ok.body), { ok: true });
  const lines = fs.readFileSync(path.join(app.dataDir, 'messages.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].email, 'test@example.org');
  assert.strictEqual(lines[0].lang, 'fr');

  assert.strictEqual((await app.post('/api/contact', Object.assign({}, good, { email: 'nope' }))).status, 400);
  assert.strictEqual((await app.post('/api/contact', Object.assign({}, good, { message: 'short' }))).status, 400);
  assert.strictEqual((await app.post('/api/contact', '{not json')).status, 400);
  assert.strictEqual((await app.post('/api/contact', '[]')).status, 400);
  assert.strictEqual((await app.request('POST', '/api/contact', { headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
  assert.strictEqual((await app.post('/api/contact', good, { Origin: 'https://evil.example' })).status, 403);
  assert.strictEqual((await app.get('/api/contact')).status, 405);

  const before = fs.readFileSync(path.join(app.dataDir, 'messages.jsonl'), 'utf8');
  const bot = await app.post('/api/contact', Object.assign({}, good, { website: 'http://spam.example' }));
  assert.strictEqual(bot.status, 200); // the bot is told it worked...
  assert.strictEqual(fs.readFileSync(path.join(app.dataDir, 'messages.jsonl'), 'utf8'), before); // ...but nothing is stored
});

test('contact API: oversized bodies are refused and repeated use is rate-limited', async () => {
  const fresh = await require('./helpers').startServer({});
  try {
    const big = await fresh.post('/api/contact', { form: 'contact', name: 'x', email: 'a@b.cd', message: 'y'.repeat(30000) });
    assert.strictEqual(big.status, 413, 'a too-large body gets a proper answer, not a reset connection');
  } finally { await fresh.close(); }
  let limited = false;
  for (let i = 0; i < 10 && !limited; i++) {
    const r = await app.post('/api/contact', { form: 'newsletter-form', email: 'rate@example.org' });
    limited = r.status === 429;
  }
  assert.ok(limited, 'rate limit never triggered');
});

/* ---------- hardening added after the review ---------- */
const { startServer: start } = require('./helpers');

test('trailing slashes redirect to the canonical address instead of serving an unstyled page', async () => {
  const r = await app.get('/about/');
  assert.strictEqual(r.status, 301);
  assert.strictEqual(r.headers.location, '/about');
  const q = await app.get('/events.html/?lang=fr');
  assert.strictEqual(q.status, 301);
  assert.strictEqual(q.headers.location, '/events.html?lang=fr');
  assert.strictEqual((await app.get('/')).status, 200);
});

test('rate limit cannot be dodged by forging X-Forwarded-For', async () => {
  const proxied = await start({ proxyHops: 1, rateLimit: { max: 3, windowMs: 60000 } });
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await proxied.post('/api/contact', { form: 'newsletter-form', email: 'a@b.cd' }, { 'X-Forwarded-For': '10.9.8.' + i + ', 203.0.113.7' })).status);
    assert.deepStrictEqual(codes.slice(0, 3), [200, 200, 200]);
    assert.ok(codes.slice(3).every((c) => c === 429), codes.join(','));
    // a different client behind the same proxy is not affected
    assert.strictEqual((await proxied.post('/api/contact', { form: 'newsletter-form', email: 'a@b.cd' }, { 'X-Forwarded-For': '198.51.100.9' })).status, 200);
  } finally { await proxied.close(); }
});

test('forwarded headers are believed only behind a configured proxy', async () => {
  const direct = await start({});
  const proxied = await start({ proxyHops: 1 });
  try {
    const h = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'www.example.org' };
    const a = await direct.get('/', h);
    assert.ok(!a.headers['strict-transport-security']);
    assert.ok(a.body.includes('rel="canonical" href="http://127.0.0.1:'));
    const b = await proxied.get('/', h);
    assert.ok(b.headers['strict-transport-security']);
    assert.ok(b.body.includes('rel="canonical" href="https://www.example.org/"'));
  } finally { await direct.close(); await proxied.close(); }
});

test('PUBLIC_ORIGIN fixes the public address and the same-origin check', async () => {
  const fixed = await start({ publicOrigin: 'https://vv.example.org' });
  try {
    const home = await fixed.get('/', { Host: 'internal-name:3000' });
    assert.ok(home.body.includes('rel="canonical" href="https://vv.example.org/"'));
    assert.ok(home.headers['strict-transport-security']);
    const good = { form: 'newsletter-form', email: 'a@b.cd' };
    assert.strictEqual((await fixed.post('/api/contact', good, { Origin: 'https://vv.example.org', Host: 'internal-name:3000' })).status, 200);
    assert.strictEqual((await fixed.post('/api/contact', good, { Origin: 'https://evil.example' })).status, 403);
  } finally { await fixed.close(); }
});

test('contact API: nothing is silently cut off, odd values are refused, data file is owner-only', async () => {
  const api = await start({ now: () => Date.parse('2026-10-01T00:00:00Z') }); // before every listed event, whatever today's date
  try {
    const base = { form: 'contact-form', name: 'Test Person', email: 'test@example.org', topic: 'Press', message: 'Hello, this is a test message.' };
    const tooLong = await api.post('/api/contact', Object.assign({}, base, { message: 'x'.repeat(5001) }));
    assert.strictEqual(tooLong.status, 400);
    assert.strictEqual(JSON.parse(tooLong.body).field, 'message');
    assert.strictEqual((await api.post('/api/contact', Object.assign({}, base, { name: { a: 1 } }))).status, 400);
    assert.strictEqual((await api.post('/api/contact', Object.assign({}, base, { form: '../../x<script>' }))).status, 400);
    assert.strictEqual((await api.post('/api/contact', Object.assign({}, base, { form: 'rsvp-form', event: 'no-such-event', guests: '2' }))).status, 400);
    assert.strictEqual((await api.post('/api/contact', Object.assign({}, base, { form: 'rsvp-form', event: 'autumn-orangerie', guests: 'abc' }))).status, 400);
    const ok = await api.post('/api/contact', Object.assign({}, base, { form: 'rsvp-form', event: 'autumn-orangerie', guests: '2' }));
    assert.strictEqual(ok.status, 200);
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(api.dataDir, 'messages.jsonl')).mode & 0o077, 0, 'messages.jsonl must not be group/world readable');
  } finally { await api.close(); }
});

test('retention: expired messages are removed, current ones and unreadable lines are kept', async () => {
  const { createServer } = require('../server');
  const os = require('os');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-retention-'));
  const now = Date.parse('2027-06-01T12:00:00Z');
  const day = 86400000;
  const iso = (t) => new Date(t).toISOString();
  const lines = [
    { receivedAt: iso(now - 400 * day), form: 'contact-form', email: 'old@x.org' },                                    // > 12 months -> removed
    { receivedAt: iso(now - 10 * day), form: 'contact-form', email: 'new@x.org' },                                     // kept
    { receivedAt: iso(now - 200 * day), form: 'rsvp-form', event: 'autumn-orangerie', email: 'past@x.org' },           // event was Oct 2026 -> > 30 days after -> removed
    { receivedAt: iso(now - 400 * day), form: 'newsletter-form', email: 'news@x.org' }                                 // until withdrawn -> kept
  ].map((m) => JSON.stringify(m));
  lines.push('not json at all');
  fs.writeFileSync(path.join(dataDir, 'messages.jsonl'), lines.join('\n') + '\n');
  const server = createServer({ dataDir, log: false });
  const removed = server.purgeMessages(now);
  assert.strictEqual(removed, 2);
  const left = fs.readFileSync(path.join(dataDir, 'messages.jsonl'), 'utf8');
  assert.ok(left.includes('new@x.org') && left.includes('news@x.org') && left.includes('not json at all'));
  assert.ok(!left.includes('old@x.org') && !left.includes('past@x.org'));
});

test('compression honours q-values and styles are cacheable', async () => {
  const noBrotli = await app.get('/i18n/common.js', { 'Accept-Encoding': 'br;q=0, gzip' });
  assert.strictEqual(noBrotli.headers['content-encoding'], 'gzip');
  const css = await app.get('/styles.css');
  assert.match(css.headers['cache-control'], /max-age=300/);
  const page = await app.get('/about.html');
  assert.strictEqual(page.headers['cache-control'], 'no-cache');
});

/* ---------- second review (10 October 2026) ---------- */

test('reservations: bookings close when an event starts; unknown and unbookable ids are refused', async () => {
  // 16 October 2026: "Autumn in the Orangerie" (15 Oct) is over, "The Queen's Hamlet at Dawn" (22 Oct) is still ahead
  const api = await start({ now: () => Date.parse('2026-10-16T08:00:00Z') });
  try {
    const rsvp = (event, extra) => api.post('/api/contact', Object.assign({ form: 'rsvp-form', name: 'A Visitor', email: 'a@example.org', event, guests: '2' }, extra));
    const past = await rsvp('autumn-orangerie');
    assert.strictEqual(past.status, 400);
    assert.deepStrictEqual(JSON.parse(past.body), { ok: false, error: 'Bookings for this event have closed', code: 'event_past', field: 'event' });
    assert.strictEqual((await rsvp('hamlet-at-dawn')).status, 200);
    // listed on the page but not offered in the form (talk without booking, invitation-only dinner)
    assert.strictEqual(JSON.parse((await rsvp('fountains-engineering')).body).code, 'event');
    assert.strictEqual(JSON.parse((await rsvp('patrons-winter-dinner')).body).code, 'event');
    // names of built-in object properties are just unknown ids
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const r = await rsvp(id);
      assert.strictEqual(r.status, 400, id);
      assert.strictEqual(JSON.parse(r.body).code, 'event', id);
    }
    // the number of guests has the same limits as the form (1 to 6)
    const seven = JSON.parse((await rsvp('hamlet-at-dawn', { guests: '7' })).body);
    assert.deepStrictEqual([seven.code, seven.field, seven.min, seven.max], ['range', 'guests', 1, 6]);
    assert.strictEqual((await rsvp('hamlet-at-dawn', { guests: '6' })).status, 200);
    assert.strictEqual(JSON.parse((await rsvp('hamlet-at-dawn', { guests: '0' })).body).code, 'range');
  } finally { await api.close(); }
});

test('contact API: every refusal names a code and the field, so the page can show the right message', async () => {
  const api = await start({});
  try {
    const base = { form: 'contact-form', name: 'Test Person', email: 'test@example.org', topic: 'Press', message: 'Hello, this is a test message.' };
    const body = async (extra) => JSON.parse((await api.post('/api/contact', Object.assign({}, base, extra))).body);
    for (const email of ['ana@gmail', 'a@localhost', 'no-at-sign.org', 'a b@c.de']) assert.deepStrictEqual([(await body({ email })).code, (await body({ email })).field], ['email', 'email'], email);
    assert.deepStrictEqual(await body({ name: 'x'.repeat(201) }), { ok: false, error: 'name is too long (maximum 200 characters)', code: 'too_long', field: 'name', max: 200 });
    assert.deepStrictEqual(await body({ name: '   ' }), { ok: false, error: 'Name is required', code: 'required', field: 'name' });
    assert.deepStrictEqual(await body({ message: 'too short' }), { ok: false, error: 'Message is too short', code: 'minlength', field: 'message', min: 10 });
    assert.strictEqual((await body({ form: 'other' })).code, 'form');
    assert.strictEqual(JSON.parse((await api.post('/api/contact', '{oops')).body).code, 'json');
  } finally { await api.close(); }
});

test('same-origin check works behind a proxy that rewrites Host, without opening the form to other sites', async () => {
  const api = await start({});
  try {
    const good = { form: 'newsletter-form', email: 'a@example.org' };
    // nginx's default: Host becomes the upstream address, the browser's Origin is the public one
    const proxied = { Origin: 'https://vv.example.org', Host: '127.0.0.1:3000' };
    assert.strictEqual((await api.post('/api/contact', good, Object.assign({ 'Sec-Fetch-Site': 'same-origin' }, proxied))).status, 200);
    assert.strictEqual((await api.post('/api/contact', good, Object.assign({ 'Sec-Fetch-Site': 'cross-site' }, proxied))).status, 403);
    assert.strictEqual((await api.post('/api/contact', good, proxied)).status, 403);
  } finally { await api.close(); }
  // with PUBLIC_ORIGIN the comparison is exact, whatever the browser says
  const fixed = await start({ publicOrigin: 'https://vv.example.org' });
  try {
    const r = await fixed.post('/api/contact', { form: 'newsletter-form', email: 'a@example.org' }, { Origin: 'https://other.example', 'Sec-Fetch-Site': 'same-origin' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(JSON.parse(r.body).code, 'origin');
  } finally { await fixed.close(); }
});

test('sub-path deployments: the bare base path redirects to the folder, so styles and scripts load', async () => {
  const sub = await start({ basePath: '/vivant' });
  try {
    const bare = await sub.get('/vivant');
    assert.strictEqual(bare.status, 301);
    assert.strictEqual(bare.headers.location, '/vivant/');
    assert.strictEqual((await sub.get('/vivant?lang=fr')).headers.location, '/vivant/?lang=fr');
    const home = await sub.get('/vivant/');
    assert.strictEqual(home.status, 200);
    assert.ok(home.body.includes('href="styles.css"'));
    assert.strictEqual((await sub.get('/vivant/about.html')).status, 200);
  } finally { await sub.close(); }
});

test('double slashes are folded into one instead of failing', async () => {
  for (const [from, to] of [['//', '/'], ['//about.html', '/about.html'], ['///events.html?lang=fr', '/events.html?lang=fr'], ['//evil.example/x', '/evil.example/x']]) {
    const r = await app.get(from);
    assert.strictEqual(r.status, 301, from);
    assert.strictEqual(r.headers.location, to, from);
  }
});

test('/health reports a data folder that cannot be written', async () => {
  const ok = await start({});
  try { assert.strictEqual((await ok.get('/health')).status, 200); } finally { await ok.close(); }
  const os = require('os');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vv-health-')), 'not-a-folder');
  fs.writeFileSync(file, '');
  const broken = await start({ dataDir: path.join(file, 'data') }); // a folder inside a file can never be created
  try {
    const r = await broken.get('/health');
    assert.strictEqual(r.status, 503);
    assert.strictEqual(JSON.parse((await broken.post('/api/contact', { form: 'newsletter-form', email: 'a@example.org' })).body).code, 'save');
  } finally { await broken.close(); }
});

test('caching: If-None-Match lists and *, Vary on 304, encoding preferences', async () => {
  const css = await app.get('/styles.css', { 'Accept-Encoding': 'gzip' });
  const tag = css.headers.etag;
  for (const header of ['"other", ' + tag, '*', tag.replace(/^W\//, '')]) {
    const r = await app.get('/styles.css', { 'If-None-Match': header, 'Accept-Encoding': 'gzip' });
    assert.strictEqual(r.status, 304, header);
    assert.strictEqual(r.headers.vary, 'Accept-Encoding');
  }
  assert.strictEqual((await app.get('/i18n/common.js', { 'Accept-Encoding': 'gzip;q=1, br;q=0.5' })).headers['content-encoding'], 'gzip');
  assert.strictEqual((await app.get('/i18n/common.js', { 'Accept-Encoding': 'gzip, br' })).headers['content-encoding'], 'br');
  assert.strictEqual((await app.get('/i18n/common.js', { 'Accept-Encoding': 'identity' })).headers['content-encoding'], undefined);
});

test('a record cut off half-way in the data file does not swallow the next one', async () => {
  const api = await start({});
  try {
    fs.writeFileSync(path.join(api.dataDir, 'messages.jsonl'), '{"form":"contact-form","email":"cut@off', { mode: 0o600 });
    assert.strictEqual((await api.post('/api/contact', { form: 'newsletter-form', email: 'next@example.org' })).status, 200);
    const lines = fs.readFileSync(path.join(api.dataDir, 'messages.jsonl'), 'utf8').split('\n');
    assert.strictEqual(JSON.parse(lines[1]).email, 'next@example.org');
  } finally { await api.close(); }
});

test('Macedonian numbers are written the Macedonian way, French the French way', async () => {
  const mk = (await app.get('/analytics.html?lang=mk')).body;
  assert.ok(mk.includes('>75.400 €<'), 'euro amounts: 75.400 €');
  assert.ok(mk.includes('>1.430<'), 'thousands: 1.430');
  assert.ok(mk.includes('>52%<'));
  assert.ok(!/>\d{1,3},\d{3}</.test(mk), 'no English-style thousands');
  const fr = (await app.get('/analytics.html?lang=fr')).body;
  assert.ok(fr.includes('>75 400 €<'));
  assert.ok(fr.includes('>52 %<'));
  const en = (await app.get('/analytics.html')).body;
  assert.ok(en.includes('>€75,400<') && en.includes('>1,430<'));
});

test('translated pages are rendered once and then reused', async () => {
  const a = await app.get('/journal.html?lang=mk');
  const b = await app.get('/journal.html?lang=mk');
  assert.strictEqual(a.body, b.body);
  assert.strictEqual(a.headers.etag, b.headers.etag);
});

/* ---------- third review (16 October 2026) ---------- */

test('translations are served per page from i18n/, and nothing else from that folder or the font folder', async () => {
  const about = await app.get('/i18n/about.js');
  assert.strictEqual(about.status, 200);
  assert.match(about.headers['content-type'], /text\/javascript/);
  assert.match(about.body, /window\.i18n\.pages\['about'\]/);
  for (const p of ['/i18n', '/i18n/../server.js', '/i18n/x.json', '/fonts/LICENSE-inter.txt', '/fonts/fonts.css', '/i18n.js']) {
    assert.strictEqual((await app.get(p)).status, 404, p);
  }
  // a translated page is rendered again when one of the translation files changes
  const first = await app.get('/about.html?lang=fr');
  const file = path.join(__dirname, '..', 'i18n', 'about.js');
  const t = fs.statSync(file).mtime;
  fs.utimesSync(file, t, new Date(t.getTime() + 1000));
  try {
    const second = await app.get('/about.html?lang=fr');
    assert.notStrictEqual(first.headers.etag, second.headers.etag);
  } finally { fs.utimesSync(file, t, t); }
});

test('a one-time donation needs an amount: a preset one, or another whole number of euros', async () => {
  const app = await startServer({ rateLimit: { max: 50, windowMs: 60000 } }); // its own server: the shared one is rate-limited
  try {
  const base = { form: 'join-form', email: 'giver@example.org', topic: 'One-time donation' };
  let r = await app.post('/api/contact', base);
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(JSON.parse(r.body).field, 'amount');
  assert.strictEqual(JSON.parse(r.body).code, 'required');
  r = await app.post('/api/contact', Object.assign({ amount: 'other', amount_other: '0' }, base));
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual([JSON.parse(r.body).field, JSON.parse(r.body).code, JSON.parse(r.body).max], ['amount_other', 'range', 10000]);
  r = await app.post('/api/contact', Object.assign({ amount: '13' }, base));
  assert.strictEqual(r.status, 400, 'only the preset amounts are accepted as presets');
  r = await app.post('/api/contact', Object.assign({ amount: '25' }, base));
  assert.strictEqual(r.status, 200);
  r = await app.post('/api/contact', Object.assign({ amount: 'other', amount_other: '75' }, base));
  assert.strictEqual(r.status, 200);
  // a membership enquiry needs no amount, and a stray one is not stored
  r = await app.post('/api/contact', { form: 'join-form', email: 'member@example.org', topic: 'Family membership', amount: '50' });
  assert.strictEqual(r.status, 200);
  const lines = fs.readFileSync(path.join(app.dataDir, 'messages.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const gifts = lines.filter((m) => m.form === 'join-form');
  assert.deepStrictEqual(gifts.slice(-3).map((m) => m.amount), ['25', '75', '']);
  } finally { await app.close(); }
});

test('the 404 page tells the browser where links inside translated texts start', async () => {
  const r = await app.get('/some/deep/missing/page');
  assert.strictEqual(r.status, 404);
  assert.match(r.body, /<html lang="en" data-link-base="\/">/);
});
