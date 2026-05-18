# Spec v2 Migration Audit

This document records the migration from the original spec to spec-v2 acceptance tests,
tracking which goals implement which test cases and confirming no regressions in scope.

## Source

Spec-v2 defines 20 acceptance tests (Test 1 through Test 20) covering the full askmycv
feature surface. Goals G1–G5 implement these tests across the strategy.

## Goal Coverage Map

| Test Range | Goal | Description |
|---|---|---|
| Tests 1–4 | G1 | Anthropic API integration, streaming, error shapes, spend tracking |
| Tests 5–8 | G2 | Setup flow, config persistence, admin bootstrap |
| Tests 9–12 | G3 | Admin authentication (password-primary + optional CF Access) |
| Tests 13–16 | G4 | Admin form, CV update, accent color, danger zone |
| Tests 17–20 | G5 | Chat UX: citations, animations, scroll, mobile, input, errors, footer |

## Migration Notes

### Removed from v1
- Polling-based streaming (replaced by SSE fetch-stream in G1)
- Hardcoded Anthropic API key in wrangler.toml (moved to KV-only storage)
- Single-factor admin password (upgraded to session + optional CF JWT in G3/G4)

### Added in v2
- F6: Client-side markdown stripping and citation-badge pipeline
- F7: @keyframes typing indicator and message fade-up animations
- F8: Auto-scroll with 100px scroll-up threshold
- F9: Mobile responsive composer (44px targets, position:sticky, 100dvh)
- F10: Keyboard UX (Enter/Shift+Enter/Escape, send-disabled state)
- F11: Credit-balance error distinct from generic upstream failures
- F14: Footer attribution with MAINTAINER_* constants and AGPL-3.0 Section 7(b)

## Invariants Preserved Through Migration

- GET / and POST /chat remain unauthenticated
- Anthropic API key stored only in KV, never in source or env vars
- Daily spend cap and per-IP rate limit enforced on every chat request
- Admin password stored as bcrypt/argon2id hash only, never plaintext

## Artifact Dependencies

G5 consumes:
- `references/anthropic-messages-error.json` — Anthropic credit-error HTTP 400 shape (created in iteration G5/attempt-4)

## Status

Audit complete. All 20 spec-v2 test cases are assigned to goals. No gaps identified.
