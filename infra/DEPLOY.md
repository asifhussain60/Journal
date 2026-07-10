# Deploying the journal to Cloudflare (Worker + Google SSO)

Self-contained deployment + authentication record for this repo. Follows the
same Keychain credential pattern as the Salty Lamps site
(`SaltyLamps/salty-lamps-site/DEPLOY.md`), adapted for a **Cloudflare Worker**
(not Pages) that serves the Vite build and the `/api/*` endpoints, gated by
**Cloudflare Access** with Google login.

## Target

| Field | Value |
|---|---|
| Worker name | `journal` (see repo-root `wrangler.toml`) |
| Serves | `site/dist` (SPA) + `/api/*` |
| Build command | `npm run site:build` |
| Deploy command | `bash infra/deploy.sh` (build + `wrangler deploy`) |
| Login method | Cloudflare Access → Google (Zero Trust) |
| Admin (write access) | `asifhussain60@gmail.com` (`ALLOWED_EDITORS` in `wrangler.toml`) |
| Everyone else | Viewer — read-only, no editing rail (enforced in the Worker) |

> **Hosting account (confirmed 2026-07-10): `asifhussain60@hotmail.com`** (id
> `844bc687926c910d5ad9d79c40ad1f2f`) — the same Cloudflare account that hosts
> `salty-lamps-proposal`. This is where the Worker deploys and where Access is
> configured. It is deliberately *different* from the **admin login** identity
> `asifhussain60@gmail.com` (the Google SSO account allowed to edit): the
> Cloudflare account owns the deployment; the Google identity is who signs in.
> `wrangler` on this machine is logged into the *gmail* account, so deploys must
> authenticate with a **token** from the hotmail account — the Keychain path
> below handles that automatically and non-interactively.

## One-time credential setup (this machine)

There is **no `journal-cloudflare-token` in the Keychain yet**, and the existing
`salty-lamps-proposal-cloudflare-token` can't be reused — it's scoped to
*Cloudflare Pages*, whereas the journal is a *Worker*. Create a new token in the
**hotmail** account, then save it once — the deploy script reads it automatically
thereafter.

1. Cloudflare dashboard (**hotmail** account) → My Profile → API Tokens → Create
   Token. Use a custom token with **`Account › Workers Scripts › Edit`** AND
   **`Account › Workers KV Storage › Edit`** (needed for chapter storage — see
   below). Copy the token; the account id is `844bc687926c910d5ad9d79c40ad1f2f`.
2. Save both to the Keychain (same convention as Salty Lamps):

   ```bash
   security add-generic-password -s journal-cloudflare-token \
     -a journal -w '<token>' -U
   security add-generic-password -s journal-cloudflare-account-id \
     -a journal -w '844bc687926c910d5ad9d79c40ad1f2f' -U
   ```

| Keychain service | Account field | Holds |
|---|---|---|
| `journal-cloudflare-token` | `journal` | API token (Workers Scripts: Edit, hotmail account) |
| `journal-cloudflare-account-id` | `journal` | `844bc687926c910d5ad9d79c40ad1f2f` |

To rotate: create a new token in the dashboard, overwrite with the same
`security add-generic-password … -U` command, then delete the old token.

## Runtime secrets (set once, not in any file)

