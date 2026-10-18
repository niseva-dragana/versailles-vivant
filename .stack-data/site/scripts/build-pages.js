#!/usr/bin/env node
// Rebuilds the shared regions of every page from /partials and keeps <title>/<meta description> in step with the
// translations in i18n/ (common.js + one file per page).
//   <head>   : <!-- @head -->    ... <!-- @/head -->      (partials/head.html)
//   header   : <!-- @header -->  ... <!-- @/header -->    (cookie notice + header)
//   footer   : <!-- @footer -->  ... <!-- @/footer -->
//   scripts  : <!-- @scripts --> ... <!-- @/scripts -->    (partials/scripts.html: i18n/common.js, i18n/<page>.js, scripts)
// Run:  npm run build      (add --check to fail if any page is out of date)
const fs = require('fs');
const path = require('path');
const { renderLang, plainText, loadI18n } = require('../server/render-lang');

const ROOT = path.join(__dirname, '..');
const PARTIALS = path.join(ROOT, 'partials');
const check = process.argv.includes('--check');
const OG_IMAGE = '{{ORIGIN}}/images/photo-1667752920461-a5ea0883f438-ff24cc65.jpg';
const EXTRA_SCRIPTS = { analytics: ['charts.js'] };
const CRUMB_KEY = { explore: 'nav_explore', tour: 'nav_tour', events: 'nav_events', involved: 'nav_involved', analytics: 'nav_analytics', journal: 'nav_journal', about: 'nav_about', contact: 'nav_contact', privacy: 'foot_privacy', faq: 'foot_faq', accessibility: 'foot_a11y' };

const i18n = loadI18n(ROOT);
const partial = (name) => fs.readFileSync(path.join(PARTIALS, name + '.html'), 'utf8').trimEnd();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ld = (obj) => '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2) + '\n</script>';

const ORG = { '@type': 'Organization', name: 'Versailles Vivant', url: '{{ORIGIN}}/' };
const attrOf = (attrs, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(attrs); return m ? m[1] : null; };
const keyIn = (body, re) => { const m = re.exec(body); return m ? m[1] : null; };
const need = (dict, key, where) => { if (!key || typeof dict[key] !== 'string') throw new Error(where + ': missing text for ' + key); return plainText(dict[key]); };

// Structured data is generated from the page itself, so it can never disagree with what visitors read.
// For ?lang=fr|mk the server swaps every text here for the same text in that language (render-lang.js).
function faqLd(html, en) {
  const items = [];
  const re = /<summary[^>]*\sdata-i18n="(q\d+)"[^>]*>[\s\S]*?<\/summary>\s*<div class="faq-answer"[^>]*\sdata-i18n="(a\d+)"/g;
  let m;
  while ((m = re.exec(html))) items.push({ '@type': 'Question', name: need(en, m[1], 'faq'), acceptedAnswer: { '@type': 'Answer', text: need(en, m[2], 'faq') } });
  if (!items.length) throw new Error('faq.html: no questions found');
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items };
}

function eventsLd(html, en) {
  const events = [];
  const re = /<article class="[^"]*\bevent\b[^"]*"([^>]*)>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = attrOf(m[1], 'id'), type = attrOf(m[1], 'data-type');
    const body = m[2];
    const loc = keyIn(body, /<dd[^>]*\sdata-i18n="(loc_\w+)"/);
    const free = type === 'talk' || type === 'volunteer';
    const reservable = new RegExp('data-rsvp="' + id + '"').test(body);
    const ev = {
      '@context': 'https://schema.org', '@type': 'Event',
      name: need(en, keyIn(body, /<h3[^>]*\sdata-i18n="(event\d+_h)"/), id),
      description: need(en, keyIn(body, /<p[^>]*\sdata-i18n="(event\d+_p)"/), id),
      startDate: attrOf(m[1], 'data-start'), endDate: attrOf(m[1], 'data-end'),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place', name: need(en, en['ld_' + loc] ? 'ld_' + loc : loc, id),
        address: loc === 'loc_hq'
          ? { '@type': 'PostalAddress', streetAddress: '14 Rue de la Paroisse', postalCode: '78000', addressLocality: 'Versailles', addressCountry: 'FR' }
          : { '@type': 'PostalAddress', addressLocality: 'Versailles', addressCountry: 'FR' }
      },
      organizer: ORG,
      url: '{{ORIGIN}}/events.html#' + id,
      inLanguage: 'en',
      isAccessibleForFree: free
    };
    if (!ev.startDate || !ev.endDate) throw new Error('event ' + id + ' has no start or end');
    if (free && reservable) ev.offers = { '@type': 'Offer', price: 0, priceCurrency: 'EUR', availability: 'https://schema.org/InStock', url: '{{ORIGIN}}/events.html#rsvp', validThrough: ev.startDate };
    events.push(ev);
  }
  if (!events.length) throw new Error('events.html: no events found');
  return events;
}

