## Problem Statement

Attempt 2 left exactly one criterion UNMET: C24 (pnpm test). 10 tests in `src/test/views/token-discipline.test.ts` fail because `src/views/admin-form.ts` lines 30-31 contain the hex literal `#c0392b` as a CSS variable fallback value. The token-discipline test rule prohibits raw hex color literals in all view files except `src/views/design-tokens.ts`.

## Current Behavior

`src/views/admin-form.ts:30-31` contains:
```
style="border-color: var(--color-error, #c0392b);"
style="color: var(--color-error, #c0392b);"
```

The hex fallback `#c0392b` violates `src/test/views/token-discipline.test.ts` which rejects any raw hex literal in a view file other than `design-tokens.ts`. All 25 other done_when criteria are already MET per attempt 2 evidence. Only these two inline-style fallbacks need to change.

## Proposed Changes

**`src/views/admin-form.ts` lines 30-31:** Remove the hex fallback from both `var(--color-error, #c0392b)` expressions:

```
// Before (lines 30-31):
style="border-color: var(--color-error, #c0392b);"
style="color: var(--color-error, #c0392b);"

// After:
style="border-color: var(--color-error);"
style="color: var(--color-error);"
```

This is the only change required. `--color-error` is already defined in `src/views/design-tokens.ts:78` as `#c92a2a`, so the CSS variable is always resolved by the design-token stylesheet injected at render time. The fallback is unnecessary and violates the project's token discipline rule.

No other file changes are needed.

## Implementation Notes

**Why this approach and not alternatives:**
- Option A (remove hex fallbacks): 2-char deletion × 2 lines, zero behavioral change, directly fixes the violation. Chosen.
- Option B (replace inline styles with CSS class): More change surface, risks altering the Danger Zone HTML content and potentially breaking the done_when regex `/Danger zone[\s\S]{0,2000}Reset all configuration/`.
- Option C (add admin-form.ts to token-discipline allowlist): Modifies test file, increases future drift risk.

**Adversarial check — can this pass the token test while breaking the Danger Zone?** The `--color-error` CSS variable is always injected via `design-tokens.ts` stylesheet at page render. No browser context exists where the fallback would be needed. The fallback removal is safe.

**All 25 other criteria are MET per attempt-2 evidence:**
- bcryptjs in package.json with saltRounds=12 ✓
- HMAC-SHA256 session signing in src/auth/session.ts ✓
- setTimeout delay in src/routes/admin.ts ✓
- admin_password_hash, cookie_signing_secret, askmycv_admin_session, DELETE ALL CONFIG in src/ ✓
- SETUP_WINDOW_MS=600_000 in state/machine.ts ✓
- HttpOnly, SameSite=Lax in src/ ✓
- src/__tests__ test patterns MET ✓
- docs/specs/auth-surface.md with both KV key names ✓
- scripts/check-contract-parity.mjs exists and exits 0 ✓
- Danger Zone + Reset all configuration in admin-form.ts ✓
- public_url/admin_url adjacency in setup.ts ✓
- 50_000 literal near cv_markdown ✓
- 100*1024/413 enforcement ✓
- No console.log of sensitive keys ✓
- pnpm build ✓
- pnpm typecheck ✓

## Verification Criteria

After the two-line fix in admin-form.ts:
1. `grep '#c0392b' src/views/admin-form.ts` — must return empty (no hex literals remain)
2. `grep 'var(--color-error)' src/views/admin-form.ts` — must return 2 matches (lines 30-31)
3. `pnpm test` — must exit 0 with all 238+ tests passing (10 previously-failing token-discipline tests now pass)
4. `pnpm build` — must exit 0 (already passing, confirm no regression)
5. All 25 previously-MET structural criteria remain unchanged since no other files are touched