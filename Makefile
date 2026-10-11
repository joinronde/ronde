.DEFAULT_GOAL := help

COMPOSE := docker compose -f docker/compose.dev.yml
WEB := pnpm --filter @ronde/web
DB := pnpm --filter @ronde/db
PORT ?= 3000

# ─── Development ──────────────────────────────────────────────────────────────

dev: apps/web/.env node_modules ## Start PostgreSQL (Docker), migrate, seed demo data, then run the dev server
	@bash -c '\
		cleanup() { rc=$$?; trap - INT TERM EXIT; echo ""; echo "Stopping PostgreSQL..."; $(COMPOSE) stop; exit $$rc; }; \
		trap cleanup INT TERM EXIT; \
		$(COMPOSE) up -d --wait db || exit 1; \
		$(DB) db:generate || exit 1; \
		$(DB) db:migrate || exit 1; \
		$(WEB) --silent db:seed || exit 1; \
		echo ""; echo "Ronde: http://localhost:$(PORT)"; \
		$(WEB) exec next dev -p $(PORT) || true; \
	'

down: ## Stop and remove containers (data is kept)
	$(COMPOSE) down

apps/web/.env:
	cp apps/web/.env.example apps/web/.env
	@echo "→ apps/web/.env created from .env.example"

node_modules: pnpm-lock.yaml
	pnpm install --frozen-lockfile
	@touch node_modules

# ─── Database ─────────────────────────────────────────────────────────────────

db-up: ## Start PostgreSQL only
	$(COMPOSE) up -d --wait db

db-migrate: db-up ## Apply pending migrations
	$(DB) db:migrate

db-migrate-dev: db-up ## Create and apply a migration after a schema change
	$(DB) db:migrate:dev

db-seed: db-up ## Load demo data (no-op if data already exists)
	$(WEB) db:seed

db-reset: db-up ## Recreate the database and reload demo data (⚠ deletes all data)
	$(DB) exec prisma migrate reset --force
	$(WEB) db:seed

db-studio: db-up ## Open Prisma Studio
	$(DB) exec prisma studio

db-destroy: ## Remove PostgreSQL and its volume (⚠ deletes all data)
	$(COMPOSE) down -v

# ─── Quality ──────────────────────────────────────────────────────────────────

lint: node_modules ## Lint and check formatting (Biome)
	pnpm lint

format: node_modules ## Format every file (Biome)
	pnpm format

typecheck: node_modules ## Type-check every package
	pnpm typecheck

test: node_modules ## Run unit tests
	pnpm test

test-integration: db-up ## Run integration tests against PostgreSQL
	pnpm test:integration

e2e: db-migrate ## Run the browser tests (Playwright) against a dev server
	$(WEB) e2e

checks: lint typecheck test ## Lint, type-check and unit tests

build: node_modules ## Build every app (standalone output)
	pnpm build

ci: checks build ## Everything the CI runs, except Docker

docker-build: ## Build the images of a release (ghcr.io/joinronde/ronde:dev and ronde-migrate:dev)
	VERSION=dev docker buildx bake -f docker/docker-bake.hcl --load

# ─── Help ─────────────────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: dev down db-up db-migrate db-migrate-dev db-seed db-reset db-studio db-destroy lint format typecheck test test-integration e2e checks build ci docker-build help
