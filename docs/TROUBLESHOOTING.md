# Troubleshooting

Last verified: 2026-05-18

---

## Failure mode 1: `wrangler deploy` authentication error

**Symptom**: Running `wrangler deploy` prints an error such as:

```
Not logged in. Try logging in, or provide an 'api_token' variable.
```

or

```
error: failed to authenticate
```

**Cause**: The wrangler CLI does not have a valid Cloudflare session.

**Resolution**:

1. Run `wrangler login` in your terminal.
2. A browser window opens. Sign in with your Cloudflare account credentials.
3. After successful authentication, wrangler stores a token in your local config.
4. Re-run `wrangler deploy`.

If you are running in a CI environment without browser access, create a Cloudflare API token at https://dash.cloudflare.com/profile/api-tokens with **Edit Cloudflare Workers** permissions, then set it as the `CLOUDFLARE_API_TOKEN` environment variable before running `wrangler deploy`.

---

## Failure mode 2: `wrangler.toml` vars causing test mocks to appear in production

**Symptom**: A variable added to the `[vars]` section of `wrangler.toml` for test purposes appears in the deployed Worker, causing unexpected behavior or exposing test configuration.

**Cause**: Variables in `[vars]` are deployed as plain-text environment bindings in the Worker. Any value placed there is visible in production.

**Resolution**:

1. Remove the variable from the `[vars]` block in `wrangler.toml`.
2. Move test-only configuration to the vitest config file (e.g. `vitest.config.ts`) or to `@cloudflare/vitest-pool-workers` environment overrides.
3. Use `wrangler secret put <KEY>` for sensitive values (API keys, signing secrets) — secrets are encrypted and not visible in the dashboard or wrangler.toml.

Test mock values must never appear in `wrangler.toml [vars]`. That block is committed to version control and deployed verbatim.

---

## Failure mode 3: Anthropic API key rejection

**Symptom**: The chat endpoint returns an error response, and `wrangler tail` shows a message such as:

```
AuthenticationError: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}
```

**Cause**: The Anthropic API key stored in KV is invalid, has been revoked, or was entered with a typo during setup.

**Resolution**:

1. Open https://console.anthropic.com/settings/keys.
2. Confirm that the key you used during setup is listed and its status is **Active**.
3. If the key is revoked or missing, create a new key. Copy the full key value (it starts with `sk-ant-`).
4. Run setup again by deleting the secrets key and re-running `/setup`:
   ```bash
   wrangler kv:key delete --binding CHAT_KV secrets
   ```
5. Open your Worker URL at `/setup`, enter the new API key, and submit the form.

Also confirm that your Anthropic account has an active billing method at https://console.anthropic.com/settings/billing. API calls fail if the account has no credit balance.

---

## Failure mode 4: Budget cap blocking all chat requests

**Symptom**: Every chat request returns an error, and `wrangler tail` shows:

```
Daily spend cap reached
```

**Cause**: The Worker's `DAILY_SPEND_LIMIT_USD` cap has been reached. The default cap is $1.00 per day. The Worker enforces this cap on every `POST /chat` request and rejects further calls until the cap resets at midnight UTC.

**Resolution — option A: wait for reset**

The cap resets automatically at midnight UTC. No action required; the chat interface will resume working the next day.

**Resolution — option B: increase the cap**

Set a higher limit using `wrangler secret`:

```bash
wrangler secret put DAILY_SPEND_LIMIT_USD
# Enter the new value at the prompt, e.g.: 5.00
```

After updating the secret, the Worker picks up the new value on the next request without redeployment.

**Resolution — option C: disable the cap**

Set `DAILY_SPEND_LIMIT_USD` to an empty string or `0` to disable the cap entirely. Note that disabling the cap means a single runaway day of traffic can result in an unbounded Anthropic bill. Monitor your usage at https://console.anthropic.com/settings/usage.

---

## Failure mode 5: 503 errors from the Worker

**Symptom**: The Worker returns HTTP 503 with an error page from Cloudflare, or `wrangler tail` shows CPU-limit exceeded messages.

**Cause**: The Cloudflare Worker has exceeded its CPU time limit for a request. The Workers free tier allows 10 ms of CPU time per request; the paid tier (Workers Bundled) allows 30 s.

**Resolution — step 1: confirm the cause**

1. Open https://dash.cloudflare.com/ and sign in.
2. Select **Workers & Pages** in the left sidebar.
3. Click your Worker name.
4. Select the **Logs** tab to view real-time logs, or run `wrangler tail` in your terminal.
5. Look for log entries containing `exceeded CPU limit` or `Worker exceeded resource limits`.

**Resolution — step 2: upgrade the plan if on the free tier**

If you are on the Workers free tier, upgrade to Workers Paid (Bundled) at https://dash.cloudflare.com/. The Bundled plan increases the CPU limit from 10 ms to 30 s per request.

**Resolution — step 3: check for slow KV reads**

503s during setup or admin operations can indicate KV read latency. KV is eventually consistent and read latency can spike to 50–150 ms in some regions. If 503s only occur during setup, retry the operation — KV latency is transient.

**Resolution — step 4: check the Anthropic streaming response**

503s during chat can indicate that the Anthropic streaming response is taking longer than expected. Verify that the Anthropic API status is nominal at https://status.anthropic.com/ before investigating the Worker configuration.