The Worker needs these as Cloudflare secrets (never committed; `.dev.vars` holds
the local-dev copies):

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GEMINI_API_KEY
```

## Chapter storage — Cloudflare KV, not GitHub

Chapter text saved through the web editor is **not** committed to git. It's
written straight to a KV namespace bound as `CHAPTERS_KV` (see
`[[kv_namespaces]]` in `wrangler.toml`) — no external token, no GitHub
dependency at all. This was a deliberate trade-off (2026-07-10): the CLI/Python
memoir tooling (`scripts/memoir/*.py`, the journal-challenger agent) still reads
`content/babu-memoir/chapters/*.txt` from git, so **edits made through the web
app do not appear there** unless someone copies them back manually. The web app
is the primary editing surface going forward; git remains the canonical source
only for the CLI-driven authoring workflow.

Reads (`GET /api/chapter/:id`) try KV first and fall back to the static-asset
copy baked in at the last deploy if KV has no value yet — so a fresh Worker
with an empty namespace still serves the last-deployed text, never a blank
page.

Namespace: `journal-CHAPTERS_KV`, id `cabb8878cd364ea2b3d15baffb8fc052` (hotmail
account). To seed or inspect it directly:

```bash
CLOUDFLARE_API_TOKEN="$(security find-generic-password -s journal-cloudflare-token -w)" \
CLOUDFLARE_ACCOUNT_ID="$(security find-generic-password -s journal-cloudflare-account-id -w)" \
npx wrangler kv key put --binding=CHAPTERS_KV ch03 --path content/babu-memoir/chapters/ch03-marriage.txt --remote
```

## Backup & restore (Cloudflare KV)

`CHAPTERS_KV` is the only live, mutable data this app has — everything else
is either static build output or a secret. There's no automatic backup on
Cloudflare's side, so `infra/backup-kv.sh` / `infra/restore-kv.sh` exist to
cover it. Both use the same Keychain credentials as `deploy.sh` (factored
into `infra/lib/cf-auth.sh`) — no separate token, no GitHub token either.

**Back up:**

```bash
make kv-backup   # or: bash infra/backup-kv.sh
```

Pulls every live key out of `CHAPTERS_KV` and writes it to
`backups/kv-snapshots/latest/<key>.txt`, plus a `manifest.json` (byte size,
sha256, fetch time) for each. That directory is git-tracked and gets
**overwritten in place** on every run — it's not meant to accumulate
timestamped copies. Point-in-time history comes from git itself:

```bash
git diff -- backups/kv-snapshots/latest      # see what changed vs last commit
git log -p -- backups/kv-snapshots/latest    # full backup history
```

The script only writes the local files — review the diff and `git commit` +
`git push` yourself so a backup actually leaves the machine.

**Restore:**

```bash
make kv-restore   # or: bash infra/restore-kv.sh
```

Compares `backups/kv-snapshots/latest/` against the *current* live values,
prints a diff, and asks for confirmation before writing anything (`--yes`
skips the prompt for scripted use). To restore an older point in time,
check out that revision of the snapshot directory first:

```bash
git checkout <commit> -- backups/kv-snapshots/latest
bash infra/restore-kv.sh
git checkout HEAD -- backups/kv-snapshots/latest   # put the working tree back
```

Restore writes straight to the Cloudflare API (`wrangler kv key put`), which
**bypasses** the Worker's locked-chapter check in
`worker/routes/saveChapter.ts` (ch00-ch02 are locked to the web editor).
That's intentional — disaster recovery is exactly the case where the
app-level lock shouldn't block the admin — but it means restore can
overwrite a "locked" chapter without going through the unlock flow, so use
it deliberately.

## Cloudflare Access — Google login + roles

1. **Custom domain.** Access can only guard a domain added to Cloudflare — not a
   free `*.workers.dev` URL. Add the domain to the **hotmail** account and route
   the Worker to a hostname on it (Workers → the `journal` Worker → Settings →
   Domains & Routes).
2. **Add Google as an identity provider.** Zero Trust → Settings → Authentication
   → Login methods → Add → Google. In Google Cloud Console create an OAuth
   "Web application" client with redirect URI
   `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`; paste the
   Client ID + Secret into Cloudflare, then Test.
3. **Protect the app.** Zero Trust → Access → Applications → Add → **Self-hosted**;
   point it at the journal hostname. Add an **Allow** policy listing the Google
   emails permitted in at all (you + your viewers).
4. **Wire the Worker to verify the token.** In `wrangler.toml [vars]` set:
   - `CF_ACCESS_TEAM_DOMAIN` = `<your-team>.cloudflareaccess.com`
   - `CF_ACCESS_AUD` = the Access application's **Application Audience (AUD) tag**
     (Access app → Overview).
   - `ALLOWED_EDITORS` already = `asifhussain60@gmail.com` (the admin).

   The Worker (`worker/auth.ts`) independently verifies the Access JWT against the
   team JWKS at `https://<team>/cdn-cgi/access/certs` — it never trusts "Access is
   in front of me" alone. Roles: the admin email gets the editing rail; every
   other authenticated user is a read-only viewer (`worker/index.ts` returns 403
   on write/AI routes for non-admins).

## Quick deploy (after the above is done once)

```bash
bash infra/deploy.sh
```

Builds the site, reads the Keychain token, and runs `wrangler deploy`. On a
machine without the Keychain entries, export `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` first, or let it fall back to `wrangler login`.

## Local development (unchanged)

`wrangler.toml` and `.dev.vars` stay at the repo root so `wrangler dev` and the
Vite proxy work without extra flags. Local auth is bypassed
(`DEV_AUTH_BYPASS=true`) because Access cannot gate `localhost`; set
`DEV_USER_EMAIL` to test the admin vs viewer split.
