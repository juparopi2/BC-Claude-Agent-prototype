#!/bin/bash

# verify-azure-config.sh
# Validates Container App environment configuration against expected values.
#
# Usage:
#   bash verify-azure-config.sh [--env dev|prod] [-E dev|prod] [--help]
#
# Flags:
#   --env, -E   Target environment: dev (default) or prod
#   --help, -h  Show this help message
#
# Environment variable fallback:
#   ENVIRONMENT=prod bash verify-azure-config.sh

set -euo pipefail

# ── Color codes ───────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Argument parsing ──────────────────────────────────────────────────────────

ENVIRONMENT="${ENVIRONMENT:-dev}"

usage() {
  echo "Usage: bash verify-azure-config.sh [--env dev|prod] [-E dev|prod] [--help]"
  echo ""
  echo "Flags:"
  echo "  --env, -E   Target environment: dev (default) or prod"
  echo "  --help, -h  Show this help message"
  echo ""
  echo "Environment variable fallback:"
  echo "  ENVIRONMENT=prod bash verify-azure-config.sh"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-E)
      ENVIRONMENT="${2:-}"
      if [ -z "$ENVIRONMENT" ]; then
        echo -e "${RED}Error: --env / -E requires a value (dev or prod).${NC}"
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown argument: $1${NC}"
      usage
      exit 1
      ;;
  esac
done

# ── Environment-specific config ───────────────────────────────────────────────

case "$ENVIRONMENT" in
  dev)
    RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
    APP_NAME="app-bcagent-backend-dev"
    KEY_VAULT_NAME="kv-bcagent-dev"
    RG_SEC="rg-BCAgentPrototype-sec-dev"
    NODE_ENV_EXPECTED="development"
    ;;
  prod)
    RESOURCE_GROUP="rg-myworkmate-app-prod"
    APP_NAME="app-myworkmate-backend-prod"
    KEY_VAULT_NAME="kv-myworkmate-prod"
    RG_SEC="rg-myworkmate-sec-prod"
    NODE_ENV_EXPECTED="production"
    ;;
  *)
    echo -e "${RED}Unknown environment: '$ENVIRONMENT'. Use 'dev' or 'prod'.${NC}"
    exit 1
    ;;
esac

# ── Output header ─────────────────────────────────────────────────────────────

echo "=================================================="
echo "Azure Container App Configuration Verification"
echo "Environment : $ENVIRONMENT"
echo "App         : $APP_NAME"
echo "RG (app)    : $RESOURCE_GROUP"
echo "RG (sec)    : $RG_SEC"
echo "Key Vault   : $KEY_VAULT_NAME"
echo "=================================================="
echo ""

# ── Helper: print_status ──────────────────────────────────────────────────────

print_status() {
  local status=$1
  local message=$2
  local details="${3:-}"

  if [ "$status" = "OK" ]; then
    echo -e "${GREEN}[OK]   $message${NC}"
  elif [ "$status" = "WARN" ]; then
    echo -e "${YELLOW}[WARN] $message${NC}"
  else
    echo -e "${RED}[FAIL] $message${NC}"
  fi

  if [ -n "$details" ]; then
    echo "         $details"
  fi
}

# ── Azure CLI authentication ──────────────────────────────────────────────────

if ! az account show &>/dev/null; then
  print_status "FAIL" "Not authenticated to Azure. Run 'az login' first."
  exit 1
fi

# ── Fetch Container App configuration ────────────────────────────────────────

echo "Fetching Container App configuration..."
echo ""

if ! az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  print_status "FAIL" "Container app '$APP_NAME' not found in resource group '$RESOURCE_GROUP'"
  exit 1
fi

ENV_VARS=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.template.containers[0].env" \
  -o json)

SECRETS=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.secrets[].name" \
  -o tsv)

# ── Expected environment variables ───────────────────────────────────────────
#
# Values:
#   "exactValue"       — compared literally; WARN if mismatch
#   "secretRef"        — must be a secretRef (any name); WARN if plain value
#   "(should be set)"  — just check it is present (any non-empty value)
#   "(optional)"       — WARN if missing, OK if present

