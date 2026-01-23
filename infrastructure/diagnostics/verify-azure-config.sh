#!/bin/bash

# verify-azure-config.sh
# Validates Container App environment configuration against expected values

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
APP_NAME="app-bcagent-backend-dev"
KEY_VAULT_NAME="kv-bcagent-dev"

echo "=================================================="
echo "Azure Container App Configuration Verification"
echo "=================================================="
echo ""

# Function to print status
print_status() {
  local status=$1
  local message=$2
  local details="${3:-}"

  if [ "$status" = "OK" ]; then
    echo -e "${GREEN}✅ $message${NC}"
  elif [ "$status" = "WARN" ]; then
    echo -e "${YELLOW}⚠️  $message${NC}"
  else
    echo -e "${RED}❌ $message${NC}"
  fi

  if [ -n "$details" ]; then
    echo "   $details"
  fi
}

# Check Azure CLI authentication
if ! az account show &>/dev/null; then
  print_status "FAIL" "Not authenticated to Azure. Run 'az login' first."
  exit 1
fi

# Fetch Container App configuration
echo "Fetching Container App configuration..."
echo ""

if ! az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  print_status "FAIL" "Container app '$APP_NAME' not found in resource group '$RESOURCE_GROUP'"
  exit 1
fi

ENV_VARS=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.template.containers[0].env" -o json)
SECRETS=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.configuration.secrets[].name" -o tsv)

# Expected configuration
declare -A EXPECTED_VARS=(
  # Core
  ["NODE_ENV"]="production"
  ["PORT"]="3002"

  # Database
  ["DATABASE_HOST"]="(should be set)"
  ["DATABASE_PORT"]="1433"
  ["DATABASE_NAME"]="(should be set)"
  ["DATABASE_USER"]="(should be set)"
  ["DATABASE_PASSWORD"]="secretRef:database-password"

  # Redis
  ["REDIS_HOST"]="(should be set)"
  ["REDIS_PORT"]="6380"
  ["REDIS_PASSWORD"]="secretRef:redis-password"
  ["REDIS_TLS"]="true"

  # Storage
  ["STORAGE_CONNECTION_STRING"]="secretRef:storage-connectionstring"
  ["STORAGE_CONTAINER_NAME"]="user-files"

  # Auth
  ["JWT_SECRET"]="secretRef:jwt-secret"
  ["MICROSOFT_CLIENT_ID"]="(should be set)"
  ["MICROSOFT_CLIENT_SECRET"]="secretRef:microsoft-client-secret"
  ["MICROSOFT_TENANT_ID"]="(should be set)"

  # AI
  ["ANTHROPIC_API_KEY"]="secretRef:anthropic-api-key"

  # Search (optional)
  ["AZURE_SEARCH_ENDPOINT"]="(optional)"
  ["AZURE_SEARCH_API_KEY"]="secretRef:azure-search-api-key"
)

# Check each expected variable
echo "=== Environment Variables Verification ==="
echo ""

for VAR_NAME in "${!EXPECTED_VARS[@]}"; do
  EXPECTED_VALUE="${EXPECTED_VARS[$VAR_NAME]}"

  # Get actual value
  ACTUAL_VALUE=$(echo "$ENV_VARS" | jq -r --arg name "$VAR_NAME" '.[] | select(.name==$name) | if .secretRef then "secretRef:" + .secretRef else .value end')

  if [ -z "$ACTUAL_VALUE" ] || [ "$ACTUAL_VALUE" = "null" ]; then
    if [[ "$EXPECTED_VALUE" == "(optional)" ]]; then
      print_status "WARN" "$VAR_NAME not set" "Optional variable"
    else
      print_status "FAIL" "$VAR_NAME not set" "Expected: $EXPECTED_VALUE"
    fi
  else
    # Check if value matches expected (for non-secret values)
    if [[ "$EXPECTED_VALUE" == "secretRef:"* ]]; then
      # Secret reference - just check that it's a secretRef
      if [[ "$ACTUAL_VALUE" == "secretRef:"* ]]; then
        print_status "OK" "$VAR_NAME = $ACTUAL_VALUE"
      else
        print_status "WARN" "$VAR_NAME = $ACTUAL_VALUE" "Expected secret reference, but got plain value"
      fi
    elif [[ "$EXPECTED_VALUE" == "(should be set)" ]] || [[ "$EXPECTED_VALUE" == "(optional)" ]]; then
      print_status "OK" "$VAR_NAME = $ACTUAL_VALUE"
    else
      # Compare exact value
      if [ "$ACTUAL_VALUE" = "$EXPECTED_VALUE" ]; then
        print_status "OK" "$VAR_NAME = $ACTUAL_VALUE"
      else
        print_status "WARN" "$VAR_NAME = $ACTUAL_VALUE" "Expected: $EXPECTED_VALUE"
      fi
    fi
  fi
done

echo ""
echo "=== Key Vault Secrets Verification ==="
echo ""

