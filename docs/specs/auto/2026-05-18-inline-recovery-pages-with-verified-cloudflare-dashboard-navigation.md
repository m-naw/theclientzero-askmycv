## Problem Statement

Error and recovery pages do not include fully self-contained inline recovery instructions. The setup-window-expired page lacks the required Cloudflare dashboard URL (`dash.cloudflare.com`), has only 4 recovery steps (5 required), shows a stale 30-minute window label, and does not display the absolute UTC expiration time. The admin login page has no Forgot-password expandable with KV recovery instructions. The POST /setup expired-window response returns `410 HTML` instead of `403 JSON` with a `recovery_summary` field.

## Current Behavior

### `src/views/error-pages.ts` — `renderExpiredSetup`
- 4 `<li>` items (needs ≥5)
- Text says "Cloudflare dashboard" but does NOT contain URL literal `dash.cloudflare.com`
- Banner says "30-minute" (stale — `SETUP_WINDOW_MS` is 600,000 ms = 10 min)
- `setup_window_start` literal present (line 65) ✓; `STATE` literal present (line 81) ✓
- No `href="docs/` or `href="./docs/` ✓
- No `SETUP_WINDOW_MS` import; no UTC expiration timestamp computed

### `src/views/login.ts` — `renderLoginForm`
- No `<details>` element, no Forgot-password expandable
- No reference to `admin_password_hash`
- Does not leak `display_name` (config not passed here) ✓

### `src/routes/setup.ts` — POST expired-window gate
- Returns `new Response(renderExpiredSetup(...), { status: 410, headers: HTML_HEADERS })`
- No `recovery_summary` field — criterion UNMET
- No `recovery_url` field ✓

### `src/__tests__/setup/setup-acceptance.test.ts` — Test 5
- Asserts `expect(r.status).toBe(410)` — must change to 403 JSON assertion atomically with setup.ts change

## Proposed Changes

### CRITICAL FIRST: `src/routes/setup.ts` — POST expired-window → 403 JSON with recovery_summary

**This is the highest-priority change and root cause of all prior iteration failures.**

Replace the POST expired-window response (lines ~107–115):
```typescript
// REMOVE:
return new Response(renderExpiredSetup({ setupWindowStart: String(startMs) }), {
  status: 410,
  headers: HTML_HEADERS,
});

// ADD:
const expiredAt = new Date(startMs + SETUP_WINDOW_MS).toISOString();
return new Response(JSON.stringify({
  error: "setup_window_expired",
  expired_at: expiredAt,
  recovery_summary: "Open dash.cloudflare.com, navigate to Workers & Pages > Storage & Databases > KV, open the STATE namespace, delete the setup_window_start key, then reload /setup.",
}), {
  status: 403,
  headers: JSON_HEADERS,
});
```

Do NOT change the GET /setup expired path (keeps existing 403 HTML). Do NOT add `recovery_url`.

### ATOMIC WITH setup.ts: `src/__tests__/setup/setup-acceptance.test.ts` — update Test 5

Change lines ~372–374 from:
```typescript
// (2) POST /setup with valid body and expired window → 410
mockAnthropicOk();
const r = await runFetch(setupRequest(null, validFormBody()));
expect(r.status).toBe(410);
```
To:
```typescript
// (2) POST /setup with valid body and expired window → 403 JSON with recovery_summary
mockAnthropicOk();
const r = await runFetch(setupRequest(null, validFormBody()));
expect(r.status).toBe(403);
const json = await r.json() as { error?: string; expired_at?: string; recovery_summary?: string; recovery_url?: string };
expect(json.expired_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
expect(json.recovery_summary).toBeTruthy();
expect(json.recovery_url).toBeUndefined();
```

**These two edits must be in the same commit. Neither is valid alone.**

### `src/views/error-pages.ts` — expand `renderExpiredSetup`

Add import at top of file:
```typescript
import { SETUP_WINDOW_MS } from "../state/machine";
```

Compute UTC expiration:
```typescript
const expiredAt = props.setupWindowStart
  ? new Date(Number(props.setupWindowStart) + SETUP_WINDOW_MS).toUTCString()
  : null;
const expiryLine = expiredAt
  ? `<p class="muted">Window expired at: <code>${escapeHtml(expiredAt)}</code></p>`
  : "";
```

Update banner: "30-minute" → "10-minute".

Expand `<ol>` from 4 to 6 steps with `dash.cloudflare.com` URL:
```html
<!-- Source: https://developers.cloudflare.com/kv/get-started/ Last verified: 2026-05-18 -->
<ol>
  <li>Open the Cloudflare dashboard at
    <a href="https://dash.cloudflare.com">dash.cloudflare.com</a>.</li>
  <li>Click <strong>Workers &amp; Pages</strong> in the left sidebar.</li>
  <li>Under <strong>Storage &amp; Databases</strong>, click <strong>KV</strong>.</li>
  <li>Open the <code>STATE</code> namespace bound to this Worker.</li>
  <li>Find and <strong>Delete</strong> the entry whose key is
    <code>setup_window_start</code>.</li>
  <li>Return here — a fresh 10-minute window starts on the next request.</li>
</ol>
```

