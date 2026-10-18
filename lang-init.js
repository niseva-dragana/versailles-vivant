/*
 * Versailles Vivant — runs before the page is painted (the only blocking script, well under 2 KB).
 * 1. Language: a returning visitor who chose French or Macedonian is sent straight to the address of the page in that
 *    language (about.html?lang=mk, or mk/about.html in the static build), so the address, the canonical link and the
 *    text always agree, and a link copied from the address bar keeps the language. Pages without a canonical address
 *    (the 404 page) are translated in place instead: the page stays hidden until script.js has translated it (it removes
 *    the class), and a CSS timer reveals it anyway after 1.5 s, so a failed script can never leave the page blank.
 *    Pages that were pre-rendered in a language (static build) are left alone.
 * 2. Cookie notice: if no choice has been made yet, html.consent-pending makes the notice part of the very first paint,
 *    so it never appears later and pushes the page down.
 */
(function () {
  var root = document.documentElement;
  var pending = true;
  var redirect = null;
  try {
    if (!root.hasAttribute('data-prerendered')) {
      var params = new URLSearchParams(window.location.search);
      var fromUrl = params.get('lang');
      var wanted = fromUrl || window.localStorage.getItem('vv_language');
      if ((wanted === 'fr' || wanted === 'mk') && root.getAttribute('lang') !== wanted) {
        root.classList.add('i18n-pending');
        if (!fromUrl && document.querySelector('link[rel="canonical"]')) {
          if (root.hasAttribute('data-static')) {
            // static build: the translated copy of this page is in the fr/ or mk/ folder next to it
            params.delete('lang');
            var query = params.toString();
            redirect = wanted + '/' + window.location.pathname.split('/').pop() + (query ? '?' + query : '') + window.location.hash;
          } else {
            // Node server: ?lang= returns the page already translated
            params.set('lang', wanted);
            redirect = window.location.pathname + '?' + params.toString() + window.location.hash;
          }
        }
      }
    }
    var c = JSON.parse(window.localStorage.getItem('vv_consent') || 'null');
    pending = !(c && (c.choice === 'all' || c.choice === 'essential') && Date.now() - c.at < 365 * 24 * 60 * 60 * 1000);
  } catch (e) { /* storage blocked: the notice is shown, and the page simply starts in its own language */ }
  if (pending) root.classList.add('consent-pending');
  if (redirect) window.location.replace(redirect);
})();
