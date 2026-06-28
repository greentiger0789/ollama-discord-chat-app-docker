# Makefile for Discord Ollama Bot
# Usage: make [target]
# Run `make help` for available commands

.PHONY: help lint lint-js lint-actions lint-docker lint-docker-root lint-docker-bot lint-security scan-secrets scan-vulns scan-code test test-quick build up down down-v clean dev shell install

# Default target
.DEFAULT_GOAL := help

## ============================================================================
## VERSIONS
## ============================================================================

# Tool versions (update these when new versions are released)
# Note: These versions are for local execution via `make`.
# GitHub Actions workflows pin their own versions in .github/workflows/.
ACTIONLINT_VERSION := 1.7.12
HADOLINT_VERSION := 2.14.0
GITLEAKS_VERSION := 8.24.0
TRIVY_VERSION := 0.63.0

PROJECT_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
DOCKER_COMPOSE ?= docker compose --project-directory $(PROJECT_DIR) -f $(PROJECT_DIR)/docker-compose.yml
BOT_SERVICE ?= discord-bot
BOT_WORKDIR ?= /app

IN_BOT_CONTAINER := $(shell if [ "$${IN_DISCORD_BOT_CONTAINER:-}" = "true" ] || { [ -f /.dockerenv ] && [ -f "$(BOT_WORKDIR)/package.json" ]; }; then echo 1; else echo 0; fi)

ifeq ($(IN_BOT_CONTAINER),1)
BOT_RUN := cd $(BOT_WORKDIR) &&
else
BOT_RUN := $(DOCKER_COMPOSE) run --build --rm --no-deps $(BOT_SERVICE)
endif

define require_host
	@if [ "$(IN_BOT_CONTAINER)" = "1" ]; then \
		echo "This target controls Docker and must be run on the host: make $@"; \
		exit 2; \
	fi
endef

## ============================================================================
## LINT TARGETS
## ============================================================================

ifeq ($(IN_BOT_CONTAINER),1)
lint: lint-js
	@echo "Docker/action linters are host-only. Run make lint on the host to include them."
else
lint: lint-js lint-actions lint-docker
endif

# JavaScript/TypeScript lint (Biome)
lint-js:
	@echo "🔍 Running JavaScript lint..."
	$(BOT_RUN) npm run lint

# GitHub Actions workflow lint
lint-actions:
	@echo "🔍 Running GitHub Actions lint..."
	$(call require_host)
	docker run --rm -v "$(PROJECT_DIR):/repo" -w /repo rhysd/actionlint:$(ACTIONLINT_VERSION)

# Dockerfile lint (both Dockerfiles)
lint-docker: lint-docker-root lint-docker-bot

lint-docker-root:
	@echo "🔍 Linting root Dockerfile..."
	$(call require_host)
	docker run --rm -v "$(PROJECT_DIR):/repo" -w /repo hadolint/hadolint:v$(HADOLINT_VERSION) hadolint /repo/Dockerfile

lint-docker-bot:
	@echo "🔍 Linting discord-bot Dockerfile..."
	$(call require_host)
	docker run --rm -v "$(PROJECT_DIR):/repo" -w /repo hadolint/hadolint:v$(HADOLINT_VERSION) hadolint /repo/discord-bot/Dockerfile

## ============================================================================
## SECURITY SCAN TARGETS
## ============================================================================

lint-security: scan-secrets scan-vulns scan-code

# Secret detection with Gitleaks
# Note: Pulls Gitleaks container on first run (~50MB). Run `make scan-secrets` to check for leaked secrets.
scan-secrets:
	@echo "🔐 Running secret scan (Gitleaks)..."
	$(call require_host)
	docker run --rm -v "$(PROJECT_DIR):/repo" -w /repo ghcr.io/gitleaks/gitleaks:v$(GITLEAKS_VERSION) detect --source . --config /repo/.gitleaks.toml --verbose

# Vulnerability scan with Trivy (Dockerfile + filesystem)
# Note: Pulls Trivy container on first run (~150MB). Run `make scan-vulns` to scan for OS/package vulnerabilities.
scan-vulns:
	@echo "🛡️ Running vulnerability scan (Trivy)..."
	$(call require_host)
	docker run --rm -v "$(PROJECT_DIR):/repo" -w /repo aquasec/trivy:v$(TRIVY_VERSION) fs --severity HIGH,CRITICAL --exit-code 1 /repo
	docker run --rm -v "$(PROJECT_DIR):/repo" -w /repo aquasec/trivy:v$(TRIVY_VERSION) config --severity HIGH,CRITICAL --exit-code 1 /repo/Dockerfile /repo/discord-bot/Dockerfile

