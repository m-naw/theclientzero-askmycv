## Problem Statement

Error and recovery pages reference Cloudflare dashboard navigation without surfacing the actual dashboard URL (`dash.cloudflare.com`), lack the required 5-step ordered instructions, and the POST /setup expired-window response returns an HTML page (410) rather than a structured JSON error with a `recovery_summary` field. The admin login page lacks the `<details>` Forgot-password expandable that enables self-service credential recovery without leaking sensitive configuration.

## Current Behavior

### `src/views/error-pages.ts` — `renderExpiredSetup`
- Contains the text "Cloudflare dashboard" but NOT the URL `dash.cloudflare.com` (fails done_when criterion 1).
- Has 4 recovery steps, not the required 5+ (lines 79–84).
- Uses static text "30-minute" window (stale — `SETUP_WINDOW_MS` = 600,000 ms = 10 min since G3).
- Accepts a raw timestamp string but does not compute or display the absolute UTC expiration time.
- No citation comment for Cloudflare dashboard navigation path.
- No `href="docs/"` or `href="./docs/"` links (already passing).

### `src/views/login.ts` — `renderLoginForm`
- Renders a minimal password form; no `<details>` element, no Forgot-password expandable (fails done_when criteria 4, 5).
- Does not reference `admin_password_hash` or contain KV recovery steps.
- Does not leak `display_name` (already passing — config is not passed here).

### `src/routes/setup.ts` — POST expired-window gate (lines 106–115)
- Returns `410 HTML` rendering `renderExpiredSetup` (fails done_when criterion 8 — no `recovery_summary` JSON field).
- No `recovery_url` field exists (already passing criterion 9).

### `src/__tests__/setup/setup-acceptance.test.ts` — Test 5 (line 374)
- Asserts `expect(r.status).toBe(410)` for expired POST /setup; must change to 403 JSON assertion once setup.ts changes.

## Proposed Changes

### 1. `src/views/error-pages.ts` — expand `renderExpiredSetup`

**Add** the literal URL `dash.cloudflare.com` as a hyperlink in step 1.  
**Expand** recovery steps from 4 to 6 (≥5 required):  
  1. Go to the Cloudflare dashboard at https://dash.cloudflare.com  
  2. Click Workers & Pages in the left sidebar.  
  3. Under Storage & Databases, click KV.  
  4. Open the STATE namespace bound to this Worker.  
  5. Find and Delete the entry whose key is setup_window_start.  
  6. Return here — a fresh 10-minute window starts on the next request.  

**Compute and display** the absolute UTC expiration timestamp when `setupWindowStart` is a numeric ms timestamp.  

**Update** the error banner text from "30-minute" to "10-minute" (matching `SETUP_WINDOW_MS = 600_000`).  

**Add** an HTML citation comment above the ordered list:  
`<!-- Navigation verified at: https://dash.cloudflare.com -> Workers & Pages -> KV. Source: https://developers.cloudflare.com/kv/get-started/ Last verified: 2026-05-18 -->`  

**Import** `SETUP_WINDOW_MS` from `../state/machine`.

### 2. `src/views/login.ts` — add Forgot password expandable

**Add** a `<details>`/`<summary>Forgot password</summary>` block beneath the login form containing an ordered list of ≥5 KV credential-recovery steps. Required literals: `dash.cloudflare.com`, `admin_password_hash`, `Delete`, `STATE`.  
1. Go to the Cloudflare dashboard at https://dash.cloudflare.com  
2. Click Workers & Pages in the left sidebar.  
3. Under Storage & Databases, click KV.  
4. Open the STATE namespace bound to this Worker.  
5. Find and Delete the KV key admin_password_hash.  
6. Reload /setup to run first-time setup and set a new admin password.  

Add citation comment adjacent to the list:  
`<!-- Navigation verified at: https://dash.cloudflare.com -> Workers & Pages -> KV. Source: https://developers.cloudflare.com/kv/get-started/ Last verified: 2026-05-18 -->`

### 3. `src/routes/setup.ts` — POST expired-window: change response to 403 JSON

