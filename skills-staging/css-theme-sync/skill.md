---
name: css-theme-sync
description: "CSS theme-parity validator and auto-fixer for Asif's journal. Invoke when the user says 'css-theme-sync', '/css-theme-sync', '@css-theme-sync', 'sync themes', 'validate themes', 'check theme parity', 'theme hygiene', 'theme drift', or after any edit to site/css/. Runs server/scripts/validate-theme-parity.mjs, interprets the 6-check report, and offers to auto-fix the deterministic violations (palette-rgba → color-mix, missing Phase 2 tokens, orphan theme files, hex literals outside the whitelist). Flags judgment cases for human review. Read-only by default — requires --apply to make edits."
---

# css-theme-sync — Theme Parity Guardian

Sustainable enforcement for the token-driven theme system at `site/css/themes/`. Prevents the regression class where a new view or edit bakes Rose & Mauve Night's palette into component CSS and breaks theme swaps.

## When to invoke

- After editing any file under `site/css/` (theme files or component files).
- After adding a new HTML view that consumes the theme system.
- After adding a new theme to the switcher.
- Preflight for any commit that touches `site/css/` or `site/js/theme-switcher.js`.
- User explicitly asks: "validate themes", "theme parity", "css-theme-sync", "why is my theme not switching".

## The 6 checks

The underlying validator is [server/scripts/validate-theme-parity.mjs](../../server/scripts/validate-theme-parity.mjs), invoked via `cd server && npm run validate-themes`.

| # | Check | Severity |
|---|---|---|
| 1 | Token parity — every theme file declares every token in base (`theme.css`). | Blocker — missing tokens break theme swap. |
| 2 | Hex literals in enforced component CSS outside fallback chains / intentional whitelist. | Blocker — hex bypasses the theme system. |
| 3 | Palette rgba in enforced component CSS — `rgba(r,g,b,a)` where `r,g,b` matches any theme palette hex. | Blocker — same class as #2 but via rgba. |
| 4 | Token reference validity — every `var(--token)` in components resolves to a declaration in `theme.css`. | Blocker — undefined tokens silently render as initial values. |
| 5 | HTML hygiene — zero `<style>` blocks, zero `style="…"` attrs with color/bg hex/rgba in the 3 theme-consuming HTML files. | Blocker — inline styles bypass the theme link. |
| 6 | Switcher consistency — every `theme-*.css` on disk is registered in `site/js/theme-switcher.js`; every registered theme has a file. | Warning — missing entries silently break selection. |

Enforced component files: `app.css`, `itinerary.css`, `ai-drawer.css`, `theme-switcher.css`.
Advisory files (scanned for reference validity only): `base.css`, `floating-chat.css` (has its own scoped `--fc-*` palette — by design).

## Mapping tables — authoritative

When the validator reports violations and the skill is asked to auto-fix, use these tables. **Never invent a mapping; if a value isn't in the table, flag it for human review.**

### Hex → Token (component CSS context)

| Hex (raw) | When used as `background` / `background-color` | When used as `color` |
|---|---|---|
| `#2b2240` `#2B2240` `#2a2140` `#27203c` `#1e1830` `#1d1630` | `var(--bg)` | `var(--contrast-dark)` |
| `#322a4a` `#352a52` `#342950` `#3a2f4a` `#3b2a4a` | `var(--bg-tertiary)` | `var(--contrast-dark)` |
| `#3a3050` `#3e3255` | `var(--bg-secondary)` | — |
| `#fff7fb` | — | `var(--text)` |
| `#eddfe8` `#ece5f4` | — | `var(--text-secondary)` |
| `#c9b8d4` | — | `var(--text-muted)` |
| `#fff` `#ffffff` `#fff9fd` `#fffdfd` `#fff9f7` `#f0e4ec` `#f5ecf2` `#f1dce7` | — | `var(--text)` |
| `#2a1438` | — | `var(--contrast-dark)` |
| `#34d399` `#a6e3b9` `#8eecc3` `#d6ffe6` | `var(--success)` | `var(--success)` |
| `#ff6b6b` `#ffc5c5` `#ffb3b3` `#ffd0d8` | `var(--error)` | `var(--error)` |
| `#a8c8f0` | `var(--info)` | `var(--info)` |
| `#c9a05f` `#d4c5a8` `#d4b87a` `#c4a87a` `#8b6914` `#fff1d9` `#fff6db` `#ffd9b0` `#ffe7bb` | `var(--gold)` | `var(--gold)` |
| `#9b59b6` `#7b5e8a` `#8b6b9e` `#d9c2ff` `#ead7ff` `#e8d4f5` | `var(--lavender)` | `var(--lavender)` |
| `#ffd6e8` `#ffc8d7` `#ffdce8` `#e88bb8` `#d4699a` `#f4a6c8` | `var(--rose)` | `var(--rose)` |
| `#ffb0cc` `#ffc3cf` | `var(--rose-2)` | `var(--rose-2)` |

