# Versailles Vivant

Presentation website for **Versailles Vivant**, a *fictional* member-supported association that looks after the gardens and tells the honest story of the Château de Versailles. Built for the course **Business Practice (Деловна пракса) 2025/2026**, FCSE/FINKI, Ss. Cyril and Methodius University, Skopje. Author: Dragana Niseva.

> The association, its people, events, figures and donations are invented for the assignment. The site says so on every page (footer) and in the FAQ. It has no connection with the Château de Versailles.

The site is plain HTML, CSS and JavaScript. It is normally served by a small Node.js server (which adds the form endpoint and server-side translation), and it can also be exported as a **static folder** for any web host (see "Static hosting" below). **There are no runtime dependencies**: nothing to `npm install` to run it.

## What is on the site

| Page | Purpose |
| --- | --- |
| `index.html` | Home: who we are and where the money went in 2025, our services (six linked cards), key figures, the three newest news posts (dated, linked), how to join |
| `about.html` | Origin story beside the association's milestones, governance, the formal details (legal form, registration, general assembly), the statutes and the 2025 annual report to download (PDF), the full team (a three-person teaser is on the home page) |
| `explore.html` | Six things worth knowing about the estate, with sources |
| `tour.html` | Five-stop photo tour: buttons, arrow keys and swiping; screen-reader friendly |
| `events.html` | Thirteen events from October 2026 to March 2027, including a Garden Saturday every month. Bookings close when an event starts (in the page and on the server); past events are marked and listed last. Type filter, "Add to calendar" (.ics), reservation form |
| `involved.html` | Membership tiers (each with a "Join" button that fills in the form), volunteering, one-time giving (preset amounts of €10, €25, €50, €100 or another amount) and how to give, sign-up form |
| `journal.html` | News & blog ("News" in the menu): eight dated posts, each with its author, category filter and an Atom feed (`feed.xml`, for feed reader apps; "Subscribe via Atom feed" opens a box with its address and a Copy button) |
| `analytics.html` | "Impact and transparency": figures, charts and the data tables behind them |
| `contact.html` | Contact form, address, email, phone, hours, click-to-load map |
| `faq.html` | 15 answers in four groups, including tax receipts for donations (with FAQ structured data) |
| `privacy.html` | Privacy and cookie policy, GDPR rights |
| `accessibility.html` | Accessibility statement (WCAG 2.2 AA target, limitations, how to report) |
| `404.html` | Custom not-found page with links back |

Other features:

* **Three languages everywhere.** The language switch is made of real links (`?lang=fr`), so crawlers can follow them; with JavaScript the page switches in place. A visitor who chose French or Macedonian earlier is taken straight to that language's address, so the address, the canonical link and the text always agree. The server renders `?lang=fr` and `?lang=mk` itself (title, `<html lang>`, canonical and `hreflang`, internal links, structured data, numbers written the local way: `75 400 €`, `75.400 €`), so crawlers and visitors without JavaScript stay in the chosen language. The static export contains pre-rendered `fr/` and `mk/` copies of every page.
* **Cookie notice.** A bar at the very top of the page, in the normal flow: it pushes the page down instead of covering it, and it is part of the first paint, so nothing jumps when the scripts load.
* **Structured data** (JSON-LD: `NGO`, `WebSite`, `BreadcrumbList`, `FAQPage`, `Event`, `Blog`), generated from the visible page by the build, so the two can never disagree.
* **"Support us"** in the header (a gilt button) leads to membership, volunteering and giving.
* `sitemap.xml` (every page in every language) and `robots.txt` generated for whatever host the site runs on, security headers, gzip/Brotli, ETags, `favicon.ico` and an Apple touch icon, and fonts hosted on the site itself. Each page loads only the texts it needs (`i18n/common.js` and its own file, about 50 KB at most before compression).

`docs/REQUIREMENTS.md` maps every line of the course brief to the page that satisfies it. `docs/PRESENTATION.md` is an 8-minute walkthrough for the oral presentation, with answers to likely questions.

## Run it

```bash
node server.js          # http://localhost:3000   (Node.js 18 or newer)
npm test                # 65 automated checks (content, server, static build)
npm run build           # regenerate shared header/footer/head, English text and feed.xml
npm run build:static -- --origin https://example.org   # export for plain web hosting into dist/
npm run a11y            # browser check: axe-core + layout on every page, language and width (needs qa/ setup, see below)
npm run pdfs            # print the statutes and the annual report (scripts/pdf/*.html) to downloads/ (needs qa/ setup)
```

