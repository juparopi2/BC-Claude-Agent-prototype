#!/bin/bash
set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
LOCATION="eastus" # OpenAI availability is better in East US
OPENAI_NAME="openai-bcagent-dev"
MODEL_NAME="text-embedding-3-small"
MODEL_VERSION="1"

echo -e "${BLUE}Setting up Azure OpenAI Service...${NC}"

# Step 0: Ensure Resource Group exists
echo -e "\n${BLUE}Step 0: Checking Resource Group '${RESOURCE_GROUP}'...${NC}"
if [ $(az group exists --name $RESOURCE_GROUP) = false ]; then
    echo "Creating resource group..."
    az group create --name $RESOURCE_GROUP --location westeurope
else
    echo "Resource group exists."
fi

# Step 1: Create OpenAI Account
echo -e "\n${BLUE}Step 1: Creating OpenAI Account '${OPENAI_NAME}'...${NC}"
az cognitiveservices account create \
  --name "$OPENAI_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --kind "OpenAI" \
  --sku "S0" \
  --yes

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ OpenAI Account created/verified${NC}"
else
  echo -e "${RED}✗ Failed to create OpenAI Account${NC}"
  exit 1
fi

# Step 2: Deploy Embedding Model
echo -e "\n${BLUE}Step 2: Deploying model '${MODEL_NAME}'...${NC}"
az cognitiveservices account deployment create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$OPENAI_NAME" \
  --deployment-name "$MODEL_NAME" \
  --model-name "$MODEL_NAME" \
  --model-version "$MODEL_VERSION" \
  --model-format "OpenAI" \
  --sku-capacity "120" \
  --sku-name "Standard"

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Model deployed${NC}"
else
  echo -e "${RED}✗ Failed to deploy model${NC}"
  exit 1
fi

# Step 3: Get Keys and Endpoint
echo -e "\n${BLUE}Step 3: Retrieving configuration...${NC}"
ENDPOINT=$(az cognitiveservices account show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.endpoint" --output tsv)
KEY=$(az cognitiveservices account keys list --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query "key1" --output tsv)

echo -e "\n${GREEN}✓ Setup complete!${NC}"
echo -e "Add these to your .env file:"
echo -e "AZURE_OPENAI_ENDPOINT=$ENDPOINT"
echo -e "AZURE_OPENAI_KEY=$KEY"
echo -e "AZURE_OPENAI_EMBEDDING_DEPLOYMENT=$MODEL_NAME"
