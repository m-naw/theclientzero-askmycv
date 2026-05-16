import { TOKENS } from "../design-tokens";

void TOKENS;

/**
 * Inline JS embedded in the chat page. Hooks the composer form, opens a
 * fetch+ReadableStream against /chat, appends deltas to .message-list,
 * and rewrites `[cv]` tokens into styled citation chips. Uses DOM
 * construction (no innerHTML on assistant text) to avoid HTML injection
 * via the streamed model output.
 */
export const CHAT_STREAMING_SCRIPT = `
(function () {
  var form = document.querySelector('form.composer-form');
  var list = document.querySelector('.message-list');
  var input = document.querySelector('.composer .textarea');
  if (!form || !list || !input) return;

  function renderInto(node, text) {
    while (node.firstChild) node.removeChild(node.firstChild);
    var parts = text.split(/(\\[cv\\])/g);
    parts.forEach(function (part) {
      if (part === '[cv]') {
        var span = document.createElement('span');
        span.className = 'citation-chip';
        span.textContent = '[cv]';
        node.appendChild(span);
      } else if (part) {
        node.appendChild(document.createTextNode(part));
      }
    });
  }

  function appendBubble(role) {
    var div = document.createElement('div');
    div.className = 'message message-' + role;
    list.appendChild(div);
    return div;
  }

  var history = [];

  function send(question) {
    appendBubble('user').textContent = question;
    var bubble = appendBubble('assistant');
    var acc = '';
    history.push({ role: 'user', content: question });
    fetch('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    }).then(function (res) {
      if (!res.body) {
        bubble.textContent = '(no stream)';
        return;
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            if (acc) history.push({ role: 'assistant', content: acc });
            return;
          }
          var chunk = dec.decode(r.value, { stream: true });
          chunk.split(/\\n\\n/).forEach(function (frame) {
            var line = frame.split(/\\n/).filter(function (l) { return l.indexOf('data:') === 0; })[0];
            if (!line) return;
            try {
              var data = JSON.parse(line.slice(5).trim());
              if (data && data.delta && typeof data.delta.text === 'string') {
                acc += data.delta.text;
                renderInto(bubble, acc);
              }
            } catch (_e) { /* non-JSON frame */ }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      bubble.textContent = 'error: ' + (err && err.message || 'unknown');
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = (input.value || '').trim();
    if (!q) return;
    input.value = '';
    send(q);
  });

  document.querySelectorAll('.suggestions .chip').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var q = btn.getAttribute('data-question') || btn.textContent || '';
      if (q) send(q.trim());
    });
  });
})();
`;
