## Problem Statement

Error and recovery pages do not include fully self-contained inline recovery instructions. The setup-window-expired page lacks the required Cloudflare dashboard URL (`dash.cloudflare.com`), has only 4 recovery steps, and shows a stale 30-minute label. The admin login page has no Forgot-password expandable, so password recovery has no inline guidance. The POST /setup expired-window response returns `410 HTML` instead of a structured `403 JSON` with `recovery_summary`. This forces users to search for external documentation, violating the META UX inline-instructions principle.

## Current Behavior

### `src/views/error-pages.ts` — `renderExpiredSetup` (lines 63–88)
- Contains text "Cloudflare dashboard" but NOT the URL literal `dash.cloudflare.com` — criterion 1 UNMET.
- Has only 4 `<li>` recovery steps — fewer than the required 5 — criterion derived from behavior scenario 1 UNMET.
- Banner says "30-minute" (stale — `SETUP_WINDOW_MS` = 600,000 ms = 10 min as of G3).
- `setupWindowStart` is a raw ms-since-epoch string; no absolute UTC expiration time is computed or displayed.
- `setup_window_start` literal present at line 65 ✓; `STATE` literal present at line 81 ✓; no `href="docs/` or `href="./docs/` ✓.

### `src/views/login.ts` — `renderLoginForm` (lines 29–57)
- No `<details>` element, no Forgot-password expandable — criteria 4 and 5 UNMET.
- No reference to `admin_password_hash` — criterion 4 UNMET.
- Does not leak `display_name` (config is not passed here) ✓.

### `src/routes/setup.ts` — POST expired-window gate (lines 106–115)
- Returns `new Response(renderExpiredSetup(...), { status: 410, headers: HTML_HEADERS })` — HTML not JSON; no `recovery_summary` field — criterion 8 UNMET.
- No `recovery_url` field anywhere ✓ — criterion 9 already met.

### `src/__tests__/setup/setup-acceptance.test.ts` — Test 5 (line 374)
- `expect(r.status).toBe(410)` — will fail after setup.ts changes to 403 JSON; must be updated atomically.

## Proposed Changes

### 1. `src/views/error-pages.ts` — expand `renderExpiredSetup`

Add import: `import { SETUP_WINDOW_MS } from "../state/machine";`

Compute UTC expiration and display it:
```typescript
const expiredAt = props.setupWindowStart
  ? new Date(Number(props.setupWindowStart) + SETUP_WINDOW_MS).toUTCString()
  : null;
const expiryLine = expiredAt
  ? `<p class="muted">Window expired at: <code>${escapeHtml(expiredAt)}</code></p>`
  : "";
```

Fix banner label from "30-minute" to "10-minute" (matches `SETUP_WINDOW_MS = 600_000`).

Expand `<ol>` from 4 to 6 steps and add `dash.cloudflare.com` URL:
```html
<!-- Navigation path verified at dash.cloudflare.com → Workers & Pages → Storage & Databases → KV.
     Source: https://developers.cloudflare.com/kv/get-started/ Last verified: 2026-05-18 -->
<ol>
  <li>Open the Cloudflare dashboard at
    <a href="https://dash.cloudflare.com">dash.cloudflare.com</a>.</li>
  <li>Click <strong>Workers &amp; Pages</strong> in the left sidebar.</li>
  <li>Under <strong>Storage &amp; Databases</strong>, click <strong>KV</strong>.</li>
  <li>Open the <code>STATE</code> namespace bound to this Worker.</li>
  <li>Find and <strong>Delete</strong> the entry whose key is <code>setup_window_start</code>.</li>
  <li>Return here — a fresh 10-minute window starts on the next request.</li>
</ol>
```

Insert `${expiryLine}` in the card section above the recovery `<h2>`.

### 2. `src/views/login.ts` — add Forgot-password `<details>` expandable

