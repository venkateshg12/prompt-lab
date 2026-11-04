.PHONY: up down logs test test-int db-migrate lint typecheck build bench help

help:
	@echo "Available commands:"
	@echo "  make up          - Start PostgreSQL + both Redis instances"
	@echo "  make down        - Stop them"
	@echo "  make logs        - Tail infrastructure logs"
	@echo "  make test        - Run unit tests"
	@echo "  make test-int    - Run integration tests (requires Docker)"
	@echo "  make db-migrate  - Apply PostgreSQL migrations (prisma migrate deploy)"
	@echo "  make lint        - Run workspace linter"
	@echo "  make typecheck   - Run workspace TypeScript checks"
	@echo "  make build       - Build all workspace packages and apps"
	@echo "  make bench       - Run the benchmark CLI (Phase 17)"

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

test:
	pnpm --filter api test

test-int:
	pnpm --filter api test:int

db-migrate:
	pnpm --filter api db:migrate

lint:
	pnpm lint

typecheck:
	pnpm typecheck

build:
	pnpm build

bench: ## Run the benchmark CLI (Phase 17), e.g. make bench ARGS="--task job-postings --split dev"
	pnpm --filter api bench -- $(ARGS)
