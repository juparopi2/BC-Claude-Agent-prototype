#!/bin/bash
################################################################################
# Setup Container App Managed Identity Permissions
################################################################################
# Configures system-assigned managed identity permissions for BOTH backend and
# frontend Container Apps:
#   - Backend: AcrPull on ACR + Key Vault secret read access
#   - Frontend: AcrPull on ACR only
#
# Run ONCE after Container Apps are created for the first time.
#
# Prerequisites:
# - Container Apps must exist and have system-assigned identity enabled
# - User must have User Access Administrator or Owner role
################################################################################

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration — environment-based
ENVIRONMENT="${ENVIRONMENT:-dev}"
SUBSCRIPTION_ID="5343f6e1-f251-4b50-a592-18ff3e97eaa7"
RESOURCE_GROUP="rg-BCAgentPrototype-app-${ENVIRONMENT}"
ACR_NAME="crbcagent${ENVIRONMENT}"
KEY_VAULT_NAME="kv-bcagent-${ENVIRONMENT}"

BACKEND_APP="app-bcagent-backend-${ENVIRONMENT}"
FRONTEND_APP="app-bcagent-frontend-${ENVIRONMENT}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Setup Container App Managed Identities${NC}"
echo -e "${BLUE}Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Set subscription
echo -e "${YELLOW}Setting Azure subscription...${NC}"
az account set --subscription "$SUBSCRIPTION_ID"

# Get ACR resource ID
echo -e "\n${BLUE}Getting ACR resource ID...${NC}"
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
echo -e "${GREEN}ACR ID: $ACR_ID${NC}"

# ── Backend Container App ────────────────────────────────────

setup_app() {
  local APP_NAME="$1"
  local NEEDS_KV="$2"

  echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Configuring: $APP_NAME${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # Check existence
  if ! az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
    echo -e "${YELLOW}⚠ Container App '$APP_NAME' not found — skipping.${NC}"
    echo -e "${YELLOW}  It will be created by the GitHub Actions workflow.${NC}"
    return 0
  fi
  echo -e "${GREEN}✓ Container App found${NC}"

  # Get managed identity principal ID
  PRINCIPAL_ID=$(az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query identity.principalId -o tsv)

  if [ -z "$PRINCIPAL_ID" ] || [ "$PRINCIPAL_ID" == "null" ]; then
    echo -e "${RED}✗ No system-assigned identity! Ensure --system-assigned was used.${NC}"
    return 1
  fi
  echo -e "${GREEN}✓ Principal ID: $PRINCIPAL_ID${NC}"

  # Assign AcrPull role
  echo -e "${YELLOW}Assigning AcrPull role...${NC}"
  az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --assignee-object-id "$PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "AcrPull" \
    --scope "$ACR_ID" \
    2>/dev/null || echo -e "${BLUE}(Role assignment might already exist)${NC}"
  echo -e "${GREEN}✓ AcrPull role assigned${NC}"

  # Key Vault access (backend only)
  if [ "$NEEDS_KV" = "true" ]; then
    echo -e "${YELLOW}Assigning Key Vault access policy...${NC}"
    az keyvault set-policy \
      --name "$KEY_VAULT_NAME" \
      --object-id "$PRINCIPAL_ID" \
      --secret-permissions get list \
      2>/dev/null || echo -e "${BLUE}(Access policy might already exist)${NC}"
    echo -e "${GREEN}✓ Key Vault access configured${NC}"
  fi

  # Verify
  echo -e "\n${BLUE}Role assignments for $APP_NAME:${NC}"
  az role assignment list \
    --assignee "$PRINCIPAL_ID" \
    --query "[].{Role:roleDefinitionName, Scope:scope}" \
    --output table
}

setup_app "$BACKEND_APP" "true"
setup_app "$FRONTEND_APP" "false"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Managed Identity Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Permissions configured:"
echo -e "  ✅ $BACKEND_APP  → AcrPull + Key Vault (get, list)"
echo -e "  ✅ $FRONTEND_APP → AcrPull"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Re-run GitHub Actions workflows to complete deployment"
echo -e "  2. This script only needs to be run once per environment"
echo ""
