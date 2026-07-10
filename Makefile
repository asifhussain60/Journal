# Makefile — canonical entry point for the journal repo (memoir + static site).
#
# Slimmed 2026-05-22 in the repo split: podcast pipeline + Azure provisioning
# + Cloudflare deploy targets removed because that surface lives in the sibling
# podcast-factory repo. Anthropic API proxy (server/) was retired the same day,
# so its npm scripts are also gone.

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
site-dev:  ## Serve site/ locally on http://localhost:3000.
	@npx serve site -l 3000 --cors

.PHONY: deploy
deploy:  ## Build the site + deploy the journal Worker to Cloudflare (see infra/DEPLOY.md).
	@bash infra/deploy.sh

.PHONY: site-sync-chapters
site-sync-chapters:  ## Mirror content/babu-memoir/chapters/ → site/chapters/.
	@$(SCRIPTS_DIR)/site/sync_chapters.sh

# ── Memoir ──────────────────────────────────────────────────────────────────

.PHONY: memoir-snapshot
memoir-snapshot:  ## Save a snapshot of the current memoir state.
	@python3 $(SCRIPTS_DIR)/memoir/save_snapshot.py

.PHONY: memoir-auto-delta
memoir-auto-delta:  ## Run the auto-delta pass on memoir chapters.
	@python3 $(SCRIPTS_DIR)/memoir/auto_delta.py
