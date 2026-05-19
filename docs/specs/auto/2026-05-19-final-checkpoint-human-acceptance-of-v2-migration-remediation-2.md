## Problem Statement

Three test assertions in the integration and admin test suites assert `/admin/login` as the unauthenticated `/admin` redirect target. The actual implementation (`src/auth/access.ts:128`) redirects to `/login?next=<encoded-path>` — the G4-round-3 next= return-URL contract. The tests pre-date that contract change; the code is correct. These 3 stale assertions cause test failures even though all 10 G9-remediation-1 view-layer fixes are substantively correct.

## Current Behavior

The following assertions fail because they check for `/admin/login` while `access.ts:128` emits `Location: /login?next=%2Fadmin`:

- `src/__tests__/integration/setup-without-cf.test.ts:212`  
  `expect(adminRes.headers.get("location")).toContain("/admin/login")`

- `src/test/admin.test.ts:178`  
  `expect(res.headers.get("location")).toContain("/admin/login")`

- `src/__tests__/admin/admin.test.ts:221` (describe-it title)  
  `it("(e) GET /admin with no session cookie returns 303 redirect to /admin/login?next=%2Fadmin", ...)`  
  and `:228` (assertion)  
  `expect(location).toContain("/admin/login")`

The redirect contract in `src/auth/access.ts:125-128` (G4-round-3):
```ts
const next = encodeURIComponent(url.pathname + url.search);
return new Response(null, {
  status: 303,
  headers: { Location: `/login?next=${next}` },
});
```

## Proposed Changes

### Prerequisites (Skill-Load Mandate — must execute before assertion changes)

1. Emit `[STRATEGOS-LOG] {"event":"skill_loaded","data":{"skill":"ui-ux-pro-max:ui-ux-pro-max"}}`
2. Emit `[STRATEGOS-LOG] {"event":"skill_loaded","data":{"skill":"frontend-design:frontend-design"}}`
3. Overwrite `.strategos/skill-load-receipt.json` with updated `iteration_id` for this iteration:
```json
{
  "skills_invoked": ["ui-ux-pro-max:ui-ux-pro-max", "frontend-design:frontend-design"],
  "invoked_at": "<ISO-timestamp>",
  "iteration_id": "<new-iteration-id>"
}
```
4. `git add .strategos/skill-load-receipt.json && git commit -m "chore: write skill-load receipt for ui-ux-pro-max + frontend-design [skip ci]"`

### FIX 1 — `src/__tests__/integration/setup-without-cf.test.ts:212`

BEFORE:
```ts
expect(adminRes.headers.get("location")).toContain("/admin/login");
```
AFTER:
```ts
expect(adminRes.headers.get("location")).toContain("/login?next=");
expect(adminRes.headers.get("location")).toContain("%2Fadmin");
```

### FIX 2 — `src/test/admin.test.ts:178`

BEFORE:
```ts
expect(res.headers.get("location")).toContain("/admin/login");
```
AFTER:
```ts
expect(res.headers.get("location")).toContain("/login?next=");
expect(res.headers.get("location")).toContain("%2Fadmin");
```

### FIX 3 — `src/__tests__/admin/admin.test.ts`

**(a) Line ~221 — test title:**

BEFORE:
```ts
it("(e) GET /admin with no session cookie returns 303 redirect to /admin/login?next=%2Fadmin", async () => {
```
AFTER:
```ts
it("(e) GET /admin with no session cookie returns 303 redirect to /login?next=%2Fadmin", async () => {
```

**(b) Line ~228 — assertion:**

BEFORE:
```ts
expect(location).toContain("/admin/login");
```
AFTER:
```ts
expect(location).toContain("/login?next=");
```
Keep adjacent assertions at lines 229-230 (`toContain("next=")` and `toContain("%2Fadmin")`) unchanged.

### Hard Constraints

- DO NOT touch `src/auth/access.ts` — the `/login?next=` redirect is the correct G4-round-3 contract.
- DO NOT touch any of the G9-remediation-1 view-layer fixes (admin.ts, setup.ts, setup-form.ts, setup-instructions.ts, admin-form.ts, admin-login.ts, design-tokens.ts, streaming.ts).
- DO NOT change any test assertion other than the 3 lines/titles called out above.
- All changes in a single commit on the existing `strategos/*` branch.
- Push at sprint close.

## Implementation Notes

**Approach selected**: Exact prescribed assertion updates (Approach A). Survived adversarial falsification: access.ts:128 was read directly and emits `/login?next=${next}` — the assertions now match. Approach B (weaken to status-only) was rejected because it discards next= regression coverage. Approach C (revert access.ts) was rejected as a hard constraint violation.

**Adversarial check**: The only failure mode is if the test runner resolves the test ID differently after the title change in FIX 3a. Guard: the token sequence `(e) GET /admin` still appears in the renamed title, preserving any describe-string routing that uses leading tokens.

**Skill-load receipt**: `.strategos/skill-load-receipt.json` already exists (committed in `18ed654`). Update `iteration_id` field to the current iteration; do not restructure the file.

## Verification Criteria

1. `pnpm build` exits 0 — no production code changed.
2. `pnpm test` exits 0 — all 3 previously-failing assertions now match the actual `/login?next=%2Fadmin` redirect.
3. `pnpm exec vitest run src/__tests__/integration/setup-without-cf.test.ts` exits 0.
4. `pnpm exec vitest run src/__tests__/integration/login-flow.test.ts` exits 0 (no regression on G4-round-3 login-flow contract).
5. `.strategos/skill-load-receipt.json` contains updated `iteration_id`; committed before assertion changes.