'use strict';
/**
 * Server-side language rendering.
 *
 * The pages carry English text plus data-i18n attributes; script.js swaps in French or Macedonian in the browser.
 * For URLs such as /about.html?lang=fr the server does the same swap *before* sending the HTML, so that
 * search engines, link previews, screen readers and anything running without JavaScript get a genuine French or
 * Macedonian document (with <html lang>, translated <title>, meta tags and a language-specific canonical URL).
 * The browser script produces the identical result, so the two stay in step.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LANGS = ['en', 'fr', 'mk'];
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ATTR_KEYS = [
  ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria-label', 'aria-label'], ['data-i18n-content', 'content'],
  ['data-i18n-alt', 'alt'], ['data-i18n-title', 'title'], ['data-i18n-aria-roledescription', 'aria-roledescription']
];

/* The texts live in i18n/: common.js (menu, footer, forms) and one file per page (i18n/about.js ...). Each page loads only
   common.js and its own file; the server reads them all. */
const I18N_DIR = 'i18n';
function i18nFiles(root) {
  const dir = path.join(root, I18N_DIR);
  return fs.readdirSync(dir).filter((f) => /^[a-z0-9-]+\.js$/.test(f)).sort().map((f) => path.join(dir, f));
}
/** Changes whenever any translation file changes (used for caching translated pages). */
function i18nVersion(root) {
  return i18nFiles(root).map((f) => path.basename(f) + ':' + fs.statSync(f).mtimeMs).join('|');
}
let cache = { key: null, data: null };
function loadI18n(root) {
  const key = root + '#' + i18nVersion(root);
  if (cache.key === key) return cache.data;
  const sandbox = { window: {} };
  for (const file of i18nFiles(root)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { timeout: 2000, filename: file });
  const data = sandbox.window.i18n || { common: {}, pages: {} };
  if (!data.common || !data.pages) throw new Error('i18n/: common.js or the page files are missing');
  cache = { key, data };
  return cache.data;
}

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hasMarkup = (s) => /<[a-z][\s\S]*>/i.test(s);

function getAttr(attrs, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"').exec(attrs);
  return m ? m[1] : null;
}
function removeAttr(attrs, name) {
  return attrs.replace(new RegExp('\\s' + name + '\\s*=\\s*"[^"]*"'), '');
}
function setAttr(attrs, name, value) {
  const re = new RegExp('((?:^|\\s)' + name + '\\s*=\\s*)"[^"]*"');
  if (re.test(attrs)) return attrs.replace(re, (all, pre) => pre + '"' + escAttr(value) + '"');
  return attrs + ' ' + name + '="' + escAttr(value) + '"';
}

/** index of the "</tag" that closes the element whose content starts at `from` (or -1) */
function findClose(html, tag, from) {
  const re = new RegExp('<(/?)' + tag + '(?=[\\s>/])[^>]*>', 'gi');
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (m[1]) { depth--; if (depth === 0) return m.index; } else if (!/\/>$/.test(m[0])) depth++;
  }
  return -1;
}


/* ---------- numbers ---------- */
// Chromium has no Macedonian number data (it would print 75,400), so Macedonian is formatted by hand: 75.400 €, 52%
function groupMk(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function formatNumber(kind, lang, value) {
  const v = Number(value);
  if (lang === 'mk') return kind === 'eur' ? groupMk(v) + '\u00a0€' : kind === 'pct' ? groupMk(v) + '%' : groupMk(v);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  if (kind === 'eur') return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  if (kind === 'pct') return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(v / 100);
  return new Intl.NumberFormat(locale).format(v);
}

/* ---------- internal links keep the chosen language ---------- */
// Relative links to the site's own pages (about.html, events.html#rsvp ...) get ?lang=fr|mk, so that a visitor or crawler
// reading a translated page without JavaScript stays in that language. script.js does the same after a language switch.
const PAGE_LINK = /(<a\b[^>]*?\shref=")([a-z0-9-]+\.html)(\?[^"#]*)?(#[^"]*)?(")/gi;
function withLangInLinks(html, lang) {
  if (lang === 'en') return html;
  return html.replace(PAGE_LINK, (all, pre, page, query, frag, post) => {
    const rest = (query || '').replace(/^\?/, '').split('&').filter((p) => p && p.indexOf('lang=') !== 0);
    rest.push('lang=' + lang);
    return pre + page + '?' + rest.join('&') + (frag || '') + post;
  });
}

/* ---------- structured data in the chosen language ---------- */
const plainText = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// JSON-LD strings that are exactly one of the page's English texts are replaced with the same text in `lang`.
// Names, descriptions and FAQ answers therefore follow the page; anything without a matching key (a street name) stays as it is.
function localizeJsonLd(json, lang, dictEn, dictLang) {
  const map = new Map();
  Object.keys(dictEn).forEach((k) => {
    if (typeof dictEn[k] !== 'string' || typeof dictLang[k] !== 'string') return;
    const from = plainText(dictEn[k]);
    if (from.length > 2 && !map.has(from)) map.set(from, plainText(dictLang[k]));
  });
  // only human-readable properties are translated, never @type, URLs, e-mail addresses or lists of available languages
  const TEXT_KEYS = new Set(['name', 'description', 'text', 'headline']);
  // links to the site's own pages point to the same language (…/events.html?lang=fr#rsvp)
  const URL_KEYS = new Set(['url', 'item', 'mainEntityOfPage']);
  const PAGE_URL = /^(\{\{ORIGIN\}\}\/(?:[a-z0-9-]+\.html)?)(#.*)?$/;
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, null)); // a list of languages is a list, not the page language
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = walk(v[k], k); }); return o; }
    if (typeof v === 'string') {
      if (key === 'inLanguage') return v === 'en' ? lang : v;
      if (URL_KEYS.has(key)) { const u = PAGE_URL.exec(v); return u ? u[1] + '?lang=' + lang + (u[2] || '') : v; }
      return TEXT_KEYS.has(key) && map.has(plainText(v)) ? map.get(plainText(v)) : v;
    }
    return v;
  };
  return JSON.stringify(walk(JSON.parse(json)), null, 2).replace(/</g, '\\u003c');
}

