/*
 * Versailles Vivant — page behaviours
 * ---------------------------------------------------------------
 * Loaded after script.js (which provides translations, the consent notice and the forms) on every page.
 * Each block below switches itself on only when its markup is present:
 *   Events   : type filter, "Add to calendar" (.ics), past events (badge, listed last, no longer bookable),
 *              reserve links that preselect the event
 *   Journal  : category filter
 *   Tour     : accessible slider (buttons, dots, arrow keys, swiping, live status)
 *   Contact  : OpenStreetMap map that loads only on request or if the visitor allowed optional content
 *   Involved : "Join" buttons on the membership tiers preselect the tier in the form; preset amounts for a donation
 * No external libraries.
 */
(function () {
  'use strict';

  var VV = window.VV || {
    t: function (k) { return k; }, consent: function () { return null; }, lang: function () { return 'en'; }
  };
  var t = function (key, vars) { return VV.t(key, vars); };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function reduceMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function onLang(fn) { document.addEventListener('vv:langchange', fn); }

  /* ---------- a filter bar that shows/hides items and reports the count ---------- */
  function initFilter(opts) {
    var bar = $(opts.bar);
    var items = $$(opts.items);
    var status = $(opts.status);
    if (!bar || !items.length) return;
    var buttons = $$('[data-filter]', bar);
    var current = 'all';

    function report() {
      if (!status) return;
      var n = items.filter(function (el) { return !el.hidden; }).length;
      var key = status.getAttribute('data-count-key') || 'shown_count';
      // one item reads "1 event shown", not "1 events shown" (the singular string is optional per language)
      if (n === 1 && t(key + '_one') !== key + '_one') key += '_one';
      status.textContent = t(key, { n: n });
    }
    function apply(value) {
      current = value;
      items.forEach(function (el) { el.hidden = !(value === 'all' || el.getAttribute(opts.attr) === value); });
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-filter') === value ? 'true' : 'false'); });
      report();
    }
    buttons.forEach(function (b) { b.addEventListener('click', function () { apply(b.getAttribute('data-filter')); }); });
    onLang(report);
    apply(current);

    // a link such as journal.html#members-morning must still land on its target
    window.addEventListener('hashchange', function () { revealHash(); });
    function revealHash() {
      var id = window.location.hash.slice(1);
      var target = id && document.getElementById(id);
      var host = target && items.filter(function (el) { return el === target || el.contains(target); })[0];
      if (host && host.hidden) apply('all');
    }
    revealHash();
  }

  /* ---------- Events ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function icsDate(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  /* lines longer than 75 octets are folded, as RFC 5545 requires; octets, not characters, so that accented and Cyrillic
     text (two bytes per letter in UTF-8) is folded in the right place and a letter is never cut in half */
  function octets(ch) { var c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  function fold(line) {
    var out = [], cur = '', size = 0;
    Array.from(line).forEach(function (ch) {
      var n = octets(ch);
      if (size + n > 75) { out.push(cur); cur = ' '; size = 1; }
      cur += ch;
      size += n;
    });
    out.push(cur);
    return out.join('\r\n');
  }
  function buildIcs(article) {
    var start = new Date(article.getAttribute('data-start'));
    var end = new Date(article.getAttribute('data-end') || article.getAttribute('data-start'));
    if (isNaN(start) || isNaN(end)) return null;
    var title = ($('h3', article) || {}).textContent || 'Versailles Vivant';
    var desc = ($('.item-body > p:not(.eyebrow)', article) || {}).textContent || '';
    var where = $('.event-meta div:nth-child(2) dd', article);
    var place = where ? where.textContent.trim() : '';
    // the place names already name the town where needed ("…, Versailles gardens"), so only add what is missing
    place = place ? place + (/Versailles|Версај/.test(place) ? t('ics_country') : t('ics_city_country')) : 'Versailles, France';
    var origin = window.location.origin && window.location.origin !== 'null' ? window.location.origin : '';
    var base = origin + window.location.pathname;
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Versailles Vivant//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + article.id + '@versailles-vivant.example',
      'DTSTAMP:' + icsDate(new Date()),
      'DTSTART:' + icsDate(start),
      'DTEND:' + icsDate(end),
      'SUMMARY:' + icsEscape(title.trim()),
      'DESCRIPTION:' + icsEscape(desc.trim()),
      'LOCATION:' + icsEscape(place),
      'URL:' + base + '#' + article.id,
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  function download(filename, text, type) {
    var blob = new Blob([text], { type: type });
    if (window.navigator.msSaveOrOpenBlob) return window.navigator.msSaveOrOpenBlob(blob, filename);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function initEvents() {
    var list = $('#event-list');
    if (!list) return;
    // the filter works on the <li>, but the type lives on the article inside it
    $$('#event-list > li').forEach(function (li) {
      var art = $('article', li);
      if (art) li.setAttribute('data-type', art.getAttribute('data-type'));
    });
    initFilter({ bar: '.filter-bar', items: '#event-list > li', status: '#event-status', attr: 'data-type' });

    // Bookings close when an event starts (the server refuses them too); once it has ended it is marked as past and moved
    // below the upcoming ones.
    var now = Date.now();
    var select = $('#rsvp-event');
    var past = [];
    $$('article[data-start]', list).forEach(function (art) {
      var start = new Date(art.getAttribute('data-start')).getTime();
      var end = new Date(art.getAttribute('data-end') || art.getAttribute('data-start')).getTime();
      if (isNaN(start) || start > now) return;
      $$('[data-rsvp]', art).forEach(function (a) { a.hidden = true; });
      var option = select && $('option[value="' + art.id + '"]', select);
      if (option) { option.disabled = true; if (select.value === art.id) select.value = ''; }
      if (!isNaN(end) && end < now) {
        art.classList.add('is-past');
        var badge = $('.badge-past', art);
        if (badge) badge.hidden = false;
        if (art.parentElement && art.parentElement.tagName === 'LI') past.push(art.parentElement);
      }
    });
    past.forEach(function (li) { list.appendChild(li); });

    list.addEventListener('click', function (e) {
      var ics = e.target.closest('[data-ics]');
      if (ics) {
        var art = ics.closest('article');
        var text = art && buildIcs(art);
        if (text) download(art.id + '.ics', text, 'text/calendar;charset=utf-8');
        return;
      }
      // "Reserve a place": choose the event in the form, bring the form into view and put the keyboard focus on that
      // choice, so a keyboard or screen-reader user hears which event is selected and carries on from there
      var rsvp = e.target.closest('[data-rsvp]');
      if (rsvp && select) {
        e.preventDefault();
        select.value = rsvp.getAttribute('data-rsvp');
        var section = $('#rsvp') || select;
        section.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
        select.focus({ preventScroll: true });
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#rsvp'); } catch (err) { /* ignore */ }
      }
    });
  }

  /* ---------- Journal ---------- */
  function initJournal() {
    if (!$('#post-list')) return;
    initFilter({ bar: '.filter-bar', items: '#post-list > article', status: '#post-status', attr: 'data-category' });
    initFeedBox();
  }

  // "Subscribe via Atom feed": the box shows the feed's full address (taken from the page's own feed link, so it is right
  // on any host and in the fr/ and mk/ copies of the static export) and copies it for the visitor's feed reader
  function initFeedBox() {
    var input = $('#feed-url'), button = $('#feed-copy'), status = $('#feed-status');
    if (!input) return;
    var link = document.querySelector('link[rel="alternate"][type="application/atom+xml"]');
    if (link && link.href) input.value = link.href;
    input.addEventListener('focus', function () { input.select(); });
    if (!button || !status) return;
    button.hidden = false;
    function report(ok) {
      status.textContent = t(ok ? 'feed_copied' : 'feed_copy_fail');
      if (!ok) { input.focus(); input.select(); }
    }
    function fallback() {
      input.focus(); input.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      report(ok);
    }
    button.addEventListener('click', function () {
      status.textContent = '';
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(input.value).then(function () { report(true); }, fallback);
      else fallback();
    });
  }

  /* ---------- Virtual tour ---------- */
  function initTour() {
    var viewport = $('#tourViewport');
    if (!viewport) return;
    var rooms = $$('.tour-room', viewport);
    var dots = $$('#tourDots [data-goto]');
    var prev = $('#tourPrev');
    var next = $('#tourNext');
    var status = $('#tourStatus');
    var index = 0;

    function title(i) { return t('t' + (i + 1) + '_h'); }
    function announce() {
      if (status) status.textContent = t('room' + (index + 1)) + ': ' + title(index);
    }
    function show(i, speak) {
      index = Math.max(0, Math.min(rooms.length - 1, i));
      rooms.forEach(function (room, n) {
        var on = n === index;
        room.classList.toggle('is-active', on);
        if (on) room.removeAttribute('aria-hidden'); else room.setAttribute('aria-hidden', 'true');
      });
      dots.forEach(function (d, n) { d.setAttribute('aria-current', n === index ? 'true' : 'false'); });
      // aria-disabled (not disabled) at the ends, so the button a visitor just pressed keeps keyboard focus
      if (prev) prev.setAttribute('aria-disabled', index === 0 ? 'true' : 'false');
      if (next) next.setAttribute('aria-disabled', index === rooms.length - 1 ? 'true' : 'false');
      // only the visible room's photo is fetched; fetch the next one ahead of time so the slide is not blank
      var ahead = rooms[index + 1] && rooms[index + 1].querySelector('img');
      if (ahead && ahead.getAttribute('src') && !ahead.getAttribute('data-prefetched')) {
        ahead.setAttribute('data-prefetched', '1');
        new window.Image().src = ahead.currentSrc || ahead.getAttribute('src');
      }
      if (speak !== false) announce();
    }
    // on a small screen the photo can be above the visible part of the page when a button is pressed: bring it back
    function keepInView() {
      var r = viewport.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.6) viewport.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
    function go(i) { var before = index; show(i); if (index !== before) keepInView(); }
    if (prev) prev.addEventListener('click', function () { if (prev.getAttribute('aria-disabled') !== 'true') go(index - 1); });
    if (next) next.addEventListener('click', function () { if (next.getAttribute('aria-disabled') !== 'true') go(index + 1); });
    dots.forEach(function (d) { d.addEventListener('click', function () { go(parseInt(d.getAttribute('data-goto'), 10)); }); });

    // swiping (touch or pen): a mostly horizontal movement of at least 50 px changes the stop; vertical scrolling is untouched
    var sx = null, sy = null;
    viewport.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
    viewport.addEventListener('pointercancel', function () { sx = null; });
    viewport.addEventListener('pointerup', function (e) {
      if (sx === null) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
    });

    document.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var el = document.activeElement;
      var tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      // only when the tour (or nothing in particular) has focus, so other widgets keep their arrow keys
      var inTour = !el || el === document.body || viewport.contains(el) || (el.closest && el.closest('.tour-controls'));
      if (!inTour) return;
      e.preventDefault();
      show(index + (e.key === 'ArrowRight' ? 1 : -1));
    });
    onLang(function () { show(index, false); });
    show(0, false);
  }

  /* ---------- Contact: map that loads only when asked ---------- */
  function initMap() {
    var card = $('#map-card');
    if (!card) return;
    var holder = $('#map-holder', card);
    var placeholder = $('.map-placeholder', card);
    var button = $('#map-load', card);
    var loaded = false;

    function load() {
      if (loaded) return;
      loaded = true;
      var frame = document.createElement('iframe');
      frame.className = 'map-frame';
      frame.src = card.getAttribute('data-map-src');
      frame.title = t('map_title');
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      holder.appendChild(frame);
      holder.hidden = false;
      if (placeholder) placeholder.hidden = true;
    }
    if (button) button.addEventListener('click', function () { load(); var f = $('iframe', holder); if (f) f.focus(); });
    onLang(function () { var f = $('iframe', holder); if (f) f.title = t('map_title'); });
    // visitors who chose "Allow optional content" get the map straight away
    if (VV.consent() === 'all') load();
    document.addEventListener('vv:consent', function (e) { if (e.detail && e.detail.choice === 'all') load(); });
  }

  /* ---------- FAQ: a link such as faq.html#q10 opens that answer ---------- */
  function initFaq() {
    if (!$('.faq-item')) return;
    function openFromHash() {
      var id = window.location.hash.slice(1);
      var item = id && document.getElementById(id);
      if (item && item.tagName === 'DETAILS') { item.open = true; item.scrollIntoView({ block: 'start' }); }
    }
    window.addEventListener('hashchange', openFromHash);
    openFromHash();
  }

  /* ---------- Get involved: "Join as …" on a membership tier fills in the form below; a one-time donation shows the
     preset amounts (and the "other amount" field when "Other" is chosen). Hidden parts are also disabled, so they are
     neither checked nor sent. ---------- */
  var DONATION = 'One-time donation';
  function initJoin() {
    var select = $('#join-interest');
    if (!select) return;
    var amounts = $('#join-amount');
    var otherField = $('#join-amount-other-field');
    var otherInput = $('#join-amount-other');
    function sync() {
      if (!amounts) return;
      var giving = select.value === DONATION;
      amounts.hidden = !giving;
      amounts.disabled = !giving;
      var other = giving && $$('input[name="amount"]', amounts).some(function (r) { return r.checked && r.value === 'other'; });
      if (otherField) otherField.hidden = !other;
      if (otherInput) { otherInput.disabled = !other; otherInput.required = other; }
    }
    select.addEventListener('change', sync);
    if (amounts) amounts.addEventListener('change', function (e) {
      sync();
      if (e.target.name === 'amount' && e.target.value === 'other' && otherInput) otherInput.focus();
    });
    // the footer's "Donate" link and the home page's "Donations" card arrive at #give: start with a donation
    if (window.location.hash === '#give' && !select.value) select.value = DONATION;
    sync();
    $$('[data-join]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var value = a.getAttribute('data-join');
        if (!$('option[value="' + value + '"]', select)) return;
        e.preventDefault();
        select.value = value;
        sync();
        var panel = select.closest('.join-panel') || select;
        panel.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
        // a gift goes straight to the amounts; a membership to the name
        var first = (value === DONATION && $('input[name="amount"]', amounts)) || $('#join-name') || select;
        first.focus({ preventScroll: true });
      });
    });
  }

  function start() {
    initJoin();
    initFaq();
    initEvents();
    initJournal();
    initTour();
    initMap();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
