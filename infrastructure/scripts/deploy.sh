#!/bin/bash
set -euo pipefail

# =============================================================================
# deploy.sh — Deploy Azure infrastructure via Bicep
#
# Usage:
#   ENVIRONMENT=dev ./deploy.sh              # Deploy dev (default)
#   ENVIRONMENT=prod ./deploy.sh             # Deploy prod
#   ENVIRONMENT=dev ./deploy.sh --what-if    # Preview changes only
# =============================================================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ENVIRONMENT="${ENVIRONMENT:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BICEP_DIR="$(cd "$SCRIPT_DIR/../bicep" && pwd)"
PARAM_FILE="$BICEP_DIR/environments/${ENVIRONMENT}.bicepparam"
LOCATION="${LOCATION:-westeurope}"
DEPLOYMENT_NAME="myworkmate-infra-${ENVIRONMENT}-$(date +%Y%m%d%H%M%S)"

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}MyWorkMate Azure Infrastructure Deployment${NC}"
echo -e "${BLUE}Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# ── Step 1: Validate prerequisites ─────────────────────────────

echo -e "${BLUE}Step 1: Checking prerequisites...${NC}"

if ! command -v az &>/dev/null; then
  echo -e "${RED}Azure CLI (az) is not installed. Install: https://aka.ms/install-azure-cli${NC}"
  exit 1
fi

if ! az account show &>/dev/null; then
  echo -e "${RED}Not logged in to Azure. Run 'az login' first.${NC}"
  exit 1
fi

SUBSCRIPTION=$(az account show --query name -o tsv)
echo -e "${GREEN}Authenticated to: $SUBSCRIPTION${NC}"

if [ ! -f "$PARAM_FILE" ]; then
  echo -e "${RED}Parameter file not found: $PARAM_FILE${NC}"
  echo "Available environments:"
  ls "$BICEP_DIR/environments/"*.bicepparam 2>/dev/null | xargs -I{} basename {} .bicepparam
  exit 1
fi

echo -e "${GREEN}Using parameter file: $PARAM_FILE${NC}"

# ── Step 2: Validate required environment variables ─────────────

echo ""
echo -e "${BLUE}Step 2: Validating environment variables...${NC}"

REQUIRED_VARS=(
  SQL_ADMIN_PASSWORD
  CLAUDE_API_KEY
  BC_TENANT_ID
  BC_CLIENT_ID
  BC_CLIENT_SECRET
  SESSION_SECRET
  ENCRYPTION_KEY
  MICROSOFT_CLIENT_ID
  MICROSOFT_CLIENT_SECRET
  MICROSOFT_TENANT_ID
)

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo -e "${RED}Missing required environment variables:${NC}"
  for var in "${MISSING[@]}"; do
    echo -e "  ${RED}- $var${NC}"
  done
  echo ""
  echo "Set them before running this script, e.g.:"
  echo "  export SQL_ADMIN_PASSWORD='...'"
  echo "  export CLAUDE_API_KEY='...'"
  exit 1
fi

echo -e "${GREEN}All required environment variables are set.${NC}"

# ── Step 3: Run what-if preview ────────────────────────────────

echo ""
echo -e "${BLUE}Step 3: Running what-if preview...${NC}"

az deployment sub what-if \
  --name "$DEPLOYMENT_NAME" \
  --location "$LOCATION" \
  --template-file "$BICEP_DIR/main.bicep" \
  --parameters "$PARAM_FILE" \
  --no-prompt

# ── Step 4: Confirm and deploy ─────────────────────────────────

if [[ "${1:-}" == "--what-if" ]]; then
  echo ""
  echo -e "${YELLOW}--what-if mode: stopping before deployment.${NC}"
  exit 0
fi

echo ""
echo -e "${YELLOW}Review the changes above.${NC}"
read -p "Proceed with deployment? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Deployment cancelled.${NC}"
  exit 0
fi

echo ""
echo -e "${BLUE}Step 4: Deploying infrastructure...${NC}"

az deployment sub create \
  --name "$DEPLOYMENT_NAME" \
  --location "$LOCATION" \
  --template-file "$BICEP_DIR/main.bicep" \
  --parameters "$PARAM_FILE" \
  --no-prompt

echo ""
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}=============================================${NC}"

# ── Step 5: Print outputs ──────────────────────────────────────

echo ""
echo -e "${BLUE}Deployment outputs:${NC}"
az deployment sub show \
  --name "$DEPLOYMENT_NAME" \
  --query "properties.outputs" \
  -o table 2>/dev/null || echo "(outputs may take a moment to propagate)"

# ── Step 6: Post-deploy checklist ──────────────────────────────

echo ""
echo -e "${YELLOW}Post-deploy steps (run once per new environment):${NC}"
echo ""
echo "  1. Setup Container App identities (after CI/CD creates the Container Apps):"
echo "     bash infrastructure/scripts/setup-container-app-identity.sh"
echo ""
echo "  2. Configure Storage CORS:"
echo "     ENVIRONMENT=${ENVIRONMENT} bash infrastructure/scripts/setup-storage-cors.sh"
echo ""
echo "  3. Update AI Search index schema:"
echo "     bash infrastructure/scripts/update-search-index-schema.sh"
echo ""
echo "  4. Update AI Search semantic config:"
echo "     bash infrastructure/scripts/update-search-semantic-config.sh"
echo ""
echo "  5. Deploy backend and frontend via GitHub Actions (git push to main)"
echo ""
echo -e "${BLUE}Verify with: bash infrastructure/diagnostics/verify-azure-config.sh${NC}"
echo ""
