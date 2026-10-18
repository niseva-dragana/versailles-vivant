# Presenting the project (8 minutes, in a 10-minute slot)

Eight minutes of demonstration leave two for questions. Read `docs/HOW-IT-WORKS.md` beforehand: it explains the server, the languages, the forms and the security headers in the order people ask about them. The plan follows the order of the course brief, so the teacher can tick off each element as you show it. Times are cumulative. Rehearse once with a timer; if you are running late, shorten step 9.

**Before the presentation**

- [ ] Open these tabs in this order: home, about, involved, events, journal, contact, `about.html?lang=mk` (view source), privacy, explore, tour, faq, analytics.
- [ ] Clear the site's data in the browser once (DevTools → Application → Clear site data) so the cookie notice shows on the home page.
- [ ] Take a screenshot of the contact page with the map loaded, on a machine with internet access, in case the room has none (the map is the only thing that comes from another site; the photos are on the site).
- [ ] Run `npm test` and `npm run a11y` the day before and keep a screenshot of each result. Do not run them live (the accessibility run takes about four minutes).
- [ ] Check the events: bookings close when an event starts and past events move to the end of the list. On the day, pick an upcoming event to book.

**The plan**

0. **Opening (0:00–0:20).** "Versailles Vivant is a fictional member-supported association around Versailles. The brief asks for every element of a presentation site; I will show them in the order of the brief."
1. **Basic information and team (0:20–1:20).** Home: mission beside where the money went in 2025, key figures (readable at once, no animation to wait for). About: the milestones, the formal details (legal form, registration number marked as a placeholder, general assembly), open the annual report PDF for a second, then the team and the note on who is staff and who is on the board.
2. **Services (1:20–2:20).** Home, "Our services": six cards, each one a link (the arrow says so). "Support us" in the header leads to Get involved: press "Join as a family" (the form is filled in), then "Make a one-time gift" (the amounts appear). Mention the FAQ answer on tax receipts (66% reduction in France).
3. **Contact form and contact information (2:20–3:10).** Send the contact form empty: the error summary lists the fields and each link jumps to its field. Type `ana@gmail` as the e-mail: the browser refuses it with the same rule as the server. Show the address, phone, hours, and the map that loads only when asked.
4. **News / blog (3:10–3:40).** News page: eight dated posts with their authors, category filter; "Subscribe via Atom feed" opens a box with the feed address and a Copy button (the `feed.xml` file itself is for feed reader apps); the home page shows the three newest.
5. **Languages (3:40–4:40).** Switch EN → FR → MK with the switch at the top. Then the `about.html?lang=mk` tab with View Source: the server sends a real Macedonian document (`<html lang="mk">`, title, canonical, `hreflang`), so search engines see each language. On the Impact page in Macedonian, the amounts read `75.400 €`.
6. **Cookies and privacy (4:40–5:10).** The notice is a bar at the top with "Accept" and "Decline": it pushes the page down and never covers anything. DevTools → Application: no cookies, two `localStorage` items. "Manage cookie preferences" in the footer reopens it.
7. **Detailed information (5:10–6:10).** Explore: six short sections with their sources. Tour: arrow keys (on a phone, swipe). FAQ. Impact: the charts are drawn from the tables underneath, so the numbers exist once and are readable without JavaScript.
8. **Specific to an association: events (6:10–7:10).** Thirteen events with a Garden Saturday every month; filter by type; "Add to calendar" downloads an `.ics` file; "Reserve a place" preselects the event. Past events are marked, moved to the end, and cannot be booked (the server refuses them too).
9. **Quality (7:10–7:45).** Show the two screenshots: `npm test` (65 checks) and `npm run a11y` (221 page views, no violations). One sentence on what was not tested: real screen readers, Safari and Firefox, a native proofread of French and Macedonian.
10. **Close (7:45–8:00).** "Next steps if the association were real: native proofreading, a real payment provider for donations, and photos of our own events."

## Likely questions, and short answers

1. **Is the organisation real?** No, and the site says so in the footer of every page, the FAQ and the privacy policy. A fictional association let me show everything a nonprofit site needs (membership, donations, transparency) without misrepresenting a real one.
2. **What are the "services" of an association?** Membership, volunteering, talks and events, the guide to the estate, the virtual tour and donations: the six cards under "Our services" on the home page, each leading to its page.
3. **How do the three languages stay in sync?** All text is in `i18n/`, once per language: `common.js` for what every page shares and one file per page, so a page downloads only its own texts. A test fails if any key is missing in a language, or if a Macedonian word mixes Latin and Cyrillic letters.
4. **What does a search engine see?** For `?lang=fr` or `?lang=mk` the server sends the page already translated, with `hreflang` links between the versions and a sitemap that lists every page in every language. On a static host, the export contains translated copies in `fr/` and `mk/`.
5. **Why a cookie notice if the site sets no cookies?** Because the optional map loads from openstreetmap.org, which receives the visitor's address; the notice asks before that happens. The two `localStorage` items are preferences the visitor sets, which the ePrivacy rules treat as strictly necessary.
6. **What happens to the data sent through the forms?** It is stored in a file only the server's user can read, and deleted automatically: contact messages after 12 months, reservations 30 days after the event. Nothing is sold or shared. The privacy page lists the legal basis and the visitor's rights.
7. **What if the faculty server only serves files?** `npm run build:static` exports the site with pre-rendered French and Macedonian pages; the forms then open the visitor's e-mail app with the message ready, instead of posting to a server that does not exist there.
8. **How did you test accessibility?** axe-core on every page, in three languages, at four widths, with animations on and off (221 page views, no violations), plus scripted keyboard tests. Automated tools find only part of the problems, so the accessibility statement says what was not tested.
9. **Where do the figures come from?** They are invented but consistent: the totals on the Impact page add up, and the same numbers appear on every page and in every language (the tests compare them).
10. **Why Node without a framework?** The site is small; with no dependencies there is nothing to update or exploit, and it runs on any server with Node 18, in Docker, or as plain files.
11. **What did you do about security?** A strict Content-Security-Policy (no inline scripts), security headers, a JSON-only form API with a size limit, a rate limit that a forged header cannot dodge, a honeypot for bots, same-origin checks, and no cookies.
12. **Did you use AI tools?** Be ready to answer this honestly and specifically: which parts you wrote, which parts an assistant helped with, and how you checked the result. Know the code well enough to explain any part of it.
13. **Is the board elected every year?** Yes: seven unpaid seats, elected at the general assembly each March (About page, and articles 10–11 of the statutes).
14. **Where does the story of the 1793 inventories come from?** From the Château de Versailles' own page "Versailles after the French Revolution", linked at the end of the post.
15. **Why does the e-mail address end in `.example`?** The association is fictional. `.example` is a domain reserved for documentation (RFC 2606), so it can never belong to anyone and no real person receives the site's messages by mistake. With a real association, it would be the association's own address.
