'use strict';
/**
 * Generated documents shared by the Node server (served on request) and scripts/build-static.js (written to disk).
 * Keeping one implementation means the static build and the live server can never disagree about the sitemap.
 */
const fs = require('fs');
const path = require('path');

const NOT_FOUND_PAGE = '404.html';
const LANGS = ['en', 'fr', 'mk'];

/** Public pages in the site root (index first, 404 excluded). */
function publicPages(root) {
  return fs.readdirSync(root)
    .filter((f) => f.endsWith('.html') && f !== NOT_FOUND_PAGE)
    .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
}

/**
 * The address of a page in a language. `origin` includes any base path and has no trailing slash.
 *   style "query"  (Node server): /about.html, /about.html?lang=fr — the server renders the language
 *   style "folder" (static build): /about.html, /fr/about.html     — pre-rendered copies in fr/ and mk/
 * English is the plain address; the home page is "/" (or "/fr/").
 */
function pageUrl(origin, file, lang, style) {
  const page = file === 'index.html' ? '' : file;
  if (!lang || lang === 'en') return origin + '/' + page;
  return style === 'folder' ? origin + '/' + lang + '/' + page : origin + '/' + page + '?lang=' + lang;
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** sitemap.xml: every page in every language, each listing all of its language versions (hreflang alternates). */
function sitemap(root, origin, style) {
  const urls = [];
  publicPages(root).forEach((f) => {
    const mtime = fs.statSync(path.join(root, f)).mtime.toISOString().slice(0, 10);
    const alts = LANGS.map((l) => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + xmlEsc(pageUrl(origin, f, l, style)) + '"/>').join('\n') +
      '\n    <xhtml:link rel="alternate" hreflang="x-default" href="' + xmlEsc(pageUrl(origin, f, 'en', style)) + '"/>';
    LANGS.forEach((l) => {
      urls.push('  <url>\n    <loc>' + xmlEsc(pageUrl(origin, f, l, style)) + '</loc>\n    <lastmod>' + mtime + '</lastmod>\n' + alts + '\n  </url>');
    });
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls.join('\n') + '\n</urlset>\n';
}

/** robots.txt; /api/ only exists when the Node server is used, disallowing it is harmless on static hosting. */
function robots(origin) {
  return 'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ' + origin + '/sitemap.xml\n';
}

/** Make the relative href/src values of the 404 page absolute, because it is shown at whatever URL was requested.
    The prefix is also left on <html data-link-base>, so that links inside texts the browser translates later (script.js)
    are made absolute the same way. */
function absolutize404(html, prefix) {
  return html
    .replace(/\b(href|src)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]*)"/gi, (m, attr, value) => attr + '="' + prefix + value + '"')
    .replace(/<html\b([^>]*)>/, (all, attrs) => '<html' + attrs + ' data-link-base="' + prefix.replace(/"/g, '') + '">');
}

/** Response headers sent by the Node server; scripts/build-static.js writes the same set to dist/_headers. */
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'", "connect-src 'self'", 'frame-src https://www.openstreetmap.org',
    "object-src 'none'", "base-uri 'self'", "form-action 'self' mailto:", "frame-ancestors 'none'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

module.exports = { SECURITY_HEADERS, NOT_FOUND_PAGE, LANGS, publicPages, pageUrl, sitemap, robots, absolutize404 };