Environment variables (all optional):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / all interfaces | Where to listen |
| `DATA_DIR` | `./data` | Where submitted forms are stored (`messages.jsonl`, one JSON object per line, readable only by the server's user) |
| `PUBLIC_ORIGIN` | *(from the request)* | The address visitors use, e.g. `https://vv.example.org`. **Set it in production** (the server prints a warning at start-up without it): canonical links, the sitemap and the same-origin check on the form then never depend on request headers. Without it, the form still works behind a proxy that rewrites the `Host` header, because browsers mark same-origin requests themselves (`Sec-Fetch-Site`) |
| `BASE_PATH` | *(empty)* | Set to `/something` if the site is published under a sub-path |
| `TRUST_PROXY` | `0` | **Number** of reverse proxies in front of the server (`1` for one). Only then are `X-Forwarded-*` headers believed, and the visitor's address is taken that many entries from the right of `X-Forwarded-For`, so the rate limit cannot be dodged by forging the header |
| `LOG` | on | Set to `0` to silence the request log |

Forms post JSON to `/api/contact`. The browser and the server apply the same rules (the same e-mail pattern, 1 to 6 guests, minimum message length, and for a one-time donation an amount of €10, €25, €50 or €100, or another whole number of euros from 1 to 10,000). The server checks the form name, the fields and their length, refuses reservations for an event that has started or cannot be booked, applies a rate limit per visitor, and stores the message. Every refusal carries a code and the field concerned, and the page shows the matching message next to that field, in the visitor's language. Where there is no form service (a static host, or a server answering 404/405), the form hands the message to the visitor's e-mail app, ready to send; if the server fails, the visitor gets an error with a pre-filled `mailto:` link. A message is never silently lost.

Stored messages follow the retention promised on `privacy.html`: contact messages are deleted after 12 months, event reservations 30 days after the event. The server applies this when it starts and once a day. `/health` answers `503` if the data folder cannot be written.

## Docker

```bash
docker compose up --build        # http://localhost:3000
```

The image runs as the unprivileged `node` user, keeps messages in the `messages` volume and has a health check on `/health`. `docker-compose.yml` also drops all capabilities and mounts the file system read-only.

## Deploy on the FCSE system

The hosting type on the FCSE system was not known when this was written. Pick the matching route:

**A. The system runs containers or Node.js** (preferred: forms work and `?lang=fr|mk` is rendered on the server)

1. Copy the repository to the server and start it with `docker compose up -d --build` (or `node server.js`).
2. Set `PUBLIC_ORIGIN` to the public address (and `TRUST_PROXY=1` if one reverse proxy sits in front; `BASE_PATH` if the site lives under a path, for example `/vivant`: the bare `/vivant` then redirects to `/vivant/`).
3. Open `/health` (should say `ok`), `/sitemap.xml` and a page with `?lang=mk` to confirm, and send one test message through the contact form.

**B. The system only serves files** (Apache, nginx, a university web space, GitHub Pages)

1. Run `npm run build:static -- --origin https://the-public-address [--base /sub/path]`.
2. Upload the contents of `dist/` (not the repository itself: its pages contain `{{ORIGIN}}` placeholders that only the build fills in).

**C. In both cases:** submit the public link on Courses.

## Static hosting: what changes

`scripts/build-static.js` copies the pages, styles, scripts, fonts, icons and feed into `dist/`, writes the real address into canonical / `hreflang` / structured data / feed, and generates:

* `fr/` and `mk/`: every page already translated (for example `fr/about.html`), so visitors and crawlers without JavaScript get real French and Macedonian documents. The language links, canonical, `hreflang` and the sitemap point to these files.
* `sitemap.xml`, `robots.txt`
* `.htaccess` for Apache (security headers, the 404 page, compression, caching), `_headers` for Netlify/Cloudflare Pages, `.nojekyll` for GitHub Pages

Differences from the Node server:

* There is no `/api/contact`. The forms hand the message to the visitor's e-mail app, ready to send, with a neutral note (this is the normal path there, not an error).
* Security headers must be set by the host (`.htaccess` or `_headers` where supported); without them the site still works.
* No automatic redirects (for example from `/about/`) and no compression unless the host provides it.

## Editing content

* **Text** lives in `i18n/`: `common.js` for what every page shares (menu, footer, cookie notice, forms) and one file per page (`i18n/about.js` …), each once per language. A page loads only `common.js` and its own file. Pages contain elements such as `<h2 data-i18n="g_h2">`; the English text inside them is written by the build, and `script.js` (browser) or `server/render-lang.js` (server) swaps in French or Macedonian.
* **Header, footer, `<head>` and scripts** are shared: edit `partials/*.html`, then `npm run build`.
* After editing, run `npm test`. It fails if a translation key is missing in any language, a link or `#anchor` is broken, a Macedonian word mixes Latin and Cyrillic letters, an inline script sneaks in, or a shared region is out of date.

## Privacy and cookies

The site sets **no cookies**. It stores two items in the browser's `localStorage`: `vv_language` (your language) and `vv_consent` (your answer to the notice, for 12 months). The OpenStreetMap map on the Contact page loads only after the visitor clicks "Load interactive map" or chose "Accept" in the cookie notice. Fonts are hosted here (no Google Fonts). Visitor IP addresses are used only for the rate limit and are forgotten after ten minutes. Details are on `privacy.html`.

## Checking accessibility and layout

`qa/a11y.js` opens every page in English, French and Macedonian at 320, 390, 768 and 1280 px as a first-time visitor (cookie notice showing), then the server-rendered `?lang=fr` / `?lang=mk` addresses, then every page with animations switched on. It reports any axe-core violation (WCAG 2.0 to 2.2 A/AA and best practices), horizontal scrolling, wrong `<html lang>`, a page heading that is not fully visible at load, script errors, failed requests to the site, and a header that wraps onto a second row on desktop. The last full run (221 page views, 17 October 2026) found no problems.

```bash
cd qa && npm install && cd ..       # once: installs playwright-core and axe-core into qa/node_modules
CHROME_PATH=/path/to/chrome npm run a11y     # CHROME_PATH is optional if Playwright's own Chromium is installed
```

It starts its own copy of the server; set `BASE=https://...` to check a deployed copy, or `WIDTHS=320,1280 LANGS=fr` to narrow the matrix. The exit code is 1 when anything is found.

## Maintenance

* **Photographs.** Every photo is stored in `images/` and served by the site itself (the Content-Security-Policy allows images from this site only). To add a photo from Unsplash, Flickr or Wikimedia, put its address in the page and run `npm run localize-images` on a machine with internet access: it copies the photo into `images/`, points the page at the copy and rebuilds. Commit `images/` and the changed files.
* **Events.** The sample events end on 20 March 2027; after that each one shows as "Past". To add one: a card in `events.html` (and an `<option>` in the reservation form if it can be booked), the `event<n>_*` keys in `i18n/events.js` in all three languages, then `npm run build`.
* **Statutes and annual report.** Edit `scripts/pdf/statutes.html` or `scripts/pdf/annual-report-2025.html`, then `npm run pdfs` and commit `downloads/`. A test checks that the report's figures match the Impact page.
* **E-mail address.** `hello@versaillesvivant.example` uses `.example`, a domain reserved for documentation (RFC 2606), because the association is fictional: no real person's inbox can receive the site's messages by mistake.

## Project layout

```
server.js               HTTP server: static files, ?lang= rendering, sitemap, robots, feed, /api/contact
server/render-lang.js   Server-side language rendering shared with the build
server/documents.js     Sitemap, robots.txt, security headers (used by the server and by the static build)
i18n/                   All text in English, French and Macedonian: common.js plus one file per page
lang-init.js            Tiny blocking script: sends a returning visitor to the address of their language (no flash of
                        English), and makes the cookie notice part of the first paint
script.js               Language switch, consent notice, forms, small enhancements
pages.js                Events, journal, tour and map behaviour
charts.js               SVG charts built from the data tables on the Impact page
partials/               Shared <head>, header (with the cookie notice), footer and script tags
scripts/                build-pages.js (shared regions, English text, structured data, feed; --check),
                        build-static.js (export with pre-rendered fr/ and mk/), localize-images.js,
                        build-pdfs.js with the documents' HTML in scripts/pdf/
downloads/              The statutes and the 2025 annual report (PDF)
qa/                     Browser accessibility/layout check (own package.json; node_modules not committed)
fonts/                  Self-hosted Work Sans, Cormorant Garamond, Inter (Cyrillic); licences included
test/                   node:test suites (content, server, static build)
docs/                   Requirements traceability, how the site works, presentation outline
```

## Credits

Photographs: Unsplash (Unsplash Licence) and Flickr (Jean-Pierre Dalbéra, CC BY 2.0); a credit line with a link to the licence sits under each photo. Fonts: Work Sans, Cormorant Garamond and Inter, all under the SIL Open Font License (see `fonts/LICENSE-*.txt`). Map: © OpenStreetMap contributors. Historical claims on the Explore page and in the Journal are checked against the sources listed there.
