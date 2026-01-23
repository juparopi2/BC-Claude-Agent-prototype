#!/bin/bash
###############################################################################
# Setup Application Insights Permissions
#
# This script configures the necessary permissions for Application Insights
# to work with Azure Container Apps.
#
# CRITICAL: Container Apps need to read the Application Insights connection
# string from Key Vault using their managed identity. Without this permission,
# Application Insights will silently fail to initialize.
#
# Permissions configured:
# 1. Container App managed identity → Key Vault Secrets User (read connection string)
#
# Usage:
#   ./setup-application-insights-permissions.sh [environment]
#
# Arguments:
#   environment: dev, staging, or prod (default: dev)
#
# Prerequisites:
#   - Azure CLI installed and authenticated (az login)
#   - Proper subscription set (az account set)
#   - Application Insights already provisioned (setup-application-insights.sh)
#   - Container App already deployed with managed identity
#
# Author: MyWorkMate Infrastructure Team
# Date: 2026-01-23
###############################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default environment
ENVIRONMENT="${1:-dev}"

# Azure resource names (following naming convention)
SUBSCRIPTION_ID="5343f6e1-f251-4b50-a592-18ff3e97eaa7"
APP_RESOURCE_GROUP="rg-BCAgentPrototype-app-${ENVIRONMENT}"
SEC_RESOURCE_GROUP="rg-BCAgentPrototype-sec-${ENVIRONMENT}"
CONTAINER_APP_NAME="app-bcagent-backend-${ENVIRONMENT}"
KEY_VAULT_NAME="kv-bcagent-${ENVIRONMENT}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Application Insights Permissions Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Environment: ${GREEN}${ENVIRONMENT}${NC}"
echo -e "Subscription: ${SUBSCRIPTION_ID}"
echo ""

# Set subscription context
echo -e "${YELLOW}[1/5]${NC} Setting subscription context..."
az account set --subscription "${SUBSCRIPTION_ID}"
echo -e "${GREEN}✓${NC} Subscription set"
echo ""

# Get Container App managed identity principal ID
echo -e "${YELLOW}[2/5]${NC} Retrieving Container App managed identity..."
PRINCIPAL_ID=$(az containerapp show \
  --name "${CONTAINER_APP_NAME}" \
  --resource-group "${APP_RESOURCE_GROUP}" \
  --query "identity.principalId" \
  --output tsv)

if [ -z "${PRINCIPAL_ID}" ] || [ "${PRINCIPAL_ID}" = "null" ]; then
  echo -e "${RED}✗${NC} Container App does not have a managed identity!"
  echo -e "${YELLOW}  Run this command to enable it:${NC}"
  echo -e "  az containerapp identity assign \\"
  echo -e "    --name ${CONTAINER_APP_NAME} \\"
  echo -e "    --resource-group ${APP_RESOURCE_GROUP} \\"
  echo -e "    --system-assigned"
  exit 1
fi

echo -e "${GREEN}✓${NC} Managed identity found: ${PRINCIPAL_ID}"
echo ""

# Get Key Vault resource ID
echo -e "${YELLOW}[3/5]${NC} Retrieving Key Vault resource ID..."
KEYVAULT_ID=$(az keyvault show \
  --name "${KEY_VAULT_NAME}" \
  --resource-group "${SEC_RESOURCE_GROUP}" \
  --query "id" \
  --output tsv)

if [ -z "${KEYVAULT_ID}" ] || [ "${KEYVAULT_ID}" = "null" ]; then
  echo -e "${RED}✗${NC} Key Vault '${KEY_VAULT_NAME}' not found!"
  echo -e "${YELLOW}  Ensure Key Vault exists in resource group '${SEC_RESOURCE_GROUP}'${NC}"
  exit 1
fi

echo -e "${GREEN}✓${NC} Key Vault found: ${KEY_VAULT_NAME}"
echo ""

# Assign Key Vault Secrets User role
echo -e "${YELLOW}[4/5]${NC} Assigning 'Key Vault Secrets User' role..."
echo -e "   This allows Container App to read Application Insights connection string"

# Check if role already assigned
EXISTING_ROLE=$(az role assignment list \
  --assignee "${PRINCIPAL_ID}" \
  --scope "${KEYVAULT_ID}" \
  --query "[?roleDefinitionName=='Key Vault Secrets User'].roleDefinitionName" \
  --output tsv)

if [ -n "${EXISTING_ROLE}" ]; then
  echo -e "${YELLOW}⚠${NC}  Role already assigned, skipping..."
else
  az role assignment create \
    --assignee "${PRINCIPAL_ID}" \
    --role "Key Vault Secrets User" \
    --scope "${KEYVAULT_ID}" \
    --output none

  echo -e "${GREEN}✓${NC} Role assigned successfully"
fi
echo ""

# Verify permissions
echo -e "${YELLOW}[5/5]${NC} Verifying permissions..."
ROLE_COUNT=$(az role assignment list \
  --assignee "${PRINCIPAL_ID}" \
  --scope "${KEYVAULT_ID}" \
  --query "length([?roleDefinitionName=='Key Vault Secrets User'])" \
  --output tsv)

if [ "${ROLE_COUNT}" -gt 0 ]; then
  echo -e "${GREEN}✓${NC} Permissions verified successfully"
else
  echo -e "${RED}✗${NC} Verification failed - role not found"
  exit 1
fi
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Setup Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Restart Container App to pick up new permissions:"
echo "   az containerapp revision restart \\"
echo "     --name ${CONTAINER_APP_NAME} \\"
echo "     --resource-group ${APP_RESOURCE_GROUP}"
echo ""
echo "2. Verify Application Insights initialization in logs:"
echo "   az containerapp logs show \\"
echo "     --name ${CONTAINER_APP_NAME} \\"
echo "     --resource-group ${APP_RESOURCE_GROUP} \\"
echo "     --tail 50 | grep -i 'ApplicationInsights'"
echo ""
echo "3. Query Application Insights to confirm data ingestion:"
echo "   - Go to Azure Portal → Application Insights → ai-bcagent-${ENVIRONMENT}"
echo "   - Run query: traces | where timestamp > ago(15m) | take 10"
echo ""
