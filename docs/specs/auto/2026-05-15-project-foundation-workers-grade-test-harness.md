## Problem Statement

Attempt 1 satisfied 11 of 12 done_when criteria. The single failing criterion (criterion 9) requires the JWKS smoke test to route JWT verification **through the Worker itself** using a test-only injection mechanism, without monkey-patching `globalThis.fetch`. The current implementation at `src/test/smoke.test.ts:96-134` does the opposite: it patches `globalThis.fetch` directly and calls `jose.jwtVerify` without ever invoking the Worker, meaning a broken Worker JWT path would go undetected.

## Current Behavior

`src/test/smoke.test.ts:91-136` — the `"JWKS mock issues verifiable JWTs"` describe block:
- Lines 96-104: patches `globalThis.fetch = ...` (explicitly prohibited by criterion 9)
- Lines 118-131: calls `jose.createRemoteJWKSet` and `jose.jwtVerify` directly (bypasses Worker entirely)
- Result: the Worker's JWT verification code in `src/worker.ts` is never executed; no `/admin`-equivalent route exists in the Worker to verify

`src/worker.ts:1-20` — only handles `GET /` (200) and `GET /health` (200); no JWT-verified route exists.

`vitest.config.ts:14` — `ACCESS_JWKS_URL_OVERRIDE: ""` binding is declared but never exercised by the Worker.

## Proposed Changes

### 1. `src/worker.ts` — Add JWT-verified `/admin` route

Add a route handler for `GET /admin` that:
- Reads the `CF-Access-JWT-Assertion` header
- Returns 403 if header is absent
- Reads the JWKS URL from `env.ACCESS_JWKS_URL_OVERRIDE` (test injection) or falls back to a placeholder production URL
- Calls `createRemoteJWKSet(new URL(jwksUrl))` and `jwtVerify(jwt, jwks)` from `jose`
- Returns 200 with `{ email }` on success; 403 on any verification failure
- Creates `createRemoteJWKSet` per-request to avoid cross-test JWKS cache pollution

This route satisfies the hard constraint: `/` and `/chat` remain unauthenticated; only `/admin` is gated.

### 2. `src/test/smoke.test.ts` — Replace JWKS describe block

Replace the `"JWKS mock issues verifiable JWTs"` describe block (lines 91-136) with `"JWKS injection wired through Worker /admin route"` that:
- Imports `fetchMock` from `cloudflare:test` (NOT using `globalThis.fetch = ...`)
- Calls `fetchMock.activate()` before the test; `fetchMock.deactivate()` in afterEach
- Sets `(env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE` to a deterministic test URL (`https://test-access.internal/cdn-cgi/access/certs`)
- Registers a `fetchMock` interceptor for GET on that URL, returning `JSON.stringify(await jwks.getJwks())`
- Issues a valid JWT via `jwks.issueJwt({ aud, iss, email })` and a forged JWT via `jwks.issueJwt({ ..., forge: true })`
- Calls `worker.fetch(new Request("https://example.test/admin", { headers: { "CF-Access-JWT-Assertion": jwt } }), env as never, ctx)` — routing through the actual Worker code
- Asserts valid JWT → `res.status === 200`
- Asserts forged JWT → `res.status === 403`
- Removes the `import { createRemoteJWKSet, jwtVerify } from 'jose'` import (no longer called directly in tests)

**Adversarial guard:** The test must assert on `res.status` returned from `worker.fetch()`, not on the result of any direct `jwtVerify` call. If the Worker's import of `jose` fails or the `/admin` route is missing, the status assertion will fail.

## Implementation Notes

**fetchMock mechanics:** `fetchMock` from `cloudflare:test` wraps miniflare's outbound fetch interceptor (based on `undici` MockAgent). When the Worker calls `fetch(jwksUrl)` inside the Workers runtime, `fetchMock` intercepts it — no `globalThis.fetch` patching required. This is the documented `@cloudflare/vitest-pool-workers` mechanism.

**Per-request JWKS client:** `createRemoteJWKSet` caches the JWKS keyset after first fetch. If shared across requests (module-level), the second test (forged JWT) will use the cached keyset and not make a second outbound fetch — meaning the forged test will not trigger the `fetchMock` interceptor. Solve by creating `createRemoteJWKSet` inside the `/admin` handler per-request, or by registering two `fetchMock` interceptors (one per test case).