Insert `${expiryLine}` above `<h2>Recovery</h2>`.

### `src/views/login.ts` — add Forgot-password `<details>` expandable

Add after `</form>` in the body template:
```html
<details class="forgot-password">
  <summary>Forgot password</summary>
  <!-- Source: https://developers.cloudflare.com/kv/get-started/ Last verified: 2026-05-18 -->
  <ol>
    <li>Open the Cloudflare dashboard at
      <a href="https://dash.cloudflare.com">dash.cloudflare.com</a>.</li>
    <li>Click <strong>Workers &amp; Pages</strong> in the left sidebar.</li>
    <li>Under <strong>Storage &amp; Databases</strong>, click <strong>KV</strong>.</li>
    <li>Open the <code>STATE</code> namespace bound to this Worker.</li>
    <li>Find and <strong>Delete</strong> the KV key
      <code>admin_password_hash</code>.</li>
    <li>Navigate to <code>/setup</code> to run first-time setup and set a new
      admin password.</li>
  </ol>
</details>
```

### `src/test/views/error-pages.test.ts` — add test assertions

Add to the `renderExpiredSetup` describe block:
```typescript
it("includes a link to dash.cloudflare.com", () => {
  expect(html).toContain("dash.cloudflare.com");
});
it("has at least 5 recovery steps", () => {
  const liCount = (html.match(/<li/g) ?? []).length;
  expect(liCount).toBeGreaterThanOrEqual(5);
});
```

## Implementation Notes

### Root cause of attempts 1 and 2 failures

The executor workspace is confirmed at G5-era state (commit `20f193d`) with ALL G6 done_when criteria unmet. Prior attempts made partial progress on views but never addressed the `recovery_summary` criterion in `src/routes/setup.ts`. The iteration verifier found this criterion unmet and failed the iteration.

### Atomic constraint (CRITICAL)

The setup.ts POST gate change (410 HTML → 403 JSON) and the Test 5 update in `src/__tests__/setup/setup-acceptance.test.ts` MUST be in the same commit/task. If either is done without the other, `pnpm test` will fail:
- setup.ts changed without test: Test 5 expects 410, gets 403 → FAIL
- test changed without setup.ts: Test 5 expects 403, gets 410 → FAIL

### GET /setup path isolation

setup.ts has TWO expired-window gates: POST (change to 403 JSON) and GET (keep as 403 HTML). Do NOT change the GET path — it would break smoke tests.

### No `recovery_url` added

`grep-not:recovery_url:src/routes/setup.ts` is currently passing (no recovery_url exists). The new JSON response must NOT include a `recovery_url` field.

### Falsifier verification commands

After all edits, run these in order:
1. `grep 'dash.cloudflare.com' src/views/error-pages.ts` — must find a hit
2. `grep -r 'admin_password_hash' src/views/` — must find a hit
3. `grep -r '<details' src/views/` — must find a hit
4. `grep 'recovery_summary' src/routes/setup.ts` — must find a hit
5. `! grep 'recovery_url' src/routes/setup.ts` — must find no hit
6. `pnpm test` — must exit 0
7. `pnpm build` — must exit 0

## Verification Criteria

| Criterion | Verification | Status | Confidence |
|---|---|---|---|
| `dash.cloudflare.com` in error-pages.ts | `grep 'dash.cloudflare.com' src/views/error-pages.ts` | UNMET | 0.95 |
| `setup_window_start` in error-pages.ts | `grep 'setup_window_start' src/views/error-pages.ts` | MET (line 65) | 1.0 |
| `STATE` in error-pages.ts | `grep 'STATE' src/views/error-pages.ts` | MET (line 81) | 1.0 |
| `admin_password_hash` in src/views/ | `grep -r 'admin_password_hash' src/views/` | UNMET | 0.93 |
| `<details` in src/views/ | `grep -r '<details' src/views/` | UNMET | 0.93 |
| No `href="docs/` in error-pages.ts | `! grep 'href="docs/' src/views/error-pages.ts` | MET | 1.0 |
| No `href="./docs/` in error-pages.ts | `! grep 'href="./docs/' src/views/error-pages.ts` | MET | 1.0 |
| `recovery_summary` in setup.ts | `grep 'recovery_summary' src/routes/setup.ts` | UNMET — ROOT CAUSE | 0.82 |
| No `recovery_url` in setup.ts | `! grep 'recovery_url' src/routes/setup.ts` | MET | 1.0 |
| `pnpm test` passes | `pnpm test` | UNMET — blocked by 410→403 | 0.78 |
| `pnpm build` | `pnpm build` | NEEDS SETUP_WINDOW_MS import | 0.88 |

**FLAGGED:** `recovery_summary` (0.82) and `pnpm test` (0.78) are the exact criteria that caused both prior iteration failures. Guard: treat Task 1 as setup.ts+test atomic change, verify with `pnpm test` before committing.