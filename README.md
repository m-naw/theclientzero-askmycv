# AskMyCV

Self-hosted, BYOK Cloudflare Worker that lets visitors chat with your CV. Open source under AGPL-3.0.

## Deploy to Cloudflare

One-click self-host on your own Cloudflare account — no signup, no shared service, no per-user costs to anyone but you. Your Anthropic API key lives in *your* Worker's KV namespace; the Worker is yours forever.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/m-naw/theclientzero-askmycv)

After the one-click deploy:

1. Open the Worker URL printed by Cloudflare — you have 10 minutes to complete setup.
2. Visit `/setup`, fill in your admin password (12–128 chars), Anthropic API key, and CV markdown, then submit. You are redirected to `/admin` and logged in via session cookie.
3. Share the public URL — visitors can ask questions about your CV without any login.

See [`cv.example.md`](./cv.example.md) for the expected CV markdown shape.

### Optional: Cloudflare Access (defense-in-depth)

Cloudflare Access is a **progressive enhancement**, not a requirement. Without it, `/admin` is protected by the admin password you set during setup. If you want an additional identity layer (SSO, email allow-list, hardware keys), you can add an Access application at any time:

1. In the Cloudflare dashboard, create an Access Application that covers `/admin` and `/setup`.
2. When you next visit `/setup`, the CF Access JWT is detected and its identity claims are stored alongside your config — subsequent admin requests are verified against both the session cookie and the Access JWT.

There is no feature flag to flip; the worker auto-detects the JWT header. Deployments that skip this step operate in password-only mode permanently with no loss of functionality.

## Local development

Requirements: Node 20+, pnpm 9+.

```bash
pnpm install
pnpm build       # wrangler dry-run deploy
pnpm test        # vitest under @cloudflare/vitest-pool-workers (miniflare/workerd)
pnpm typecheck   # tsc --noEmit
pnpm dev         # wrangler dev
```

`pnpm test` boots the Worker inside miniflare so KV TTL, ReadableStream, and `crypto.subtle` behave identically to production. The smoke test in `src/test/smoke.test.ts` exercises:

- Workers runtime primitives (KV `expirationTtl`, streaming, Web Crypto).
- The Worker entry returning a 200 on `GET /`.
- The Anthropic mock streaming the four required SSE event types (`message_start`, `content_block_delta`, `message_delta`, `message_stop`).
- The JWKS mock issuing a valid JWT and rejecting a forged one through the same `jose.createRemoteJWKSet` path used in production.

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for the implementation contract: KV schema, routing, state machine, Anthropic prompt-caching strategy, and test-injection points.

## License

[AGPL-3.0-or-later](./LICENSE). If you run a modified version as a network service, you must publish your modifications.
