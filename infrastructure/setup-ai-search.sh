#!/bin/bash
set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
RESOURCE_GROUP="rg-BCAgentPrototype-data-dev"
LOCATION="westeurope"
SEARCH_SERVICE_NAME="search-bcagent-dev"
SKU="basic" # Basic is minimum for some vector features production, but standard/free might work for dev. Sticking to plan suggestion.

echo -e "${BLUE}Setting up Azure AI Search...${NC}"

# Step 0: Ensure Resource Group exists
echo -e "\n${BLUE}Step 0: Checking Resource Group '${RESOURCE_GROUP}'...${NC}"
if [ $(az group exists --name $RESOURCE_GROUP) = false ]; then
    echo "Creating resource group..."
    az group create --name $RESOURCE_GROUP --location $LOCATION
else
    echo "Resource group exists."
fi

# Step 1: Create Search Service
echo -e "\n${BLUE}Step 1: Creating Search Service '${SEARCH_SERVICE_NAME}'...${NC}"
az search service create \
  --name "$SEARCH_SERVICE_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --sku "$SKU" \
  --location "$LOCATION" \
  --partition-count 1 \
  --replica-count 1

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Search Service created/verified${NC}"
else
  echo -e "${RED}✗ Failed to create Search Service${NC}"
  # Check if name is taken
  exit 1
fi

# Step 2: Get Keys and Endpoint
echo -e "\n${BLUE}Step 2: Retrieving configuration...${NC}"
KEY=$(az search admin-key show --service-name "$SEARCH_SERVICE_NAME" --resource-group "$RESOURCE_GROUP" --query "primaryKey" --output tsv)
ENDPOINT="https://$SEARCH_SERVICE_NAME.search.windows.net"

echo -e "\n${GREEN}✓ Setup complete!${NC}"
echo -e "Add these to your .env file:"
echo -e "AZURE_SEARCH_ENDPOINT=$ENDPOINT"
echo -e "AZURE_SEARCH_KEY=$KEY"
