# G6 Spec: Inline Recovery Pages with Verified Cloudflare Dashboard Navigation

## Context

This is attempt 4. All three prior attempts failed:
- Attempt 1: View changes made but `recovery_summary` never added to setup.ts → iteration_failure
- Attempt 2: Only added SETUP_WINDOW_MS import → recovery_summary still missing → iteration_failure
- Attempt 3: Sprint task itself FAILED (totalFailed:1) — likely added test assertions before implementing the feature, OR changed setup.ts without atomically updating Test 5 → pnpm test broke

The executor workspace is at G5 baseline (commit `20f193d`). ALL 5 unmet G6 criteria need to be addressed.

## Unmet Done-When Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `fs:contains src/views/error-pages.ts dash.cloudflare.com` | UNMET |
| 4 | `grep:admin_password_hash:src/views` | UNMET |
| 5 | `fs:contains-regex src/views /<details/` | UNMET |
| 8 | `fs:contains-regex src/routes/setup.ts /recovery_summary/` | UNMET |
| 10 | `pnpm test` | UNMET (test 5 still expects 410) |
| 11 | `pnpm build` | UNMET |

Criteria 2, 3, 6, 7, 9 are already met and must not be broken.

## OBJECTIVE 1 — ATOMIC: Fix POST /setup Expired Gate + Test 5 (HIGHEST PRIORITY)

### Why atomic

Test 5 in `src/__tests__/setup/setup-acceptance.test.ts` line 374 currently asserts `expect(r.status).toBe(410)`. If setup.ts is changed to return 403 without simultaneously updating the test, `pnpm test` fails. Conversely, if the test is updated before setup.ts is changed, it also fails. Both files MUST change in the same commit.

### Change: `src/routes/setup.ts` — POST expired gate

Current code (lines ~107–115):
```typescript
return new Response(renderExpiredSetup({ setupWindowStart: swsRaw ?? undefined }), {
  status: 410,
  headers: HTML_HEADERS,
});
```

Change to return 403 JSON with `recovery_summary`:
```typescript
return new Response(
  JSON.stringify({
    error: "setup_window_expired",
    recovery_summary: "Delete the 'setup_window_start' key from the STATE KV namespace in the Cloudflare dashboard, then reload this page to start a fresh 10-minute setup window.",
  }),
  {
    status: 403,
    headers: { "content-type": "application/json" },
  },
);
```

IMPORTANT: Do NOT change the GET /setup expired gate (lines ~265–271) — it stays 403 HTML.

### Change: `src/__tests__/setup/setup-acceptance.test.ts` — Test 5 (atomic with above)

Current Test 5 (line 374):
```typescript
expect(r.status).toBe(410);
```

Change to:
```typescript
expect(r.status).toBe(403);
const json = await r.json() as Record<string, unknown>;
expect(typeof json.recovery_summary).toBe("string");
expect(json.error).toBe("setup_window_expired");
```

Note: The test may also read `r.text()` or use other patterns — read the full test context before editing to preserve structure. The key invariant is: status 403, JSON body, `recovery_summary` string field, `error: "setup_window_expired"`.

## OBJECTIVE 2 — Expand `renderExpiredSetup` in `src/views/error-pages.ts`

### Changes required

1. **Add `dash.cloudflare.com` link** (satisfies criterion 1): Recovery step 1 must link to `https://dash.cloudflare.com` with descriptive anchor text (e.g., `<a href="https://dash.cloudflare.com">Cloudflare dashboard</a>`).

2. **Expand to 6+ recovery steps** (better UX, unambiguous navigation):
   - Step 1: Open `https://dash.cloudflare.com` and sign in to your account
   - Step 2: Navigate to **Workers & Pages** in the left sidebar
   - Step 3: Select your Worker, then open the **KV** tab (or navigate to **Storage → KV Namespaces**)
   - Step 4: Open the `STATE` namespace bound to this Worker
   - Step 5: Find and delete the key `setup_window_start`
   - Step 6: Reload this page — a fresh 10-minute window starts on the next request

3. **Fix stale "30-minute" copy**: Change to "10-minute" throughout (matches `SETUP_WINDOW_MS = 600_000`).

4. **Import `SETUP_WINDOW_MS`** and compute UTC expiry from `setupWindowStart`:
   ```typescript
   import { SETUP_WINDOW_MS } from "../state/machine";
   ```
   Then compute: if `setupWindowStart` is provided, display the expiry time as a human-readable UTC string.

5. **Add `admin_password_hash` reference** (satisfies criterion 4): In the KV deletion list or a note, mention that if you also need to clear credentials, delete `admin_password_hash` from the same namespace.

### Invariants to preserve
- `setup_window_start` literal MUST remain (criterion 2, already met)
- `STATE` literal MUST remain (criterion 3, already met)
- NO `href="docs/"` links (criterion 6, already met)
- NO `href="./docs/"` links (criterion 7, already met)

## OBJECTIVE 3 — Add Forgot-Password `<details>` to `renderLoginForm` in `src/views/login.ts`

### Changes required

1. **Add `<details>` element** (satisfies criterion 5): Below the login form, add a collapsed `<details><summary>Forgot password / locked out?</summary>...</details>` section.

2. **Reference `admin_password_hash`** (satisfies criterion 4 if not already met by OBJ2): Inside `<details>`, explain that to reset credentials, the user must delete `admin_password_hash` from the `STATE` KV namespace.

3. **Link to `dash.cloudflare.com`**: Inside `<details>`, include a link to `https://dash.cloudflare.com` for navigation to the KV namespace.

4. Example structure:
   ```html
   <details class="recovery-hint">
     <summary>Forgot password / locked out?</summary>
     <div class="card">
       <p>To reset your admin password:</p>
       <ol>
         <li>Open <a href="https://dash.cloudflare.com">dash.cloudflare.com</a> and navigate to your Worker's KV namespace (<code>STATE</code>).</li>
         <li>Delete the key <code>admin_password_hash</code>.</li>
         <li>Re-run setup at <code>/setup</code> to set a new password.</li>
       </ol>
     </div>
   </details>
   ```

### Invariants to preserve
- Form must still have `name="admin_password"` password input
- POST action must remain `/login`
- API key must never appear in this page (already true — this view has no access to it)

## OBJECTIVE 4 — Verify with `pnpm test` and `pnpm build`

After all three objectives are complete:
1. Run `pnpm test` — must pass (especially Test 5, which verifies the 403 JSON response)
2. Run `pnpm build` — must produce zero errors

## Hard Constraints (must not be violated)

1. The Anthropic API key never appears in any HTML response or worker console output.
2. The admin plaintext password is never persisted in any KV value; only its bcrypt or argon2id hash is stored.
3. The daily Anthropic spend cap and the per-IP chat rate limit are enforced on every chat request; no bypass path exists.
4. GET / and POST /chat remain unauthenticated; admin login is never required to view the public chat.
5. Cloudflare Access JWT verification is auto-detected and optional; it is never hardcoded as mandatory.
6. No production-visible variable used for test mocking is introduced into wrangler.toml [vars].

## Implementation Order (CRITICAL)

1. **First**: Read `src/routes/setup.ts` and `src/__tests__/setup/setup-acceptance.test.ts` to understand current Test 5 structure
2. **Second**: Edit BOTH files (setup.ts + test) in the same commit — this is the blocking criterion
3. **Third**: Expand `src/views/error-pages.ts` (renderExpiredSetup)
4. **Fourth**: Update `src/views/login.ts` (add `<details>`)
5. **Last**: Run `pnpm test` then `pnpm build` to verify all criteria

Do NOT run tests or add test assertions before implementing the features they assert.