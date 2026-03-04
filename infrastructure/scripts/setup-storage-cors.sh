#!/bin/bash
set -e  # Exit on error

# =============================================================================
# setup-storage-cors.sh
#
# Configures CORS (Cross-Origin Resource Sharing) rules for Azure Blob Storage.
# This is REQUIRED for browser-based file uploads using SAS URLs.
#
# WHEN TO RUN:
#   - After initial infrastructure deployment
#   - After changing frontend URL or adding new environments
#   - When troubleshooting "CORS policy" errors in browser console
#
# SECURITY CONSIDERATIONS:
#   The storage account uses public network access with SAS URL authentication.
#   CORS restricts which origins can make browser requests to the storage.
#   - SAS URLs have expiration times (default: 3 hours)
#   - SAS URLs have specific permissions (create, write only - no read/delete)
#   - Without proper CORS, browsers will block the upload requests
#
# ARCHITECTURE:
#   Browser --> Azure Blob Storage (direct upload via SAS URL)
#             ^ CORS rules allow requests from frontend origins
#
# =============================================================================

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration - Environment-specific
ENVIRONMENT="${ENVIRONMENT:-dev}"

case "$ENVIRONMENT" in
  dev|development)
    STORAGE_ACCOUNT="sabcagentdev"
    RESOURCE_GROUP_DATA="rg-BCAgentPrototype-data-dev"
    RESOURCE_GROUP_APP="rg-BCAgentPrototype-app-dev"
    FRONTEND_APP_NAME="app-bcagent-frontend-dev"
    # Development origins (localhost)
    DEV_ORIGINS=("http://localhost:3000" "http://127.0.0.1:3000")
    ;;
  test)
    STORAGE_ACCOUNT="sabcagenttest"
    RESOURCE_GROUP_DATA="rg-BCAgentPrototype-data-test"
    RESOURCE_GROUP_APP="rg-BCAgentPrototype-app-test"
    FRONTEND_APP_NAME="app-bcagent-frontend-test"
    DEV_ORIGINS=()
    ;;
  prod|production)
    STORAGE_ACCOUNT="sabcagentprod"
    RESOURCE_GROUP_DATA="rg-BCAgentPrototype-data-prod"
    RESOURCE_GROUP_APP="rg-BCAgentPrototype-app-prod"
    FRONTEND_APP_NAME="app-bcagent-frontend-prod"
    DEV_ORIGINS=()
    ;;
  *)
    echo -e "${RED}Unknown environment: $ENVIRONMENT${NC}"
    echo "Usage: ENVIRONMENT=dev|test|prod $0"
    exit 1
    ;;
esac

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}Azure Blob Storage CORS Configuration${NC}"
echo -e "${BLUE}Environment: ${YELLOW}$ENVIRONMENT${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Verify Azure CLI authentication
# -----------------------------------------------------------------------------
echo -e "${BLUE}Step 1: Verifying Azure CLI authentication...${NC}"
if ! az account show &>/dev/null; then
  echo -e "${RED}Not authenticated to Azure. Run 'az login' first.${NC}"
  exit 1
fi
SUBSCRIPTION=$(az account show --query name -o tsv)
echo -e "${GREEN}Authenticated to: $SUBSCRIPTION${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 2: Verify storage account exists
# -----------------------------------------------------------------------------
echo -e "${BLUE}Step 2: Verifying storage account...${NC}"
if ! az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP_DATA" &>/dev/null; then
  echo -e "${RED}Storage account '$STORAGE_ACCOUNT' not found${NC}"
  echo "Run the main infrastructure deployment first."
  exit 1
fi
echo -e "${GREEN}Storage account '$STORAGE_ACCOUNT' found${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 3: Get frontend Container App URL
# -----------------------------------------------------------------------------
echo -e "${BLUE}Step 3: Getting frontend Container App URL...${NC}"
FRONTEND_FQDN=$(az containerapp show \
  --name "$FRONTEND_APP_NAME" \
  --resource-group "$RESOURCE_GROUP_APP" \
  --query properties.configuration.ingress.fqdn \
  --output tsv 2>/dev/null || echo "")

if [ -z "$FRONTEND_FQDN" ]; then
  echo -e "${YELLOW}Frontend Container App not found. CORS will only include development origins.${NC}"
  PROD_ORIGIN=""
else
  PROD_ORIGIN="https://$FRONTEND_FQDN"
  echo -e "${GREEN}Frontend URL: $PROD_ORIGIN${NC}"
fi
echo ""

# -----------------------------------------------------------------------------
# Step 4: Clear existing CORS rules
# -----------------------------------------------------------------------------
echo -e "${BLUE}Step 4: Clearing existing CORS rules...${NC}"
az storage cors clear --account-name "$STORAGE_ACCOUNT" --services b 2>/dev/null || true
echo -e "${GREEN}Existing rules cleared${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 5: Add CORS rules
# -----------------------------------------------------------------------------
echo -e "${BLUE}Step 5: Adding CORS rules...${NC}"

# Common CORS parameters
METHODS="GET POST PUT DELETE OPTIONS"
ALLOWED_HEADERS="*"
EXPOSED_HEADERS="*"
MAX_AGE=3600

# Add production origin (if available)
if [ -n "$PROD_ORIGIN" ]; then
  echo "  Adding production origin: $PROD_ORIGIN"
  az storage cors add \
    --account-name "$STORAGE_ACCOUNT" \
    --services b \
    --methods $METHODS \
    --origins "$PROD_ORIGIN" \
    --allowed-headers "$ALLOWED_HEADERS" \
    --exposed-headers "$EXPOSED_HEADERS" \
    --max-age $MAX_AGE
  echo -e "${GREEN}  Production origin added${NC}"
fi

# Add development origins (if any)
for DEV_ORIGIN in "${DEV_ORIGINS[@]}"; do
  echo "  Adding development origin: $DEV_ORIGIN"
  az storage cors add \
    --account-name "$STORAGE_ACCOUNT" \
    --services b \
    --methods $METHODS \
    --origins "$DEV_ORIGIN" \
    --allowed-headers "$ALLOWED_HEADERS" \
    --exposed-headers "$EXPOSED_HEADERS" \
    --max-age $MAX_AGE
  echo -e "${GREEN}  Development origin added${NC}"
done

echo ""

# -----------------------------------------------------------------------------
# Step 6: Verify CORS configuration
# -----------------------------------------------------------------------------
echo -e "${BLUE}Step 6: Verifying CORS configuration...${NC}"
az storage cors list --account-name "$STORAGE_ACCOUNT" --services b --output table
echo ""

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}CORS Configuration Complete!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo "Configured origins:"
if [ -n "$PROD_ORIGIN" ]; then
  echo -e "  ${GREEN}$PROD_ORIGIN${NC} (production)"
fi
for DEV_ORIGIN in "${DEV_ORIGINS[@]}"; do
  echo -e "  ${YELLOW}$DEV_ORIGIN${NC} (development)"
done
echo ""
echo "These origins can now upload files directly to Azure Blob Storage."
echo ""
echo -e "${YELLOW}NOTE: If you add a custom domain to the frontend, you must:${NC}"
echo "  1. Add the custom domain as an additional CORS origin"
echo "  2. Or re-run this script after updating the Container App"
echo ""
