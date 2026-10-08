#!/usr/bin/make -f

ifeq ($(OS),Windows_NT)
    CWD ?= "$(shell echo %CD%)"
    DOCKER ?= docker
else
    CWD ?= "$(shell pwd)"
    DOCKER ?= $(if $(shell docker -v 2>/dev/null),docker,podman)
endif
DOCKER_IMAGE_TAG ?= y2z/invisible-ink
PORT ?= 5703

.DEFAULT_GOAL := help

create-image: ## Create image
	@$(DOCKER) build -t $(DOCKER_IMAGE_TAG) .
.PHONY: create-image

help: ## Show this helpful message
	@for ML in $(MAKEFILE_LIST); do \
		grep -E '^[a-zA-Z_-]+:.*?## .*$$' $$ML | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'; \
	done
.PHONY: help

serve: create-image ## Start demo server in a container
	@$(DOCKER) run -it -v $(CWD):/src/$(DOCKER_IMAGE_TAG) --rm -p $(PORT):$(PORT) $(DOCKER_IMAGE_TAG)
.PHONY: serve

SERVE: ## Start demo server
	@npm run start-demo-server
.PHONY: SERVE

examples: create-image ## Rebuild example pages in a container
		@$(DOCKER) run -it -v $(CWD):/src/$(DOCKER_IMAGE_TAG) --rm -p $(PORT):$(PORT) $(DOCKER_IMAGE_TAG) make EXAMPLES
.PHONY: examples

EXAMPLES: ## Rebuild example pages
	@npm run build-examples
.PHONY: EXAMPLES

TEST: ## Run tests
	@npm run test
.PHONY: TEST

update-lock-file: create-image ## Update package-lock.json
	@$(DOCKER) run  -it --rm -v $(CWD):/src/$(DOCKER_IMAGE_TAG)/ $(DOCKER_IMAGE_TAG) make -f Prebuild.mk UPDATE_LOCK_FILE
.PHONY: update-lock-file
