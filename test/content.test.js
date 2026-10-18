'use strict';
// Static checks on the source files: translations, links, structure, accessibility basics, CSP-friendliness.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, pages, read, loadI18n, dictionaryFor } = require('./helpers');

const i18n = loadI18n(ROOT);
const LANGS = ['en', 'fr', 'mk'];
const pageName = (html) => (/<body[^>]*data-page="([^"]+)"/.exec(html) || [])[1];

test('all pages exist', () => {
  const expected = ['404', 'about', 'accessibility', 'analytics', 'contact', 'events', 'explore', 'faq', 'index', 'involved', 'journal', 'privacy', 'tour'];
  assert.deepStrictEqual(pages().map((f) => f.replace('.html', '')), expected);
});

test('shared regions are up to date (npm run build --check)', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-pages.js'), '--check'], { stdio: 'pipe' });
});

test('every data-i18n key used in a page exists in English, French and Macedonian', () => {
  const problems = [];
  for (const f of pages()) {
    const html = read(f);
    const page = pageName(html);
    const keys = new Set([...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]));
    for (const lang of LANGS) {
      const dict = dictionaryFor(i18n, page, lang);
      for (const k of keys) if (dict[k] === undefined || dict[k] === '') problems.push(`${f} [${lang}] missing "${k}"`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('French and Macedonian dictionaries have exactly the keys of the English one', () => {
  const problems = [];
  for (const [scope, value] of [['common', i18n.common], ...Object.entries(i18n.pages)]) {
    const en = Object.keys(value.en).sort();
    for (const lang of ['fr', 'mk']) {
      const other = Object.keys(value[lang] || {}).sort();
      if (en.join() !== other.join()) problems.push(`${scope}/${lang} differs from en`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('Macedonian text has no words that mix Latin and Cyrillic letters', () => {
  const bad = [];
  for (const [scope, value] of [['common', i18n.common], ...Object.entries(i18n.pages)]) {
    for (const [k, v] of Object.entries(value.mk)) {
      const text = v.replace(/<[^>]+>/g, ' ');
      for (const w of text.match(/[\p{L}̀-ͯ]+/gu) || []) {
        if (/\p{Script=Latin}/u.test(w) && /\p{Script=Cyrillic}/u.test(w)) bad.push(`${scope}.${k}: ${w}`);
      }
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('translated strings keep the same placeholders and links as English', () => {
  const problems = [];
  const sig = (s) => (s.match(/\{n\}|<a href="[^"]+"/g) || []).join('|');
  for (const [scope, value] of [['common', i18n.common], ...Object.entries(i18n.pages)]) {
    for (const k of Object.keys(value.en)) for (const lang of ['fr', 'mk']) {
      if (value[lang][k] !== undefined && sig(value.en[k]) !== sig(value[lang][k])) problems.push(`${scope}.${k} [${lang}]`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('internal links and #fragments resolve', () => {
  const problems = [];
  const idsOf = {};
  for (const f of pages()) idsOf[f] = new Set([...read(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const f of pages()) {
    for (const m of read(f).matchAll(/\shref="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|tel:|\{\{)/.test(href)) continue;
      const [fileAndQuery, frag] = href.split('#');
      const file = fileAndQuery.split('?')[0]; // "?lang=fr" (the language links) is the page itself
      const target = file === '' ? f : file;
      if (!fs.existsSync(path.join(ROOT, target))) { problems.push(`${f}: ${href} -> missing file`); continue; }
      if (frag && target.endsWith('.html') && !idsOf[target].has(frag)) problems.push(`${f}: ${href} -> missing id`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('each page has lang, title, description, one h1, a main landmark and a skip link', () => {
  const problems = [];
  for (const f of pages()) {
    const html = read(f);
    if (!/<html lang="en"/.test(html)) problems.push(`${f}: html lang`);
    if (!/<title[^>]*>[^<]{5,}<\/title>/.test(html)) problems.push(`${f}: title`);
    if (!/<meta name="description" [^>]*content="[^"]{40,}"/.test(html)) problems.push(`${f}: description`);
    const h1 = (html.match(/<h1[\s>]/g) || []).length;
    if (h1 !== 1) problems.push(`${f}: ${h1} h1`);
    if (!/<main id="main"/.test(html)) problems.push(`${f}: main`);
    if (!/class="skip-link" href="#main"/.test(html)) problems.push(`${f}: skip link`);
    if (!/<nav[^>]*aria-label/.test(html)) problems.push(`${f}: nav label`);
  }
  assert.deepStrictEqual(problems, []);
});

test('images have alt text; form controls have labels', () => {
  const problems = [];
  for (const f of pages()) {
    const html = read(f);
    for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) problems.push(`${f}: img without alt ${m[0].slice(0, 60)}`);
    for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      const attrs = m[2];
      if (/type="(hidden|submit|button)"/.test(attrs)) continue;
      const id = (/\sid="([^"]+)"/.exec(attrs) || [])[1];
      const labelled = /aria-label=/.test(attrs) || (id && html.includes(`for="${id}"`)) || new RegExp(`<label[^>]*>(?:(?!</label>)[\\s\\S])*${m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(html);
      if (!labelled) problems.push(`${f}: unlabelled ${m[0].slice(0, 70)}`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('no inline scripts other than JSON-LD (the Content-Security-Policy forbids them)', () => {
  const problems = [];
  for (const f of [...pages(), 'partials/head.html', 'partials/scripts.html']) {
    const html = f.includes('/') ? read(f) : read(f);
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
      if (!/\ssrc="/.test(m[1]) && !/type="application\/ld\+json"/.test(m[1])) problems.push(`${f}: ${m[0]}`);
    }
    if (/\son[a-z]+="/i.test(html.replace(/data-[a-z-]+="[^"]*"/g, ''))) problems.push(`${f}: inline event handler`);
  }
  assert.deepStrictEqual(problems, []);
});

test('JSON-LD blocks are valid JSON', () => {
  for (const f of pages()) {
    for (const m of read(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => JSON.parse(m[1].replace(/\{\{ORIGIN\}\}/g, 'https://example.org')), f);
    }
  }
  assert.ok(/"@type": "FAQPage"/.test(read('faq.html')));
  assert.ok(/"@type": "NGO"/.test(read('index.html')));
  assert.ok((read('events.html').match(/"@type": "Event"/g) || []).length >= 4);
});

test('the site sets no cookies and uses no third-party scripts, fonts or styles', () => {
  const all = [...pages(), 'script.js', 'pages.js', 'charts.js'].map(read).join('\n');
  assert.ok(!/document\.cookie/.test(all), 'document.cookie is used');
  assert.ok(!/<script[^>]+src="https?:/.test(all), 'external script');
  assert.ok(!/<link[^>]+href="https?:\/\/(fonts\.googleapis|fonts\.gstatic|cdn)/.test(all), 'external stylesheet/font');
});

test('the Atom feed lists every journal post', () => {
  const feed = read('feed.xml');
  const posts = (read('journal.html').match(/<article class="[^"]*\bpost\b/g) || []).length;
  assert.ok(posts >= 5);
  assert.strictEqual((feed.match(/<entry>/g) || []).length, posts);
  assert.ok(feed.startsWith('<?xml'));
  assert.ok(feed.includes('xmlns="http://www.w3.org/2005/Atom"'));
});

test('the four required areas of the brief are present', () => {
  // basic info, team, services, contact form + info, news/blog, languages, cookies, detailed info
  assert.ok(/data-i18n="team1_h"/.test(read('about.html')), 'team');
  assert.ok(/id="contact-form"/.test(read('contact.html')), 'contact form');
  assert.ok(/href="tel:/.test(read('contact.html')) && /mailto:/.test(read('contact.html')), 'contact info');
  assert.ok(/id="post-list"/.test(read('journal.html')), 'news / blog');
  assert.ok(/data-lang="mk"/.test(read('partials/header.html')), 'language switch');
  assert.ok(/data-cookie-action="essential"/.test(read('partials/header.html')), 'cookie notice');
  assert.ok(/id="membership"/.test(read('involved.html')), 'services (membership)');
});

/* ---------- second review (10 October 2026) ---------- */
const jsonldOf = (html) => [].concat(...[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])));

test('structured data is generated from the visible page and matches it item for item', () => {
  const plain = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const en = (page) => dictionaryFor(i18n, page, 'en');
  // FAQ: every question on the page, in order, with its answer
  const faqHtml = read('faq.html');
  const questions = [...faqHtml.matchAll(/<summary data-i18n="(q\d+)">/g)].map((m) => m[1]);
  const faq = jsonldOf(faqHtml).find((x) => x['@type'] === 'FAQPage');
  assert.deepStrictEqual(faq.mainEntity.map((q) => q.name), questions.map((k) => plain(en('faq')[k])));
  assert.ok(faq.mainEntity.some((q) => /tax/i.test(q.name)), 'the tax-receipt question is included');
  // events: one Event per card, with the card's dates
  const evHtml = read('events.html');
  const cards = [...evHtml.matchAll(/<article class="[^"]*\bevent\b[^"]*" id="([^"]+)" data-type="[^"]+" data-start="([^"]+)" data-end="([^"]+)"/g)];
  const events = jsonldOf(evHtml).filter((x) => x['@type'] === 'Event');
  assert.strictEqual(events.length, cards.length);
  assert.ok(cards.length >= 13);
  cards.forEach((c, i) => {
    assert.strictEqual(events[i].url, '{{ORIGIN}}/events.html#' + c[1]);
    assert.strictEqual(events[i].startDate, c[2]);
    assert.strictEqual(events[i].endDate, c[3]);
  });
  // news: one BlogPosting per post; a photo only where the post has one
  const jHtml = read('journal.html');
  const posts = [...jHtml.matchAll(/<article class="[^"]*\bpost\b[^"]*" id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)];
  const blog = jsonldOf(jHtml).find((x) => x['@type'] === 'Blog');
  assert.strictEqual(blog.blogPost.length, posts.length);
  posts.forEach((p, i) => {
    assert.strictEqual(blog.blogPost[i].url, '{{ORIGIN}}/journal.html#' + p[1]);
    assert.strictEqual(Boolean(blog.blogPost[i].image), /<img\b/.test(p[2]), p[1]);
  });
});

test('the browser and the server use the same rules for e-mail addresses and the number of guests', () => {
  const server = read('server.js');
  const email = /const EMAIL = \/\^(.+)\$\/;/.exec(server)[1];
  for (const f of ['contact.html', 'events.html', 'involved.html', 'journal.html']) {
    for (const m of read(f).matchAll(/<input type="email"[^>]*>/g)) assert.ok(m[0].includes('pattern="' + email + '"'), f + ': ' + m[0]);
  }
  const guests = /const GUESTS = \{ min: (\d+), max: (\d+) \}/.exec(server);
  const input = /<input type="number" id="rsvp-guests"[^>]*>/.exec(read('events.html'))[0];
  assert.ok(input.includes('min="' + guests[1] + '"') && input.includes('max="' + guests[2] + '"'), input);
});

test('the reservation form offers bookable events in date order, each with a card on the page', () => {
  const html = read('events.html');
  const start = Object.fromEntries([...html.matchAll(/<article[^>]*\sid="([^"]+)"[^>]*\sdata-start="([^"]+)"/g)].map((m) => [m[1], Date.parse(m[2])]));
  const options = [.../<select id="rsvp-event"[^>]*>([\s\S]*?)<\/select>/.exec(html)[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(options.length >= 10);
  for (const id of options) assert.ok(start[id], id + ' has no event card');
  const times = options.map((id) => start[id]);
  assert.deepStrictEqual(times, times.slice().sort((a, b) => a - b));
  // every card offering a booking button is in the form, and the other way round
  const bookable = [...html.matchAll(/data-rsvp="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(bookable.slice().sort(), options.slice().sort());
});

test('the language switch is made of links a crawler can follow, with the current language marked', () => {
  for (const f of pages()) {
    const html = read(f);
    const links = [...html.matchAll(/<a href="\?lang=(en|fr|mk)" hreflang="\1" data-lang="\1"[^>]*>/g)];
    assert.strictEqual(links.length, 6, f + ': two switches (top bar and menu) of three links');
    assert.deepStrictEqual(links.filter((m) => /aria-current="true"/.test(m[0])).map((m) => m[1]), ['en', 'en'], f);
    assert.ok(!/<button[^>]*data-lang=/.test(html), f + ': no language buttons left');
    // hreflang: English is the plain address
    if (f !== '404.html') assert.ok(/<link rel="alternate" hreflang="en" href="\{\{ORIGIN\}\}\/[a-z0-9-]*(\.html)?">/.test(html), f);
  }
});

test('the brief\'s own words appear on the pages: services, news, blog', () => {
  const en = (page, key) => dictionaryFor(i18n, page, 'en')[key];
  assert.match(en('index', 'svc_eyebrow'), /services/i);
  assert.match(en('journal', 'page_eyebrow'), /news/i);
  assert.match(en('journal', 'page_eyebrow'), /blog/i);
  assert.strictEqual(dictionaryFor(i18n, 'index', 'en').nav_journal, 'News');
  assert.ok(/id="services"/.test(read('index.html')));
});

test('favicons for every browser exist and are linked', () => {
  const head = read('partials/head.html');
  for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(head.includes('href="' + f + '"'), f + ' linked');
  }
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'favicon.ico')).readUInt16LE(2), 1, 'favicon.ico is an icon file');
});

test('the invented figures add up and agree across pages and languages', () => {
  const html = read('analytics.html');
  for (const t of html.matchAll(/<table class="data-table"[^>]*>([\s\S]*?)<\/table>/g)) {
    const foot = /<tfoot>([\s\S]*?)<\/tfoot>/.exec(t[1]);
    if (!foot) continue;
    const cells = (row) => [...row.matchAll(/<td[^>]*data-value="(\d+)"/g)].map((m) => Number(m[1]));
    const rows = [.../<tbody>([\s\S]*?)<\/tbody>/.exec(t[1])[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => cells(m[1]));
    const totals = cells(foot[1]);
    totals.forEach((total, col) => assert.strictEqual(rows.reduce((sum, r) => sum + r[col], 0), total, 'column ' + col + ' of a table on the Impact page'));
  }
  const num = (page, key) => dictionaryFor(i18n, page, 'en')[key];
  assert.strictEqual(num('index', 'stat_2_num'), num('analytics', 'im_s1_num')); // members
  assert.strictEqual(num('index', 'stat_3_num'), num('analytics', 'im_s2_num')); // programmes in 2025
  assert.strictEqual(num('index', 'stat_4_num'), num('analytics', 'im_s4_num')); // volunteer hours
  assert.ok(html.includes('data-fmt="int" data-value="' + num('analytics', 'im_s2_num') + '"'), 'programmes = table total');
  assert.ok(html.includes('data-value="' + num('analytics', 'im_s3_num').replace(/\D/g, '') + '"'), 'people = table total');
  // the same figures in every language
  for (const [scope, v] of [['common', i18n.common], ...Object.entries(i18n.pages)]) {
    for (const k of Object.keys(v.en).filter((x) => /_num$/.test(x))) {
      for (const lang of ['fr', 'mk']) assert.strictEqual(v[lang][k].replace(/\D/g, ''), v.en[k].replace(/\D/g, ''), scope + '.' + k + ' [' + lang + ']');
    }
  }
});

/* ---------- third review (16 October 2026) ---------- */

test('each page loads only the shared texts and its own (i18n/common.js + i18n/<page>.js), and every text file is used', () => {
  const used = new Set(['common.js']);
  for (const f of pages()) {
    const html = read(f);
    const scripts = [...html.matchAll(/<script src="i18n\/([a-z0-9-]+\.js)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(scripts, ['common.js', pageName(html) + '.js'], f);
    scripts.forEach((s) => used.add(s));
  }
  const files = fs.readdirSync(path.join(ROOT, 'i18n')).filter((x) => x.endsWith('.js'));
  assert.deepStrictEqual(files.filter((x) => !used.has(x)), [], 'unused translation files');
  assert.ok(!fs.existsSync(path.join(ROOT, 'i18n.js')), 'the old single i18n.js is gone');
  // no page downloads more than common.js plus its own texts (about 50 KB before compression)
  for (const f of pages()) {
    const size = ['common.js', pageName(read(f)) + '.js'].reduce((n, x) => n + fs.statSync(path.join(ROOT, 'i18n', x)).size, 0);
    assert.ok(size < 60000, f + ' loads ' + size + ' bytes of text');
  }
});

test('no inline styles and no ARIA roles where a native element exists (html-validate "recommended")', () => {
  const problems = [];
  for (const f of [...pages(), 'partials/header.html', 'partials/footer.html']) {
    const html = read(f);
    if (/\sstyle="/.test(html)) problems.push(f + ': style attribute');
    for (const m of html.matchAll(/\srole="(region|banner|navigation|main|contentinfo|button|link|list|listitem|heading|article|complementary)"/g)) problems.push(f + ': role="' + m[1] + '"');
  }
  assert.deepStrictEqual(problems, []);
});

test('the donation amounts offered in the form are the ones the server accepts', () => {
  const server = read('server.js');
  const presets = JSON.parse(/const AMOUNTS = (\[[^\]]*\]);/.exec(server)[1].replace(/'/g, '"'));
  const other = /const OTHER_AMOUNT = \{ min: (\d+), max: (\d+) \}/.exec(server);
  const html = read('involved.html');
  const radios = [...html.matchAll(/<input type="radio" name="amount" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(radios, presets.concat('other'));
  const input = /<input type="number" id="join-amount-other"[^>]*>/.exec(html)[0];
  assert.ok(input.includes('min="' + other[1] + '"') && input.includes('max="' + other[2] + '"'), input);
  assert.ok(html.includes('<option value="' + /const DONATION_TOPIC = '([^']+)'/.exec(server)[1] + '"'), 'the donation topic exists in the form');
});

test('the statutes and the annual report can be downloaded, and their figures match the Impact page', () => {
  for (const f of ['versailles-vivant-statutes.pdf', 'versailles-vivant-annual-report-2025.pdf']) {
    const buf = fs.readFileSync(path.join(ROOT, 'downloads', f));
    assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-', f);
  }
  const report = read('scripts/pdf/annual-report-2025.html');
  const impact = read('analytics.html');
  for (const m of impact.matchAll(/data-value="(\d{4,})" data-fmt="eur"/g)) {
    const euros = '€' + Number(m[1]).toLocaleString('en-GB');
    assert.ok(report.includes(euros), 'the report has ' + euros);
  }
});

test('every photo is served by the site itself (no image is loaded from another site)', () => {
  const external = /(?:src="|url\(['"]?)https?:\/\/[^"')]+\.(?:jpe?g|png|webp|avif|gif)|(?:src="|url\(['"]?)https:\/\/(?:images\.unsplash\.com|live\.staticflickr\.com|upload\.wikimedia\.org)/i;
  for (const f of [...pages(), 'styles.css']) assert.ok(!external.test(read(f)), f + ' loads a photo from another site');
  for (const m of [...pages().map(read).join('\n').matchAll(/src="(images\/[^"]+)"/g)]) assert.ok(fs.existsSync(path.join(ROOT, m[1])), m[1]);
  assert.match(read('server/documents.js'), /"img-src 'self' data:"/);
});