**env mutability:** The `env` object from `cloudflare:test` exposes miniflare bindings. String bindings (like `ACCESS_JWKS_URL_OVERRIDE`) can be set on the env object in test context because miniflare passes them as a plain JS object. Cast required: `(env as Record<string, string>).ACCESS_JWKS_URL_OVERRIDE = url`.

**Approach selection (brainstorm survivor):** Three approaches were evaluated. Approach A (`fetchMock` + `worker.fetch()`) survives because it exercises the real Worker code path without requiring globalThis patching or service binding plumbing. Approaches B and C were rejected: B requires unsupported service binding registration; C bypasses the Worker's production `createRemoteJWKSet` call and cannot detect a broken JWT path.

**All other criteria (1-8, 10-12):** Confirmed met in attempt 1. The spec does not re-plan these. The executor must verify they remain passing after the criterion-9 fix.

## Verification Criteria

### Criterion 1 — wrangler.toml KV binding
Falsifier: `grep -c 'binding = "STATE"' wrangler.toml` returns 0
Evidence strength: 0.92 (11/12 met in attempt 1 implicitly includes this)

### Criterion 2 — wrangler.toml no secrets
Falsifier: `grep -E "ANTHROPIC|JWT_SECRET|^\[vars\]" wrangler.toml` returns nonzero
Evidence strength: 0.92

### Criterion 3 — package.json scripts and lockfile
Falsifier: `node -e "const p=require('./package.json'); ['build','test','typecheck'].forEach(s=>{ if(!p.scripts[s]) throw new Error(s) })"` exits nonzero; or `ls pnpm-lock.yaml` exits nonzero
Evidence strength: 0.92

### Criterion 4 — LICENSE AGPL-3.0
Falsifier: `head -100 LICENSE | grep -i agpl` returns empty
Evidence strength: 0.92

### Criterion 5 — cv.example.md ≥ 500 chars
Falsifier: `wc -c < cv.example.md` prints a number less than 500
Evidence strength: 0.92

### Criterion 6 — README Deploy button
Falsifier: `grep -c 'Deploy to Cloudflare' README.md` returns 0; or `grep -c 'deploy.workers.cloudflare.com.*m-naw/theclientzero-askmycv' README.md` returns 0
Evidence strength: 0.92

### Criterion 7 — Workers-runtime primitives (KV TTL, streaming, crypto.subtle)
Falsifier: `pnpm test` exits nonzero; or KV TTL test / streaming test / crypto.subtle test reports failure
Evidence strength: 0.92

### Criterion 8 — Anthropic SSE mock emits four event types
Falsifier: `pnpm test` exits nonzero; or `"Anthropic mock emits the four required SSE event types"` test reports failure
Evidence strength: 0.92

### Criterion 9 — JWKS injection via Worker path, no globalThis patching [FLAGGED]
Falsifier (primary): `grep 'globalThis.fetch' src/test/smoke.test.ts` returns nonzero
Falsifier (secondary): the JWKS describe block does not call `worker.fetch()` or `SELF.fetch()` → the Worker's JWT verification path is never invoked
Falsifier (tertiary): `pnpm test` exits nonzero after the fix (integration failure)
Adversarial guard: assert on HTTP status from Worker response, not on `jwtVerify` result
Evidence strength pre-fix: 0.1 (confirmed broken in attempt 1)
Evidence strength post-fix: 0.85 (contingent on `fetchMock` intercepting miniflare outbound fetch correctly — verify by running `pnpm test` and confirming the new describe block passes)
Residual gap: `fetchMock` from `cloudflare:test` must intercept the Worker's outbound `fetch()` to the JWKS URL inside miniflare. If miniflare's fetch does not route through the `undici` MockAgent that `fetchMock` uses, a secondary interception strategy (registering a custom `outboundService` in `vitest.config.ts`) must be evaluated. The executor must run `pnpm test` and confirm the test passes before declaring done.

### Criterion 10 — `pnpm install && pnpm build` succeeds
Falsifier: `pnpm build` exits nonzero
Evidence strength: 0.92

### Criterion 11 — `pnpm test` exits 0 with ≥1 passing smoke test
Falsifier: `pnpm test` exits nonzero
Evidence strength: 0.85 (contingent on criterion 9 fix)

### Criterion 12 — `pnpm typecheck` exits 0
Falsifier: `pnpm typecheck` exits nonzero
Evidence strength: 0.88 (adding `jose` imports to `worker.ts` must not introduce type errors)