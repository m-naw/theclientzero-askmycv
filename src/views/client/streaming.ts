import { TOKENS } from "../design-tokens";

void TOKENS;

/**
 * Inline JS embedded in the chat page. Hooks the composer form, opens a
 * fetch+ReadableStream against /chat, appends deltas to .message-list,
 * strips markdown, and rewrites `[cv]` tokens into styled citation
 * badges. Uses DOM construction (no innerHTML on assistant text) to
 * avoid HTML injection via the streamed model output.
 *
 * Also handles: typing indicator, message-bubble fade-up entrance,
 * auto-scroll with 100-pixel scroll-up tolerance, mobile visualViewport
 * keyboard survival, keyboard UX (Enter / Shift+Enter / Escape),
 * send-button disabled state, and credit-distinct error rendering.
 */
export const CHAT_STREAMING_SCRIPT = `
(function () {
  var form = document.querySelector('form.composer-form');
  var list = document.querySelector('.message-list');
  var input = document.querySelector('.composer .textarea');
  var btn = form ? form.querySelector('button[type="submit"]') : null;
  if (!form || !list || !input || !btn) return;

  // ----- F6: markdown stripping + citation-badge buffering -----------
  function stripMarkdown(text) {
    return text
      .replace(/\\*\\*([^*]+)\\*\\*/g, '$1')
      .replace(/\\*([^*\\n]+)\\*/g, '$1')
      .replace(/\`([^\`\\n]+)\`/g, '$1')
      .replace(/^#{1,6}\\s+/gm, '')
      .replace(/^[\\s]*[-*+]\\s+/gm, '');
  }

  function splitForRender(text) {
    // Hold back a partial [cv] token so the user never sees [c or [cv literal.
    var partial = text.match(/\\[(?:c(?:v)?)?$/);
    var safe = partial ? text.slice(0, text.length - partial[0].length) : text;
    return { safe: safe, held: partial ? partial[0] : '' };
  }

  function renderInto(node, rawText) {
    var stripped = stripMarkdown(rawText);
    var sp = splitForRender(stripped);
    while (node.firstChild) node.removeChild(node.firstChild);
    var parts = sp.safe.split(/(\\[cv\\])/g);
    parts.forEach(function (part) {
      if (part === '[cv]') {
        var span = document.createElement('span');
        span.className = 'citation-chip citation-badge';
        span.textContent = 'cv';
        node.appendChild(span);
      } else if (part) {
        node.appendChild(document.createTextNode(part));
      }
    });
    // Keep partial token invisible — do NOT render sp.held.
  }

  function appendBubble(role) {
    var div = document.createElement('div');
    div.className = 'message message-' + role;
    list.appendChild(div);
    return div;
  }

  function appendTypingIndicator() {
    var wrap = document.createElement('div');
    wrap.className = 'message message-assistant typing-host';
    var ind = document.createElement('span');
    ind.className = 'typing-indicator';
    ind.setAttribute('aria-label', 'Assistant is typing');
    for (var i = 0; i < 3; i++) {
      var d = document.createElement('span');
      d.className = 'dot';
      ind.appendChild(d);
    }
    wrap.appendChild(ind);
    list.appendChild(wrap);
    return wrap;
  }

  // ----- F8: auto-scroll with 100-pixel tolerance ------------------------
  function maybeAutoscroll(force) {
    var doc = document.documentElement;
    var dist = doc.scrollHeight - window.scrollY - window.innerHeight;
    if (force || dist < 100) {
      window.scrollTo({ top: doc.scrollHeight, behavior: 'smooth' });
    }
  }

  // ----- F11: credit-distinct error rendering ------------------------
  function renderUpstreamError(bubble, res) {
    return res.json().then(function (data) {
      if (data && data.reason === 'credits') {
        bubble.textContent = 'Chat is temporarily unavailable — credit limit reached. Please try again later.';
      } else {
        bubble.textContent = 'Something went wrong reaching the model. Please try again later.';
      }
    }).catch(function () {
      bubble.textContent = 'Something went wrong. Please try again.';
    });
  }

  var history = [];

  function setSending(sending) {
    if (sending) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
    } else {
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  }

  function send(question) {
    appendBubble('user').textContent = question;
    maybeAutoscroll(true); // F8 unconditional on visitor submit
    var typing = appendTypingIndicator();
    var bubble = null;
    var acc = '';
    history.push({ role: 'user', content: question });
    setSending(true);

    function ensureBubble() {
      if (!bubble) {
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        bubble = appendBubble('assistant');
      }
    }

    fetch('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    }).then(function (res) {
      if (!res.ok) {
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        bubble = appendBubble('assistant');
        return renderUpstreamError(bubble, res);
      }
      if (!res.body) {
        ensureBubble();
        bubble.textContent = '(no stream)';
        return;
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      // SSE frames are delimited by \\n\\n. A single reader.read() may
      // deliver a partial frame; buffer across reads so a delta whose JSON
      // straddles a chunk boundary is not lost. Mirrors parseSseFrames /
      // extractDeltaText in src/views/client/sse-parser.ts (the unit-tested
      // source of truth — keep this inline copy in sync; the smoke test
      // src/__tests__/views/streaming-script.test.ts asserts on the
      // buffering pattern's presence).
      var sseBuf = '';
      function processFrame(frame) {
        var line = frame.split(/\\n/).filter(function (l) { return l.indexOf('data:') === 0; })[0];
        if (!line) return;
        try {
          var data = JSON.parse(line.slice(5).trim());
          if (data && data.delta && data.delta.type === 'text_delta' && typeof data.delta.text === 'string') {
            acc += data.delta.text;
            ensureBubble();
            renderInto(bubble, acc);
            maybeAutoscroll(false);
          }
        } catch (_e) { /* non-JSON frame */ }
      }
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            // Drain any final whole frame still in the buffer at close.
            if (sseBuf) {
              var tail = sseBuf;
              sseBuf = '';
              processFrame(tail);
            }
            if (acc) history.push({ role: 'assistant', content: acc });
            return;
          }
          sseBuf += dec.decode(r.value, { stream: true });
          var parts = sseBuf.split(/\\n\\n/);
          sseBuf = parts.pop() || '';
          parts.forEach(processFrame);
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      if (!bubble) bubble = appendBubble('assistant');
      bubble.textContent = 'Network error: ' + (err && err.message || 'unknown');
    }).then(function () {
      setSending(false);
    });
  }

  // ----- F10: keyboard UX --------------------------------------------
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter sends, Shift+Enter inserts newline.
      e.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

  function updateSendDisabled() {
    var v = (input.value || '').trim();
    if (!v) {
      btn.disabled = true;
    } else if (btn.textContent === 'Send' || btn.textContent === '') {
      btn.disabled = false;
    }
  }
  input.addEventListener('input', updateSendDisabled);
  updateSendDisabled();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = (input.value || '').trim();
    if (!q) return;
    input.value = '';
    updateSendDisabled();
    send(q);
  });

  document.querySelectorAll('.suggestions .chip').forEach(function (chipEl) {
    chipEl.addEventListener('click', function () {
      var q = chipEl.getAttribute('data-question') || chipEl.textContent || '';
      q = q.trim();
      if (q) send(q);
    });
  });

  // ----- F9: visualViewport for iOS keyboard survival ----------------
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      if (window.visualViewport) {
        document.body.style.setProperty('--vv-height', window.visualViewport.height + 'px');
      }
    });
  }
})();
`;
