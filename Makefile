# Makefile for Discord Ollama Bot
# Usage: make [target]
# Run `make help` for available commands

.PHONY: help lint lint-js lint-actions lint-docker lint-docker-root lint-docker-bot test test-quick build up down down-v clean dev shell install

# Default target
.DEFAULT_GOAL := help

## ============================================================================
## VERSIONS
## ============================================================================

# Tool versions (update these when new versions are released)
ACTIONLINT_VERSION := 1.7.12
HADOLINT_VERSION := 2.14.0

## ============================================================================
## LINT TARGETS
## ============================================================================

# Run all linters
lint: lint-js lint-actions lint-docker

# JavaScript/TypeScript lint (Biome)
lint-js:
	@echo "🔍 Running JavaScript lint..."
	docker compose run --build --rm --no-deps discord-bot npm run lint

# GitHub Actions workflow lint
lint-actions:
	@echo "🔍 Running GitHub Actions lint..."
	docker run --rm -v "$$PWD:/repo" -w /repo rhysd/actionlint:$(ACTIONLINT_VERSION)

# Dockerfile lint (both Dockerfiles)
lint-docker: lint-docker-root lint-docker-bot

lint-docker-root:
	@echo "🔍 Linting root Dockerfile..."
	docker run --rm -v "$$PWD:/repo" -w /repo hadolint/hadolint:v$(HADOLINT_VERSION) hadolint /repo/Dockerfile

lint-docker-bot:
	@echo "🔍 Linting discord-bot Dockerfile..."
	docker run --rm -v "$$PWD:/repo" -w /repo hadolint/hadolint:v$(HADOLINT_VERSION) hadolint /repo/discord-bot/Dockerfile

## ============================================================================
## TEST TARGETS
## ============================================================================

# Run tests
test:
	@echo "🧪 Running tests..."
	docker compose run --build --rm --no-deps discord-bot npm test

# Run tests in running container (faster if container is already running)
test-quick:
	@echo "🧪 Running tests (quick mode)..."
	docker compose exec discord-bot npm test

## ============================================================================
## DOCKER TARGETS
## ============================================================================

# Build containers
build:
	@echo "🏗️ Building containers..."
	docker compose build

# Start containers in background
up:
	@echo "🚀 Starting containers..."
	docker compose up -d

# Stop containers
down:
	@echo "🛑 Stopping containers..."
	docker compose down

# Stop containers and remove volumes
down-v:
	@echo "🛑 Stopping containers and removing volumes..."
	docker compose down -v

# Clean up Docker resources (WARNING: removes ALL unused Docker resources, not just this project)
clean:
	@echo "🧹 Cleaning up Docker resources..."
	@echo "⚠️  This will remove ALL unused Docker resources (images, containers, networks)!"
	docker compose down -v
	docker system prune -f

## ============================================================================
## DEVELOPMENT TARGETS
## ============================================================================

# Start development mode with hot reload
dev:
	@echo "🔧 Starting development mode..."
	docker compose up

# Shell into discord-bot container
shell:
	@echo "💻 Opening shell in discord-bot container..."
	docker compose exec discord-bot /bin/sh

# Install dependencies (rebuild node_modules)
install:
	@echo "📦 Installing dependencies..."
	docker compose run --build --rm --no-deps discord-bot npm ci

## ============================================================================
## HELP
## ============================================================================

help:
	@echo "Discord Ollama Bot - Available Commands"
	@echo ""
	@echo "Lint Commands:"
	@echo "  make lint          - Run all linters"
	@echo "  make lint-js       - Run JavaScript/TypeScript lint (Biome)"
	@echo "  make lint-actions  - Run GitHub Actions workflow lint"
	@echo "  make lint-docker   - Run Dockerfile lint (hadolint)"
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