# Expected secrets
EXPECTED_SECRETS=(
  "database-password"
  "redis-password"
  "storage-connectionstring"
  "jwt-secret"
  "microsoft-client-secret"
  "anthropic-api-key"
  "azure-search-api-key"
)

# Check if secrets exist in Container App configuration
echo "Checking secrets registered in Container App..."
for SECRET_NAME in "${EXPECTED_SECRETS[@]}"; do
  if echo "$SECRETS" | grep -q "^${SECRET_NAME}$"; then
    print_status "OK" "Secret '$SECRET_NAME' registered in Container App"
  else
    if [ "$SECRET_NAME" = "azure-search-api-key" ]; then
      print_status "WARN" "Secret '$SECRET_NAME' not registered" "Optional for basic functionality"
    else
      print_status "FAIL" "Secret '$SECRET_NAME' not registered in Container App"
    fi
  fi
done

echo ""
echo "Checking secrets exist in Key Vault..."
for SECRET_NAME in "${EXPECTED_SECRETS[@]}"; do
  # Convert to PascalCase for Key Vault naming (e.g., database-password -> DatabasePassword)
  KV_SECRET_NAME=$(echo "$SECRET_NAME" | sed -r 's/(^|-)([a-z])/\U\2/g')

  if az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "$KV_SECRET_NAME" &>/dev/null; then
    print_status "OK" "Secret '$KV_SECRET_NAME' exists in Key Vault"

    # Check if secret has a value (not empty)
    SECRET_VALUE=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "$KV_SECRET_NAME" --query value -o tsv)
    if [ -z "$SECRET_VALUE" ]; then
      print_status "WARN" "Secret '$KV_SECRET_NAME' is empty"
    fi
  else
    if [ "$SECRET_NAME" = "azure-search-api-key" ]; then
      print_status "WARN" "Secret '$KV_SECRET_NAME' not found in Key Vault" "Optional"
    else
      print_status "FAIL" "Secret '$KV_SECRET_NAME' not found in Key Vault"
    fi
  fi
done

echo ""
echo "=== Managed Identity Verification ==="
echo ""

# Check if Container App has managed identity assigned
IDENTITY_TYPE=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "identity.type" -o tsv)

if [ -z "$IDENTITY_TYPE" ] || [ "$IDENTITY_TYPE" = "None" ]; then
  print_status "FAIL" "No managed identity assigned to Container App"
else
  print_status "OK" "Managed identity type: $IDENTITY_TYPE"

  if [ "$IDENTITY_TYPE" = "SystemAssigned" ] || [ "$IDENTITY_TYPE" = "SystemAssigned,UserAssigned" ]; then
    PRINCIPAL_ID=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "identity.principalId" -o tsv)
    echo "   System-assigned identity principal ID: $PRINCIPAL_ID"
  fi

  if [ "$IDENTITY_TYPE" = "UserAssigned" ] || [ "$IDENTITY_TYPE" = "SystemAssigned,UserAssigned" ]; then
    USER_IDENTITIES=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "identity.userAssignedIdentities" -o json)
    echo "   User-assigned identities:"
    echo "$USER_IDENTITIES" | jq -r 'keys[]' | sed 's/^/     - /'
  fi
fi

# Check Key Vault access policies
echo ""
echo "Checking Key Vault access..."

if [ -n "$IDENTITY_TYPE" ] && [ "$IDENTITY_TYPE" != "None" ]; then
  PRINCIPAL_ID=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "identity.principalId" -o tsv)

  # Check if identity has access to Key Vault (via RBAC or access policies)
  ROLE_ASSIGNMENTS=$(az role assignment list --assignee "$PRINCIPAL_ID" --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/rg-BCAgentPrototype-sec-dev/providers/Microsoft.KeyVault/vaults/$KEY_VAULT_NAME" --query "[].roleDefinitionName" -o tsv)

  if [ -n "$ROLE_ASSIGNMENTS" ]; then
    print_status "OK" "Managed identity has RBAC roles on Key Vault"
    echo "$ROLE_ASSIGNMENTS" | sed 's/^/     - /'
  else
    print_status "WARN" "No RBAC roles found. Checking access policies..."

    # Note: Access policies check requires different approach
    # This is a simplified check
    print_status "WARN" "Manual verification needed: Check Key Vault access policies in Azure Portal"
  fi
fi

echo ""
echo "=== Container App Status ==="
echo ""

# Check app status
PROVISIONING_STATE=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.provisioningState" -o tsv)
RUNNING_STATUS=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.runningStatus" -o tsv)

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

# Get replica count
REPLICA_COUNT=$(az containerapp replica list --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "length(@)" -o tsv)
echo "   Active replicas: $REPLICA_COUNT"

echo ""
echo "=================================================="
echo "Configuration Verification Complete"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Fix any FAILED (❌) items above"
echo "2. Review WARNINGS (⚠️) and fix if necessary"
echo "3. Check recent logs: ./fetch-container-logs.sh --errors-only --since 1h"
echo "4. Run health check: ./check-file-upload-health.sh"