declare -A EXPECTED_VARS=(
  # Core
  ["NODE_ENV"]="$NODE_ENV_EXPECTED"
  ["PORT"]="3001"

  # Database (connection string — prod only; secretRef)
  ["DATABASE_CONNECTION_STRING"]="secretRef"
  ["DATABASE_SERVER"]="secretRef"
  ["DATABASE_NAME"]="secretRef"
  ["DATABASE_USER"]="secretRef"
  ["DATABASE_PASSWORD"]="secretRef"

  # Redis
  ["REDIS_CONNECTION_STRING"]="secretRef"

  # Storage
  ["STORAGE_CONNECTION_STRING"]="secretRef"
  ["STORAGE_CONTAINER_NAME"]="user-files"

  # AI — Anthropic
  ["ANTHROPIC_API_KEY"]="secretRef"
  ["ANTHROPIC_MODEL"]="(should be set)"

  # Application Insights
  ["APPLICATIONINSIGHTS_CONNECTION_STRING"]="secretRef"
  ["APPLICATIONINSIGHTS_ENABLED"]="true"
  ["APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE"]="(should be set)"

  # Auth / session
  ["SESSION_SECRET"]="secretRef"
  ["ENCRYPTION_KEY"]="secretRef"

  # Microsoft OAuth
  ["MICROSOFT_CLIENT_ID"]="secretRef"
  ["MICROSOFT_CLIENT_SECRET"]="secretRef"
  ["MICROSOFT_TENANT_ID"]="secretRef"

  # Azure OpenAI
  ["AZURE_OPENAI_ENDPOINT"]="secretRef"
  ["AZURE_OPENAI_KEY"]="secretRef"
  ["AZURE_OPENAI_EMBEDDING_DEPLOYMENT"]="text-embedding-3-small"

  # Azure AI Search
  ["AZURE_SEARCH_ENDPOINT"]="secretRef"
  ["AZURE_SEARCH_KEY"]="secretRef"
  ["AZURE_SEARCH_INDEX_NAME"]="file-chunks-index"

  # Azure Vision
  ["AZURE_VISION_ENDPOINT"]="secretRef"
  ["AZURE_VISION_KEY"]="secretRef"

  # Azure Document Intelligence
  ["AZURE_DI_ENDPOINT"]="secretRef"
  ["AZURE_DI_KEY"]="secretRef"
)

# DATABASE_CONNECTION_STRING is prod-only; on dev it may not be present
DEV_OPTIONAL_VARS=("DATABASE_CONNECTION_STRING")

# ── Section: Environment Variables ───────────────────────────────────────────

echo "=== Environment Variables Verification ==="
echo ""

for VAR_NAME in "${!EXPECTED_VARS[@]}"; do
  EXPECTED_VALUE="${EXPECTED_VARS[$VAR_NAME]}"

  # Resolve actual value from the Container App env array
  ACTUAL_VALUE=$(echo "$ENV_VARS" | jq -r \
    --arg name "$VAR_NAME" \
    '.[] | select(.name==$name) | if .secretRef then "secretRef:" + .secretRef else .value end' \
    2>/dev/null || true)

  # Treat jq "null" output as absent
  if [ "$ACTUAL_VALUE" = "null" ]; then
    ACTUAL_VALUE=""
  fi

  if [ -z "$ACTUAL_VALUE" ]; then
    # Variable is absent
    if [[ "$EXPECTED_VALUE" == "(optional)" ]]; then
      print_status "WARN" "$VAR_NAME not set" "Optional variable"
    elif [[ "$ENVIRONMENT" == "dev" ]] && printf '%s\n' "${DEV_OPTIONAL_VARS[@]}" | grep -qx "$VAR_NAME"; then
      print_status "WARN" "$VAR_NAME not set" "Optional on dev"
    else
      print_status "FAIL" "$VAR_NAME not set" "Expected: $EXPECTED_VALUE"
    fi
  else
    # Variable is present — check value
    if [[ "$EXPECTED_VALUE" == "secretRef" ]]; then
      if [[ "$ACTUAL_VALUE" == secretRef:* ]]; then
        print_status "OK" "$VAR_NAME = $ACTUAL_VALUE"
      else
        print_status "WARN" "$VAR_NAME = $ACTUAL_VALUE" "Expected a secret reference, got a plain value"
      fi
    elif [[ "$EXPECTED_VALUE" == "(should be set)" ]] || [[ "$EXPECTED_VALUE" == "(optional)" ]]; then
      print_status "OK" "$VAR_NAME = $ACTUAL_VALUE"
    else
      # Exact value comparison
      if [ "$ACTUAL_VALUE" = "$EXPECTED_VALUE" ]; then
        print_status "OK" "$VAR_NAME = $ACTUAL_VALUE"
      else
        print_status "WARN" "$VAR_NAME = $ACTUAL_VALUE" "Expected: $EXPECTED_VALUE"
      fi
    fi
  fi
