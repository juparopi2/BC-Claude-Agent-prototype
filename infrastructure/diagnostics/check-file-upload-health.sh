#!/bin/bash

# check-file-upload-health.sh
# Comprehensive health check for file upload infrastructure
# Verifies Azure Storage connectivity, permissions, firewall, and CORS

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
RESOURCE_GROUP_DATA="rg-BCAgentPrototype-data-dev"
RESOURCE_GROUP_SEC="rg-BCAgentPrototype-sec-dev"
RESOURCE_GROUP_APP="rg-BCAgentPrototype-app-dev"
STORAGE_ACCOUNT="sabcagentdev"
CONTAINER_NAME="user-files"
BACKEND_APP_NAME="app-bcagent-backend-dev"
MANAGED_IDENTITY_NAME="mi-bcagent-backend-dev"
KEY_VAULT_NAME="kv-bcagent-dev"

echo "=================================================="
echo "File Upload Health Check for MyWorkMate"
echo "=================================================="
echo ""

# Function to print status
print_status() {
  local status=$1
  local message=$2

  if [ "$status" = "OK" ]; then
    echo -e "${GREEN}✅ $message${NC}"
  elif [ "$status" = "WARN" ]; then
    echo -e "${YELLOW}⚠️  $message${NC}"
  else
    echo -e "${RED}❌ $message${NC}"
  fi
}

# Check 1: Azure CLI Authentication
echo "=== 1. Azure CLI Authentication ==="
if az account show &>/dev/null; then
  SUBSCRIPTION=$(az account show --query name -o tsv)
  print_status "OK" "Authenticated to Azure (Subscription: $SUBSCRIPTION)"
else
  print_status "FAIL" "Not authenticated to Azure. Run 'az login' first."
  exit 1
fi
echo ""