function blogLd(html, en) {
  const posts = [];
  const re = /<article class="[^"]*\bpost\b[^"]*"([^>]*)>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = attrOf(m[1], 'id'), date = attrOf(m[1], 'data-date'), writer = attrOf(m[1], 'data-author');
    const img = keyIn(m[2], /<img[^>]*\ssrc="([^"]+)"/);
    const post = {
      '@type': 'BlogPosting',
      headline: need(en, keyIn(m[2], /<h2[^>]*\sdata-i18n="([^"]+)"/), id),
      description: need(en, keyIn(m[2], /<p[^>]*\sdata-i18n="(a\d+_p)"/), id),
      datePublished: date, dateModified: date,
      author: writer ? { '@type': 'Person', name: writer } : ORG, publisher: ORG,
      inLanguage: 'en',
      mainEntityOfPage: '{{ORIGIN}}/journal.html#' + id,
      url: '{{ORIGIN}}/journal.html#' + id
    };
    if (img) post.image = img.replace(/&amp;/g, '&');
    posts.push(post);
  }
  if (!posts.length) throw new Error('journal.html: no posts found');
  return { '@context': 'https://schema.org', '@type': 'Blog', name: need(en, 'meta_title', 'journal'), url: '{{ORIGIN}}/journal.html', inLanguage: 'en', publisher: ORG, blogPost: posts };
}

function jsonld(page, html) {
  const en = Object.assign({}, i18n.common.en, (i18n.pages[page] || {}).en);
  if (page === '404') return '';
  if (page === 'index') {
    return [
      ld({
        '@context': 'https://schema.org', '@type': 'NGO', name: 'Versailles Vivant', url: '{{ORIGIN}}/', logo: '{{ORIGIN}}/favicon.svg',
        description: en.ld_org_desc,
        foundingDate: '2016', email: 'hello@versaillesvivant.example', telephone: '+33 1 99 00 12 34', availableLanguage: ['en', 'fr', 'mk'],
        address: { '@type': 'PostalAddress', streetAddress: '14 Rue de la Paroisse', postalCode: '78000', addressLocality: 'Versailles', addressCountry: 'FR' }
      }),
      ld({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Versailles Vivant', url: '{{ORIGIN}}/', inLanguage: ['en', 'fr', 'mk'] })
    ].join('\n');
  }
  const out = [ld({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: en.nav_home, item: '{{ORIGIN}}/' },
      { '@type': 'ListItem', position: 2, name: en[CRUMB_KEY[page]] || en.meta_title, item: '{{ORIGIN}}/' + page + '.html' }
    ]
  })];
  if (page === 'faq') out.push(ld(faqLd(html, en)));
  if (page === 'events') out.push(ld(eventsLd(html, en)));
  if (page === 'journal') out.push(ld(blogLd(html, en)));
  return out.join('\n');
}

