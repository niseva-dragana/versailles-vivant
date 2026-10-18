# How the site works

A walk through the parts people ask about: the server, the three languages, the forms and the security headers. Each section says where the code is, so you can open it while explaining.

## 1. The big picture

The site is plain HTML, CSS and JavaScript. There is no framework and nothing to install. One small Node.js program (`server.js`) serves the files and adds what a plain file host cannot: the contact form endpoint, pages already translated on the server, and a sitemap for the address it runs on.

```
browser ──> server.js ──> HTML page (English source)
                │            └─ ?lang=fr|mk → translated before sending (server/render-lang.js)
                ├─ /api/contact → checks the form, stores it in data/messages.jsonl
                ├─ /sitemap.xml, /robots.txt, /feed.xml → generated for this address
                └─ every answer carries the security headers (server/documents.js)
```

Without Node, `npm run build:static` exports the same site as plain files (section 6).

## 2. The server (`server.js`)

`createServer()` builds an ordinary `http.createServer` handler. For each request, in order:

1. **Addresses are cleaned.** `//about.html` is folded to `/about.html`. `/about/` redirects to `/about`. With `BASE_PATH=/vivant`, the bare `/vivant` redirects to `/vivant/`.
2. **`/api/contact`** goes to `handleContact()` (section 4). Anything other than GET or HEAD elsewhere gets `405`.
3. **`/health`** says `ok` only if the data folder can be written. Docker uses it.
4. **Generated documents:** `/sitemap.xml` and `/robots.txt` come from `server/documents.js`, `/feed.xml` from the file the build writes.
5. **Files.** `resolvePublicFile()` serves only an allow-list: page, style and script files at the top level, plus `fonts/` (`.woff2`), `images/`, `i18n/` (`.js`, the translations) and `downloads/` (`.pdf`). `server.js`, `package.json`, dot-files, `data/` and anything with `..` are refused with the styled 404 page. That is why nobody can download the source or the stored messages.
6. **`serveFile()`** fills in `{{ORIGIN}}` (the site's own address, for canonical and sitemap links), translates the page if `?lang=` asks for it, compresses it (Brotli or gzip, whichever the browser prefers) and sends an `ETag`, so an unchanged file costs a tiny `304` the next time.

`PUBLIC_ORIGIN` tells the server its real address. Without it, the address comes from the request's `Host` header, which is checked against a strict pattern so it cannot inject markup.

## 3. Three languages (`i18n/`, `server/render-lang.js`, `script.js`)

All text lives once per language in `i18n/`: `common.js` holds what every page shares (menu, footer, cookie notice, form messages) and each page has its own file (`i18n/about.js` …). A page loads only `common.js` and its own file, so no page downloads the texts of the twelve others. The HTML carries the English text plus a key:

```html
<h2 data-i18n="mission_h2">Not the Château. Not a tour company either.</h2>
```

That key is used in three places:

* **Build** (`npm run build`, `scripts/build-pages.js`) writes the English text into every page, so the HTML files are always complete English documents.
* **Browser** (`script.js`, `applyLanguage`): the EN / FR / MK links swap every `data-i18n` text, translated attributes (`alt`, `aria-label`, `placeholder`), the page title and the numbers. The choice is remembered (`localStorage`, key `vv_language`). `lang-init.js` runs before the page is painted: a returning French visitor who opens a plain address (`about.html`) is sent straight to `about.html?lang=fr` (or `fr/about.html` in the static export), so the address, the canonical link and the text always agree and there is no flash of English.
* **Server** (`renderLang`): for `about.html?lang=mk` the server does the same swap before sending the page. It also sets `<html lang="mk">`, the canonical and `hreflang` links, links to other pages (`contact.html?lang=mk`), the structured data and the number format (`75.400 €`). A search engine or a browser without JavaScript therefore gets a real Macedonian page.

Browser and server use the same dictionary and the same rules, so their output is identical.

A test fails if any key is missing in a language, or if a Macedonian word mixes Latin and Cyrillic letters.

## 4. Forms (`script.js` and `handleContact` in `server.js`)

In the browser, each form is checked before sending: required fields, e-mail pattern, 1–6 guests, message length. Errors appear next to the fields, and a summary at the top lists them, each linking to its field. The message is then sent as JSON to `/api/contact`.

The server checks everything again, because a browser check can be skipped:

* JSON only. A cross-site page cannot send JSON without the browser's permission check, which this server never grants.
* The same-origin check (`Origin`, or the browser's `Sec-Fetch-Site`).
* A rate limit: 20 messages per 10 minutes per address. It counts the real address even behind a proxy (`TRUST_PROXY`) and cannot be dodged with a forged `X-Forwarded-For` header.
* A 20 KB size limit, answered with `413`.
* A hidden "honeypot" field. Bots fill it in; they are told "ok" and nothing is stored.
* Field rules. A reservation is refused if the event is unknown, cannot be booked, or has already started. A one-time donation must name an amount: €10, €25, €50, €100, or another whole number of euros from 1 to 10,000.

Each refusal returns a `code` and the `field`, and the page shows the matching message next to that field, in the visitor's language. Accepted messages are appended to `data/messages.jsonl`, a file only the server's user can read. They are deleted on the schedule the privacy page promises: contact messages after 12 months, reservations 30 days after the event.

## 5. Security headers (`server/documents.js`)

Every response carries:

| Header | What it does |
| --- | --- |
| `Content-Security-Policy` | The browser may run scripts only from this site, never inline. Images may come only from this site (the photos are stored in `images/`). The map may load only from openstreetmap.org, and forms may post only here or to `mailto:`. An injected `<script>` would simply not run. |
| `X-Content-Type-Options: nosniff` | The browser must trust the declared file type, so a text file cannot be run as a script. |
| `X-Frame-Options: DENY`, `frame-ancestors 'none'` | No other site can show these pages in a frame (protects against clickjacking). |
| `Referrer-Policy: strict-origin-when-cross-origin` | Other sites see only the domain a visitor came from, not the full address. |
| `Permissions-Policy` | Camera, microphone, location and payment are switched off. |
| `Cross-Origin-Opener-Policy: same-origin` | A page opened from here cannot control this window. |
| `Strict-Transport-Security` | Sent only over HTTPS: the browser must use HTTPS from then on. |

The static export writes the same headers to `.htaccess` (Apache) and `_headers` (Netlify / Cloudflare Pages).

## 6. Static export (`scripts/build-static.js`)

`npm run build:static -- --origin https://address` writes `dist/`. It contains the English pages, translated copies in `dist/fr/` and `dist/mk/`, the sitemap and robots file, `.htaccess` and `_headers`. A static host has no `/api/contact`, so the forms hand the finished message to the visitor's own e-mail app instead.

## 7. How it is checked

* `npm test` runs 65 checks. They cover the content (every key in every language, links, one `h1` per page, structured data matching the page), the real server on a random port (headers, refused files, forms, reservations, caching, languages) and the static export.
* `npm run a11y` runs axe-core accessibility checks in a real browser: every page, in every language, at four screen widths, plus a pass with animations switched on.
