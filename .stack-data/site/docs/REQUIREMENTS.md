# Course brief → where it is satisfied

Source: *Business Practice 2025/2026 — Terms, Rights and Obligations*. The assignment is a website for a small business or organisation that "should contain all elements of a presentation website for the selected entity", deployed on the FCSE system, submitted as a link, and assessed by the teacher (50), classmates (30), the student's own reviews (10) and an automated agent that checks all pages and elements (10).

Chosen entity: **Versailles Vivant**, a fictional member-supported association (NGO) for garden stewardship and public education around the Château de Versailles. Author: Dragana Niseva.

## Elements named in the brief

| Brief | Where | Notes |
| --- | --- | --- |
| Basic information | `index.html`, `about.html` | Mission, origin story (2016), governance, key figures; on About, the association's formal details: legal form (*association loi 1901*), registration number (a marked placeholder), general assembly, the statutes and the 2025 annual report as downloadable PDFs, milestones 2016–2026, seat |
| Team / employees | `about.html#team` (six people), `index.html#team-teaser` (first three, linking to the full team) | Roles and short bios; a note says who is staff and who sits on the board, and that the people are fictional |
| Services | `index.html#services` ("Our services": six linked cards), "Support us" button in the header, `involved.html` (membership tiers €9/€16/€40 with "Join" buttons, volunteering, one-time giving with preset amounts), `events.html`, `tour.html` | For an association the services are membership, volunteering, talks and events, the guide to the estate, the virtual tour and donations; the word "services" is on the home page in all three languages |
| Contact form | `contact.html` `#contact-form` | Inline validation with the same rules as the server, error summary, the server's own field errors shown next to the field, POST `/api/contact` with honeypot, size limit and rate limit; hands over to e-mail where there is no form service |
| Contact information | `contact.html`, footer on every page, JSON-LD `NGO` on the home page | Address, e-mail, phone, opening hours, map that loads only on request; a note says the details belong to a fictional association |
| News / blog | `journal.html` ("News" in the menu, "News & blog" on the page), `feed.xml`, latest news on the home page | Eight dated posts (newest 2 October 2026), each with its author, category filter, Atom feed linked from every page, `Blog` structured data; the home page shows the three newest posts, dated and linked |
| Multilingual support | Language switch on every page (in the menu, and in the top bar on tablets) | English, French, Macedonian, key-for-key (a test fails on a missing key or a mixed Latin/Cyrillic word). The switch is made of links a crawler can follow. `?lang=` addresses are rendered on the server (real `<html lang>`, title, meta, canonical + `hreflang`, internal links that keep the language, structured data and numbers in the page language); the static export has pre-rendered `fr/` and `mk/` pages |
| Cookies | Notice bar at the top of the page on the first visit, in the normal flow (it pushes the page down, never covers it, and is part of the first paint), "Manage cookie preferences" in the footer, `privacy.html#cookies` | The site sets no cookies; the two `localStorage` items are listed; optional third-party content (the map) is opt-in |
| Detailed information | `explore.html`, `faq.html`, `analytics.html`, `privacy.html`, `accessibility.html` | History with cited sources (including the 2007 Hall of Mirrors restoration figures), 15 FAQs (including tax receipts for donations), figures with data tables, legal and accessibility statements |
| Elements specific to the entity | `events.html` (thirteen events October 2026 – March 2027 with a Garden Saturday every month, an icon per kind of event, calendar download, reservations that close when an event starts, past events listed last), `analytics.html` (transparency report with accessible charts), the annual report and statutes (`downloads/`), `involved.html#give` (how to give, preset amounts), `tour.html` | What a nonprofit is expected to show: how money is spent, how to join, how to give, what happens next |

## What the automated agent can check

| Check | Evidence |
| --- | --- |
| Every page loads, no broken internal links or anchors | `npm test` ("every page answers 200", "internal links and #fragments resolve") |
| Title, description, one `h1`, landmarks, skip link on every page | `npm test` |
| No script errors, no failed requests to the site, no horizontal scrolling, correct `<html lang>`, heading visible at load, header on one row on desktop | `npm run a11y` (13 pages × 3 languages × 320, 390, 768 and 1280 px, plus the server-rendered `?lang=` pages and a pass with animations on) |
| Accessibility (axe-core, WCAG 2.0–2.2 A/AA + best practice) | `npm run a11y`: 221 page views, no axe violations (an automated tool finds only part of the possible issues; what has and has not been tested is stated in `accessibility.html`) |
| Forms: labels, validation, error messages, success state | `npm test`, `npm run a11y` |
| SEO: sitemap (every page in every language), robots, canonical, `hreflang`, Open Graph, JSON-LD (`NGO`, `WebSite`, `BreadcrumbList`, `FAQPage`, `Event`, `Blog`) generated from the visible page | `npm test`, `/sitemap.xml`, `/robots.txt` |
| Security headers (CSP without `unsafe-inline` scripts, HSTS behind HTTPS, `nosniff`, frame and referrer policies); rate limit that cannot be dodged with a forged `X-Forwarded-For`; reservations refused for past or unknown events; messages stored with owner-only permissions and deleted on the schedule the privacy page states | `npm test` |
| Performance: compression, ETags, immutable font caching, no render-blocking third-party requests, no layout shift from the cookie notice, each page loading only its own texts | `npm test`; fonts are hosted locally |
| Privacy: no cookies, no trackers, consent for third-party content | `npm test`, `privacy.html` |

## Honest limits

* Hosting on the FCSE system was not known when this was written. The site runs either as a Node/Docker service or as a static export (`npm run build:static`, with pre-rendered French and Macedonian pages); on a static host the forms hand the message to the visitor's e-mail app (see `README.md`).
* The Docker image was not built (no Docker daemon and no access to Docker Hub where the site was prepared); instead the `Dockerfile` passes the hadolint linter, `docker-compose.yml` validates with `docker compose config`, and the server was started from exactly the files the image copies. A dynamic security scan (HawkScan) could not be run either; the server was tested with its own automated tests and manual probes instead (path traversal, forged headers, hostile `Host`, oversized bodies, trailing and double slashes).
* All sample events end on 20 March 2027; after that they are shown as "Past" until new ones are added.
* The organisation is fictional and the site says so; payments are not processed and replies to forms are simulated.
* Photographs come from Unsplash and Flickr and are stored on the site (`images/`, copied with `scripts/localize-images.js`); a credit line sits under each photo, and visitors' browsers contact no photo library.
* French and Macedonian have not been proofread by a professional translator (stated in the accessibility statement).
* No test with a real screen reader, Safari or Firefox was possible where the site was prepared.
