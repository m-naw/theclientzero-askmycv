import { TOKENS } from "../design-tokens";

void TOKENS;

/**
 * Inline JS for the setup-instructions page: every few seconds, probe
 * the Worker root with credentials included. Once the response no
 * longer renders the instructions page (signalled by a custom header
 * `x-askmycv-state`), reload the page so the visitor lands on the
 * setup form, which is only served when an Access JWT is present.
 */
export const ACCESS_POLL_SCRIPT = `
(function () {
  var POLL_MS = 3000;
  function probe() {
    fetch('/', { credentials: 'include', cache: 'no-store' })
      .then(function (r) {
        var state = r.headers.get('x-askmycv-state');
        if (state && state !== 'unconfigured_no_access') {
          window.location.reload();
        }
      })
      .catch(function () { /* swallow transient errors */ });
  }
  setInterval(probe, POLL_MS);
})();
`;
