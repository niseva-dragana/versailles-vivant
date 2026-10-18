#!/usr/bin/env node
'use strict';
/**
 * Static build for hosts that only serve files (Apache, nginx, GitHub Pages, Netlify, a university web space ...).
 *
 *   node scripts/build-static.js --origin https://vv.example.org [--base /vivant] [--out dist]
 *
 * What it writes to --out:
 *   - the English pages at the root, and a copy of every page already translated into French and Macedonian in fr/ and mk/
 *     (fr/about.html ...). Visitors, search engines and link-preview bots that do not run JavaScript therefore get a real
 *     French or Macedonian document, and the language links, canonical and hreflang addresses all point to these files.
 *   - the real address stamped into canonical / hreflang / Open Graph / JSON-LD / Atom feed
 *   - sitemap.xml (every page in every language), robots.txt, .htaccess (Apache: security headers, 404 page, compression,
 *     caching), _headers (Netlify / Cloudflare Pages: the same security headers as server.js) and .nojekyll (GitHub Pages)
 *
 * What a static host cannot do: there is no form service, so the forms hand the message to the visitor's e-mail app
 * (data-endpoint is emptied, which script.js treats as "e-mail only"); there are no redirects.
 */
const fs = require('fs');
const path = require('path');
const documents = require('../server/documents');
const { renderLang, loadI18n } = require('../server/render-lang');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['styles.css', 'lang-init.js', 'script.js', 'pages.js', 'charts.js', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'feed.xml'];
const DIRS = ['fonts', 'images', 'i18n', 'downloads'];
const TRANSLATED = ['fr', 'mk'];

function parseArgs(argv) {
  const out = { origin: '', base: '', out: path.join(ROOT, 'dist') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); return argv[++i]; };
    if (a === '--origin') out.origin = val();
    else if (a === '--base') out.base = val();
    else if (a === '--out') out.out = path.resolve(val());
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Unknown option ' + a);
  }
  return out;
}

/**
 * Turns a page into its static form. `dir` is '' for the English pages at the root, or 'fr' / 'mk' for the translated
 * copies one folder down (whose HTML has already been rendered in that language by renderLang).
 */
