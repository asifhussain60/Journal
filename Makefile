# Makefile — canonical entry point for the journal repo (memoir + Worker-served site).
#
# Slimmed 2026-05-22 in the repo split: the podcast pipeline and Azure
# provisioning live in the sibling podcast-factory repo, and the Express
# Anthropic proxy (server/) was retired the same day — the Worker owns the API.
# Cloudflare deploy targets came BACK on 2026-07-10 with the Worker rebuild
# (deploy, kv-backup, kv-restore below); see infra/DEPLOY.md.

.DEFAULT_GOAL := help
SHELL := /bin/bash

# ── repo paths (do not edit) ────────────────────────────────────────────────
SCRIPTS_DIR := scripts

# ── targets ─────────────────────────────────────────────────────────────────

.PHONY: help
help:  ## Print this help.
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── Setup ───────────────────────────────────────────────────────────────────

.PHONY: install-skills
install-skills:  ## Install Claude Code skills + agent wrappers from this repo into the runtime.
	@$(SCRIPTS_DIR)/install-claude-skills.sh

.PHONY: install-skills-dry
install-skills-dry:  ## Dry-run the skill installer (no files written).
	@$(SCRIPTS_DIR)/install-claude-skills.sh --dry-run

# ── Site + deploy ───────────────────────────────────────────────────────────

.PHONY: site-dev
site-dev:  ## Vite dev server for the SPA on http://localhost:3000 (proxies /api to worker-dev).
	@npm run site:dev

.PHONY: worker-dev
worker-dev:  ## Run the Worker + /api/* locally on :8787 via wrangler (reads .dev.vars).
	@npm run worker:dev

.PHONY: deploy
deploy:  ## Build the site + deploy the journal Worker to Cloudflare (see infra/DEPLOY.md).
	@bash infra/deploy.sh

.PHONY: kv-backup
kv-backup:  ## Snapshot live chapter text from Cloudflare KV into backups/kv-snapshots/latest/.
	@bash infra/backup-kv.sh

.PHONY: kv-restore
kv-restore:  ## Restore backups/kv-snapshots/latest/ back into live Cloudflare KV (prompts for confirmation).
	@bash infra/restore-kv.sh

.PHONY: site-sync-chapters
site-sync-chapters:  ## LEGACY mirror to site/chapters/ — the manifest build (run on every site dev/build/test) mirrors chapters now.
	@$(SCRIPTS_DIR)/site/sync_chapters.sh

.PHONY: site-sync-libraries
site-sync-libraries:  ## Parse the reference libraries and mirror them into site/src/data/library.json.
	@python3 $(SCRIPTS_DIR)/memoir/parse_libraries.py
	@$(SCRIPTS_DIR)/site/sync_library.sh

# ── Memoir ──────────────────────────────────────────────────────────────────

.PHONY: memoir-snapshot
memoir-snapshot:  ## Save a snapshot of the current memoir state.
	@python3 $(SCRIPTS_DIR)/memoir/save_snapshot.py

.PHONY: memoir-auto-delta
memoir-auto-delta:  ## Run the auto-delta pass on memoir chapters.
	@python3 $(SCRIPTS_DIR)/memoir/auto_delta.py
