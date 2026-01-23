#!/bin/bash

# setup-application-insights.sh
# Provisions Azure Application Insights + Log Analytics Workspace for MyWorkMate

set -euo pipefail

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
LOCATION="westeurope"
WORKSPACE_NAME="law-bcagent-dev"
APP_INSIGHTS_NAME="ai-bcagent-dev"
KEY_VAULT_NAME="kv-bcagent-dev"
RETENTION_DAYS=365

echo "=================================================="
echo "Application Insights Setup for MyWorkMate"
echo "=================================================="
echo ""

# Check Azure CLI authentication
if ! az account show &>/dev/null; then
  echo -e "${YELLOW}Error: Not authenticated to Azure. Run 'az login' first.${NC}"
  exit 1
fi

SUBSCRIPTION=$(az account show --query name -o tsv)
echo -e "${CYAN}Deploying to subscription: $SUBSCRIPTION${NC}"
echo ""

# Step 1: Create Log Analytics Workspace
echo "=== Step 1: Creating Log Analytics Workspace ==="
echo ""

if az monitor log-analytics workspace show --workspace-name "$WORKSPACE_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  echo -e "${YELLOW}Log Analytics Workspace '$WORKSPACE_NAME' already exists. Skipping creation.${NC}"
else
  echo "Creating Log Analytics Workspace '$WORKSPACE_NAME'..."

  az monitor log-analytics workspace create \
    --resource-group "$RESOURCE_GROUP" \
    --workspace-name "$WORKSPACE_NAME" \
    --location "$LOCATION" \
    --retention-time "$RETENTION_DAYS" \
    --query "{name:name, id:id, location:location}" \
    -o table

  echo -e "${GREEN}✅ Log Analytics Workspace created successfully${NC}"
fi

WORKSPACE_ID=$(az monitor log-analytics workspace show --workspace-name "$WORKSPACE_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)
echo "Workspace ID: $WORKSPACE_ID"
echo ""

# Step 2: Create Application Insights (workspace-based)
echo "=== Step 2: Creating Application Insights ==="
echo ""

if az monitor app-insights component show --app "$APP_INSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  echo -e "${YELLOW}Application Insights '$APP_INSIGHTS_NAME' already exists. Skipping creation.${NC}"
else
  echo "Creating Application Insights '$APP_INSIGHTS_NAME'..."

  # Use MSYS_NO_PATHCONV to prevent Git Bash from converting workspace ID path
  MSYS_NO_PATHCONV=1 az monitor app-insights component create \
    --app "$APP_INSIGHTS_NAME" \
    --location "$LOCATION" \
    --resource-group "$RESOURCE_GROUP" \
    --workspace "$WORKSPACE_ID" \
    --query "{name:name, appId:appId, instrumentationKey:instrumentationKey}" \
    -o table

  echo -e "${GREEN}✅ Application Insights created successfully${NC}"
fi
echo ""

# Step 3: Get Connection String
echo "=== Step 3: Retrieving Connection String ==="
echo ""

CONNECTION_STRING=$(az monitor app-insights component show \
  --app "$APP_INSIGHTS_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query connectionString -o tsv)

echo "Connection String (first 50 chars): ${CONNECTION_STRING:0:50}..."
echo ""

# Step 4: Store Connection String in Key Vault
echo "=== Step 4: Storing Connection String in Key Vault ==="
echo ""

if az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "ApplicationInsights-ConnectionString" &>/dev/null; then
  echo -e "${YELLOW}Secret 'ApplicationInsights-ConnectionString' already exists in Key Vault.${NC}"
  read -p "Do you want to update it? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name "ApplicationInsights-ConnectionString" \
      --value "$CONNECTION_STRING" \
      --query "{name:name,version:version}" \
      -o table

    echo -e "${GREEN}✅ Secret updated in Key Vault${NC}"
  else
    echo "Skipped updating secret."
  fi
else
  az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "ApplicationInsights-ConnectionString" \
    --value "$CONNECTION_STRING" \
    --query "{name:name,version:version}" \
    -o table

  echo -e "${GREEN}✅ Secret stored in Key Vault${NC}"
fi
echo ""

# Step 5: Configure Data Collection
echo "=== Step 5: Configuring Data Collection ==="
echo ""

# Set sampling percentage (default: 100% for initial phase, can reduce later)
SAMPLING_PERCENTAGE=100
echo "Setting sampling percentage to $SAMPLING_PERCENTAGE%"

az monitor app-insights component update \
  --app "$APP_INSIGHTS_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --sampling-percentage "$SAMPLING_PERCENTAGE" \
  --query "{name:name,samplingPercentage:samplingPercentage}" \
  -o table

echo -e "${GREEN}✅ Sampling configured${NC}"
echo ""

# Step 6: Summary and Next Steps
echo "=================================================="
echo "Setup Complete!"
echo "=================================================="
echo ""
echo -e "${GREEN}✅ Log Analytics Workspace: $WORKSPACE_NAME${NC}"
echo -e "${GREEN}✅ Application Insights: $APP_INSIGHTS_NAME${NC}"
echo -e "${GREEN}✅ Connection String stored in Key Vault: $KEY_VAULT_NAME${NC}"
echo -e "${GREEN}✅ Retention period: $RETENTION_DAYS days (GDPR compliant)${NC}"
echo -e "${GREEN}✅ Sampling rate: $SAMPLING_PERCENTAGE%${NC}"
echo ""
echo "Next Steps:"
echo ""
echo "1. Update Container App environment variables:"
echo "   az containerapp update \\"
echo "     --name app-bcagent-backend-dev \\"
echo "     --resource-group $RESOURCE_GROUP \\"
echo "     --set-env-vars \"APPLICATIONINSIGHTS_ENABLED=true\" \\"
echo "     --secrets \"applicationinsights-connectionstring=keyvaultref:$CONNECTION_STRING,identityref:mi-bcagent-backend-dev\""
echo ""
echo "2. Deploy updated backend code with Application Insights integration"
echo ""
echo "3. Verify logs are flowing:"
echo "   - Open Azure Portal > Application Insights > $APP_INSIGHTS_NAME > Logs"
echo "   - Run query: traces | where timestamp > ago(15m) | take 100"
echo ""
echo "4. Create dashboard and alerts (see Phase 6 documentation)"
echo ""
echo "Portal Links:"
echo "  - Log Analytics: https://portal.azure.com/#@/resource$WORKSPACE_ID"
echo "  - Application Insights: https://portal.azure.com/#@/resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Insights/components/$APP_INSIGHTS_NAME"
echo ""
echo "=================================================="
echo ""
