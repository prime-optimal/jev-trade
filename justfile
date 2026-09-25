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
