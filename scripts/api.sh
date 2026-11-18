#!/usr/bin/env bash
# Starts the API locally against embedded Postgres + anvil (dev).
cd "$(dirname "$0")/../apps/api"
set -a; . ./.env.example; [ -f .env ] && . ./.env; set +a
export DEPLOYMENT_FILE=${DEPLOYMENT_FILE_ABS:-$PWD/../../packages/contracts/deployments/31337.json}
exec npx tsx src/main.ts