function layoutPage(html, file, dir) {
  const page = file === 'index.html' ? '' : file;
  const url = (lang) => '{{ORIGIN}}/' + (lang === 'en' ? '' : lang + '/') + page;

  // no form service on a static host: the forms open the visitor's e-mail app instead (script.js)
  html = html.replace(/(<form\b[^>]*?)\sdata-endpoint="[^"]*"/g, '$1 data-endpoint=""');

  // English pages are marked too: a visitor who chose French or Macedonian earlier is sent to the pre-rendered copy (lang-init.js)
  if (!dir) html = html.replace(/<html\b([^>]*)>/, (all, attrs) => '<html' + attrs + ' data-static>');
  if (dir) {
    html = html.replace(/<html\b([^>]*)>/, (all, attrs) => '<html' + attrs + ' data-prerendered>');
    // shared files (styles, scripts, fonts, images, the feed) are one folder up; links between pages stay in this folder,
    // without the ?lang= the server version uses
    html = html.replace(/\b(href|src)="(?![a-z][a-z0-9+.-]*:|\/|#|\?|\{\{)([^"]*)"/gi, (all, attr, value) => {
      if (/^[a-z0-9-]+\.html(?=[?#]|$)/i.test(value)) {
        const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(value);
        const rest = (m[2] || '').slice(1).split('&').filter((p) => p && p.indexOf('lang=') !== 0);
        return attr + '="' + m[1] + (rest.length ? '?' + rest.join('&') : '') + (m[3] || '') + '"';
      }
      return attr + '="../' + value + '"';
    });
    // url(...) in style attributes: relative addresses move one folder up as well. The quote is matched first and the
    // address checked after it; with an optional quote and a lookahead alone, url('https://…') became url(../'https://…')
    html = html.replace(/url\((['"]?)([^'")]*)\1\)/gi, (all, q, u) => (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(u) || !u ? all : 'url(' + q + '../' + u + q + ')'));
    // structured data: links to pages in this language become links to the files in this folder
    html = html.replace(/\{\{ORIGIN\}\}\/([a-z0-9-]+\.html)?\?lang=(fr|mk)/g, (all, p, lang) => '{{ORIGIN}}/' + lang + '/' + (p || ''));
  }

  // the language links lead to the pre-rendered files
  const switchHref = (lang) => (lang === (dir || 'en') ? file : (dir ? '../' : '') + (lang === 'en' ? '' : lang + '/') + file);
  html = html.replace(/<a\b[^>]*\sdata-lang="(en|fr|mk)"[^>]*>/g, (tag, lang) => tag.replace(/\shref="[^"]*"/, ' href="' + switchHref(lang) + '"'));

  // canonical, alternates and og:url use the same addresses
  html = html.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + url(dir || 'en') + '">');
  html = html.replace(/<link rel="alternate" hreflang="(en|fr|mk|x-default)" href="[^"]*">/g,
    (all, l) => '<link rel="alternate" hreflang="' + l + '" href="' + url(l === 'x-default' ? 'en' : l) + '">');
  html = html.replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + url(dir || 'en') + '">');
  return html;
}

/** Apache (most university and shared hosting): the same headers as server.js, the 404 page, compression and caching. */
function htaccess(base) {
  const headers = Object.entries(documents.SECURITY_HEADERS).map(([k, v]) => '  Header always set ' + k + ' "' + v.replace(/"/g, '\\"') + '"').join('\n');
  return [
    '# Written by scripts/build-static.js. Apache reads this file; other servers ignore it.',
    'Options -Indexes',
    'DirectoryIndex index.html',
    'AddDefaultCharset utf-8',
    'AddType application/atom+xml .xml',
    'AddType application/xml sitemap.xml',
    'ErrorDocument 404 ' + (base || '') + '/404.html',
    '<IfModule mod_headers.c>',
    headers,
    '  <FilesMatch "\\.(woff2|png|jpe?g|webp|avif|ico)$">',
    '    Header set Cache-Control "public, max-age=31536000, immutable"',
    '  </FilesMatch>',
    '  <FilesMatch "\\.(html|xml)$">',
    '    Header set Cache-Control "no-cache"',
    '  </FilesMatch>',
    '</IfModule>',
    '<IfModule mod_deflate.c>',
    '  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/xml application/atom+xml image/svg+xml',
    '</IfModule>',
    ''
  ].join('\n');
}

function build(opts) {
  const origin = String(opts.origin || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(origin)) throw new Error('--origin must look like https://host (no path; use --base for a sub-path)');
  let base = String(opts.base || '').replace(/\/+$/, '');
  if (base && !/^\/[A-Za-z0-9._~\/-]*$/.test(base)) throw new Error('--base must look like /sub/path');
  const out = path.resolve(opts.out);
  // The output folder is emptied first, so refuse anything that could be the project itself or somebody's documents.
  if (out === ROOT || ROOT.startsWith(out + path.sep)) throw new Error('--out must be a separate folder, not the project folder');
  const rel = path.relative(ROOT, out);
  if (!rel.startsWith('..') && !path.isAbsolute(rel) && !['dist', 'build', 'public', '_site'].includes(rel.split(path.sep)[0])) {
    throw new Error('--out inside the project must be dist, build, public or _site (it is emptied before every build)');
  }
  if (fs.existsSync(out) && fs.readdirSync(out).length && !fs.existsSync(path.join(out, '.nojekyll'))) {
    throw new Error('--out exists, is not empty and does not look like an earlier static build; choose an empty folder');
  }
  const full = origin + base;                                   // used for canonical / hreflang / sitemap
  const stamp = (text) => text.replace(/\{\{ORIGIN\}\}/g, full);
  const i18n = loadI18n(ROOT);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const written = [];
  const write = (name, data) => { fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true }); fs.writeFileSync(path.join(out, name), data); written.push(name); };

  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
  for (const f of pages) {
    const source = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (f === documents.NOT_FOUND_PAGE) {
      // shown at whatever address was requested, so its links are absolute; the language links switch in place (script.js)
      write(f, stamp(documents.absolutize404(source.replace(/(<form\b[^>]*?)\sdata-endpoint="[^"]*"/g, '$1 data-endpoint=""'), base + '/')));
      continue;
    }
    write(f, stamp(layoutPage(source, f, '')));
    for (const lang of TRANSLATED) write(lang + '/' + f, stamp(layoutPage(renderLang(source, lang, i18n), f, lang)));
  }
  for (const f of FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) continue;
    write(f, f.endsWith('.xml') ? stamp(fs.readFileSync(src, 'utf8')) : fs.readFileSync(src));
  }
  for (const d of DIRS) {
    const src = path.join(ROOT, d);
    if (!fs.existsSync(src)) continue;
    (function copy(dir, relDir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) copy(path.join(dir, e.name), relDir + '/' + e.name);
        else if (e.isFile() && !e.name.startsWith('.')) write(relDir + '/' + e.name, fs.readFileSync(path.join(dir, e.name)));
      }
    })(src, d);
  }
  write('sitemap.xml', documents.sitemap(ROOT, full, 'folder'));
  write('robots.txt', documents.robots(full));
  write('.htaccess', htaccess(base));
  write('_headers', '/*\n' + Object.entries(documents.SECURITY_HEADERS).map(([k, v]) => '  ' + k + ': ' + v).join('\n') + '\n');
  write('.nojekyll', '');

  const left = written.filter((n) => /\.(html|xml|txt)$/.test(n)).filter((n) => fs.readFileSync(path.join(out, n), 'utf8').includes('{{ORIGIN}}'));
  if (left.length) throw new Error('Placeholder left in: ' + left.join(', '));
  return { out, files: written.length, pages: pages.length, translated: (pages.length - 1) * TRANSLATED.length, origin: full };
}

module.exports = { build, parseArgs, layoutPage };

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || !opts.origin) {
      console.log('Usage: node scripts/build-static.js --origin https://host [--base /sub/path] [--out dist]');
      process.exit(opts.help ? 0 : 2);
    }
    const r = build(opts);
    console.log('Static site written to ' + path.relative(process.cwd(), r.out) + ' (' + r.pages + ' English pages, ' + r.translated +
      ' translated copies in fr/ and mk/, ' + r.files + ' files) for ' + r.origin);
  } catch (e) {
    console.error('build-static: ' + e.message);
    process.exit(1);
  }
}