Add a `<details>` block beneath the `</form>` tag:
```html
<details class="forgot-password">
  <summary>Forgot password</summary>
  <!-- Navigation path verified at dash.cloudflare.com → Workers & Pages → Storage & Databases → KV.
       Source: https://developers.cloudflare.com/kv/get-started/ Last verified: 2026-05-18 -->
  <ol>
    <li>Open the Cloudflare dashboard at
      <a href="https://dash.cloudflare.com">dash.cloudflare.com</a>.</li>
    <li>Click <strong>Workers &amp; Pages</strong> in the left sidebar.</li>
    <li>Under <strong>Storage &amp; Databases</strong>, click <strong>KV</strong>.</li>
    <li>Open the <code>STATE</code> namespace bound to this Worker.</li>
    <li>Find and <strong>Delete</strong> the KV key <code>admin_password_hash</code>.</li>
    <li>Navigate to <code>/setup</code> to run first-time setup and set a new admin password.</li>
  </ol>
</details>
```

This satisfies: `<details` in src/views ✓, `admin_password_hash` in src/views ✓, `dash.cloudflare.com` in login view ✓, `Delete` ✓, `STATE` ✓.

### 3. `src/routes/setup.ts` — change POST expired-window response from 410 HTML to 403 JSON

Replace lines 107–115:
```typescript
// OLD:
return new Response(renderExpiredSetup({ setupWindowStart: String(startMs) }), {
  status: 410,
  headers: HTML_HEADERS,
});

// NEW:
const expiredAt = new Date(startMs + SETUP_WINDOW_MS).toISOString();
return new Response(JSON.stringify({
  error: "setup_window_expired",
  expired_at: expiredAt,
  recovery_summary: "Open dash.cloudflare.com → Workers & Pages → Storage & Databases → KV → STATE, delete the setup_window_start key, then reload /setup.",
}), {
  status: 403,
  headers: JSON_HEADERS,
});
```

Do NOT add a `recovery_url` field. Do NOT change the GET /setup expired-window path (lines 265–271) — it keeps its existing 403 HTML form.

### 4. `src/__tests__/setup/setup-acceptance.test.ts` — update Test 5 atomically with #3

Change the comment and assertion at line 372–374:
```typescript
// OLD:
// (2) POST /setup with valid body and expired window → 410
mockAnthropicOk();
const r = await runFetch(setupRequest(null, validFormBody()));
expect(r.status).toBe(410);

// NEW:
// (2) POST /setup with valid body and expired window → 403 JSON with recovery_summary
mockAnthropicOk();
const r = await runFetch(setupRequest(null, validFormBody()));
expect(r.status).toBe(403);
const json = await r.json() as { error?: string; expired_at?: string; recovery_summary?: string; recovery_url?: string };
expect(json.expired_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
expect(json.recovery_summary).toBeTruthy();
expect(json.recovery_url).toBeUndefined();
```

### 5. `src/test/views/error-pages.test.ts` — add new assertions

Add to the `renderExpiredSetup` describe block:
```typescript
it("includes a link to dash.cloudflare.com", () => {
  expect(html).toContain("dash.cloudflare.com");
});
it("has at least 5 recovery steps", () => {
  const liMatches = html.match(/<li/g) ?? [];
  expect(liMatches.length).toBeGreaterThanOrEqual(5);
});
```

## Implementation Notes

### Root cause of Attempt 1 failure

The executor workspace (`/tmp/strategos-workspaces/STR-64bdcbc6-40f5-4bde-a345-6fbb2a4a1eec/askmycv`) confirmed at commit `20f193d` (G5 era) — ALL G6 done_when criteria are UNMET. Prior attempt commits (`b71529b`, `9d058a6`, `f06d11c`) appear only in the spec-planner's repo, not the executor workspace. This spec plans complete G6 work from the G5 baseline.

### Approach selection (brainstorming survivors)

