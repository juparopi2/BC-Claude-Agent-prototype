#!/bin/bash
################################################################################
# Setup Container App Managed Identity Permissions
################################################################################
# This script configures the necessary permissions for the Container App's
# system-assigned managed identity to access Azure Container Registry and
# Key Vault.
#
# This script should be executed ONCE after the Container App is created
# for the first time.
#
# Prerequisites:
# - Container App must exist and have system-assigned identity enabled
# - User running this script must have:
#   - User Access Administrator or Owner role on the subscription/RG
#   - Key Vault Administrator or equivalent
################################################################################

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SUBSCRIPTION_ID="5343f6e1-f251-4b50-a592-18ff3e97eaa7"
RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
CONTAINER_APP_NAME="app-bcagent-backend-dev"
ACR_NAME="crbcagentdev"
KEY_VAULT_NAME="kv-bcagent-dev"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Setup Container App Managed Identity${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Set subscription
echo -e "${YELLOW}Setting Azure subscription...${NC}"
az account set --subscription "$SUBSCRIPTION_ID"

# Check if Container App exists
echo -e "\n${BLUE}Checking Container App existence...${NC}"
if ! az containerapp show --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
    echo -e "${RED}❌ Container App '$CONTAINER_APP_NAME' not found!${NC}"
    echo -e "${YELLOW}Please create the Container App first by running the GitHub Actions workflow.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Container App found${NC}"

# Get the system-assigned identity principal ID
echo -e "\n${BLUE}Getting managed identity...${NC}"
PRINCIPAL_ID=$(az containerapp show \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query identity.principalId -o tsv)

if [ -z "$PRINCIPAL_ID" ] || [ "$PRINCIPAL_ID" == "null" ]; then
    echo -e "${RED}❌ Container App does not have system-assigned identity enabled!${NC}"
    echo -e "${YELLOW}Please ensure the Container App was created with --system-assigned flag.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Managed Identity Principal ID: $PRINCIPAL_ID${NC}"

# Get ACR resource ID
echo -e "\n${BLUE}Getting ACR resource ID...${NC}"
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
echo -e "${GREEN}✓ ACR ID: $ACR_ID${NC}"

# Assign AcrPull role to the managed identity
echo -e "\n${YELLOW}Assigning AcrPull role to managed identity...${NC}"
az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --assignee-object-id "$PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "AcrPull" \
    --scope "$ACR_ID" \
    2>/dev/null || echo -e "${BLUE}(Role assignment might already exist)${NC}"

echo -e "${GREEN}✓ AcrPull role assigned${NC}"

# Assign Key Vault access policy
echo -e "\n${YELLOW}Assigning Key Vault access policy...${NC}"
az keyvault set-policy \
    --name "$KEY_VAULT_NAME" \
    --object-id "$PRINCIPAL_ID" \
    --secret-permissions get list \
    2>/dev/null || echo -e "${BLUE}(Access policy might already exist)${NC}"

echo -e "${GREEN}✓ Key Vault access configured${NC}"

# Verify permissions
echo -e "\n${BLUE}Verifying role assignments...${NC}"
echo -e "${BLUE}Managed Identity Permissions:${NC}"
az role assignment list \
    --assignee "$PRINCIPAL_ID" \
    --query "[].{Role:roleDefinitionName, Scope:scope}" \
    --output table

# Verify Key Vault access
echo -e "\n${BLUE}Key Vault Access Policies:${NC}"
az keyvault show \
    --name "$KEY_VAULT_NAME" \
    --query "properties.accessPolicies[?objectId=='$PRINCIPAL_ID'].{ObjectId:objectId, Permissions:permissions.secrets}" \
    --output table

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Managed Identity Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e ""
echo -e "The Container App managed identity now has:"
echo -e "  ✅ AcrPull access to $ACR_NAME"
echo -e "  ✅ Key Vault secrets read access to $KEY_VAULT_NAME"
echo -e ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. The Container App can now pull images from ACR"
echo -e "  2. The Container App can read secrets from Key Vault"
echo -e "  3. Re-run the GitHub Actions workflow to complete deployment"
echo -e "  4. This script only needs to be run once per Container App"
echo -e ""
echo -e "${BLUE}To update the Container App with the backend image:${NC}"
echo -e "  git push origin main"
echo -e ""
