#!/usr/bin/env node
'use strict';
/**
 * Copies every photograph the site loads from Unsplash, Flickr or Wikimedia into /images and points the pages at the
 * local copies. After running it, no visitor's browser contacts a third party to show a photo (better for privacy,
 * speed and resilience), and the Content-Security-Policy `img-src` in server.js can be tightened to 'self' data:.
 *
 *   node scripts/localize-images.js           download and rewrite
 *   node scripts/localize-images.js --dry     only list what would be done
 *
 * The photo credits that appear on the pages stay as they are. When no external photo is left, the script also
 * tightens the Content-Security-Policy (server/documents.js: img-src 'self' data:) and updates the privacy policy
 * (i18n/privacy.js, key s4_li2, in all three languages), then runs `npm run build`. Commit images/ afterwards.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const URL_RE = /https:\/\/(?:images\.unsplash\.com|live\.staticflickr\.com|upload\.wikimedia\.org)\/[^"'\s<>)]+/g;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif', 'image/svg+xml': '.svg' };
const decode = (u) => u.replace(/&amp;/g, '&');

async function run({ root = path.join(__dirname, '..'), dry = false, fetchImpl = globalThis.fetch, build = true, log = console.log } = {}) {
  const files = [
    ...fs.readdirSync(root).filter((f) => f.endsWith('.html') || f === 'styles.css'),
    ...fs.readdirSync(path.join(root, 'partials')).map((f) => 'partials/' + f),
    'scripts/build-pages.js'
  ].filter((f) => fs.existsSync(path.join(root, f)));
  const text = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

  const urls = new Map(); // decoded URL -> { raw: Set, file }
  for (const f of files) for (const m of text[f].matchAll(URL_RE)) {
    const key = decode(m[0]);
    if (!urls.has(key)) urls.set(key, { raws: new Set(), file: null });
    urls.get(key).raws.add(m[0]);
  }
  log(urls.size + ' external image URL(s) found');
  if (dry || !urls.size) { for (const u of urls.keys()) log('  ' + u); return { downloaded: 0, urls: [...urls.keys()] }; }

  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  const downloads = [];
  for (const [url, info] of urls) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'VersaillesVivant-localize-images/1.0 (university course project)' }, redirect: 'follow' });
    if (!res.ok) throw new Error('Could not download ' + url + ' (HTTP ' + res.status + '); nothing was changed');
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!EXT[type]) throw new Error(url + ' is not an image (' + type + '); nothing was changed');
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
    info.file = base + '-' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 8) + EXT[type];
    downloads.push([info.file, Buffer.from(await res.arrayBuffer())]);
    log('  downloaded ' + info.file);
  }
  for (const [name, buf] of downloads) fs.writeFileSync(path.join(root, 'images', name), buf);

  // the social-sharing image must be an absolute URL: build-pages.js turns {{ORIGIN}} into the site address
  const og = /const OG_IMAGE = '([^']+)';/.exec(text['scripts/build-pages.js']);
  for (const f of files) {
    let t = text[f];
    if (f === 'scripts/build-pages.js' && og) {
      const info = urls.get(decode(og[1]));
      if (info) t = t.replace(og[0], "const OG_IMAGE = '{{ORIGIN}}/images/" + info.file + "';");
    } else {
      for (const info of urls.values()) for (const raw of info.raws) t = t.split(raw).join('images/' + info.file);
    }
    if (t !== text[f]) fs.writeFileSync(path.join(root, f), t);
  }
  const external = new RegExp(URL_RE.source);
  const left = files.some((f) => external.test(fs.readFileSync(path.join(root, f), 'utf8')));
  if (!left) {
    tightenPolicy(root, log);
    updatePrivacyText(root, log);
  }
  if (build) execFileSync(process.execPath, [path.join(root, 'scripts', 'build-pages.js')], { stdio: 'inherit' });
  log('Done. Check the pages, run npm test, and commit images/ with the changed files.');
  return { downloaded: downloads.length, urls: [...urls.keys()] };
}

// no browser needs to fetch a photo from another site any more
function tightenPolicy(root, log) {
  const file = path.join(root, 'server', 'documents.js');
  if (!fs.existsSync(file)) return;
  const t = fs.readFileSync(file, 'utf8');
  const out = t.replace(/"img-src 'self' data:[^"]*"/, '"img-src \'self\' data:"');
  if (out !== t) { fs.writeFileSync(file, out); log('  Content-Security-Policy: img-src \'self\' data:'); }
}

// the privacy policy must stop saying that photo libraries receive the visitor's address
const PRIVACY_PHOTOS = {
  en: '<strong>Photographs</strong> are hosted on this site, so no photo library receives your data when you view them. Flickr photos are credited beside the photo, as their CC BY licence requires; Unsplash photos are used under the Unsplash Licence and are credited to Unsplash.',
  fr: '<strong>Les photographies</strong> sont hébergées sur ce site\u00a0: aucune photothèque ne reçoit vos données lorsque vous les consultez. Les photos Flickr sont créditées à côté de l’image, comme l’exige leur licence CC BY\u202f; les photos Unsplash sont utilisées sous la licence Unsplash et sont créditées à Unsplash.',
  mk: '<strong>Фотографиите</strong> се сместени на овој сајт, па ниедна фото-библиотека не ги добива вашите податоци кога ги гледате. Фотографиите од Flickr се потпишани покрај сликата, како што бара нивната лиценца CC BY; фотографиите од Unsplash се користат според лиценцата на Unsplash и се потпишани со Unsplash.'
};
function updatePrivacyText(root, log) {
  const file = path.join(root, 'i18n', 'privacy.js');
  if (!fs.existsSync(file)) return;
  const vm = require('vm');
  const sandbox = { window: {} };
  const src = fs.readFileSync(file, 'utf8');
  vm.runInNewContext(src, sandbox);
  const privacy = sandbox.window.i18n && sandbox.window.i18n.pages && sandbox.window.i18n.pages.privacy;
  if (!privacy) return;
  let out = src;
  for (const lang of Object.keys(PRIVACY_PHOTOS)) {
    const old = privacy[lang] && privacy[lang].s4_li2;
    if (!old || old === PRIVACY_PHOTOS[lang]) continue;
    const quoted = JSON.stringify(old);
    if (out.split(quoted).length !== 2) { log('  privacy text (' + lang + ') not found exactly once: update s4_li2 by hand'); continue; }
    out = out.replace(quoted, () => JSON.stringify(PRIVACY_PHOTOS[lang]));
  }
  if (out !== src) { fs.writeFileSync(file, out); log('  privacy policy: photographs are hosted on this site'); }
}

module.exports = { run };

if (require.main === module) {
  run({ dry: process.argv.includes('--dry') }).catch((e) => { console.error(e.message); process.exit(1); });
}
