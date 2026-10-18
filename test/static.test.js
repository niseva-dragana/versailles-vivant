'use strict';
// The static build (scripts/build-static.js) for hosts without Node.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, pages, startServer } = require('./helpers');
const { build } = require('../scripts/build-static');
const documents = require('../server/documents');
// every .html file of a build, including the translated copies in fr/ and mk/
const builtPages = (out) => [].concat(...['', 'fr', 'mk'].map((d) => fs.readdirSync(path.join(out, d)).filter((f) => f.endsWith('.html')).map((f) => (d ? d + '/' : '') + f)));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vv-static-'));
const ORIGIN = 'https://vv.example.org';

test('static build stamps the address into every page, feed and sitemap', () => {
  const out = tmp();
  const r = build({ origin: ORIGIN, out });
  assert.strictEqual(r.pages, pages().length);
  for (const f of pages()) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    assert.ok(!html.includes('{{ORIGIN}}'), f + ' still has a placeholder');
    if (f !== '404.html') assert.match(html, new RegExp('<link rel="canonical" href="' + ORIGIN.replace(/\./g, '\\.') + '/'), f + ' canonical');
    // JSON-LD must still parse after stamping
    for (const m of html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  }
  for (const f of ['feed.xml', 'sitemap.xml', 'robots.txt']) assert.ok(fs.readFileSync(path.join(out, f), 'utf8').includes(ORIGIN), f);
  assert.match(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/vv\.example\.org\/sitemap\.xml/);
  assert.match(fs.readFileSync(path.join(out, '_headers'), 'utf8'), /Content-Security-Policy: default-src 'self'/);
});

test('static build is self-contained: every local file a page references exists, in every language folder', () => {
  const out = tmp();
  build({ origin: ORIGIN, out });
  const missing = [];
  const files = builtPages(out);
  assert.strictEqual(files.length, pages().length + 2 * (pages().length - 1)); // 404.html exists once
  for (const f of files) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    for (const m of html.matchAll(/\b(?:href|src)="([^"#?]+)/g)) {
      const u = m[1];
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u)) continue;
      const target = u.startsWith('/') ? path.join(out, u) : path.join(out, path.dirname(f), u);
      if (!fs.existsSync(target)) missing.push(f + ' -> ' + u);
    }
  }
  assert.deepStrictEqual([...new Set(missing)], []);
  for (const f of ['favicon.ico', 'apple-touch-icon.png', '.htaccess']) assert.ok(fs.existsSync(path.join(out, f)), f);
});

test('static build: French and Macedonian are real pre-rendered pages that link to each other', () => {
  const out = tmp();
  build({ origin: ORIGIN, out });
  const fr = fs.readFileSync(path.join(out, 'fr/about.html'), 'utf8');
  const mk = fs.readFileSync(path.join(out, 'mk/events.html'), 'utf8');
  const en = fs.readFileSync(path.join(out, 'about.html'), 'utf8');
  assert.match(fr, /<html lang="fr" data-prerendered>/);
  assert.match(mk, /<html lang="mk" data-prerendered>/);
  assert.match(/<title[^>]*>([^<]*)</.exec(mk)[1], /[Ѐ-ӿ]/);
  // addresses: canonical and alternates point to the folders, English is the plain address
  assert.ok(fr.includes('<link rel="canonical" href="https://vv.example.org/fr/about.html">'));
  for (const page of [fr, en]) {
    assert.ok(page.includes('<link rel="alternate" hreflang="en" href="https://vv.example.org/about.html">'));
    assert.ok(page.includes('<link rel="alternate" hreflang="fr" href="https://vv.example.org/fr/about.html">'));
    assert.ok(page.includes('<link rel="alternate" hreflang="mk" href="https://vv.example.org/mk/about.html">'));
    assert.ok(!page.includes('?lang='), 'no ?lang= addresses on a static host');
  }
  // shared files one folder up, pages in the same folder, language links to the other folders
  assert.ok(fr.includes('href="../styles.css"') && fr.includes('src="../script.js"'));
  assert.ok(fr.includes('href="contact.html"'));
  assert.ok(fr.includes('href="../about.html" hreflang="en" data-lang="en"'));
  assert.ok(fr.includes('href="about.html" hreflang="fr" data-lang="fr"'));
  assert.ok(fr.includes('href="../mk/about.html" hreflang="mk" data-lang="mk"'));
  assert.ok(en.includes('href="fr/about.html" hreflang="fr" data-lang="fr"'));
  assert.ok(/<a href="about\.html" hreflang="fr" data-lang="fr"[^>]*aria-current="true"/.test(fr), 'French is marked as the current language');
  // structured data in the page language, with links to the pages in that language
  const events = JSON.parse(/<script type="application\/ld\+json">\s*(\[[\s\S]*?\])\s*<\/script>/.exec(mk)[1]);
  assert.ok(events.every((e) => e.inLanguage === 'mk' && /^https:\/\/vv\.example\.org\/mk\/events\.html#/.test(e.url) && /[Ѐ-ӿ]/.test(e.name)));
  // no form service on a static host: the forms hand over to e-mail
  for (const f of builtPages(out)) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    assert.ok(!/data-endpoint="[^"]/.test(html), f + ' still posts to a form service');
  }
  assert.match(fs.readFileSync(path.join(out, '.htaccess'), 'utf8'), /ErrorDocument 404 \/404\.html[\s\S]*Header always set Content-Security-Policy/);
});

