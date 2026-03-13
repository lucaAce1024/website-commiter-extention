/**
 * Ahrefs MAIN world fetch interceptor + Turnstile token injector.
 * Injected via <script src="..."> from the content script to bypass page CSP.
 *
 * 1. Intercepts stGetFreeBacklinksList responses → posts urlFrom list back.
 * 2. Captures Cloudflare Turnstile render callback → when a token arrives
 *    via postMessage, calls the callback to bypass Turnstile automatically.
 */
(function () {
  if (window.__ahrefsFetchIntercepted) return;
  window.__ahrefsFetchIntercepted = true;

  var API_KEY = 'stGetFreeBacklinksList';
  var origFetch = window.fetch;

  // ---- Fetch interception ----
  window.fetch = function () {
    var args = arguments;
    var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
    return origFetch.apply(this, args).then(function (response) {
      if (url && String(url).indexOf(API_KEY) !== -1) {
        var clone = response.clone();
        clone.json().then(function (data) {
          var urlFromList = [];
          try {
            if (Array.isArray(data) && data.length >= 2) {
              var obj = data[1];
              var backlinks = (obj && obj.topBacklinks && obj.topBacklinks.backlinks) || (obj && obj.backlinks) || [];
              urlFromList = backlinks.map(function (b) { return b.urlFrom; }).filter(Boolean);
            }
          } catch (e) { /* ignore */ }
          if (urlFromList.length > 0) {
            window.postMessage({ __navSubmitterAhrefsBacklinks: true, urlFromList: urlFromList }, '*');
            console.log('[NavSubmitter] Intercepted stGetFreeBacklinksList, urlFrom count:', urlFromList.length);
          }
        }).catch(function () { /* ignore */ });
      }
      return response;
    });
  };

  // ---- Turnstile callback capture ----
  var _turnstileCallback = null;

  function patchTurnstile(ts) {
    if (!ts || ts.__navPatched) return;
    var origRender = ts.render;
    if (typeof origRender !== 'function') return;
    ts.render = function (container, options) {
      if (options && typeof options.callback === 'function') {
        _turnstileCallback = options.callback;
        console.log('[NavSubmitter] Captured Turnstile render callback');
      }
      return origRender.apply(this, arguments);
    };
    ts.__navPatched = true;
  }

  // Patch if turnstile already exists
  if (window.turnstile) {
    patchTurnstile(window.turnstile);
  }

  // Watch for turnstile being set later (Cloudflare script loads async)
  var _origTurnstile = window.turnstile;
  try {
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      enumerable: true,
      get: function () { return _origTurnstile; },
      set: function (val) {
        _origTurnstile = val;
        if (val) patchTurnstile(val);
      }
    });
  } catch (e) {
    console.warn('[NavSubmitter] Could not defineProperty for turnstile:', e.message);
  }

  // ---- Token injection listener ----
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.__navSubmitterInjectTurnstileToken && event.data.token) {
      var token = event.data.token;
      console.log('[NavSubmitter] Received Turnstile token for injection, callback available:', !!_turnstileCallback);

      // Method 1: Call captured callback
      if (_turnstileCallback) {
        try {
          _turnstileCallback(token);
          console.log('[NavSubmitter] Turnstile callback invoked with token');
          window.postMessage({ __navSubmitterTurnstileInjected: true, method: 'callback' }, '*');
          return;
        } catch (e) {
          console.warn('[NavSubmitter] Turnstile callback failed:', e.message);
        }
      }

      // Method 2: Find callback via data-callback attribute
      var container = document.querySelector('.cf-turnstile, [data-sitekey]');
      if (container) {
        var cbName = container.getAttribute('data-callback');
        if (cbName && typeof window[cbName] === 'function') {
          try {
            window[cbName](token);
            console.log('[NavSubmitter] Turnstile data-callback invoked:', cbName);
            window.postMessage({ __navSubmitterTurnstileInjected: true, method: 'data-callback' }, '*');
            return;
          } catch (e) {
            console.warn('[NavSubmitter] data-callback failed:', e.message);
          }
        }
      }

      // Method 3: Set hidden input value (last resort)
      var inputs = document.querySelectorAll('input[name="cf-turnstile-response"], [name="cf-turnstile-response"]');
      if (inputs.length > 0) {
        inputs.forEach(function (inp) { inp.value = token; });
        console.log('[NavSubmitter] Set cf-turnstile-response input value');
        window.postMessage({ __navSubmitterTurnstileInjected: true, method: 'input' }, '*');
        return;
      }

      console.warn('[NavSubmitter] No Turnstile injection method succeeded');
      window.postMessage({ __navSubmitterTurnstileInjected: false }, '*');
    }
  });

  console.log('[NavSubmitter] MAIN world fetch interceptor + Turnstile handler installed for Ahrefs');
})();
