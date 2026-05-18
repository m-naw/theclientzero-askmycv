# Auth Surface Reference

This document describes the complete authentication surface for the askmycv admin area.

## KV Keys

| Key | Description |
|-----|-------------|
| `admin_password_hash` | bcrypt hash of the admin password. Set during first-time setup via `/setup`. Never stored in plaintext. |
| `cookie_signing_secret` | 32-byte random hex string used as the HMAC-SHA256 key for signing session tokens. Auto-generated on first login if absent. |

## Session Cookie

| Attribute | Value |
|-----------|-------|
| Name | `askmycv_admin_session` |
| HttpOnly | Yes — not accessible from JavaScript |
| Secure | Yes — only sent over HTTPS |
| SameSite | `Lax` — protects against CSRF while allowing top-level navigation |
| Path | `/admin` — scoped to admin routes only |
| Lifetime | 7 days (Max-Age=604800) |

Token format: `base64url(payload_json).base64url(hmac_sha256_signature)`

Payload fields: `{ sub: "admin", iat: <unix_seconds>, exp: <unix_seconds> }`

## Endpoints

### POST /admin/login

Authenticates an admin user and issues a session cookie.

- Accepts: `application/json` or `application/x-www-form-urlencoded` with `password` field.
- Reads `admin_password_hash` from KV and verifies password with bcrypt.
- On success: returns 200 with `Set-Cookie: askmycv_admin_session=...`.
- On failure: 500ms anti-bruteforce delay, then 401.
- Rate limited: 10 failed attempts per IP per hour → 429.

### POST /admin/logout

Clears the session cookie.

- Requires: valid session cookie.
- Returns `Set-Cookie: askmycv_admin_session=; Max-Age=0` to expire the cookie immediately.

### POST /admin/reset

Permanently deletes all configuration from KV and clears the session.

- Requires: valid session cookie + `current_password` + `confirm` = literal string `DELETE ALL CONFIG`.
- Verifies `current_password` against `admin_password_hash` (bcrypt, 500ms delay on mismatch).
- Wrong `confirm` string → 400, no data deleted.
- On success: deletes `config`, `admin_password_hash`, `cookie_signing_secret` from KV; returns 200 with session-clearing `Set-Cookie`.

## Rate Limiting

- **Login attempts**: 10 per IP per hour (sliding window, stored in KV under `ratelimit:login:<ip>`).
- Exceeding the limit returns HTTP 429 without a delay.

## Anti-Bruteforce Delay

- Every failed login attempt (wrong password) introduces a **500ms delay** before the 401 response is returned.
- This applies to both `/admin/login` and the password verification inside `/admin/reset`.

## Optional Cloudflare Access Layer

When `access_email` is set in the stored config, an additional Cloudflare Access JWT check is enforced on `GET /admin` and `POST /admin/save`:

- The `cf-access-jwt-assertion` header must be present and cryptographically valid.
- The JWT's `email` claim must match `access_email`.
- If the header is absent or the JWT is invalid, the request returns 403.

When `access_email` is absent from config, the CF Access JWT check is skipped — the session cookie alone is sufficient to access admin routes. This is intentional and by design; CF Access integration is optional.
