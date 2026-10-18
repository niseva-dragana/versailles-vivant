/* =========================================================
   Versailles Vivant — shared site script (no dependencies)
   - language switching (EN / FR / MK) with ?lang= deep links
   - cookie / optional-content consent (stored in localStorage)
   - accessible forms: inline validation with the same rules as the server, the server's own field errors,
     and a hand-over to the visitor's e-mail app where no form service exists (static hosting)
   - small progressive enhancements (nav, reveal, counters)
   Page-specific behaviour lives in pages.js and charts.js.
   ========================================================= */
(function () {
  'use strict';

  var LANGS = ['en', 'fr', 'mk'];
  var CONSENT_KEY = 'vv_consent';
  var LANG_KEY = 'vv_language';
  var CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
  var root = document.documentElement;
  var pageName = document.body.getAttribute('data-page') || 'index';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // pages of the static build that were pre-rendered in French or Macedonian (fr/about.html) keep their language
  var prerendered = root.hasAttribute('data-prerendered');

  /* ---------- storage that never throws (private mode, blocked storage) ---------- */
  var memory = {};
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return memory[k] || null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { memory[k] = v; } },
    remove: function (k) { try { window.localStorage.removeItem(k); } catch (e) { delete memory[k]; } }
  };

  /* ---------- i18n ---------- */
  var dict = { en: {}, fr: {}, mk: {} };
  (function buildDictionary() {
    var data = window.i18n || { common: {}, pages: {} };
    LANGS.forEach(function (l) {
      dict[l] = Object.assign({}, (data.common || {})[l] || {}, ((data.pages || {})[pageName] || {})[l] || {});
    });
  })();

  var currentLang = 'en';
  function t(key, vars) {
    var s = (dict[currentLang] && dict[currentLang][key]);
    if (s === undefined) s = dict.en[key];
    if (s === undefined) return key;
    if (vars) Object.keys(vars).forEach(function (k) { if (vars[k] !== undefined && vars[k] !== null) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    return s;
  }

  // the 404 page is shown at any address, so links inside translated texts are made absolute (server/documents.js)
  var linkBase = root.getAttribute('data-link-base');
  function setText(el, value) {
    if (!/<[a-z][\s\S]*>/i.test(value)) { el.textContent = value; return; }
    el.innerHTML = value;
    if (linkBase) {
      el.querySelectorAll('a[href]').forEach(function (a) {
        var href = a.getAttribute('href');
        if (!/^([a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(href)) a.setAttribute('href', linkBase + href);
      });
    }
  }

  /* ---------- numbers in the page language (server/render-lang.js formats them the same way) ---------- */
  // Chromium has no Macedonian number data (it would print 75,400), so Macedonian is formatted by hand: 75.400 €, 52%
  function groupMk(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function formatNumber(kind, lang, value) {
    var v = Number(value);
    if (lang === 'mk') return kind === 'eur' ? groupMk(v) + ' €' : kind === 'pct' ? groupMk(v) + '%' : groupMk(v);
    var locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
    try {
      if (kind === 'eur') return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
      if (kind === 'pct') return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(v / 100);
      return new Intl.NumberFormat(locale).format(v);
    } catch (e) { return String(v); }
  }

  var ATTRS = [['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria-label', 'aria-label'], ['data-i18n-content', 'content'],
    ['data-i18n-alt', 'alt'], ['data-i18n-title', 'title'], ['data-i18n-aria-roledescription', 'aria-roledescription']];

  function applyLanguage(lang, opts) {
    opts = opts || {};
    if (LANGS.indexOf(lang) === -1) lang = 'en';
    currentLang = lang;
    root.setAttribute('lang', lang);
    if (opts.persist !== false) store.set(LANG_KEY, lang);
    // a page of the static build that was pre-rendered in this language (fr/about.html) already carries every text, with
    // its links adjusted for the folder it is in; writing the texts again would undo that
    if (opts.rendered) { document.dispatchEvent(new CustomEvent('vv:langchange', { detail: { lang: lang } })); return; }
    var d = dict[lang] || {};
    function fill(el, v) { var n = el.getAttribute('data-n'); return n === null ? v : v.replace(/\{n\}/g, n); }
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = d[el.getAttribute('data-i18n')];
      if (v !== undefined) setText(el, fill(el, v));
    });
    ATTRS.forEach(function (pair) {
      document.querySelectorAll('[' + pair[0] + ']').forEach(function (el) {
        var v = d[el.getAttribute(pair[0])];
        if (v !== undefined) el.setAttribute(pair[1], fill(el, v));
      });
    });
    document.querySelectorAll('[data-fmt][data-value]').forEach(function (el) {
      if (!el.hasAttribute('data-i18n')) el.textContent = formatNumber(el.getAttribute('data-fmt'), lang, el.getAttribute('data-value'));
    });
    var titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) document.title = titleEl.textContent;
    // the language links: the current one is marked for screen readers and styled
    document.querySelectorAll('[data-lang]').forEach(function (a) {
      if (a.getAttribute('data-lang') === lang) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    if (!prerendered) syncPageLinks(lang);
    if (opts.updateUrl) {
      try {
        var u = new URL(window.location.href);
        if (lang === 'en') u.searchParams.delete('lang'); else u.searchParams.set('lang', lang);
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) { /* ignore */ }
    }
    document.dispatchEvent(new CustomEvent('vv:langchange', { detail: { lang: lang } }));
  }

  /* Links to the site's own pages carry ?lang=fr|mk (as the server renders them), so that opening a link or sharing it keeps the
     language. Switching back to English removes the parameter again. */
  var PAGE_HREF = /^([a-z0-9-]+\.html)(\?[^#]*)?(#.*)?$/i;
  function syncPageLinks(lang) {
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (a.hasAttribute('data-lang')) return;
      var m = PAGE_HREF.exec(a.getAttribute('href'));
      if (!m) return;
      var rest = (m[2] || '').replace(/^\?/, '').split('&').filter(function (p) { return p && p.indexOf('lang=') !== 0; });
      if (lang !== 'en') rest.push('lang=' + lang);
      a.setAttribute('href', m[1] + (rest.length ? '?' + rest.join('&') : '') + (m[3] || ''));
    });
  }

  function detectLanguage() {
    if (prerendered) return { lang: root.getAttribute('lang') || 'en' };
    var fromUrl = null;
    try { fromUrl = new URLSearchParams(window.location.search).get('lang'); } catch (e) { /* ignore */ }
    if (fromUrl && LANGS.indexOf(fromUrl) !== -1) return { lang: fromUrl, fromUrl: true };
    var saved = store.get(LANG_KEY);
    if (saved && LANGS.indexOf(saved) !== -1) return { lang: saved };
    return { lang: 'en' };
  }

  function initLanguage() {
    var found = detectLanguage();
    document.querySelectorAll('a[data-lang]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var lang = a.getAttribute('data-lang');
        // "?lang=fr" links switch the page in place, without a reload; links to the pre-rendered pages of the static
        // build (fr/about.html) are followed normally, after the choice has been remembered
        if ((a.getAttribute('href') || '').charAt(0) === '?' && !prerendered) {
          e.preventDefault();
          applyLanguage(lang, { updateUrl: true });
        } else {
          store.set(LANG_KEY, lang);
        }
      });
    });
    applyLanguage(found.lang, { updateUrl: !!found.fromUrl, rendered: prerendered });
    root.classList.remove('i18n-pending'); // set by lang-init.js to avoid a flash of English
  }

  /* When the site is served from static hosting, replace the {{ORIGIN}} placeholder used for canonical / hreflang. */
  function fixOriginPlaceholders() {
    var origin = window.location.origin && window.location.origin !== 'null' ? window.location.origin : '';
    if (!origin) return;
    document.querySelectorAll('link[href*="{{ORIGIN}}"], meta[content*="{{ORIGIN}}"]').forEach(function (el) {
      var attr = el.hasAttribute('href') ? 'href' : 'content';
      el.setAttribute(attr, el.getAttribute(attr).replace(/\{\{ORIGIN\}\}/g, origin));
    });
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (el) {
      if (el.textContent.indexOf('{{ORIGIN}}') !== -1) el.textContent = el.textContent.replace(/\{\{ORIGIN\}\}/g, origin);
    });
  }

  /* ---------- navigation ---------- */
  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var collapse = document.querySelector('.nav-collapse');
    var header = document.querySelector('.site-header');
    var here = (window.location.pathname.split('/').pop() || 'index.html');
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      if (a.getAttribute('href').split('?')[0] === here && !a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
    });
    if (!toggle || !collapse) return;
    function setOpen(open) {
      // while the cookie notice is above the header, bring the header to the top first so the whole menu fits on screen
      if (open && header) {
        var top = header.getBoundingClientRect().top;
        if (top > 0) window.scrollBy(0, top);
      }
      collapse.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      root.classList.toggle('menu-open', open);
    }
    toggle.addEventListener('click', function () { setOpen(!collapse.classList.contains('is-open')); });
    collapse.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && collapse.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
    });
  }

  /* ---------- consent (cookie notice + optional third-party content) ---------- */
  function readConsent() {
    var raw = store.get(CONSENT_KEY);
    if (!raw) return null;
    try {
      var c = JSON.parse(raw);
      if ((c.choice === 'all' || c.choice === 'essential') && Date.now() - c.at < CONSENT_MAX_AGE_MS) return c.choice;
    } catch (e) { /* ignore */ }
    return null;
  }
  function writeConsent(choice) {
    store.set(CONSENT_KEY, JSON.stringify({ choice: choice, at: Date.now() }));
    document.dispatchEvent(new CustomEvent('vv:consent', { detail: { choice: choice } }));
  }

  /* The notice is a bar at the very top of the page, in the normal flow (it pushes the page down; it never covers it).
     lang-init.js has already made it visible before the first paint if no choice was stored (html.consent-pending). */
  function initConsent() {
    var banner = document.getElementById('cookie-banner');
    if (!banner) return;
    var opener = null; // the "Manage cookie preferences" button, when that is how the notice was opened
    store.remove('vv_cookie_choice'); // legacy key from the first version of the site

    function show(focus) {
      banner.classList.add('is-visible');
      if (focus) {
        window.scrollTo(0, 0);
        var primary = banner.querySelector('[data-cookie-action="' + (readConsent() === 'essential' ? 'essential' : 'all') + '"]') || banner.querySelector('button');
        if (primary) primary.focus({ preventScroll: true });
      }
    }
    function hide() {
      var hadFocus = banner.contains(document.activeElement);
      banner.classList.remove('is-visible');
      root.classList.remove('consent-pending');
      if (hadFocus) {
        if (opener) opener.focus(); // back to the footer button the visitor came from
        else {
          // first visit: carry on from where the notice was, at the start of the site header
          var next = document.querySelector('.site-header a[href], .site-header button');
          if (next) next.focus({ preventScroll: true });
        }
      }
      opener = null;
    }
    banner.querySelectorAll('[data-cookie-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        writeConsent(btn.getAttribute('data-cookie-action'));
        hide();
      });
    });
    banner.addEventListener('keydown', function (e) { if (e.key === 'Escape' && readConsent()) hide(); });
    document.querySelectorAll('#manage-cookies, [data-manage-cookies]').forEach(function (btn) {
      btn.addEventListener('click', function () { opener = btn; show(true); });
    });
    if (readConsent()) root.classList.remove('consent-pending'); else show(false);
  }

  /* ---------- forms ---------- */
  function fieldFor(el) { return el.closest('.form-field') || el.parentElement; }

  function messageFor(el) {
    if (el._serverError) return t(el._serverError.key, el._serverError.vars); // a field the server refused
    var v = el.validity;
    if (v.valueMissing) return el.type === 'checkbox' ? t('err_consent') : el.type === 'radio' ? t('err_choice') : t('err_required');
    if (el.type === 'email' && (v.typeMismatch || v.patternMismatch)) return t('err_email');
    if (v.tooShort) return t('err_minlength', { n: el.getAttribute('minlength') });
    if (v.tooLong) return t('err_too_long', { n: el.getAttribute('maxlength') });
    if (v.rangeUnderflow || v.rangeOverflow || v.stepMismatch || v.badInput || v.typeMismatch) {
      return t('err_range', { min: el.getAttribute('min'), max: el.getAttribute('max') });
    }
    return t('err_required');
  }

  function clearErrors(form) {
    form.querySelectorAll('.field-error').forEach(function (n) { n.remove(); });
    form.querySelectorAll('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
    form.querySelectorAll('.form-errors, .form-failure, .form-handoff').forEach(function (n) { n.remove(); });
  }

  function formLabel(el) { return el.form && el.id && el.form.querySelector('label[for="' + el.id + '"]'); }
  function labelText(el) {
    // a group of options (the donation amounts) is named by its legend, not by one option's label
    var legend = el.type === 'radio' && el.closest('fieldset') && el.closest('fieldset').querySelector('legend');
    if (legend) return legend.textContent.replace(/\s+/g, ' ').trim();
    var label = formLabel(el) || el.closest('label');
    return label ? label.textContent.replace(/\s+/g, ' ').trim() : (el.getAttribute('aria-label') || el.name);
  }

  function showErrors(form, invalid, quiet) {
    clearErrors(form);
    // one message per group of options, not one per option
    var seen = {};
    invalid = invalid.filter(function (el) {
      if (el.type !== 'radio') return true;
      if (seen[el.name]) return false;
      seen[el.name] = true;
      return true;
    });
    form._invalid = invalid; // remembered so the messages can be rewritten if the language changes
    var summary = document.createElement('div');
    summary.className = 'form-errors';
    summary.setAttribute('role', 'alert');
    summary.setAttribute('tabindex', '-1');
    var h = document.createElement('p');
    h.className = 'form-errors-title';
    h.textContent = t('err_summary');
    var ul = document.createElement('ul');
    summary.appendChild(h);
    summary.appendChild(ul);
    invalid.forEach(function (el, i) {
      if (!el.id) el.id = (form.id || 'f') + '-field-' + i;
      var msg = messageFor(el);
      var err = document.createElement('p');
      err.className = 'field-error';
      err.id = el.id + '-error';
      err.textContent = msg;
      fieldFor(el).appendChild(err);
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', ((el.getAttribute('aria-describedby') || '').replace(/\S*-error\b/g, '') + ' ' + err.id).trim());
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + el.id;
      // a checkbox's label is a whole sentence, so its message already says what is needed;
      // French puts a (non-breaking) space before the colon
      a.textContent = el.type === 'checkbox' ? msg : labelText(el) + (currentLang === 'fr' ? ' : ' : ': ') + msg;
      a.addEventListener('click', function (e) { e.preventDefault(); el.focus(); });
      li.appendChild(a);
      ul.appendChild(li);
    });
    form.insertBefore(summary, form.firstChild);
    if (!quiet) summary.focus();
  }

  // the server names the field it refused and why (server.js); the visitor sees the same message the browser would give
  var SERVER_MESSAGES = { email: 'err_email', event: 'err_event', event_past: 'err_event_past', range: 'err_range', too_long: 'err_too_long', required: 'err_required', minlength: 'err_minlength' };
  function showServerError(form, body) {
    var el = body && body.field && form.elements[body.field];
    if (el && !el.tagName && el.length) el = el[0]; // a group of options: its first option carries the message
    var key = body && SERVER_MESSAGES[body.code];
    if (!el || !key || typeof el.setCustomValidity !== 'function') return false;
    el._serverError = { key: key, vars: { n: body.max || body.min, min: body.min, max: body.max } };
    el.setCustomValidity(t(key, el._serverError.vars));
    showErrors(form, [el]);
    return true;
  }

  function mailtoHref(form, payload) {
    var to = form.getAttribute('data-mailto');
    if (!to) return null;
    var key = form.getAttribute('data-i18n-mailto-subject');
    var subj = (key && t(key) !== key ? t(key) : form.getAttribute('data-mailto-subject')) || 'Website message';
    var lines = [];
    Object.keys(payload).forEach(function (k) {
      if (k === 'form' || k === 'website' || k === 'lang' || payload[k] === '') return;
      var el = form.elements[k];
      var value = payload[k];
      if (el && el.tagName === 'SELECT' && el.selectedIndex > 0) value = el.options[el.selectedIndex].text;
      if (el && !el.tagName && el.length) { // a group of options: the legend, and the text of the chosen option
        var chosen = Array.prototype.filter.call(el, function (r) { return r.checked; })[0];
        if (chosen && chosen.closest('label')) value = chosen.closest('label').textContent.replace(/\s+/g, ' ').trim();
        el = el[0];
      }
      lines.push((el && (el.id || el.type === 'radio') ? labelText(el) : k) + ': ' + value);
    });
    return 'mailto:' + to + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(lines.join('\n'));
  }

  function showFailure(form, payload) {
    var box = document.createElement('div');
    box.className = 'form-failure';
    box.setAttribute('role', 'alert');
    box.setAttribute('tabindex', '-1');
    var p = document.createElement('p');
    p.textContent = t('err_send') + ' ';
    var href = mailtoHref(form, payload);
    if (href) {
      var a = document.createElement('a');
      a.href = href;
      a.textContent = t('err_mail_link');
      p.appendChild(a);
      p.appendChild(document.createTextNode('.'));
    }
    box.appendChild(p);
    form.insertBefore(box, form.firstChild);
    box.focus();
  }

  /* Where there is no form service (static hosting), the message is handed to the visitor's own e-mail app, ready to send.
     This is the normal path there, not an error, so the note is neutral and the form stays filled in. */
  function handOff(form, payload) {
    var href = mailtoHref(form, payload);
    var to = form.getAttribute('data-mailto') || '';
    var box = document.createElement('div');
    box.className = 'form-handoff';
    box.setAttribute('role', 'status');
    box.setAttribute('tabindex', '-1');
    var h = document.createElement('p');
    h.className = 'form-handoff-title';
    h.textContent = t('mail_handoff_h');
    var p = document.createElement('p');
    var parts = t('mail_handoff_p').split('{email}');
    p.appendChild(document.createTextNode(parts[0]));
    if (parts.length > 1) {
      var a = document.createElement('a');
      a.href = href || 'mailto:' + to;
      a.textContent = to;
      p.appendChild(a);
      p.appendChild(document.createTextNode(parts.slice(1).join('')));
    }
    box.appendChild(h);
    box.appendChild(p);
    form.insertBefore(box, form.firstChild);
    box.focus();
    if (href) window.location.href = href;
  }

  function initForms() {
    document.querySelectorAll('form[data-endpoint]').forEach(function (form) {
      form.setAttribute('novalidate', '');
      var holder = form.closest('[data-form-holder]') || form.parentElement;
      var ok = holder.querySelector('.form-success');
      var submitBtn = form.querySelector('[type="submit"]');
      form.addEventListener('input', function (e) {
        var el = e.target;
        // choosing any option of a group clears the message, which sits on the group's first option
        if (el.type === 'radio' && el.name && form.elements[el.name] && form.elements[el.name][0]) el = form.elements[el.name][0];
        if (el._serverError) { el._serverError = null; el.setCustomValidity(''); }
        if (el.getAttribute && el.getAttribute('aria-invalid') === 'true' && el.checkValidity()) {
          el.removeAttribute('aria-invalid');
          var err = document.getElementById(el.id + '-error');
          if (err) err.remove();
        }
      });
      // if the language is switched while error messages are showing, show them again in the new language
      document.addEventListener('vv:langchange', function () {
        if (!form.querySelector('.form-errors') || !form._invalid) return;
        var still = form._invalid.filter(function (el) { return !el.checkValidity(); });
        if (still.length) showErrors(form, still, true);
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        clearErrors(form);
        // spaces around a value are never meaningful; without this, a name made of spaces would pass "required"
        Array.prototype.forEach.call(form.elements, function (el) {
          if ((el.type === 'text' || el.type === 'email' || el.tagName === 'TEXTAREA') && el.value !== el.value.trim()) el.value = el.value.trim();
        });
        var invalid = Array.prototype.filter.call(form.elements, function (el) { return el.willValidate && !el.checkValidity(); });
        if (invalid.length) { showErrors(form, invalid); return; }
        var payload = { form: form.id || 'contact' };
        new FormData(form).forEach(function (v, k) { if (k !== 'consent') payload[k] = String(v); });
        payload.lang = currentLang;
        var endpoint = form.getAttribute('data-endpoint');
        if (!endpoint || window.location.protocol === 'file:' || !window.fetch) { handOff(form, payload); return; }
        if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); }
        var finish = function (outcome, body) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); }
          if (outcome === 'ok') {
            form.classList.add('hidden');
            if (ok) { ok.classList.remove('hidden'); ok.classList.add('is-visible'); ok.setAttribute('tabindex', '-1'); ok.focus(); }
          } else if (outcome === 'handoff') {
            handOff(form, payload);
          } else if (!(outcome === 'refused' && showServerError(form, body))) {
            showFailure(form, payload);
          }
        };
        fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(function (r) {
            return r.json().catch(function () { return null; }).then(function (body) {
              if (r.ok && body && body.ok === true) return finish('ok');
              // no form service at this address (a static host answers 404 or 405): use e-mail instead
              if (r.status === 404 || r.status === 405 || r.status === 501) return finish('handoff');
              finish(r.status === 400 ? 'refused' : 'failed', body);
            });
          })
          .catch(function () { finish('failed'); });
      });
    });
  }

  /* ---------- visual enhancements (all respect prefers-reduced-motion) ---------- */
  function initReveal() {
    var els = document.querySelectorAll('.reveal, .parterre');
    if (!els.length) return;
    if (!('IntersectionObserver' in window) || reduceMotion) { els.forEach(function (el) { el.classList.add('is-visible'); }); return; }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    els.forEach(function (el) { obs.observe(el); });
  }

  function initTiltCards() {
    if (reduceMotion || !window.matchMedia('(pointer: fine)').matches) return;
    document.querySelectorAll('.frame-card').forEach(function (card) {
      var rect = null;
      card.addEventListener('mouseenter', function () { rect = card.getBoundingClientRect(); card.style.transition = 'none'; });
      card.addEventListener('mousemove', function (e) {
        if (!rect) return;
        var px = (e.clientX - rect.left) / rect.width - 0.5;
        var py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = 'perspective(800px) rotateX(' + (py * -6) + 'deg) rotateY(' + (px * 6) + 'deg) translateY(-4px)';
      });
      card.addEventListener('mouseleave', function () { rect = null; card.style.transition = ''; card.style.transform = ''; });
    });
  }

  /* ---------- a photo that cannot load (offline, blocked network) must still leave a finished-looking frame ---------- */
  function initImageFallbacks() {
    function mark(img) {
      if (img.classList.contains('img-failed')) return;
      img.classList.add('img-failed');
      var host = img.parentElement;
      if (!host) return;
      host.classList.add('has-failed-img');
      host.setAttribute('data-alt', img.getAttribute('alt') || '');
    }
    document.addEventListener('error', function (e) { if (e.target && e.target.tagName === 'IMG') mark(e.target); }, true);
    document.querySelectorAll('img[src]').forEach(function (img) { if (img.complete && img.naturalWidth === 0) mark(img); });
    // keep the visible text in step when the language changes
    document.addEventListener('vv:langchange', function () {
      document.querySelectorAll('.has-failed-img > img').forEach(function (img) { img.parentElement.setAttribute('data-alt', img.getAttribute('alt') || ''); });
    });
  }

  /* Figures further down the page count up when they scroll into view. Figures that are on screen when the page opens are
     left as they are, so that they can be read (and photographed) at once. */
  function initStatCountUp() {
    var rows = Array.prototype.filter.call(document.querySelectorAll('.stat-row'), function (row) {
      return row.getBoundingClientRect().top > window.innerHeight;
    });
    if (!rows.length || reduceMotion || !('IntersectionObserver' in window)) return;
    function animateNum(el) {
      var raw = el.textContent.trim();
      var match = raw.match(/^([\d.,\s  ]+)(.*)$/);
      if (!match) return;
      var target = parseInt(match[1].replace(/[^\d]/g, ''), 10);
      if (isNaN(target) || (target >= 1900 && target <= 2100 && !/[,.\s  ]/.test(match[1]))) return; // never count up a year
      var suffix = match[2], start = null, duration = 1100;
      var grouped = /\d[,.\s  ]\d{3}/.test(match[1]);
      el.setAttribute('aria-label', raw);
      (function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / duration, 1);
        var cur = Math.floor((1 - Math.pow(1 - p, 3)) * target);
        el.textContent = (grouped ? formatNumber('int', currentLang, cur) : String(cur)) + suffix;
        if (p < 1) window.requestAnimationFrame(step);
        else {
          // the language may have changed while counting: end on the current text
          var key = el.getAttribute('data-i18n');
          el.textContent = key ? t(key) : raw;
          el.removeAttribute('aria-label');
        }
      })(performance.now());
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.querySelectorAll('.stat .num').forEach(animateNum); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.4 });
    rows.forEach(function (row) { obs.observe(row); });
  }

  window.VV = {
    consent: readConsent, t: t, lang: function () { return currentLang; }, store: store,
    formatNumber: function (kind, value) { return formatNumber(kind, currentLang, value); }
  };

  document.addEventListener('DOMContentLoaded', function () {
    fixOriginPlaceholders();
    initNav();
    initLanguage();
    initConsent();
    initForms();
    initReveal();
    initTiltCards();
    initStatCountUp();
    initImageFallbacks();
    document.dispatchEvent(new CustomEvent('vv:ready'));
  });
})();