done

# ── Section: Key Vault Secrets (Container App registration) ──────────────────

echo ""
echo "=== Key Vault Secrets Verification ==="
echo ""

# These are the secret names as registered on the Container App
# (must match what create-container-apps.sh configures).
EXPECTED_SECRETS=(
  "sql-conn-string"
  "redis-conn-string"
  "stor-conn-string"
  "database-server"
  "database-name"
  "database-user"
  "database-password"
  "openai-endpoint"
  "azure-openai-key"
  "search-endpoint"
  "azure-search-key"
  "vision-endpoint"
  "azure-vision-key"
  "azure-di-endpoint"
  "azure-di-key"
  "azure-audio-endpoint"
  "azure-audio-key"
  "appinsights-conn"
  "anthropic-api-key"
  "bc-tenant-id"
  "bc-client-id"
  "bc-client-secret"
  "session-secret"
  "encryption-key"
  "microsoft-client-id"
  "ms-client-secret"
  "microsoft-tenant-id"
  "graph-webhook-url"
)

echo "Checking secrets registered in Container App..."
for SECRET_NAME in "${EXPECTED_SECRETS[@]}"; do
  if echo "$SECRETS" | grep -qx "$SECRET_NAME"; then
    print_status "OK" "Secret '$SECRET_NAME' registered in Container App"
  else
    print_status "FAIL" "Secret '$SECRET_NAME' not registered in Container App"
  fi
done

# ── Section: Key Vault secret existence ───────────────────────────────────────

echo ""
echo "Checking Key Vault access and secret presence..."
echo "(Scope: $RG_SEC / $KEY_VAULT_NAME)"
echo ""

# Test KV access once before iterating
if ! az keyvault secret list --vault-name "$KEY_VAULT_NAME" &>/dev/null; then
  print_status "WARN" "Cannot list secrets in Key Vault '$KEY_VAULT_NAME'" \
    "Check that your identity has 'list' permission. Skipping per-secret KV checks."
else
  # Map Container App secret name -> Key Vault secret name used in create-container-apps.sh
  declare -A KV_SECRET_MAP=(
    ["sql-conn-string"]="SqlDb-ConnectionString"
    ["redis-conn-string"]="Redis-ConnectionString"
    ["stor-conn-string"]="Storage-ConnectionString"
    ["database-server"]="Database-Server"
    ["database-name"]="Database-Name"
    ["database-user"]="Database-User"
    ["database-password"]="Database-Password"
    ["openai-endpoint"]="AZURE-OPENAI-ENDPOINT"
    ["azure-openai-key"]="AZURE-OPENAI-KEY"
    ["search-endpoint"]="AZURE-SEARCH-ENDPOINT"
    ["azure-search-key"]="AZURE-SEARCH-KEY"
    ["vision-endpoint"]="AZURE-VISION-ENDPOINT"
    ["azure-vision-key"]="AZURE-VISION-KEY"
    ["azure-di-endpoint"]="DocumentIntelligence-Endpoint"
    ["azure-di-key"]="DocumentIntelligence-Key"
    ["azure-audio-endpoint"]="AZURE-AUDIO-ENDPOINT"
    ["azure-audio-key"]="AZURE-AUDIO-KEY"
    ["appinsights-conn"]="ApplicationInsights-ConnectionString"
    ["anthropic-api-key"]="Claude-ApiKey"
    ["bc-tenant-id"]="BC-TenantId"
    ["bc-client-id"]="BC-ClientId"
    ["bc-client-secret"]="BC-ClientSecret"
    ["session-secret"]="SESSION-SECRET"
    ["encryption-key"]="ENCRYPTION-KEY"
    ["microsoft-client-id"]="Microsoft-ClientId"
    ["ms-client-secret"]="Microsoft-ClientSecret"
    ["microsoft-tenant-id"]="Microsoft-TenantId"
    ["graph-webhook-url"]="Graph-WebhookBaseUrl"
  )

  for SECRET_NAME in "${EXPECTED_SECRETS[@]}"; do
    KV_NAME="${KV_SECRET_MAP[$SECRET_NAME]:-}"
    if [ -z "$KV_NAME" ]; then
      print_status "WARN" "No Key Vault mapping defined for '$SECRET_NAME'" "Update KV_SECRET_MAP in this script"
      continue
    fi

    if az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "$KV_NAME" &>/dev/null; then
      SECRET_VALUE=$(az keyvault secret show \
        --vault-name "$KEY_VAULT_NAME" \
        --name "$KV_NAME" \
        --query value -o tsv 2>/dev/null || true)
      if [ -z "$SECRET_VALUE" ]; then
        print_status "WARN" "KV secret '$KV_NAME' exists but is empty"
      else
        print_status "OK" "KV secret '$KV_NAME' exists and has a value"
      fi
    else
      print_status "FAIL" "KV secret '$KV_NAME' not found in Key Vault '$KEY_VAULT_NAME'"
    fi
  done
