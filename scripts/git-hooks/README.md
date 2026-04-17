# Git hooks

Repo-managed git hook source files. They live here so they're version-controlled
and travel with the repo; they get copied into `.git/hooks/` by the installer.

## Install

```bash
./scripts/install-git-hooks.sh
```

Run once after `git clone` on a new machine, or whenever hook sources change.
Idempotent — safe to re-run.

## Hooks

### `pre-commit`

Runs `cd server && npm run validate-themes` when any staged file touches the
theme system:

- `site/css/**`
- `site/js/theme-switcher.js`
- `site/**/*.html`
- `trips/**/*.html`

Commits with theme parity violations are blocked. The validator runs 8 checks —
see [server/scripts/validate-theme-parity.mjs](../../server/scripts/validate-theme-parity.mjs)
and the [css-theme-sync skill](../../skills-staging/css-theme-sync/skill.md) for
the full list.

Bypass in emergencies only:

```bash
git commit --no-verify
```
