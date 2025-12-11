#!/bin/bash
set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
LOCATION="westeurope"
CV_NAME="cv-bcagent-dev"
SKU="S1"

echo -e "${BLUE}Setting up Azure Computer Vision...${NC}"

# Step 0: Ensure Resource Group exists
echo -e "\n${BLUE}Step 0: Checking Resource Group '${RESOURCE_GROUP}'...${NC}"
if [ $(az group exists --name $RESOURCE_GROUP) = false ]; then
    echo "Creating resource group..."
    az group create --name $RESOURCE_GROUP --location $LOCATION
else
    echo "Resource group exists."
fi

# Step 1: Create Computer Vision Account
echo -e "\n${BLUE}Step 1: Creating Computer Vision Account '${CV_NAME}'...${NC}"
az cognitiveservices account create \
  --name "$CV_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --kind "ComputerVision" \
  --sku "$SKU" \
  --yes

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Computer Vision Account created/verified${NC}"
else
  echo -e "${RED}✗ Failed to create Computer Vision Account${NC}"
  exit 1
fi

# Step 2: Get Keys and Endpoint
echo -e "\n${BLUE}Step 2: Retrieving configuration...${NC}"
ENDPOINT=$(az cognitiveservices account show --name "$CV_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.endpoint" --output tsv)
KEY=$(az cognitiveservices account keys list --name "$CV_NAME" --resource-group "$RESOURCE_GROUP" --query "key1" --output tsv)

echo -e "\n${GREEN}✓ Setup complete!${NC}"
echo -e "Add these to your .env file:"
echo -e "AZURE_VISION_ENDPOINT=$ENDPOINT"
echo -e "AZURE_VISION_KEY=$KEY"
