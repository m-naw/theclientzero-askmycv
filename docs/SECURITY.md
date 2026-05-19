# Security Model

Last verified: 2026-05-18

---

## Authentication: password-primary

The admin interface at `/admin` and `/setup` is protected by a password you choose during initial setup.

- The plaintext password is never stored anywhere — not in KV, not in logs, not in environment variables.
- The password is hashed with **bcrypt at cost factor 12** (or argon2id with equivalent work factor) before being stored in KV under the key `admin_password_hash`.
- Every admin request verifies the submitted password against the stored hash using a constant-time comparison.
- Session state is managed via a signed cookie. The cookie signing secret is a 32-byte random value stored in KV under `cookie_signing_secret` and is generated during setup.

### What "cost ≥ 12" means in practice

bcrypt at cost 12 requires approximately 250 ms of CPU time per verification on a modern server. This makes offline brute-force attacks expensive: a single GPU performing 10 billion MD5 hashes per second can only attempt roughly 15 bcrypt-cost-12 hashes per second. An 8-character random password with mixed case and digits has ~6×10¹³ combinations — that takes roughly 128 years at that rate.

---

## Optional: Cloudflare Access (progressive enhancement)

Cloudflare Access is **not required**. The Worker functions in password-only mode with no loss of functionality.

If you add Cloudflare Access, it provides an additional identity layer (SSO, email allow-list, hardware key). The Worker auto-detects the `CF-Access-Jwt-Assertion` header on incoming requests:

- If the header is absent, the request is treated as password-only mode.
- If the header is present, the Worker fetches the JWKS from the Cloudflare team domain, verifies the JWT signature, and validates the `aud` (audience) claim.
- There is no configuration flag to flip — detection is entirely automatic.

This is a defense-in-depth measure. Even if an attacker obtains your admin password, they cannot reach `/admin` without also satisfying the Cloudflare Access policy (e.g. being in an email allow-list or presenting a valid hardware key).

---

## Threat model

### In scope

| Threat | Mitigation |
|---|---|
| Admin credential theft via brute force | bcrypt cost ≥ 12 slows offline attacks; session cookie expiry limits window |
| Admin credential theft via log/env exposure | Plaintext password never stored or logged |
| Session hijacking | Session cookie is signed with a 32-byte secret; signed with HMAC-SHA256 |
| Rate-limit bypass (chat endpoint) | Per-IP rate limit enforced on every `POST /chat` request; no bypass path |
| Daily spend overrun | `DAILY_SPEND_LIMIT_USD` cap enforced on every chat request before calling Anthropic |
| Forged CF Access JWT | JWT signature verified against Cloudflare's JWKS; forged tokens are rejected |

### Out of scope

| Threat | Reason |
|---|---|
| Cloudflare infrastructure compromise | Outside your control; Cloudflare's own security posture applies |
| Anthropic API key leakage via Anthropic platform | Outside your control; Anthropic's own security posture applies |
| Visitor browser compromise | The public chat page has no admin-level access; visitors cannot access config |
| Physical access to Cloudflare data centres | Outside your control |

---

## Recovery procedures

### Forgotten admin password

The password hash is stored in KV. Delete it and re-run setup:

```bash
wrangler kv:key delete --binding CHAT_KV admin_password_hash
wrangler kv:key delete --binding CHAT_KV cookie_signing_secret
```

Then open your Worker URL and visit `/setup` to set a new password.

### Suspected credential compromise

1. Immediately delete all four config keys:
   ```bash
   wrangler kv:key delete --binding CHAT_KV config
   wrangler kv:key delete --binding CHAT_KV secrets
   wrangler kv:key delete --binding CHAT_KV admin_password_hash
   wrangler kv:key delete --binding CHAT_KV cookie_signing_secret
   ```
2. Revoke the compromised Anthropic API key at https://console.anthropic.com/settings/keys.
3. Create a new Anthropic API key.
4. Re-run `/setup` with a new admin password and the new API key.
5. If Cloudflare Access was configured, rotate any relevant access policies at https://one.cloudflare.com/.

### Suspected session token theft

Delete the `cookie_signing_secret` key in KV. All existing sessions become invalid immediately because the signing secret has changed.

```bash
wrangler kv:key delete --binding CHAT_KV cookie_signing_secret
```

The next time you log in, a new signing secret is generated.

---

## Anthropic API key handling

The Anthropic API key is stored in KV under the `secrets` key, encrypted at rest by Cloudflare's KV encryption. It is:

- Never returned in any HTTP response body.
- Never written to Worker console output.
- Never exposed in client-side JavaScript.

The key is read server-side only, used to call the Anthropic API, and the raw value is never forwarded to the client.
