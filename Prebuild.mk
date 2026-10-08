#!/usr/bin/make -f

INSTALL_DEPS: ## Install required dependencies
	@npm ci --no-audit --no-fund
.PHONY: INSTALL_DEPS

UPDATE_LOCK_FILE: ## Generate new package-lock.json file
	@npm i --no-audit --no-fund --no-progress --package-lock-only
.PHONY: UPDATE_LOCK_FILE
