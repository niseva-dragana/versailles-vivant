'use strict';
/**
 * Versailles Vivant — dependency-free web server.
 *
 *  - serves the static site from an allow-list of files (nothing else in the folder is reachable)
 *  - sends security headers (CSP, nosniff, referrer policy, frame protection)
 *  - gzip / brotli compression with ETag revalidation
 *  - fills {{ORIGIN}} placeholders so canonical / hreflang / sitemap URLs always match the real host
 *  - POST /api/contact  (contact, membership, newsletter and RSVP forms) with validation,
 *    honeypot, rate limiting and append-only JSON Lines storage
 *  - dynamic /sitemap.xml and /robots.txt, /health for container health checks
 *
 * Run:  node server.js      (PORT, DATA_DIR, BASE_PATH, TRUST_PROXY and LOG are optional environment variables)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { renderLang, loadI18n, i18nVersion, LANGS } = require('./server/render-lang');
const documents = require('./server/documents');

const ROOT = __dirname;
const NOT_FOUND_PAGE = '404.html';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.ics': 'text/calendar; charset=utf-8', '.pdf': 'application/pdf'
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.xml', '.txt', '.webmanifest']);
const PLACEHOLDER_TYPES = new Set(['.html', '.xml', '.txt']);
// Root-level files that must never be served even though their extension is allowed.
const PRIVATE_ROOT_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'eslint.config.js']);
// Public folders, each with the only kinds of file it may serve (fonts/LICENSE-*.txt, for instance, is not served).
const PUBLIC_DIRS = new Map([
  ['fonts', /^[A-Za-z0-9._-]+\.woff2$/],
  ['images', /^[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp|avif|svg|ico)$/],
  ['i18n', /^[a-z0-9-]+\.js$/],          // translations: i18n/common.js and one file per page
  ['downloads', /^[A-Za-z0-9._-]+\.pdf$/] // statutes and annual report
]);
const ROOT_FILE = /^[A-Za-z0-9_-]+\.(html|css|js|json|svg|xml|txt|png|jpg|jpeg|webp|avif|ico|webmanifest)$/;

const { SECURITY_HEADERS } = documents;

/*
 * Environment variables (all optional):
 *   PORT, HOST, DATA_DIR, BASE_PATH, LOG=0
 *   PUBLIC_ORIGIN   e.g. https://vv.example.org  — the address visitors use. When set it is used for canonical / hreflang /
 *                   sitemap URLs and for the same-origin check on the form, so nothing depends on proxy headers.
 *                   Strongly recommended in production (the server prints a warning without it). Without it, the form still
 *                   works behind a proxy that rewrites the Host header: browsers mark same-origin requests (Sec-Fetch-Site).
 *   TRUST_PROXY     number of reverse proxies in front of this server (1 = one proxy). Only then are X-Forwarded-* headers
 *                   believed; the client IP is the entry the *nearest trusted proxy* appended, which a visitor cannot forge.
 */
const MAX_CACHE_ENTRIES = 300;
const RETENTION = { contact: 365, rsvpAfterEventDays: 30 }; // days; matches privacy.html

function proxyHops(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5) : 0;
}