### rgba palette → token or color-mix

| Source rgba (r,g,b) | Palette hex | Replacement pattern |
|---|---|---|
| `rgba(43,34,64, A)` | `#2b2240` | `color-mix(in srgb, var(--bg) [A*100]%, transparent)` |
| `rgba(58,48,80, A)` | `#3a3050` | `color-mix(in srgb, var(--bg-secondary) [A*100]%, transparent)` |
| `rgba(198,166,255, A)` | `#c6a6ff` | Prefer declared `--accent-a{N}` if A*100 ∈ {6,8,12,14,15,18,20,25,30,35}; else `color-mix(in srgb, var(--accent) [A*100]%, transparent)` |
| `rgba(255,176,204, A)` | `#ffb0cc` | Prefer `--rose-a{N}` if A*100 ∈ {6,8,10,14,15,18}; else `color-mix(in srgb, var(--rose) [A*100]%, transparent)` |
| `rgba(244,212,156, A)` | `#f4d49c` | Prefer `--gold-a{N}` if A*100 ∈ {6,8,14,18}; else `color-mix(in srgb, var(--gold) [A*100]%, transparent)` |
| `rgba(174,143,255, A)` | deeper lavender | `color-mix(in srgb, var(--accent) [A*100]%, var(--bg))` |
| `rgba(139,92,246, A)` | vivid purple `#8B5CF6` | `color-mix(in srgb, var(--accent) [A*100]%, var(--contrast-dark))` |
| `rgba(255,232,239, A)` | `#ffe8ef` (`--blush`) | `color-mix(in srgb, var(--blush) [A*100]%, transparent)` |
| `rgba(16,185,129, A)` | semantic success | `color-mix(in srgb, var(--success) [A*100]%, transparent)` |
| `rgba(208,96,96, A)` `rgba(255,110,110, A)` `rgba(255,120,140, A)` `rgba(200,80,80, A)` | semantic error | `color-mix(in srgb, var(--error) [A*100]%, transparent)` |
| `rgba(212,160,48, A)` `rgba(200,170,100, A)` | semantic warning | `color-mix(in srgb, var(--warning) [A*100]%, transparent)` |
| `rgba(90,142,200, A)` `rgba(127,180,216, A)` | semantic info | `color-mix(in srgb, var(--info) [A*100]%, transparent)` |
| `rgba(110,231,183, A)` | `#6EE7B7` (mood-adventure-fg) | `var(--mood-adventure-fg)` (preferred) or `color-mix(in srgb, var(--success) [A*100]%, transparent)` |
| `rgba(0,0,0, A)` `rgba(255,255,255, A)` | theme-agnostic | **LEAVE** |

### Modal scrim

- `rgba(15, 10, 30, 0.72)` → `rgba(0, 0, 0, 0.55)`. Modal backdrop should be theme-agnostic dark, not palette-tinted.

### Intentional hardcodes (never fix)

- `.dark-dot`, `.sepia-dot`, `.light-dot` — reader-pref preview swatches. Always show the same color regardless of site theme.
- Any CSS inside `[data-reading-theme="sepia"]` or `[data-reading-theme="light"]` blocks — reader-pref overrides on top of the site theme.
- Wooden shelf decorative gradient in `.bookshelf*` selectors (e.g. `linear-gradient(to bottom, #7a4a24, #5c3318, #4a2a12)`).
- The `--fc-*` palette in `floating-chat.css` — intentionally scoped to the chat widget.
- Hex inside `var(--token, #fallback)` — legitimate fallback chains.
- Hex inside CSS comments.

