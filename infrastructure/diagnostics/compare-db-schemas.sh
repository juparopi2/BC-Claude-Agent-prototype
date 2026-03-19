#!/bin/bash
# compare-db-schemas.sh
#
# Runs the DB schema diagnostic against dev and/or production databases
# by fetching credentials from their respective Key Vaults.
#
# Prerequisites:
#   az login --tenant <tenant-id>
#   sqlcmd or the Node/TypeScript diagnostics are used instead (see below)
#
# Usage:
#   bash infrastructure/diagnostics/compare-db-schemas.sh               # both envs
#   bash infrastructure/diagnostics/compare-db-schemas.sh --env dev     # dev only
#   bash infrastructure/diagnostics/compare-db-schemas.sh --env prod    # prod only

set -euo pipefail

# ── Color codes ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Environment config ───────────────────────────────────────────────────────
declare -A DEV=(
  [kv]="kv-bcagent-dev"
  [server]="sqlsrv-bcagent-dev.database.windows.net"
  [database]="sqldb-bcagent-dev"
  [user]="bcagentadmin"
  [label]="DEVELOPMENT"
)

declare -A PROD=(
  [kv]="kv-myworkmate-prod"
  [server]="sqlsrv-myworkmate-prod.database.windows.net"
  [database]="sqldb-myworkmate-prod"
  [user]="bcagentadmin"
  [label]="PRODUCTION"
)

# ── Argument parsing ─────────────────────────────────────────────────────────
ENV_FILTER="both"
for arg in "$@"; do
  case $arg in
    --env) shift ;;
    dev|development) ENV_FILTER="dev" ;;
    prod|production) ENV_FILTER="prod" ;;
    --help|-h)
      echo "Usage: $0 [--env dev|prod]"
      echo "  Diagnoses database schema for each environment."
      exit 0
      ;;
  esac
done

# ── Auth check ───────────────────────────────────────────────────────────────
if ! az account show &>/dev/null; then
  echo -e "${RED}❌ Not authenticated. Run: az login${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Azure CLI authenticated${NC}"
SUBSCRIPTION=$(az account show --query name -o tsv)
echo -e "   Subscription: ${SUBSCRIPTION}\n"

# ── Script root ──────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIAG_SCRIPT="$REPO_ROOT/backend/scripts/database/diagnose-db-schema.ts"

if [ ! -f "$DIAG_SCRIPT" ]; then
  echo -e "${RED}❌ Diagnostic script not found: $DIAG_SCRIPT${NC}"
  exit 1
fi

# ── Run diagnostic for one environment ──────────────────────────────────────
run_diagnostic() {
  local -n ENV=$1  # nameref to associative array

  echo ""
  echo -e "${BOLD}$(printf '=%.0s' {1..60})${NC}"
  echo -e "${BOLD}  ENVIRONMENT: ${ENV[label]}${NC}"
  echo -e "${BOLD}$(printf '=%.0s' {1..60})${NC}"
  echo -e "${CYAN}  Key Vault: ${ENV[kv]}${NC}"
  echo -e "${CYAN}  Server:    ${ENV[server]}${NC}"
  echo -e "${CYAN}  Database:  ${ENV[database]}${NC}"
  echo ""

  # Fetch password from Key Vault
  echo "Fetching credentials from Key Vault..."
  if ! DB_PASSWORD=$(az keyvault secret show \
    --vault-name "${ENV[kv]}" \
    --name "Database-Password" \
    --query value -o tsv 2>/dev/null); then
    echo -e "${RED}❌ Failed to fetch Database-Password from ${ENV[kv]}${NC}"
    echo "   Ensure you have Key Vault Secrets User role on this vault."
    return 1
  fi
  echo -e "${GREEN}✅ Credentials fetched${NC}"

  # Run TypeScript diagnostic
  echo ""
  DATABASE_SERVER="${ENV[server]}" \
  DATABASE_NAME="${ENV[database]}" \
  DATABASE_USER="${ENV[user]}" \
  DATABASE_PASSWORD="$DB_PASSWORD" \
    npx --prefix "$REPO_ROOT/backend" tsx \
      "$DIAG_SCRIPT" \
      --table messages

  # Clear password from memory
  unset DB_PASSWORD
}

# ── Main ─────────────────────────────────────────────────────────────────────
if [ "$ENV_FILTER" = "both" ] || [ "$ENV_FILTER" = "dev" ]; then
  run_diagnostic DEV
fi

if [ "$ENV_FILTER" = "both" ] || [ "$ENV_FILTER" = "prod" ]; then
  run_diagnostic PROD
fi

echo ""
echo -e "${BOLD}$(printf '=%.0s' {1..60})${NC}"
echo -e "${BOLD}  COMPARISON COMPLETE${NC}"
echo -e "${BOLD}$(printf '=%.0s' {1..60})${NC}"
echo ""
echo "CI pipeline → database mapping:"
echo "  test.yml backend-integration-tests     → DEV DB (development env secrets)"
echo "  production-deploy.yml test-gate         → DEV DB (production env secrets: DATABASE_SERVER)"
echo "  production-deploy.yml migrate-database  → PROD DB (production env secrets: DATABASE_URL)"
echo ""
echo "If total_tokens is COMPUTED in DEV DB:"
echo "  → Both test.yml and production-deploy.yml test-gate will fail"
echo "  → Fix: create a new Prisma migration to convert it to plain INT"
echo ""
