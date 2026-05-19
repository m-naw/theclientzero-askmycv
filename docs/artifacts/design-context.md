# G8b Design Context

## Source material
- No Figma artifact. Aesthetic direction inferred from product context (CV chat for a senior engineer talking to recruiters).
- Fonts already loaded via Google Fonts: Fraunces (display, variable opsz/wght), Instrument Sans (body), JetBrains Mono.

## Aesthetic direction: Editorial / Refined Minimal
- Warm parchment palette (#f6f3ec base) — distances the page from default-Inter-on-white "SaaS" look without going maximalist.
- Strong typographic hierarchy: Fraunces at 2.25rem display weight 400, opsz 144, slight negative tracking — feels like a magazine masthead rather than a UI heading.
- Asymmetric chat bubbles: user bubble pulled right, accent-tinted, with one corner trimmed to radius-sm (talking-corner). Assistant bubble pulled left, surface card with subtle border, mirrored trimmed corner. Reads as conversation, not a list.
- Composer is a frosted, blurred sticky bar with backdrop-filter, focus-within ring in accent. Pill send button with accent-tinted shadow.
- Citation chips: small mono-font surface-2 pills with subtle border; hover lifts to accent.

## Token strategy
- Additive — preserves every legacy --color-* / --space-{xs,sm,md,lg,xl} / --radius-{sm,md,lg} token so existing tests and other pages (setup, admin, error-pages) continue to work unchanged.
- New semantic slots added: --surface, --surface-2, --text-primary/secondary/muted, --border, --border-subtle, --accent, --accent-foreground, --message-{user,assistant}-{bg,text}, --code-{bg,text}, --error-{bg,text}, --success-bg.
- New scale tokens: --font-display, --font-body, --space-1..8 on 4/8px baseline.

## Dark mode
- Intentional palette — not auto-inverted. Surface near-black warm (#15130f), text near-white warm (#ededeb), assistant bubble distinguishable from surface (#1c1a16), borders pulled up to #3a352d so cards retain definition.
- Accent-driven slots (--accent, --message-user-bg, --accent-foreground) intentionally NOT overridden in dark mode — user-configured accent flows through both themes.

## Accessibility checks (manual contrast estimates)
- Light: --text-primary #1a1814 on --surface #f6f3ec — ~16:1, AAA.
- Light: --text-secondary #4a4640 on --surface — ~9:1, AAA.
- Light: --text-muted #7a7368 on --surface — ~4.7:1, AA for normal text.
- Dark: --text-primary #ededeb on --surface #15130f — ~14:1, AAA.
- Dark: --text-muted #8f8a7e on --surface — ~5.4:1, AA.
- Error text #9b1c1c on #fdecec — ~6.6:1, AA. Dark error #f87171 on #2d1414 — ~6.8:1, AA.

## Verification anchor
- Bubble tokens grep: `--message-user-bg` and `--message-assistant-bg` each appear ≥2x in design-tokens.ts (definition + consumption inside `.message-user`/`.message-assistant` CSS rules).
- :focus-visible rule present globally and on `.btn`, `.chip`.
- `@media (hover: hover)` guards hover states on `.btn`, `.chip`, `.citation-chip`, `.anchors a`.
- prefers-reduced-motion strips animation/transition.
