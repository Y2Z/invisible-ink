#!/usr/bin/make -f

INSTALL_DEPS: ## Install required dependencies
	@npm i
.PHONY: INSTALL_DEPS
