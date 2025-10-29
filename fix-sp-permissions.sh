#!/bin/bash
################################################################################
# Fix Service Principal Permissions for Azure Container Apps Deployment
################################################################################
# This script assigns the necessary Contributor role to the GitHub Actions
# Service Principal at the Resource Group level, as required by Azure Container
# Apps deployment documentation.
#
# Reference: https://learn.microsoft.com/en-us/azure/container-apps/github-actions
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
SP_APP_ID="860de439-a0f5-4fef-b696-cf3131d77050"
SP_OBJECT_ID="8e052582-1146-491e-ac96-ff6aa3c402c5"
RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Fix Service Principal Permissions${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Set subscription
echo -e "${YELLOW}Setting Azure subscription...${NC}"
az account set --subscription "$SUBSCRIPTION_ID"

# Show current permissions
echo -e "\n${BLUE}Current Service Principal permissions:${NC}"
az role assignment list \
  --assignee "$SP_APP_ID" \
  --all \
  --output table

# Assign Contributor role at Resource Group level
echo -e "\n${YELLOW}Assigning Contributor role to Service Principal on Resource Group...${NC}"
echo -e "Service Principal: sp-bcagent-github-actions"
echo -e "Resource Group: $RESOURCE_GROUP"
echo -e ""

# Calculate scope
RG_SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"

echo -e "${YELLOW}Executing role assignment...${NC}"
az role assignment create \
  --assignee "$SP_APP_ID" \
  --role "Contributor" \
  --scope "$RG_SCOPE"

echo -e "\n${GREEN}✓ Role assignment completed${NC}"

# Verify the new permissions
echo -e "\n${BLUE}Updated Service Principal permissions:${NC}"
az role assignment list \
  --assignee "$SP_APP_ID" \
  --all \
  --output table

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Service Principal now has the required permissions${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e ""
echo -e "The GitHub Actions workflow should now be able to:"
echo -e "  - Create Azure Container Apps"
echo -e "  - Update Container Apps"
echo-e "  - Assign roles to managed identities"
echo -e "  - Configure ACR integration"
echo -e ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Re-run the GitHub Actions workflow"
echo -e "  2. Verify the Container App deploys successfully"
echo -e ""