## Phase 2 token additions (if validator reports undefined tokens)

If check 4 reports missing `--state-*`, `--motion-*`, `--radius-pill`, `--focus-ring`, `--shadow-float`, `--shadow-card-hover`, or `--space-*`, these are **Phase 2 canonical tokens** that should be declared in every theme file. Reference: [framework.md](../../framework.md) Phase 2 design-system canon.

| Token | Value (dark themes) | Value (light themes) |
|---|---|---|
| `--state-success` | alias of `--success` | alias of `--success` |
| `--state-warning` | alias of `--warning` | alias of `--warning` |
| `--state-error` | alias of `--error` | alias of `--error` |
| `--state-info` | alias of `--info` | alias of `--info` |
| `--radius-pill` | `9999px` | `9999px` |
| `--radius-full` | `9999px` (alias) | `9999px` (alias) |
| `--motion-fast` | `150ms ease-out` | `150ms ease-out` |
| `--motion-normal` | `250ms ease-out` | `250ms ease-out` |
| `--motion-slow` | `400ms cubic-bezier(.2,.8,.2,1)` | same |
| `--focus-ring` | `0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent)` | same |
| `--shadow-float` | theme-appropriate deep shadow | theme-appropriate soft shadow |
| `--shadow-card-hover` | same pattern | same pattern |
| `--space-1` … `--space-8` | `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px` | same |
| `--transition-fast` | alias of `--motion-fast` | same |

These must be added to **every** theme file (all 9) or check 1 will fail.

## Auto-fix behavior

When invoked with "go" / "apply" / "fix" as a follow-up after the skill reports violations:

1. **Check 1 fixes (token parity)** — if a theme file is missing a token from base, declare it with a theme-appropriate value using the mapping above. Never silently copy from base without considering light/dark context.
2. **Check 2/3 fixes** — mechanical substitution per the mapping table. Use `replace_all: true` where the hex/rgba is unambiguous. Use targeted edits inside gradients.
3. **Check 4 fixes** — if the undefined token has a canonical alias (e.g. `--accent-primary` → `--accent`, `--font-body` → `--font-sans`), replace the reference. If it's a missing Phase 2 token, declare it in all themes. If it has no canonical mapping, flag for human.
4. **Check 6 fixes** — if a theme file exists on disk but isn't registered, add it to the switcher's `THEMES` array with a best-guess `{id, name, description, category, swatches}` derived from the file's tokens, and prompt user to confirm.

**Never auto-fix:**
- Any violation in a reader-theme override block.
- Any hex in the intentional-hardcode whitelist.
- Any rgba triplet not in the mapping table.
- Any token without a clear canonical replacement.

## Output

- Summary: which checks passed, which failed, violation count per check.
- For each failure: top 10 violations with file:line, the problematic value, and the proposed fix.
- Classification of each violation: `[AUTO]` (can auto-fix), `[JUDGE]` (human needed), `[KEEP]` (matches intentional-hardcode whitelist — validator false positive; should be added to whitelist).
- End with a single-line invocation the user can run to apply auto-fixes, e.g.:
  - "Run `css-theme-sync --apply` to auto-fix 8 [AUTO] violations."
  - "5 [JUDGE] violations need human review — see above."
  - "3 [KEEP] violations are intentional — consider adding to whitelist at validate-theme-parity.mjs `INTENTIONAL_HARDCODE_CLASSES`."

## Exit contracts

- Validator exits 0 → nothing to do, skill reports "All checks pass."
- Validator exits 1, `--apply` not set → skill reports findings, offers to fix.
- Validator exits 1, `--apply` set → skill applies [AUTO] fixes, re-runs validator, reports new state.

## Scope boundaries

- Never touch `chapters/`, `reference/`, memoir files, or anything outside `site/css/`, `site/js/theme-switcher.js`, `site/*.html`, `site/itineraries/*.html`, `trips/*/itinerary.html`, `server/scripts/validate-theme-parity.mjs`, and its own skill directory.
- Never modify `floating-chat.css`'s `--fc-*` scoped palette.
- Never modify a theme file's hex palette values without a user confirmation (the palette is the theme's identity).
- Never remove tokens from `theme.css` — tokens are additive across phases.