function createServer(options) {
  const opts = Object.assign({
    dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
    basePath: (process.env.BASE_PATH || '').replace(/\/+$/, ''),
    publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, ''),
    proxyHops: proxyHops(process.env.TRUST_PROXY),
    log: process.env.LOG !== '0',
    rateLimit: { max: 20, windowMs: 10 * 60 * 1000 },
    now: () => Date.now() // the clock; tests replace it to check what happens before and after an event
  }, options);
  if (opts.trustProxy && !opts.proxyHops) opts.proxyHops = 1; // `trustProxy: true` is accepted as "one proxy"
  const MESSAGES = path.join(opts.dataDir, 'messages.jsonl');
  const hits = new Map(); // ip -> [timestamps]
  const cache = new Map(); // key -> compressed or rendered Buffer (bounded)
  function remember(key, value) {
    cache.set(key, value);
    // bounded: keys depend on the requested Host, so a client must not be able to grow the cache without limit
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  }

  /* ---------- helpers ---------- */
  const behindProxy = () => opts.proxyHops > 0;
  const firstOf = (v) => String(v || '').split(',')[0].trim();
  const HOST_OK = /^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9a-fA-F:]+\](:\d{1,5})?$/;
  // Public origin used for canonical / hreflang / sitemap URLs. The host is validated because it ends up inside HTML.
  function origin(req) {
    if (opts.publicOrigin) return opts.publicOrigin + opts.basePath;
    const fwdProto = behindProxy() ? firstOf(req.headers['x-forwarded-proto']).toLowerCase() : '';
    const proto = fwdProto === 'https' ? 'https' : 'http';
    const rawHost = firstOf((behindProxy() && req.headers['x-forwarded-host']) || req.headers.host || 'localhost');
    const host = HOST_OK.test(rawHost) ? rawHost : 'localhost';
    return proto + '://' + host + opts.basePath;
  }
  // With N trusted proxies, the client is the Nth entry from the right of X-Forwarded-For: the entries to its left were
  // supplied by the visitor and can be anything.
  function clientIp(req) {
    if (behindProxy() && req.headers['x-forwarded-for']) {
      const list = String(req.headers['x-forwarded-for']).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) return list[Math.max(0, list.length - opts.proxyHops)].slice(0, 64);
    }
    return req.socket.remoteAddress || 'unknown';
  }
  const isHttps = (req) => (opts.publicOrigin ? opts.publicOrigin.startsWith('https://') : behindProxy() && firstOf(req.headers['x-forwarded-proto']).toLowerCase() === 'https');
  function baseHeaders(req, extra) {
    const h = Object.assign({}, SECURITY_HEADERS, extra);
    if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
    return h;
  }
  // honours q-values: "br;q=0, gzip" means no brotli, "gzip;q=1, br;q=0.5" prefers gzip; brotli wins a tie
  function pickEncoding(header) {
    const q = Object.create(null);
    String(header || '').split(',').forEach((part) => {
      const m = /^\s*([a-z*-]+)\s*(?:;\s*q=([0-9.]+))?\s*$/i.exec(part);
      if (m) q[m[1].toLowerCase()] = m[2] === undefined ? 1 : parseFloat(m[2]);
    });
    const weight = (name) => { const v = q[name] !== undefined ? q[name] : q['*']; return v > 0 ? v : 0; };
    const br = weight('br'), gz = weight('gzip');
    if (!br && !gz) return null;
    return br >= gz ? 'br' : 'gzip';
  }
  // If-None-Match may list several tags or be "*"; weak and strong forms of the same tag match (RFC 9110, weak comparison)
  function etagMatches(header, etag) {
    if (!header) return false;
    const bare = (v) => v.trim().replace(/^W\//, '');
    return String(header).split(',').some((v) => v.trim() === '*' || bare(v) === bare(etag));
  }
  function sendJson(req, res, status, obj, extra) {
    const body = JSON.stringify(obj);
    res.writeHead(status, baseHeaders(req, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra)));
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  function sendBuffer(req, res, status, buf, type, extra) {
    const headers = baseHeaders(req, Object.assign({ 'Content-Type': type }, extra));
    const ext = (extra && extra['X-Ext']) || '';
    delete headers['X-Ext'];
    let out = buf;
    if (COMPRESSIBLE.has(ext) && buf.length > 512) {
      const enc = pickEncoding(req.headers['accept-encoding']);
      const key = (extra && extra.ETag && enc) ? 'z:' + extra.ETag + ':' + enc : null;
      if (enc) {
        const hit = key && cache.get(key);
        out = hit || (enc === 'br' ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.gzipSync(buf, { level: 6 }));
        if (key && !hit) remember(key, out);
        headers['Content-Encoding'] = enc;
      }
      headers.Vary = 'Accept-Encoding';
    }
    headers['Content-Length'] = out.length;
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : out);
  }
  function sendText(req, res, status, text) {
    sendBuffer(req, res, status, Buffer.from(text), 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  const publicPages = () => documents.publicPages(ROOT);

  function resolvePublicFile(pathname) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.some((p) => p.startsWith('.') || p.includes('\0'))) return null;
    if (parts.length === 1 && ROOT_FILE.test(parts[0]) && !PRIVATE_ROOT_FILES.has(parts[0])) return path.join(ROOT, parts[0]);
    if (parts.length === 2 && PUBLIC_DIRS.has(parts[0]) && PUBLIC_DIRS.get(parts[0]).test(parts[1])) return path.join(ROOT, parts[0], parts[1]);
    return null;
  }

  function serveFile(req, res, file, status) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound(req, res);
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const needsOrigin = PLACEHOLDER_TYPES.has(ext);
      const o = needsOrigin ? origin(req) : '';
      // ?lang=fr|mk|en on an HTML page returns that language already rendered (see server/render-lang.js)
      let lang = null;
      if (ext === '.html') {
        try { lang = new URL(req.url, 'http://localhost').searchParams.get('lang'); } catch (e) { lang = null; }
        if (LANGS.indexOf(lang) === -1) lang = null;
      }
      const i18nStamp = lang ? i18nVersion(ROOT) : '';
      const etag = 'W/"' + crypto.createHash('sha1').update(st.mtimeMs + ':' + st.size + ':' + o + ':' + (lang || '') + ':' + i18nStamp).digest('hex').slice(0, 20) + '"';
      const longCache = file.includes(path.sep + 'fonts' + path.sep) || file.includes(path.sep + 'images' + path.sep);
      // fonts and photos never change under the same name; styles and scripts are re-checked after 5 minutes (ETag => cheap 304);
      // pages are always revalidated
      const cacheControl = longCache ? 'public, max-age=31536000, immutable' : (ext === '.css' || ext === '.js') ? 'public, max-age=300' : 'no-cache';
      const extra = { ETag: etag, 'Last-Modified': st.mtime.toUTCString(), 'Cache-Control': cacheControl, 'X-Ext': ext };
      if (status === 404) { extra['Cache-Control'] = 'no-store'; delete extra.ETag; }
      if (status !== 404 && etagMatches(req.headers['if-none-match'], etag)) {
        const h304 = { ETag: etag, 'Cache-Control': extra['Cache-Control'] };
        if (COMPRESSIBLE.has(ext)) h304.Vary = 'Accept-Encoding'; // the 200 would have said so too
        res.writeHead(304, baseHeaders(req, h304));
        return res.end();
      }
      // a translated page is rendered once per version of the page, of the translations (i18n/) and of the address, then reused
      const renderedKey = status !== 404 && lang ? 'r:' + etag : null;
      const rendered = renderedKey && cache.get(renderedKey);
      if (rendered) return sendBuffer(req, res, status || 200, rendered, type, extra);
      fs.readFile(file, (e, data) => {
        if (e) return sendText(req, res, 500, 'Server error');
        let buf = data;
        if (needsOrigin) {
          let text = data.toString('utf8');
          if (lang) { try { text = renderLang(text, lang, loadI18n(ROOT)); } catch (err) { console.error('language rendering failed:', err.message); } }
          text = text.replace(/\{\{ORIGIN\}\}/g, o);
          // The 404 page is served at whatever URL was requested (/a/b/c), so make its relative links absolute
          if (status === 404 && ext === '.html') {
            const prefix = opts.basePath + '/';
            text = documents.absolutize404(text, prefix);
          }
          buf = Buffer.from(text);
          if (renderedKey) remember(renderedKey, buf);
        }
        sendBuffer(req, res, status || 200, buf, type, extra);
      });
    });
  }

  function notFound(req, res) {
    if (req.url && (req.url.startsWith('/api/') || /\.(json|xml)$/.test(req.url.split('?')[0]))) return sendJson(req, res, 404, { ok: false, error: 'Not found' });
    serveFile(req, res, path.join(ROOT, NOT_FOUND_PAGE), 404);
  }

  /* ---------- dynamic documents ---------- */
  const sitemap = (req) => documents.sitemap(ROOT, origin(req));

  /* ---------- form endpoint ---------- */
  function pruneHits() {
    const now = Date.now();
    for (const [k, v] of hits) if (!v.some((t) => now - t < opts.rateLimit.windowMs)) hits.delete(k);
  }
  function rateLimited(ip) {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < opts.rateLimit.windowMs);
    // refused attempts are not recorded: the list never holds more than `max` entries, and the window still ends on time
    const limited = list.length >= opts.rateLimit.max;
    if (!limited) list.push(now);
    hits.set(ip, list);
    if (hits.size > 5000) pruneHits(); // safety net; the timer below normally keeps the map small
    return limited;
  }
  // control characters and the line/paragraph separators U+2028/2029 (which would split a JSON Lines record in some tools)
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim().slice(0, max);
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  const FORMS = new Set(['contact', 'contact-form', 'rsvp-form', 'join-form', 'newsletter-form']);
  const LIMITS = { name: 200, email: 200, topic: 100, event: 100, message: 5000 };
  const GUESTS = { min: 1, max: 6 }; // the same limits as the form (events.html)
  // a one-time donation offered through the "Get involved" form: a preset amount, or another whole number of euros
  const DONATION_TOPIC = 'One-time donation';
  const AMOUNTS = ['10', '25', '50', '100']; // the same choices as the form (involved.html)
  const OTHER_AMOUNT = { min: 1, max: 10000 };
  const MIN_MESSAGE = 10;

  // Events come from events.html, the single source of truth: start and end of every event, and which ones can be booked
  // (those offered in the reservation form). Used to validate reservations and for retention. Re-read when the file changes.
  let eventsCache = { mtime: -1, data: null };
  function eventInfo() {
    const file = path.join(ROOT, 'events.html');
    let mtime;
    try { mtime = fs.statSync(file).mtimeMs; } catch (e) { return { start: new Map(), end: new Map(), reservable: new Set(), known: false }; }
    if (eventsCache.mtime === mtime) return eventsCache.data;
    const html = fs.readFileSync(file, 'utf8');
    const data = { start: new Map(), end: new Map(), reservable: new Set(), known: true }; // Maps: "constructor" or "__proto__" are just strings
    const re = /<article\b[^>]*>/g;
    let m;
    while ((m = re.exec(html))) {
      const id = /\sid="([^"]+)"/.exec(m[0]);
      const start = /\sdata-start="([^"]+)"/.exec(m[0]);
      const end = /\sdata-end="([^"]+)"/.exec(m[0]);
      if (!id || !start) continue;
      const s = Date.parse(start[1]);
      const e = end ? Date.parse(end[1]) : s;
      if (!isNaN(s)) data.start.set(id[1], s);
      if (!isNaN(e)) data.end.set(id[1], e);
    }
    const select = /<select[^>]*\sid="rsvp-event"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    if (select) {
      const opt = /<option[^>]*\svalue="([^"]+)"/g;
      while ((m = opt.exec(select[1]))) if (data.start.has(m[1])) data.reservable.add(m[1]);
    }
    eventsCache = { mtime, data };
    return data;
  }

  // Retention promised in privacy.html: contact messages 12 months; reservations 30 days after the event; newsletter and
  // membership enquiries until withdrawn. Run at start-up and once a day.
  function purgeMessages(now) {
    now = now || Date.now();
    let text;
    try { text = fs.readFileSync(MESSAGES, 'utf8'); } catch (e) { return 0; }
    const ends = eventInfo().end;
    const DAY = 86400000;
    let removed = 0;
    const kept = text.split('\n').filter((line) => {
      if (!line.trim()) return false;
      let m;
      try { m = JSON.parse(line); } catch (e) { return true; } // never destroy a line we cannot read
      const received = Date.parse(m.receivedAt) || now;
      let expired = false;
      if (m.form === 'contact-form' || m.form === 'contact') expired = now - received > RETENTION.contact * DAY;
      else if (m.form === 'rsvp-form') expired = now > (ends.get(m.event) || received) + RETENTION.rsvpAfterEventDays * DAY;
      if (expired) removed++;
      return !expired;
    });
    if (removed) {
      const tmp = MESSAGES + '.tmp';
      fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '', { mode: 0o600 });
      fs.renameSync(tmp, MESSAGES);
    }
    return removed;
  }

  function tooLarge(req, res) {
    // answer first, then close, so the client sees a 413 and not a connection reset
    res.shouldKeepAlive = false;
    sendJson(req, res, 413, { ok: false, error: 'Message too large', code: 'size' }, { Connection: 'close' });
    res.on('finish', () => req.destroy());
  }

  // Same-origin check. With PUBLIC_ORIGIN it is exact. Without it, the Host header is compared, and a request the browser
  // itself marks as same-origin (Sec-Fetch-Site, which a page cannot set) is accepted too: behind a proxy that rewrites Host
  // (nginx sends 127.0.0.1:3000 by default) the form keeps working instead of refusing every visitor.
  function sameOrigin(req) {
    const site = req.headers.origin;
    if (!site || site === 'null') return true; // not sent by every client; the JSON-only rule still blocks cross-site form posts
    try {
      const u = new URL(site);
      if (opts.publicOrigin) return u.origin === new URL(opts.publicOrigin).origin;
      if (u.host === req.headers.host || (behindProxy() && u.host === firstOf(req.headers['x-forwarded-host']))) return true;
    } catch (e) { return false; }
    return req.headers['sec-fetch-site'] === 'same-origin';
  }

  // the visitor's own data file must never lose a record because an earlier write was cut off half-way
  function appendRecord(record) {
    fs.mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
    let prefix = '';
    try {
      const fd = fs.openSync(MESSAGES, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        if (size > 0) {
          const last = Buffer.alloc(1);
          fs.readSync(fd, last, 0, 1, size - 1);
          if (last[0] !== 0x0a) prefix = '\n';
        }
      } finally { fs.closeSync(fd); }
    } catch (e) { /* no file yet */ }
    fs.appendFileSync(MESSAGES, prefix + JSON.stringify(record) + '\n', { mode: 0o600 });
  }

  // Every refusal names a code (and, for a field, the field) so the page can show the visitor the right message.
  function refuse(req, res, status, code, error, extra) {
    return sendJson(req, res, status, Object.assign({ ok: false, error, code }, extra));
  }

  function handleContact(req, res) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return refuse(req, res, 415, 'type', 'Send JSON (Content-Type: application/json)');
    if (!sameOrigin(req)) return refuse(req, res, 403, 'origin', 'Cross-site submissions are not accepted');
    if (rateLimited(clientIp(req))) return sendJson(req, res, 429, { ok: false, error: 'Too many submissions, please try again in a few minutes', code: 'rate' }, { 'Retry-After': '300' });
    const declared = parseInt(req.headers['content-length'], 10);
    if (declared > 20000) return tooLarge(req, res);
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > 20000) { aborted = true; tooLarge(req, res); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return refuse(req, res, 400, 'json', 'Invalid JSON'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return refuse(req, res, 400, 'json', 'Invalid payload');
      if (clean(data.website, 200)) return sendJson(req, res, 200, { ok: true }); // honeypot: pretend success, store nothing
      // fields must be text; refusing (rather than truncating) means the visitor is told when something was too long
      for (const field of Object.keys(LIMITS)) {
        const v = data[field];
        if (v == null || v === '') continue;
        if (typeof v !== 'string') return refuse(req, res, 400, 'invalid', 'Invalid ' + field, { field });
        if (v.trim().length > LIMITS[field]) return refuse(req, res, 400, 'too_long', field + ' is too long (maximum ' + LIMITS[field] + ' characters)', { field, max: LIMITS[field] });
      }
      const email = clean(data.email, LIMITS.email);
      if (!EMAIL.test(email)) return refuse(req, res, 400, 'email', 'Invalid email', { field: 'email' });
      const form = clean(data.form, 40) || 'contact';
      if (!FORMS.has(form)) return refuse(req, res, 400, 'form', 'Unknown form', { field: 'form' });
      const guests = clean(data.guests, 3);
      if (guests && !(/^\d{1,2}$/.test(guests) && +guests >= GUESTS.min && +guests <= GUESTS.max)) {
        return refuse(req, res, 400, 'range', 'Guests must be a whole number from ' + GUESTS.min + ' to ' + GUESTS.max, { field: 'guests', min: GUESTS.min, max: GUESTS.max });
      }
      const event = clean(data.event, LIMITS.event);
      if (form === 'rsvp-form') {
        const ev = eventInfo();
        if (!event) return refuse(req, res, 400, 'event', 'Choose an event', { field: 'event' });
        if (ev.known && !ev.reservable.has(event)) return refuse(req, res, 400, 'event', 'Unknown event, or one that cannot be booked', { field: 'event' });
        // bookings close when the event starts
        if (ev.known && opts.now() >= ev.start.get(event)) return refuse(req, res, 400, 'event_past', 'Bookings for this event have closed', { field: 'event' });
      }
      // the amount is only asked for (and only kept) when the visitor offers a one-time donation
      let amount = '';
      if (form === 'join-form' && clean(data.topic, LIMITS.topic) === DONATION_TOPIC) {
        const choice = clean(data.amount, 10);
        if (!choice) return refuse(req, res, 400, 'required', 'Choose an amount', { field: 'amount' });
        if (choice === 'other') {
          const other = clean(data.amount_other, 6);
          if (!(/^\d{1,5}$/.test(other) && +other >= OTHER_AMOUNT.min && +other <= OTHER_AMOUNT.max)) {
            return refuse(req, res, 400, 'range', 'The amount must be a whole number of euros from ' + OTHER_AMOUNT.min + ' to ' + OTHER_AMOUNT.max, { field: 'amount_other', min: OTHER_AMOUNT.min, max: OTHER_AMOUNT.max });
          }
          amount = String(+other);
        } else if (AMOUNTS.includes(choice)) amount = choice;
        else return refuse(req, res, 400, 'invalid', 'Unknown amount', { field: 'amount' });
      }
      const msg = {
        receivedAt: new Date(opts.now()).toISOString(), form, lang: ['en', 'fr', 'mk'].includes(data.lang) ? data.lang : 'en',
        name: clean(data.name, LIMITS.name), email, topic: clean(data.topic, LIMITS.topic), event, guests, amount, message: clean(data.message, LIMITS.message)
      };
      if (form === 'contact-form' || form === 'contact') {
        if (!msg.name) return refuse(req, res, 400, 'required', 'Name is required', { field: 'name' });
        if (msg.message.length < MIN_MESSAGE) return refuse(req, res, 400, 'minlength', 'Message is too short', { field: 'message', min: MIN_MESSAGE });
      }
      try {
        // owner-only: the file holds personal data (see privacy.html). Synchronous so that it can never interleave with the daily purge.
        appendRecord(msg);
      } catch (e) { return refuse(req, res, 500, 'save', 'Could not save your message'); }
      sendJson(req, res, 200, { ok: true });
    });
    req.on('error', () => { /* client went away */ });
  }

  /* ---------- request handler ---------- */
  const server = http.createServer((req, res) => {
    const started = Date.now();
    if (opts.log) res.on('finish', () => console.log(req.method + ' ' + req.url.split('?')[0] + ' ' + res.statusCode + ' ' + (Date.now() - started) + 'ms'));
    // "//about.html" would otherwise be read as a link to another host; repeated slashes are folded into one
    if (/^\/{2,}/.test(req.url)) {
      res.writeHead(301, baseHeaders(req, { Location: '/' + req.url.replace(/^\/+/, ''), 'Cache-Control': 'no-store', 'Content-Length': 0 }));
      return res.end();
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (e) { return notFound(req, res); }
    if (opts.basePath && pathname === opts.basePath) {
      // /vivant without the slash would load the page with its styles and scripts looked up outside /vivant/
      const search = req.url.indexOf('?') === -1 ? '' : req.url.slice(req.url.indexOf('?'));
      res.writeHead(301, baseHeaders(req, { Location: opts.basePath + '/' + search, 'Cache-Control': 'public, max-age=3600', 'Content-Length': 0 }));
      return res.end();
    }
    if (opts.basePath && pathname.startsWith(opts.basePath + '/')) pathname = pathname.slice(opts.basePath.length) || '/';

    if (pathname === '/api/contact') {
      if (req.method === 'POST') return handleContact(req, res);
      res.setHeader('Allow', 'POST');
      return sendJson(req, res, 405, { ok: false, error: 'Use POST' }, { Allow: 'POST' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendBuffer(req, res, 405, Buffer.from('Method not allowed'), 'text/plain; charset=utf-8', { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
    }
    if (pathname === '/health' || pathname === '/healthz') {
      // healthy only if messages can actually be saved
      try {
        fs.mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
        fs.accessSync(opts.dataDir, fs.constants.W_OK);
      } catch (e) { return sendText(req, res, 503, 'data directory is not writable'); }
      return sendText(req, res, 200, 'ok');
    }
    if (pathname === '/sitemap.xml') return sendBuffer(req, res, 200, Buffer.from(sitemap(req)), MIME['.xml'], { 'Cache-Control': 'no-cache', 'X-Ext': '.xml' });
    if (pathname === '/robots.txt') {
      return sendBuffer(req, res, 200, Buffer.from(documents.robots(origin(req))), MIME['.txt'], { 'Cache-Control': 'no-cache', 'X-Ext': '.txt' });
    }
    // /about/ and /events.html/ would load but with every relative link (CSS, scripts, pages) resolved one level too deep,
    // so send them to the canonical address instead
    if (/^\/[A-Za-z0-9._-]+\/$/.test(pathname)) {
      const search = new URL(req.url, 'http://localhost').search;
      res.writeHead(301, baseHeaders(req, { Location: opts.basePath + pathname.slice(0, -1) + search, 'Cache-Control': 'public, max-age=3600', 'Content-Length': 0 }));
      return res.end();
    }
    if (pathname === '/') pathname = '/index.html';
    else if (!path.extname(pathname) && /^\/[A-Za-z0-9_-]+$/.test(pathname)) pathname += '.html';
    if (pathname === '/feed.xml') { const f = path.join(ROOT, 'feed.xml'); if (fs.existsSync(f)) return serveAtom(req, res, f); }

    const file = resolvePublicFile(pathname);
    if (!file) return notFound(req, res);
    serveFile(req, res, file, 200);
  });

  function serveAtom(req, res, file) {
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) return notFound(req, res);
      const o = origin(req);
      const body = Buffer.from(data.replace(/\{\{ORIGIN\}\}/g, o));
      const etag = 'W/"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 20) + '"';
      if (etagMatches(req.headers['if-none-match'], etag)) { res.writeHead(304, baseHeaders(req, { ETag: etag, Vary: 'Accept-Encoding' })); return res.end(); }
      sendBuffer(req, res, 200, body, 'application/atom+xml; charset=utf-8', { ETag: etag, 'Cache-Control': 'no-cache', 'X-Ext': '.xml' });
    });
  }

  server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
  // housekeeping: forget old rate-limit entries (so an IP address is really kept only for the window) and apply the retention rules
  server.on('listening', () => {
    try { const n = purgeMessages(); if (n && opts.log) console.log('Retention: removed ' + n + ' expired message(s)'); } catch (e) { console.error('Retention purge failed:', e.message); }
    const timers = [
      setInterval(pruneHits, 60 * 1000),
      setInterval(() => { try { purgeMessages(); } catch (e) { console.error('Retention purge failed:', e.message); } }, 24 * 3600 * 1000)
    ];
    timers.forEach((t) => t.unref());
    server.on('close', () => timers.forEach(clearInterval));
  });
  server.purgeMessages = purgeMessages; // exposed for tests
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN) {
    console.warn('Warning: PUBLIC_ORIGIN is not set. Canonical and sitemap URLs will use the Host header the server receives ' +
      '(behind a proxy that may be 127.0.0.1). Set PUBLIC_ORIGIN=https://your-address.');
  }
  const server = createServer();
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log('Versailles Vivant listening on port ' + PORT));
  const stop = () => { console.log('Shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