# Dependency vulnerability scan (npm audit)
# Scope: known vulnerabilities in npm dependencies only.
# For static code analysis, see CodeQL in GitHub Actions (codeql.yml).
scan-code:
	@echo "🔍 Running dependency vulnerability scan (npm audit)..."
	$(call require_host)
	$(BOT_RUN) npm audit --audit-level=high

## ============================================================================
## TEST TARGETS
## ============================================================================

# Run tests
test:
	@echo "🧪 Running tests..."
	$(BOT_RUN) npm test

# Run tests in running container (faster if container is already running)
test-quick:
	@echo "🧪 Running tests (quick mode)..."
ifeq ($(IN_BOT_CONTAINER),1)
	cd $(BOT_WORKDIR) && npm test
else
	$(DOCKER_COMPOSE) exec $(BOT_SERVICE) npm test
endif

## ============================================================================
## DOCKER TARGETS
## ============================================================================

# Build containers
build:
	@echo "🏗️ Building containers..."
	$(call require_host)
	$(DOCKER_COMPOSE) build

# Start containers in background
up:
	@echo "🚀 Starting containers..."
	$(call require_host)
	$(DOCKER_COMPOSE) up -d

# Stop containers
down:
	@echo "🛑 Stopping containers..."
	$(call require_host)
	$(DOCKER_COMPOSE) down

# Stop containers and remove volumes
down-v:
	@echo "🛑 Stopping containers and removing volumes..."
	$(call require_host)
	$(DOCKER_COMPOSE) down -v

# Clean up Docker resources (WARNING: removes ALL unused Docker resources, not just this project)
clean:
	@echo "🧹 Cleaning up Docker resources..."
	@echo "⚠️  This will remove ALL unused Docker resources (images, containers, networks)!"
	$(call require_host)
	$(DOCKER_COMPOSE) down -v
	docker system prune -f

## ============================================================================
## DEVELOPMENT TARGETS
## ============================================================================

# Start development mode with hot reload
dev:
	@echo "🔧 Starting development mode..."
	$(call require_host)
	$(DOCKER_COMPOSE) up

# Shell into discord-bot container
shell:
	@echo "💻 Opening shell in discord-bot container..."
ifeq ($(IN_BOT_CONTAINER),1)
	cd $(BOT_WORKDIR) && /bin/sh
else
	$(DOCKER_COMPOSE) exec $(BOT_SERVICE) /bin/sh
endif

# Install dependencies (rebuild node_modules)
install:
	@echo "📦 Installing dependencies..."
	$(BOT_RUN) npm ci

## ============================================================================
## HELP
## ============================================================================

help:
	@echo "Discord Ollama Bot - Available Commands"
	@echo "App targets run via Docker on the host and directly in /app inside the discord-bot container."
	@echo "Docker control/actionlint/hadolint targets are host-only."
	@echo ""
	@echo "Lint Commands:"
	@echo "  make lint          - Run linters (host: all, container: app lint)"
	@echo "  make lint-js       - Run JavaScript/TypeScript lint (Biome)"
	@echo "  make lint-actions  - Run GitHub Actions workflow lint"
	@echo "  make lint-docker   - Run Dockerfile lint (hadolint)"
	@echo "  make lint-security - Run all security scans"
	@echo ""
	@echo "Security Scan Commands:"
	@echo "  make scan-secrets - Run secret detection (Gitleaks)"
	@echo "  make scan-vulns   - Run vulnerability scan (Trivy)"
	@echo "  make scan-code    - Run code vulnerability scan (npm audit)"
	@echo ""
	@echo "Test Commands:"
	@echo "  make test          - Run tests (fresh container)"
	@echo "  make test-quick    - Run tests (in running container)"
	@echo ""
	@echo "Docker Commands:"
	@echo "  make build         - Build containers"
	@echo "  make up            - Start containers in background"
	@echo "  make down          - Stop containers"
	@echo "  make down-v        - Stop containers and remove volumes"
	@echo "  make clean         - Clean up Docker resources"
	@echo ""
	@echo "Development Commands:"
	@echo "  make dev           - Start development mode (with logs)"
	@echo "  make shell         - Open shell in discord-bot container"
	@echo "  make install       - Install/rebuild dependencies"
	@echo ""