test('static build under a sub-path: canonical URLs and the 404 page links use the base', () => {
  const out = tmp();
  build({ origin: ORIGIN, base: '/vivant/', out });
  assert.match(fs.readFileSync(path.join(out, 'about.html'), 'utf8'), /rel="canonical" href="https:\/\/vv\.example\.org\/vivant\/about\.html"/);
  const nf = fs.readFileSync(path.join(out, '404.html'), 'utf8');
  assert.match(nf, /href="\/vivant\/styles\.css"/);
  assert.match(nf, /href="\/vivant\/index\.html"/);
  assert.ok(!/(href|src)="(?!https?:|\/|#|mailto:|tel:|data:)[^"]/.test(nf), 'relative link left in 404.html');
});

test('static sitemap lists the language folders; robots.txt is identical to the server\'s', async () => {
  const out = tmp();
  build({ origin: ORIGIN, out });
  const sm = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  assert.strictEqual(sm, documents.sitemap(ROOT, ORIGIN, 'folder'));
  assert.ok(sm.includes('<loc>https://vv.example.org/fr/about.html</loc>') && sm.includes('<loc>https://vv.example.org/mk/</loc>'));
  assert.ok(!sm.includes('?lang='));
  const app = await startServer({ publicOrigin: ORIGIN });
  try {
    const robots = await app.get('/robots.txt');
    assert.strictEqual(robots.body, fs.readFileSync(path.join(out, 'robots.txt'), 'utf8'));
  } finally { await app.close(); }
});

test('static build refuses unsafe or incomplete arguments', () => {
  assert.throws(() => build({ origin: '', out: tmp() }), /--origin/);
  assert.throws(() => build({ origin: 'ftp://x.org', out: tmp() }), /--origin/);
  assert.throws(() => build({ origin: 'https://x.org/path', out: tmp() }), /--origin/);
  assert.throws(() => build({ origin: ORIGIN, base: 'no-slash', out: tmp() }), /--base/);
  assert.throws(() => build({ origin: ORIGIN, out: ROOT }), /separate folder/);
  assert.throws(() => build({ origin: ORIGIN, out: path.join(ROOT, 'images') }), /inside the project/);
  const notEmpty = tmp();
  fs.writeFileSync(path.join(notEmpty, 'precious.txt'), 'keep me');
  assert.throws(() => build({ origin: ORIGIN, out: notEmpty }), /not empty/);
  assert.ok(fs.existsSync(path.join(notEmpty, 'precious.txt')));
  const again = tmp();
  build({ origin: ORIGIN, out: again });
  build({ origin: ORIGIN, out: again }); // rebuilding over an earlier build is fine
});

test('localize-images: photos become local files, and the policy and privacy text follow', async () => {
  const { run } = require('../scripts/localize-images');
  // work on a copy of the site, never on the project itself
  const copy = tmp();
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'qa', 'dist', 'data', 'test', 'docs'].includes(e.name)) continue;
    fs.cpSync(path.join(ROOT, e.name), path.join(copy, e.name), { recursive: true });
  }
  // the site's own photos are already in images/; give the copy a new external photo, as when one is added later
  const page = path.join(copy, 'journal.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('</main>', '<img src="https://images.unsplash.com/photo-test-123?w=800&amp;q=75" alt="Test photo"></main>'));
  const docs = path.join(copy, 'server', 'documents.js');
  fs.writeFileSync(docs, fs.readFileSync(docs, 'utf8').replace('"img-src \'self\' data:"', '"img-src \'self\' data: https://images.unsplash.com"'));
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg });
  const r = await run({ root: copy, fetchImpl, log: () => {} });
  assert.strictEqual(r.downloaded, 1, 'the new photo is downloaded');
  for (const f of fs.readdirSync(copy).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(copy, f), 'utf8');
    assert.ok(!/images\.unsplash\.com|staticflickr\.com/.test(html.replace(/<a [^>]*>/g, '')), f + ' still loads an external photo');
    for (const m of html.matchAll(/(?:src="|url\(')(images\/[^"')]+)/g)) assert.ok(fs.existsSync(path.join(copy, m[1])), f + ': ' + m[1]);
  }
  assert.match(fs.readFileSync(path.join(copy, 'server', 'documents.js'), 'utf8'), /"img-src 'self' data:"/);
  const i18nText = fs.readFileSync(path.join(copy, 'i18n', 'privacy.js'), 'utf8');
  assert.ok(!/currently loaded from the photo libraries|actuellement chargées|моментално се вчитуваат/.test(i18nText), 'privacy text updated in all three languages');
  assert.ok(i18nText.includes('are hosted on this site'));
});

test('static build: url() in a translated copy points one folder up, and full addresses are left alone', () => {
  const { layoutPage } = require('../scripts/build-static');
  const html = '<html lang="fr"><body><div style="--a:url(\'https://x.example/a.jpg\')"></div><div style="--b:url(&quot;images/b.jpg&quot;)"></div>' +
    '<div style="--c:url(images/c.jpg)"></div><div style="--d:url(data:image/png;base64,AAAA)"></div><div style="--e:url(\'/abs.jpg\')"></div></body></html>';
  const out = layoutPage(html, 'index.html', 'fr');
  assert.ok(out.includes("url('https://x.example/a.jpg')"), 'an absolute address is unchanged');
  assert.ok(!out.includes("../'"), 'no quote after ../');
  assert.ok(out.includes('url(../images/c.jpg)'), out);
  assert.ok(out.includes('url(data:image/png;base64,AAAA)') && out.includes("url('/abs.jpg')"));
  // the home pages of the build carry no broken photo address
  const outDir = tmp();
  build({ origin: ORIGIN, out: outDir });
  for (const f of ['index.html', 'fr/index.html', 'mk/index.html']) assert.ok(!/url\(\.\.\/['"]/.test(fs.readFileSync(path.join(outDir, f), 'utf8')), f);
  assert.match(fs.readFileSync(path.join(outDir, 'about.html'), 'utf8'), /<html lang="en" data-static>/, 'English pages are marked for the language redirect');
});