function renderHead(page, file, html) {
  const dict = Object.assign({}, i18n.common.en, (i18n.pages[page] || {}).en);
  if (!dict.meta_title || !dict.meta_desc) throw new Error('missing meta_title/meta_desc for ' + page);
  let h = partial('head');
  const indexable = page !== '404';
  h = h.replace(/\{\{#indexable\}\}([\s\S]*?)\{\{\/indexable\}\}\{\{\^indexable\}\}([\s\S]*?)\{\{\/indexable\}\}/, (all, yes, no) => (indexable ? yes : no));
  return h
    .replace(/<title data-i18n="meta_title">\{\{meta_title\}\}<\/title>/, () => '<title data-i18n="meta_title">' + escText(dict.meta_title) + '</title>')
    .replace(/\{\{meta_title\}\}/g, () => esc(dict.meta_title))
    .replace(/\{\{meta_desc\}\}/g, () => esc(dict.meta_desc))
    .replace(/\{\{og_image\}\}/g, () => esc(OG_IMAGE))
    .replace(/\{\{page\}\}/g, file === 'index.html' ? '' : file)
    .replace(/\{\{jsonld\}\}/g, () => jsonld(page, html))
    .replace(/\n+$/, '');
}

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let changed = 0;
for (const file of pages) {
  const full = path.join(ROOT, file);
  const page = file.replace(/\.html$/, '');
  let html = fs.readFileSync(full, 'utf8');
  const original = html;
  const regions = {
    head: renderHead(page, file, html),
    header: partial('header'),
    footer: partial('footer'),
    scripts: partial('scripts').replace('{{page}}', () => {
      if (!fs.existsSync(path.join(ROOT, 'i18n', page + '.js'))) throw new Error(file + ': no i18n/' + page + '.js');
      return page;
    }).replace('{{extra_scripts}}', (EXTRA_SCRIPTS[page] || []).map((s) => '\n<script src="' + s + '" defer></script>').join(''))
  };
  for (const [name, body] of Object.entries(regions)) {
    const re = new RegExp('<!-- @' + name + ' -->[\\s\\S]*?<!-- @/' + name + ' -->');
    if (!re.test(html)) throw new Error(file + ' has no <!-- @' + name + ' --> region');
    html = html.replace(re, () => '<!-- @' + name + ' -->\n' + body + '\n<!-- @/' + name + ' -->');
  }
  // fill the English text of every data-i18n element from i18n/ (single source of truth)
  html = renderLang(html, 'en', i18n);
  // mark the current page in the navigation (script.js does the same as a fallback)
  html = html.replace(/(<ul class="nav-links">[\s\S]*?<\/ul>)/, (ul) => ul.replace(/ aria-current="page"/g, '').replace(new RegExp('<a href="' + file.replace('.', '\\.') + '"'), '<a href="' + file + '" aria-current="page"'));
  if (html !== original) { changed++; if (!check) fs.writeFileSync(full, html); }
}

let feedChanged = false;
// Atom feed of the news page (feed.xml), generated from journal.html + the English strings in i18n/common.js and i18n/journal.js
function buildFeed() {
  const html = fs.readFileSync(path.join(ROOT, 'journal.html'), 'utf8');
  const en = Object.assign({}, i18n.common.en, i18n.pages.journal.en);
  const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const shorten = (text) => (text.length <= 240 ? text : text.slice(0, 240).replace(/\s+\S*$/, '') + '…');
  const entries = [];
  const re = /<article class="[^"]*\bpost\b[^"]*" id="([^"]+)" data-category="([^"]+)" data-date="([^"]+)"([^>]*)>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const title = /<h2[^>]*data-i18n="([^"]+)"/.exec(m[5]);
    const para = /<p[^>]*data-i18n="(a\d+_p)"/.exec(m[5]);
    if (!title || !en[title[1]]) throw new Error('journal post ' + m[1] + ' has no title key');
    entries.push({ id: m[1], category: m[2], date: m[3], author: attrOf(m[4], 'data-author'), title: strip(en[title[1]]), summary: para && en[para[1]] ? shorten(strip(en[para[1]])) : '' });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const iso = (d) => d + 'T09:00:00Z';
  const xml = ['<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">',
    '  <title>Versailles Vivant — News</title>',
    '  <subtitle>Notes from the gardens and the archive. A fictional association (university course project).</subtitle>',
    '  <link rel="self" type="application/atom+xml" href="{{ORIGIN}}/feed.xml"/>',
    '  <link rel="alternate" type="text/html" href="{{ORIGIN}}/journal.html"/>',
    '  <id>{{ORIGIN}}/journal.html</id>',
    '  <updated>' + iso(entries.length ? entries[0].date : '2026-01-01') + '</updated>',
    '  <author><name>Versailles Vivant committee</name></author>']
    .concat(entries.map((e) => [
      '  <entry>',
      '    <title>' + escText(e.title) + '</title>',
      '    <link rel="alternate" type="text/html" href="{{ORIGIN}}/journal.html#' + esc(e.id) + '"/>',
      '    <id>{{ORIGIN}}/journal.html#' + esc(e.id) + '</id>',
      '    <published>' + iso(e.date) + '</published>',
      '    <updated>' + iso(e.date) + '</updated>',
      '    <category term="' + esc(e.category) + '"/>',
      e.author ? '    <author><name>' + escText(e.author) + '</name></author>' : null,
      '    <summary>' + escText(e.summary) + '</summary>',
      '  </entry>'].filter((line) => line !== null).join('\n')))
    .concat(['</feed>', '']).join('\n');
  const file = path.join(ROOT, 'feed.xml');
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (old !== xml) { feedChanged = true; if (!check) fs.writeFileSync(file, xml); }
  return entries.length;
}
const posts = buildFeed();

console.log((check ? 'would update ' : 'updated ') + changed + ' of ' + pages.length + ' pages; feed.xml (' + posts + ' posts) ' + (feedChanged ? (check ? 'is out of date' : 'rewritten') : 'is up to date'));
if (check && (changed || feedChanged)) process.exit(1);