**Approach A — minimal view edits only (selected):** Modify `renderLoginForm` in `src/views/login.ts` for Forgot-password `<details>`; expand `renderExpiredSetup` in `src/views/error-pages.ts`; change POST /setup gate from 410 HTML → 403 JSON with `recovery_summary`. All done_when criteria are file-path assertions (`grep -r` on `src/views/`, `src/routes/setup.ts`) — satisfied by Approach A without touching GET /admin auth behavior.

**Approach B — change GET /admin to return 200 login form on unauthenticated:** More aligned with behavior scenario 2 literal reading. Falsifier: `src/test/admin.test.ts:162` tests `expect(res.status).toBe(401)` for missing session — would require updating test file not in affected areas. Rejected: unnecessary scope creep, criteria 4/5 are path-based not route-behavior-based.

**Approach C — new renderAdminNotAuthenticated view in error-pages.ts:** Adds a third rendering path that duplicates login form content. Falsifier: `grep 'admin_password_hash' src/views/error-pages.ts` would need to find it there — but this creates duplicated recovery logic. Rejected: login form is the natural UX location.

### Critical atomic guard

POST /setup expired gate change (410 HTML → 403 JSON) and Test 5 update MUST be in the same task. If setup.ts changes without the test update, `pnpm test` fails at `setup-acceptance.test.ts:374`. This is the most likely root cause of any prior iteration-level failures.

### GET /setup path isolation guard

setup.ts has TWO expired-window checks: POST (lines 107–115) and GET (lines 265–271). Only the POST path changes to JSON. GET keeps its existing 403 HTML. Changing the GET path would break smoke tests that check for HTML content on expired GET /setup.

### SETUP_WINDOW_MS import

`src/views/error-pages.ts` does not currently import from `../state/machine`. Add `import { SETUP_WINDOW_MS } from "../state/machine";` — safe dependency, exports only a constant.

### Citation requirement

Both `renderExpiredSetup` and the login Forgot-password block must carry an HTML comment citing the Cloudflare KV navigation source URL: `https://developers.cloudflare.com/kv/get-started/` with `Last verified: 2026-05-18`.

## Verification Criteria

| Done-When Criterion | Verification Command | Confidence | Status |
|---|---|---|---|
| `dash.cloudflare.com` in error-pages.ts | `grep 'dash.cloudflare.com' src/views/error-pages.ts` | 0.95 | UNMET — needs edit |
| `setup_window_start` in error-pages.ts | `grep 'setup_window_start' src/views/error-pages.ts` | 1.0 | ALREADY MET (line 65) |
| `STATE` in error-pages.ts | `grep 'STATE' src/views/error-pages.ts` | 1.0 | ALREADY MET (line 81) |
| `admin_password_hash` in src/views/ | `grep -r 'admin_password_hash' src/views/` | 0.93 | UNMET — add to login.ts |
| `<details` in src/views/ | `grep -r '<details' src/views/` | 0.93 | UNMET — add to login.ts |
| No `href="docs/` in error-pages.ts | `! grep 'href="docs/' src/views/error-pages.ts` | 1.0 | ALREADY MET |
| No `href="./docs/` in error-pages.ts | `! grep 'href="./docs/' src/views/error-pages.ts` | 1.0 | ALREADY MET |
| `recovery_summary` in setup.ts | `grep 'recovery_summary' src/routes/setup.ts` | 0.82 | UNMET — FLAGGED |
| No `recovery_url` in setup.ts | `! grep 'recovery_url' src/routes/setup.ts` | 1.0 | ALREADY MET |
| `pnpm test` passes | `pnpm test` | 0.78 | UNMET — FLAGGED; requires atomic impl+test change |
| `pnpm build` passes | `pnpm build` | 0.88 | Needs SETUP_WINDOW_MS import |

**FLAGGED criteria:**
- `recovery_summary` (0.82): POST response restructure from HTML 410 → JSON 403. Guard: restrict change to POST path only, not GET.
- `pnpm test` (0.78): Test 5 must be updated atomically with setup.ts POST path change. Guard: both edits in a single implementation task.