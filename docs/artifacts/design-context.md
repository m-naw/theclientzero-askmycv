# Design Context

## Design System Overview

This project uses a custom CSS custom-property (CSS variable) token system with no Tailwind or CSS-in-JS framework. All design tokens are declared in `src/views/design-tokens.ts`, which is the ONLY file in `src/views/` permitted to contain raw hex, px, or rem literals (enforced by `src/test/views/token-discipline.test.ts`).

## Token Architecture

- **Single source of truth:** `src/views/design-tokens.ts` exports `TOKENS` (JS references to `var(--name)` strings), `toCssVars(accentColor?)` (produces the `:root {}` and `[data-theme="dark"] {}` CSS blocks), and `baseStyles()` (shared layout/typography/component CSS).
- **No Figma, no Tailwind, no tailwind.config.ts.** All design decisions are encoded as CSS custom properties.
- **Dual-theme system:** `:root {}` defines the light palette; `[data-theme="dark"] {}` overrides a subset of color tokens for dark mode. The theme is applied via `data-theme` attribute on `<html>`.

## Color Palette

### Light Theme (`:root`)
| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#fafaf7` | Page background |
| `--color-surface` | `#ffffff` | Card/input background |
| `--color-text` | `#1a1a1f` | Body text |
| `--color-text-muted` | `#6b6b78` | Secondary text |
| `--color-accent` | `#3b5bdb` (default) | Interactive/brand color |
| `--color-accent-fg` | `#ffffff` | Text on accent |
| `--color-error` | `#c92a2a` | Error states |
| `--color-border` | `#e3e3e8` | Dividers/borders |

### Dark Theme (`[data-theme="dark"]`)
| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#181613` | Page background |
| `--color-surface` | `#242220` | Card/input background |
| `--color-text` | `#ededeb` | Body text |
| `--color-text-muted` | `#9b9b94` | Secondary text |
| `--color-border` | `#3a3834` | Dividers/borders |

## Typography

### Web Fonts (Google Fonts)
Three font families are loaded via Google Fonts stylesheet in `src/views/layout.ts`:
- **Fraunces** — serif display font for `h1`, `h2` headings
- **Instrument Sans** — humanist sans-serif for `body` text
- **JetBrains Mono** — monospaced font for `--font-mono` (code, textarea)

Font-family declarations in `baseStyles()` use the unencoded names with spaces (e.g., `'Instrument Sans'`, `'JetBrains Mono'`). The Google Fonts URL uses URL-encoded `+` separators (`Instrument+Sans`, `JetBrains+Mono`) which is a different encoding and does not satisfy the `grep -rP 'Instrument\s+Sans'` criterion — only the CSS declarations in `design-tokens.ts` do.

### Font Stack
- `body font-family`: `'Instrument Sans', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- `h1, h2 font-family`: `'Fraunces', Georgia, serif`
- `--font-mono`: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`

## Spacing Scale
| Token | Value |
|---|---|
| `--space-xs` | `0.25rem` |
| `--space-sm` | `0.5rem` |
| `--space-md` | `1rem` |
| `--space-lg` | `1.5rem` |
| `--space-xl` | `2.5rem` |

## Border Radius
| Token | Value |
|---|---|
| `--radius-sm` | `4px` |
| `--radius-md` | `8px` |
| `--radius-lg` | `16px` |

## Motion
| Token | Value |
|---|---|
| `--motion-fast` | `120ms ease-out` |
| `--motion-normal` | `220ms ease-out` |

## Layout Entrypoint

`src/views/layout.ts` exports `renderLayout(props: LayoutProps)` which wraps every page. `LayoutProps` includes optional `theme` (`'light' | 'dark'`) and `description` fields added in Sprint 1. The `data-theme` attribute on `<html>` is set from `props.theme ?? 'light'`.

## SEO Meta Tags

All pages include (via `renderLayout`):
- `<meta property="og:title" content="...">` — HTML-escaped title
- `<meta property="og:type" content="website">`
- `<meta name="twitter:card" content="summary">`
- `<meta name="twitter:title" content="...">` — HTML-escaped title

## Token Discipline Constraint

The test at `src/test/views/token-discipline.test.ts` sweeps all `src/views/**/*.ts` files with regex `/#[0-9a-fA-F]{3,8}\b/` and fails if any file other than `design-tokens.ts` contains a hex color literal. Hex values must NEVER be placed in `layout.ts`, `chat-page.ts`, or any other view file.