fi

# ── Section: Managed Identity ─────────────────────────────────────────────────

echo ""
echo "=== Managed Identity Verification ==="
echo ""

IDENTITY_TYPE=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "identity.type" -o tsv)

if [ -z "$IDENTITY_TYPE" ] || [ "$IDENTITY_TYPE" = "None" ]; then
  print_status "FAIL" "No managed identity assigned to Container App"
else
  print_status "OK" "Managed identity type: $IDENTITY_TYPE"

  if [[ "$IDENTITY_TYPE" == *"SystemAssigned"* ]]; then
    PRINCIPAL_ID=$(az containerapp show \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --query "identity.principalId" -o tsv)
    echo "         System-assigned identity principal ID: $PRINCIPAL_ID"
  fi

  if [[ "$IDENTITY_TYPE" == *"UserAssigned"* ]]; then
    USER_IDENTITIES=$(az containerapp show \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --query "identity.userAssignedIdentities" -o json)
    echo "         User-assigned identities:"
    echo "$USER_IDENTITIES" | jq -r 'keys[]' | sed 's/^/           - /'
  fi
fi

# ── Section: Key Vault RBAC ───────────────────────────────────────────────────

echo ""
echo "Checking Key Vault access (RBAC)..."

if [ -n "$IDENTITY_TYPE" ] && [ "$IDENTITY_TYPE" != "None" ] && [[ "$IDENTITY_TYPE" == *"SystemAssigned"* ]]; then
  PRINCIPAL_ID=$(az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "identity.principalId" -o tsv)

  SUBSCRIPTION_ID=$(az account show --query id -o tsv)
  KV_SCOPE="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG_SEC}/providers/Microsoft.KeyVault/vaults/${KEY_VAULT_NAME}"

  ROLE_ASSIGNMENTS=$(az role assignment list \
    --assignee "$PRINCIPAL_ID" \
    --scope "$KV_SCOPE" \
    --query "[].roleDefinitionName" -o tsv 2>/dev/null || true)

  if [ -n "$ROLE_ASSIGNMENTS" ]; then
    print_status "OK" "Managed identity has RBAC role(s) on Key Vault"
    echo "$ROLE_ASSIGNMENTS" | sed 's/^/           - /'
  else
    print_status "WARN" "No RBAC roles found on Key Vault scope" \
      "This is expected if access is via Key Vault access policies (set-policy) — verify in Azure Portal"
  fi
fi

# ── Section: Container App Status ────────────────────────────────────────────

echo ""
echo "=== Container App Status ==="
echo ""

PROVISIONING_STATE=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.provisioningState" -o tsv)

RUNNING_STATUS=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.runningStatus" -o tsv)

if [ "$PROVISIONING_STATE" = "Succeeded" ]; then
  print_status "OK" "Provisioning state: $PROVISIONING_STATE"
else
  print_status "WARN" "Provisioning state: $PROVISIONING_STATE"
fi

if [ "$RUNNING_STATUS" = "Running" ]; then
  print_status "OK" "Running status: $RUNNING_STATUS"
else
  print_status "WARN" "Running status: $RUNNING_STATUS"
fi

REPLICA_COUNT=$(az containerapp replica list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "length(@)" -o tsv 2>/dev/null || echo "unknown")
echo "         Active replicas: $REPLICA_COUNT"

# ── Footer ────────────────────────────────────────────────────────────────────

echo ""
echo "=================================================="
echo "Configuration Verification Complete  [$ENVIRONMENT]"
echo "=================================================="
echo ""
echo "Next steps:"
echo "  1. Fix any [FAIL] items above"
echo "  2. Review [WARN] items and fix if necessary"
echo "  3. Check recent logs: ./fetch-container-logs.sh --errors-only --since 1h"
echo "  4. Run health check:  ./check-file-upload-health.sh"
echo ""