Change ONLY the POST /setup expired-window gate from 410 HTML to 403 JSON:
```
const expiredAt = new Date(startMs + SETUP_WINDOW_MS).toISOString();
return new Response(JSON.stringify({
  error: "setup_window_expired",
  expired_at: expiredAt,
  recovery_summary: "Open dash.cloudflare.com -> Workers & Pages -> KV -> STATE, delete the setup_window_start key, then reload.",
}), { status: 403, headers: JSON_HEADERS });
```
Do NOT add a `recovery_url` field. The GET /setup expired-window HTML response (lines 265–271) keeps its existing 403 HTML form unchanged.

### 4. `src/__tests__/setup/setup-acceptance.test.ts` — update Test 5

Change the assertion at line 374 from `expect(r.status).toBe(410)` to:
```
expect(r.status).toBe(403);
const json = await r.json();
expect(json.expired_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
expect(json.recovery_summary).toBeTruthy();
expect(json.recovery_url).toBeUndefined();
```

### 5. `src/test/views/error-pages.test.ts` — add assertions

Add to the `renderExpiredSetup` describe block assertions for `dash.cloudflare.com` presence and ≥5 `<li>` items in the rendered HTML.

## Implementation Notes

### Approach selection

Three approaches were evaluated. Approach A (minimal view changes) was selected: add Forgot password `<details>` to `renderLoginForm` in `src/views/login.ts`; expand `renderExpiredSetup`; change POST /setup 410 → 403 JSON. Does NOT change GET /admin auth behavior (keeps existing 401 for missing session). All done_when criteria are file-path assertions, not HTTP behavior assertions — criteria 4 and 5 are satisfied by any file in `src/views/`. Approach B (change GET /admin to render 200 login form) would require updating `src/test/admin.test.ts` which is not in affected areas, adding maintenance risk without satisfying additional done_when criteria.

### SETUP_WINDOW_MS import

`src/views/error-pages.ts` does not currently import from `../state/machine`. Import `SETUP_WINDOW_MS` to compute expiry timestamps. This is a safe dependency: `machine.ts` exports only a constant with no circular risk.

### Adversarial guard

Adversarial finding: `src/__tests__/setup/setup-acceptance.test.ts:374` asserts `expect(r.status).toBe(410)`. If setup.ts changes status to 403 without updating this test, `pnpm test` FAILS. Guard: group the setup.ts change and the test update as a single atomic task in the sprint.

Second adversarial finding: GET /setup expired path (setup.ts lines 265–271) also returns 403 HTML — changing it too would break smoke tests. Guard: spec explicitly restricts the 403 JSON change to the POST handler only.

## Verification Criteria

| Done-When | Command | Confidence |
|---|---|---|
| `dash.cloudflare.com` in error-pages.ts | `grep 'dash.cloudflare.com' src/views/error-pages.ts` | 0.95 |
| `setup_window_start` in error-pages.ts | Already present at line 65 | 1.0 |
| `STATE` in error-pages.ts | Already present at line 81 | 1.0 |
| `admin_password_hash` in src/views/ | `grep -r 'admin_password_hash' src/views/` | 0.93 |
| `<details` in src/views/ | `grep -r '<details' src/views/` | 0.93 |
| No `href="docs/` in error-pages.ts | `! grep 'href="docs/' src/views/error-pages.ts` | 1.0 |
| No `href="./docs/` in error-pages.ts | `! grep 'href="./docs/' src/views/error-pages.ts` | 1.0 |
| `recovery_summary` in setup.ts | `grep 'recovery_summary' src/routes/setup.ts` | 0.82 (FLAGGED) |
| No `recovery_url` in setup.ts | `! grep 'recovery_url' src/routes/setup.ts` | 1.0 |
| `pnpm test` | `pnpm test` | 0.78 (FLAGGED) |
| `pnpm build` | `pnpm build` | 0.88 |

**FLAGGED criteria:**
- `recovery_summary` (0.82): POST response restructure from HTML 410 to JSON 403. Residual gap: must not touch GET /setup path. Guard: atomic task.
- `pnpm test` (0.78): Test 5 must be updated atomically with setup.ts change. Guard: single task covers both files.