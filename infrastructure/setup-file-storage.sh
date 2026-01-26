#!/bin/bash
set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
STORAGE_ACCOUNT="sabcagentdev"
RESOURCE_GROUP="rg-BCAgentPrototype-data-dev"
CONTAINER_NAME="user-files"
POLICY_FILE="infrastructure/blob-lifecycle-policy.json"

echo -e "${BLUE}Setting up Azure Blob Storage for file management...${NC}"

# Step 1: Create container
echo -e "\n${BLUE}Step 1: Creating container '${CONTAINER_NAME}'...${NC}"
az storage container create \
  --name "$CONTAINER_NAME" \
  --account-name "$STORAGE_ACCOUNT" \
  --public-access off \
  --auth-mode key \
  --only-show-errors

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Container created/verified${NC}"
else
  echo -e "${RED}✗ Failed to create container${NC}"
  exit 1
fi

# Step 2: Apply lifecycle policy
echo -e "\n${BLUE}Step 2: Applying lifecycle management policy...${NC}"
az storage account management-policy create \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --policy "@$POLICY_FILE" \
  --only-show-errors

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Lifecycle policy applied${NC}"
else
  echo -e "${RED}✗ Failed to apply lifecycle policy${NC}"
  exit 1
fi

# Step 3: Verify container
echo -e "\n${BLUE}Step 3: Verifying container...${NC}"
az storage container show \
  --name "$CONTAINER_NAME" \
  --account-name "$STORAGE_ACCOUNT" \
  --auth-mode key \
  --query "{name:name, publicAccess:properties.publicAccess}" \
  --output table

# Step 4: Verify policy
echo -e "\n${BLUE}Step 4: Verifying lifecycle policy...${NC}"
az storage account management-policy show \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query "policy.rules[0].definition.actions.baseBlob" \
  --output table

echo -e "\n${GREEN}✓ Azure Blob Storage setup complete!${NC}"
echo -e "\nCost optimization enabled:"
echo -e "  - Hot tier: New files (0-30 days)"
echo -e "  - Cool tier: Older files (30-90 days) - 50% cheaper"
echo -e "  - Archive tier: Archive files (90-730 days) - 90% cheaper"
echo -e "  - Auto-delete: After 730 days (2 years retention)"

echo -e "\n${BLUE}IMPORTANT: CORS Configuration${NC}"
echo -e "For browser-based file uploads to work, you must also configure CORS."
echo -e "Run: ${GREEN}bash infrastructure/setup-storage-cors.sh${NC}"
echo -e "This is required for drag-and-drop folder uploads and SAS URL uploads."