function dictionaryFor(i18n, page, lang) {
  const en = Object.assign({}, (i18n.common || {}).en, ((i18n.pages || {})[page] || {}).en);
  if (lang === 'en') return en;
  return Object.assign(en, (i18n.common || {})[lang], ((i18n.pages || {})[page] || {})[lang]);
}

function renderLang(html, lang, i18n) {
  if (LANGS.indexOf(lang) === -1) return html;
  const pageMatch = /<body\b[^>]*\sdata-page="([^"]+)"/.exec(html);
  const page = pageMatch ? pageMatch[1] : 'index';
  const dict = dictionaryFor(i18n, page, lang);

  let out = '';
  let i = 0;
  const tagRe = /<([a-zA-Z][\w-]*)((?:\s[^>]*)?)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    let attrs = m[2];
    if (tag === 'script' || tag === 'style') { // never touch code; JSON-LD data is translated, everything else is left alone
      const close = html.toLowerCase().indexOf('</' + tag, tagRe.lastIndex);
      if (close !== -1) {
        if (tag === 'script' && lang !== 'en' && /type="application\/ld\+json"/.test(attrs)) {
          try {
            const localized = '\n' + localizeJsonLd(html.slice(tagRe.lastIndex, close), lang, dictionaryFor(i18n, page, 'en'), dict) + '\n';
            out += html.slice(i, m.index) + '<' + m[1] + attrs + '>' + localized;
            i = close;
          } catch (err) { /* malformed JSON-LD is served unchanged */ }
        }
        tagRe.lastIndex = close;
      }
      continue;
    }
    if (tag === 'html') {
      out += html.slice(i, m.index) + '<html' + setAttr(attrs, 'lang', lang) + '>';
      i = tagRe.lastIndex;
      continue;
    }
    // numbers in data tables are written in the page language (English too, so the source pages use the same formatter)
    const fmt = getAttr(attrs, 'data-fmt');
    if (fmt !== null && attrs.indexOf('data-i18n') === -1 && getAttr(attrs, 'data-value') !== null) {
      const close = findClose(html, tag, tagRe.lastIndex);
      if (close !== -1) {
        out += html.slice(i, m.index) + '<' + m[1] + attrs + '>' + escText(formatNumber(fmt, lang, getAttr(attrs, 'data-value')));
        i = close;
        tagRe.lastIndex = close;
        continue;
      }
    }
    if (attrs.indexOf('data-i18n') === -1 && attrs.indexOf('data-lang=') === -1 && !(lang !== 'en' && /rel="canonical"|property="og:url"/.test(attrs))) continue;

    let changed = attrs;
    const n = getAttr(attrs, 'data-n'); // optional number substituted for {n} (e.g. "Room {n}")
    const fill = (v) => (n === null ? v : v.replace(/\{n\}/g, n));
    ATTR_KEYS.forEach((pair) => {
      const key = getAttr(attrs, pair[0]);
      if (key !== null && dict[key] !== undefined) changed = setAttr(changed, pair[1], fill(dict[key]));
    });
    const langBtn = getAttr(attrs, 'data-lang');
    if (langBtn !== null) {
      if (/aria-pressed=/.test(attrs)) changed = setAttr(changed, 'aria-pressed', langBtn === lang ? 'true' : 'false');
      else { changed = removeAttr(changed, 'aria-current'); if (langBtn === lang) changed = setAttr(changed, 'aria-current', 'true'); }
    }
    if (lang !== 'en') {
      if (/rel="canonical"/.test(attrs)) changed = changed.replace(/href="([^"?#]*)"/, 'href="$1?lang=' + lang + '"');
      if (/property="og:url"/.test(attrs)) changed = changed.replace(/content="([^"?#]*)"/, 'content="$1?lang=' + lang + '"');
    }

    const key = getAttr(attrs, 'data-i18n');
    const selfClosing = /\/\s*$/.test(attrs);
    if (key !== null && dict[key] !== undefined && !VOID.has(tag) && !selfClosing) {
      const close = findClose(html, tag, tagRe.lastIndex);
      if (close !== -1) {
        const value = fill(dict[key]);
        out += html.slice(i, m.index) + '<' + m[1] + changed + '>' + (hasMarkup(value) ? value : escText(value));
        i = close;
        tagRe.lastIndex = close;
        continue;
      }
    }
    out += html.slice(i, m.index) + '<' + m[1] + changed + '>';
    i = tagRe.lastIndex;
  }
  return withLangInLinks(out + html.slice(i), lang);
}

module.exports = { renderLang, loadI18n, i18nVersion, dictionaryFor, LANGS, plainText, formatNumber };
