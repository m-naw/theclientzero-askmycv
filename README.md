# AskMyCV

Self-hosted, BYOK Cloudflare Worker that lets visitors chat with your CV. Open source under AGPL-3.0.

## Deploy to Cloudflare

One-click self-host on your own Cloudflare account — no signup, no shared service, no per-user costs to anyone but you. Your Anthropic API key lives in *your* Worker's KV namespace; the Worker is yours forever.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/m-naw/theclientzero-askmycv)

After the one-click deploy:

1. Open the Worker URL printed by Cloudflare.
2. Follow the in-page instructions to gate `/admin` and `/setup` behind Cloudflare Access.
3. Sign in via Access, paste your Anthropic API key + CV markdown, and save.
4. Share the public URL — visitors can ask questions about your CV without any login.

See [`cv.example.md`](./cv.example.md) for the expected CV markdown shape.

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
