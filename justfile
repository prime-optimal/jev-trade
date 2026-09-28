# jev-trade local development and verification recipes

# List available project recipes
default:
    @just --list

# Install bot and dashboard dependencies
install:
    bun install
    bun install --cwd web

# Run the bot in watch mode with mise env defaults and secrets injected by fnox
dev:
    fnox exec -- scripts/with-mise-env.sh bun run dev

# Run the bot with mise env defaults and secrets injected by fnox
start:
    fnox exec -- scripts/with-mise-env.sh bun run start

# Run the dashboard development server with mise env defaults
web:
    mise exec -- bun run dev:web

# Run the bot test suite
test:
    bun test

# Typecheck the bot and dashboard
typecheck:
    bunx tsc --noEmit
    cd web && bunx tsc --noEmit

# Run tests and typechecks
check: test typecheck

# Build the dashboard for production
build-web:
    bun run --cwd web build

smoke_db := "postgres://postgres:postgres@127.0.0.1:55432/postgres"
smoke_secret := "local-smoke-secret-not-for-production-0123456789"

# Start local Postgres and load the real decision fixture; prints the owner token
[group('smoke')]
smoke-model:
    docker start jev-smoke-pg 2>/dev/null || docker run -d --name jev-smoke-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
    until docker exec jev-smoke-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
    DATABASE_URL={{smoke_db}} DECISION_OWNER_SECRET={{smoke_secret}} bun scripts/seed-model.ts

# Run a paper bot (mock model, testnet, dry run, no secrets) against the smoke database
[group('smoke')]
smoke-bot:
    DATABASE_URL={{smoke_db}} DECISION_OWNER_SECRET={{smoke_secret}} MODEL=mock DRY_RUN=true HL_TESTNET=true PORT=3000 bun src/index.ts

# Remove the smoke database container
[group('smoke')]
smoke-clean:
    docker rm -f jev-smoke-pg

# Preview Railway infrastructure changes from .railway/railway.ts
[group('railway')]
deploy-plan:
    railway config plan

# Apply Railway infrastructure after reviewing the plan (prompts to confirm)
[group('railway')]
deploy-infra: deploy-plan
    railway config apply

# Push the OpenRouter key from fnox to the bot service, then generate both public domains
[group('railway')]
deploy-setup:
    fnox exec -- sh -c 'printf %s "$OPENROUTER_API_KEY" | railway variables set OPENROUTER_API_KEY --stdin --service bot --skip-deploys'
    railway domain --service bot
    railway domain --service web

# Verify, then build and deploy this checkout to the bot and web services
[group('railway')]
deploy: check
    railway up --ci --service bot -m "$(git log -1 --format='%h %s')"
    railway up --ci --service web -m "$(git log -1 --format='%h %s')"
    just deploy-status

# Show Railway deployment status for every service
[group('railway')]
deploy-status:
    railway service status --service bot
    railway service status --service web