# Check 2: Storage Account Existence and Access
echo "=== 2. Storage Account Verification ==="
if az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP_DATA" &>/dev/null; then
  print_status "OK" "Storage account '$STORAGE_ACCOUNT' exists"

  # Get storage account properties
  STORAGE_STATUS=$(az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP_DATA" --query provisioningState -o tsv)
  if [ "$STORAGE_STATUS" = "Succeeded" ]; then
    print_status "OK" "Storage account status: $STORAGE_STATUS"
  else
    print_status "WARN" "Storage account status: $STORAGE_STATUS (expected: Succeeded)"
  fi
else
  print_status "FAIL" "Storage account '$STORAGE_ACCOUNT' not found"
  exit 1
fi
echo ""

# Check 3: Container Existence
echo "=== 3. Container Verification ==="
if az storage container show --name "$CONTAINER_NAME" --account-name "$STORAGE_ACCOUNT" --auth-mode login &>/dev/null; then
  print_status "OK" "Container '$CONTAINER_NAME' exists"

  # Check public access level
  PUBLIC_ACCESS=$(az storage container show --name "$CONTAINER_NAME" --account-name "$STORAGE_ACCOUNT" --auth-mode login --query properties.publicAccess -o tsv)
  if [ "$PUBLIC_ACCESS" = "None" ] || [ "$PUBLIC_ACCESS" = "none" ] || [ -z "$PUBLIC_ACCESS" ]; then
    print_status "OK" "Public access: Private (secure)"
  else
    print_status "WARN" "Public access: $PUBLIC_ACCESS (should be Private)"
  fi
else
  print_status "FAIL" "Container '$CONTAINER_NAME' not found or not accessible"
  echo "  Try creating it: az storage container create --name $CONTAINER_NAME --account-name $STORAGE_ACCOUNT --auth-mode login"
  exit 1
fi
echo ""

# Check 4: Network Firewall Rules
echo "=== 4. Storage Network Firewall Rules ==="
FIREWALL_RULES=$(az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP_DATA" --query "networkRuleSet.defaultAction" -o tsv)

if [ "$FIREWALL_RULES" = "Allow" ]; then
  print_status "OK" "Default action: Allow (no firewall restrictions)"
elif [ "$FIREWALL_RULES" = "Deny" ]; then
  print_status "WARN" "Default action: Deny (firewall enabled - checking allowed networks)"

  # Get allowed IPs
  ALLOWED_IPS=$(az storage account network-rule list --account-name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP_DATA" --query ipRules[].ipAddressOrRange -o tsv)

  if [ -z "$ALLOWED_IPS" ]; then
    print_status "FAIL" "No IP addresses allowed through firewall"
    echo "  Container Apps need to be added to the allowlist"
  else
    echo "  Allowed IPs: $ALLOWED_IPS"
  fi

  # Check if Azure services bypass is enabled
  BYPASS=$(az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP_DATA" --query "networkRuleSet.bypass" -o tsv)
  if [[ "$BYPASS" == *"AzureServices"* ]]; then
    print_status "OK" "Azure Services bypass enabled (Container Apps should have access)"
  else
    print_status "WARN" "Azure Services bypass NOT enabled"
  fi
fi
echo ""

# Check 5: CORS Configuration
echo "=== 5. CORS Configuration ==="
CORS_RULES=$(az storage cors list --account-name "$STORAGE_ACCOUNT" --services b --auth-mode login 2>/dev/null || echo "[]")

if [ "$CORS_RULES" = "[]" ] || [ -z "$CORS_RULES" ]; then
  print_status "WARN" "No CORS rules configured (may block browser uploads)"
  echo "  If using browser-based uploads, add CORS rules:"
  echo "  az storage cors add --account-name $STORAGE_ACCOUNT --services b \\"
  echo "    --methods GET POST PUT DELETE OPTIONS \\"
  echo "    --origins 'https://your-frontend-domain.com' \\"
  echo "    --allowed-headers '*' --exposed-headers '*' --max-age 3600"
else
  print_status "OK" "CORS rules configured"
  echo "$CORS_RULES" | head -5
fi
echo ""

# Check 6: Managed Identity Configuration
echo "=== 6. Managed Identity Configuration ==="
if az identity show --name "$MANAGED_IDENTITY_NAME" --resource-group "$RESOURCE_GROUP_SEC" &>/dev/null; then
  print_status "OK" "Managed identity '$MANAGED_IDENTITY_NAME' exists"

  # Get principal ID
  PRINCIPAL_ID=$(az identity show --name "$MANAGED_IDENTITY_NAME" --resource-group "$RESOURCE_GROUP_SEC" --query principalId -o tsv)
  echo "  Principal ID: $PRINCIPAL_ID"

  # Check role assignments on storage account
  echo ""
  echo "  Checking role assignments on storage account..."
  STORAGE_ID=$(az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP_DATA" --query id -o tsv)

  ROLE_ASSIGNMENTS=$(az role assignment list --assignee "$PRINCIPAL_ID" --scope "$STORAGE_ID" --query "[].roleDefinitionName" -o tsv)

  if [ -z "$ROLE_ASSIGNMENTS" ]; then
    print_status "FAIL" "No role assignments found on storage account"
    echo "  Required: 'Storage Blob Data Contributor' role"
    echo "  Fix: az role assignment create --assignee $PRINCIPAL_ID \\"
    echo "       --role 'Storage Blob Data Contributor' --scope $STORAGE_ID"
  else
    if echo "$ROLE_ASSIGNMENTS" | grep -q "Storage Blob Data Contributor"; then
      print_status "OK" "Has 'Storage Blob Data Contributor' role"
    else
      print_status "WARN" "Roles assigned: $ROLE_ASSIGNMENTS"
      print_status "WARN" "Missing recommended role: 'Storage Blob Data Contributor'"
    fi
  fi
else
  print_status "FAIL" "Managed identity '$MANAGED_IDENTITY_NAME' not found"
fi
echo ""

# Check 7: Key Vault Secrets
echo "=== 7. Key Vault Connection String ==="
if az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "StorageConnectionString" &>/dev/null; then
  print_status "OK" "Secret 'StorageConnectionString' exists in Key Vault"

  # Get secret value (redacted)
  SECRET_VALUE=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "StorageConnectionString" --query value -o tsv)

  # Validate connection string format
  if [[ "$SECRET_VALUE" == *"AccountName=$STORAGE_ACCOUNT"* ]]; then
    print_status "OK" "Connection string references correct storage account"
  else
    print_status "FAIL" "Connection string does NOT reference storage account '$STORAGE_ACCOUNT'"
  fi

  if [[ "$SECRET_VALUE" == *"AccountKey="* ]] || [[ "$SECRET_VALUE" == *"SharedAccessSignature="* ]]; then
    print_status "OK" "Connection string contains authentication credentials"
  else
    print_status "FAIL" "Connection string missing AccountKey or SAS token"
  fi
else
  print_status "FAIL" "Secret 'StorageConnectionString' not found in Key Vault"
  echo "  Create it: az keyvault secret set --vault-name $KEY_VAULT_NAME \\"
  echo "             --name StorageConnectionString --value '<connection-string>'"
fi
echo ""

# Check 8: Container App Environment Variables
echo "=== 8. Container App Configuration ==="
if az containerapp show --name "$BACKEND_APP_NAME" --resource-group "$RESOURCE_GROUP_APP" &>/dev/null; then
  print_status "OK" "Container app '$BACKEND_APP_NAME' exists"

  # Check environment variables
  ENV_VARS=$(az containerapp show --name "$BACKEND_APP_NAME" --resource-group "$RESOURCE_GROUP_APP" --query "properties.template.containers[0].env" -o json)

  # Check STORAGE_CONNECTION_STRING
  if echo "$ENV_VARS" | grep -q "STORAGE_CONNECTION_STRING"; then
    STORAGE_CONN_TYPE=$(echo "$ENV_VARS" | jq -r '.[] | select(.name=="STORAGE_CONNECTION_STRING") | if .secretRef then "secretRef: " + .secretRef else "value: " + .value end')
    print_status "OK" "STORAGE_CONNECTION_STRING configured ($STORAGE_CONN_TYPE)"
  else
    print_status "FAIL" "STORAGE_CONNECTION_STRING not configured"
  fi

  # Check STORAGE_CONTAINER_NAME
  if echo "$ENV_VARS" | grep -q "STORAGE_CONTAINER_NAME"; then
    CONTAINER_VAR=$(echo "$ENV_VARS" | jq -r '.[] | select(.name=="STORAGE_CONTAINER_NAME") | .value')
    if [ "$CONTAINER_VAR" = "$CONTAINER_NAME" ]; then
      print_status "OK" "STORAGE_CONTAINER_NAME = '$CONTAINER_VAR' (correct)"
    else
      print_status "FAIL" "STORAGE_CONTAINER_NAME = '$CONTAINER_VAR' (should be '$CONTAINER_NAME')"
    fi
  else
    print_status "WARN" "STORAGE_CONTAINER_NAME not set (will use default 'user-files')"
  fi
else
  print_status "FAIL" "Container app '$BACKEND_APP_NAME' not found"
fi
echo ""

# Check 9: Test Connection to Storage
echo "=== 9. Connection Test ==="
echo "Testing blob upload capability..."

TEST_FILE="/tmp/myworkmate-health-check-$(date +%s).txt"
echo "MyWorkMate File Upload Health Check - $(date)" > "$TEST_FILE"

if az storage blob upload \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER_NAME" \
  --name "health-check/test-$(date +%s).txt" \
  --file "$TEST_FILE" \
  --auth-mode login &>/dev/null; then

  print_status "OK" "Successfully uploaded test file to blob storage"
  rm "$TEST_FILE"
else
  print_status "FAIL" "Failed to upload test file"
  echo "  This indicates a permission or connectivity issue"
  rm "$TEST_FILE"
fi
echo ""

# Summary
echo "=================================================="
echo "Health Check Summary"
echo "=================================================="
echo ""
echo "If all checks passed (✅), file upload should work."
echo "If any checks failed (❌), address them before retrying."
echo ""
echo "Common fixes:"
echo "1. Missing role assignment: Assign 'Storage Blob Data Contributor' to managed identity"
echo "2. Firewall blocking: Add Container App IPs to storage allowlist or enable Azure Services bypass"
echo "3. Wrong connection string: Update Key Vault secret with correct value"
echo "4. Container name mismatch: Update STORAGE_CONTAINER_NAME environment variable"
echo ""
echo "For detailed logs, run: ./fetch-container-logs.sh --service FileUploadService --tail 100"
