## Problem Statement

G4 is largely implemented: `src/routes/index.ts` wires GET `/` to `detectState()` and renders the correct G3 template per state; `src/routes/setup.ts` implements all POST `/setup` gates (JWT auth, config-exists, window-expired, field validation, cv_markdown bounds, Anthropic test call, KV persist); `src/state/machine.ts` writes `setup_window_start` to KV on first state-A visit; `src/__tests__/setup/setup-acceptance.test.ts` covers 8 acceptance scenarios.

The remaining gap is: the acceptance test for the Anthropic API test call does not assert the outgoing request body shape. The done_when criterion requires "the captured outgoing test-call request body has the documented Anthropic Messages API shape (model, system, messages, max_tokens fields present)" but the current fetchMock interceptor only asserts response status, not the intercepted request payload. Additionally, unstaged daily_budget_usd validation tests in `src/__tests__/setup/setup-acceptance.test.ts` need to be committed.

## Current Behavior

`src/__tests__/setup/setup-acceptance.test.ts` (modified, unstaged): 8 `it()` blocks. The Anthropic mock (`mockAnthropicOk()` / `mockAnthropicFail()`) uses undici `fetchMock` to intercept `POST /v1/messages` on the test host. Interceptors return mocked responses but do NOT capture the incoming request body. No test asserts the outgoing body contains `model`, `system`, `messages`, `max_tokens`.

Unstaged diff: adds daily_budget_usd non-numeric/non-positive validation tests (400 expected) and adds `"daily_budget_usd"` to the missing-required-fields iteration. Production code in `src/routes/setup.ts` already validates daily_budget_usd correctly. Changes are additive.

All other implementation is complete: routing, state machine, JWT auth, template rendering, KV persistence, window expiry.

## Proposed Changes

### 1. `src/__tests__/setup/setup-acceptance.test.ts` — add body-shape assertion

Modify the existing Anthropic-rejects-key test to capture the outgoing request body:

```typescript
let capturedBody: unknown;
fetchMock
  .get("https://anthropic.mock")
  .intercept({ path: "/v1/messages", method: "POST" })
  .reply((opts) => {
    capturedBody = JSON.parse(opts.body as string);
    return { statusCode: 401, data: { error: "invalid_api_key" } };
  });
// ... POST /setup call ...
expect(capturedBody).toMatchObject({
  model: expect.any(String),
  system: expect.any(String),
  messages: expect.any(Array),
  max_tokens: expect.any(Number),
});
```

The exact undici MockAgent API must match the installed version — implementer verifies `reply` callback vs `on("request")` approach.

### 2. Commit unstaged changes

The daily_budget_usd validation tests must be committed alongside the body-shape assertion change.

### 3. Verify all pnpm commands pass

Run `pnpm build && pnpm typecheck && pnpm test && pnpm lint`. Fix any failures. Test count must be >= 80.

## Implementation Notes

### Why this is the only remaining gap

Static analysis confirmed:
- `worker.ts` routes to `handleRoot()` and `handlePostSetup()` — no placeholder
- `detectState()` at machine.ts:146 writes `setup_window_start` to KV
- `handlePostSetup()` in setup.ts calls `client.messages.create` with `max_tokens: 1` via `env.ANTHROPIC_BASE_URL`
- `verifyAccessJwt()` in auth/access.ts returns 403 on bad/missing JWT
- JWKS mock is KV-based (writing to `__test_jwks` key) — no network dependency

### Anthropic mock body capture caveat

The `fetchMock` in `@cloudflare/vitest-pool-workers` (undici MockAgent) may not support `on("request")` callbacks. The `reply` callback form receiving request opts (including body) is the recommended approach. Implementer must verify against installed undici version.

### Hard constraints honored

- Chat page (GET /) remains public in state C — no auth gate
- POST /setup always verifies JWT cryptographically first
- Anthropic API key read only from KV secrets

## Verification Criteria

11 of 13 done_when criteria are met by existing tests. 1 criterion requires the new body-shape assertion (Anthropic outgoing body). 1 criterion requires running all pnpm commands and confirming pass.