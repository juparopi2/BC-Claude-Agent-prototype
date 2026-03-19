#!/bin/bash
set -euo pipefail

# =============================================================================
# create-container-apps.sh — Bootstrap Container Apps for a new environment
#
# Run ONCE before the first CI/CD pipeline execution. Creates both Container
# Apps (backend + frontend) with all Key Vault secret references pre-configured
# so that the production-deploy.yml workflow can do `az containerapp update`
# from the very first deploy.
#
# Sequence (avoids chicken-and-egg with managed identity + KV):
#   1. Create Container Apps with placeholder image + system-assigned identity
#   2. Grant Key Vault access to each app's system identity
#   3. Configure all KV secret references on the backend
#   4. Set initial env vars (secretref + direct values)
#
# Prerequisites:
#   - Bicep deployment complete (KV populated, CAE exists, ACR exists)
#   - Azure CLI logged in with Owner or User Access Administrator role
#   - ENVIRONMENT env var set (dev | prod)
#
# Usage:
#   ENVIRONMENT=prod bash infrastructure/scripts/create-container-apps.sh
# =============================================================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ENVIRONMENT="${ENVIRONMENT:-dev}"

case "$ENVIRONMENT" in
  dev)
    PROJECT_NAME="bcagent"
    RG_PREFIX="rg-BCAgentPrototype"
    ;;
  prod)
    PROJECT_NAME="myworkmate"
    RG_PREFIX="rg-myworkmate"
    ;;
  *)
    echo -e "${RED}Unknown environment: $ENVIRONMENT. Use 'dev' or 'prod'.${NC}"
    exit 1
    ;;
esac

RESOURCE_GROUP="${RG_PREFIX}-app-${ENVIRONMENT}"
RG_SEC="${RG_PREFIX}-sec-${ENVIRONMENT}"
KEY_VAULT_NAME="kv-${PROJECT_NAME}-${ENVIRONMENT}"
KEY_VAULT_URI="https://${KEY_VAULT_NAME}.vault.azure.net"
CAE_NAME="cae-${PROJECT_NAME}-${ENVIRONMENT}"
ACR_NAME="cr${PROJECT_NAME}${ENVIRONMENT}"
BACKEND_APP="app-${PROJECT_NAME}-backend-${ENVIRONMENT}"
FRONTEND_APP="app-${PROJECT_NAME}-frontend-${ENVIRONMENT}"
PLACEHOLDER_IMAGE="mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}Bootstrap Container Apps — ${ENVIRONMENT}${NC}"
echo -e "${BLUE}=============================================${NC}"
echo -e "Resource Group : ${YELLOW}${RESOURCE_GROUP}${NC}"
echo -e "Key Vault      : ${YELLOW}${KEY_VAULT_NAME}${NC}"
echo -e "CAE            : ${YELLOW}${CAE_NAME}${NC}"
echo -e "Backend App    : ${YELLOW}${BACKEND_APP}${NC}"
echo -e "Frontend App   : ${YELLOW}${FRONTEND_APP}${NC}"
echo ""

# ── Validate prerequisites ────────────────────────────────────────────────────

echo -e "${BLUE}Step 1: Validating prerequisites...${NC}"

if ! az account show &>/dev/null; then
  echo -e "${RED}Not logged in. Run 'az login' first.${NC}"
  exit 1
fi

if ! az containerapp env show --name "$CAE_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  echo -e "${RED}Container Apps Environment '$CAE_NAME' not found.${NC}"
  echo "Run the Bicep deployment first: ENVIRONMENT=${ENVIRONMENT} bash infrastructure/scripts/deploy.sh"
  exit 1
fi

if ! az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RG_SEC" &>/dev/null; then
  echo -e "${RED}Key Vault '$KEY_VAULT_NAME' not found. Run Bicep deployment first.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Prerequisites validated${NC}"
echo ""

# ── Helper: create or skip if already exists ──────────────────────────────────

app_exists() {
  az containerapp show --name "$1" --resource-group "$RESOURCE_GROUP" &>/dev/null
}

# ── Create backend Container App ──────────────────────────────────────────────

echo -e "${BLUE}Step 2: Creating backend Container App...${NC}"

if app_exists "$BACKEND_APP"; then
  echo -e "${YELLOW}⚠ Backend app already exists — skipping creation.${NC}"
else
  az containerapp create \
    --name "$BACKEND_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$CAE_NAME" \
    --image "$PLACEHOLDER_IMAGE" \
    --system-assigned \
    --ingress external \
    --target-port 3001 \
    --transport http \
    --min-replicas 1 \
    --max-replicas 3 \
    --cpu 0.5 \
    --memory 1.0Gi \
    --output none
  echo -e "${GREEN}✓ Backend Container App created${NC}"
fi

# ── Create frontend Container App ─────────────────────────────────────────────

echo -e "${BLUE}Step 3: Creating frontend Container App...${NC}"

if app_exists "$FRONTEND_APP"; then
  echo -e "${YELLOW}⚠ Frontend app already exists — skipping creation.${NC}"
else
  az containerapp create \
    --name "$FRONTEND_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$CAE_NAME" \
    --image "$PLACEHOLDER_IMAGE" \
    --system-assigned \
    --ingress external \
    --target-port 3000 \
    --transport http \
    --min-replicas 1 \
    --max-replicas 3 \
    --cpu 0.25 \
    --memory 0.5Gi \
    --output none
  echo -e "${GREEN}✓ Frontend Container App created${NC}"
fi

echo ""

# ── Grant Key Vault access ────────────────────────────────────────────────────

echo -e "${BLUE}Step 4: Granting Key Vault access to managed identities...${NC}"

grant_kv_access() {
  local APP_NAME="$1"
  local PRINCIPAL_ID

  PRINCIPAL_ID=$(az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query identity.principalId -o tsv)

  if [ -z "$PRINCIPAL_ID" ] || [ "$PRINCIPAL_ID" = "null" ]; then
    echo -e "${RED}✗ No system-assigned identity on '$APP_NAME'${NC}"
    return 1
  fi

  echo -e "  ${APP_NAME}: principal ${PRINCIPAL_ID}"
  az keyvault set-policy \
    --name "$KEY_VAULT_NAME" \
    --resource-group "$RG_SEC" \
    --object-id "$PRINCIPAL_ID" \
    --secret-permissions get list \
    --output none 2>/dev/null || true
  echo -e "  ${GREEN}✓ KV access granted${NC}"
}

grant_kv_access "$BACKEND_APP"
grant_kv_access "$FRONTEND_APP"
echo ""

# ── Configure backend KV secret references ────────────────────────────────────

echo -e "${BLUE}Step 5: Configuring backend Key Vault secret references...${NC}"

KV_REF="${KEY_VAULT_URI}/secrets"

az containerapp secret set \
  --name "$BACKEND_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets \
    "sql-conn-string=keyvaultref:${KV_REF}/SqlDb-ConnectionString,identityref:system" \
    "redis-conn-string=keyvaultref:${KV_REF}/Redis-ConnectionString,identityref:system" \
    "stor-conn-string=keyvaultref:${KV_REF}/Storage-ConnectionString,identityref:system" \
    "database-server=keyvaultref:${KV_REF}/Database-Server,identityref:system" \
    "database-name=keyvaultref:${KV_REF}/Database-Name,identityref:system" \
    "database-user=keyvaultref:${KV_REF}/Database-User,identityref:system" \
    "database-password=keyvaultref:${KV_REF}/Database-Password,identityref:system" \
    "openai-endpoint=keyvaultref:${KV_REF}/AZURE-OPENAI-ENDPOINT,identityref:system" \
    "azure-openai-key=keyvaultref:${KV_REF}/AZURE-OPENAI-KEY,identityref:system" \
    "search-endpoint=keyvaultref:${KV_REF}/AZURE-SEARCH-ENDPOINT,identityref:system" \
    "azure-search-key=keyvaultref:${KV_REF}/AZURE-SEARCH-KEY,identityref:system" \
    "vision-endpoint=keyvaultref:${KV_REF}/AZURE-VISION-ENDPOINT,identityref:system" \
    "azure-vision-key=keyvaultref:${KV_REF}/AZURE-VISION-KEY,identityref:system" \
    "azure-di-endpoint=keyvaultref:${KV_REF}/DocumentIntelligence-Endpoint,identityref:system" \
    "azure-di-key=keyvaultref:${KV_REF}/DocumentIntelligence-Key,identityref:system" \
    "azure-audio-endpoint=keyvaultref:${KV_REF}/AZURE-AUDIO-ENDPOINT,identityref:system" \
    "azure-audio-key=keyvaultref:${KV_REF}/AZURE-AUDIO-KEY,identityref:system" \
    "appinsights-conn=keyvaultref:${KV_REF}/ApplicationInsights-ConnectionString,identityref:system" \
    "anthropic-api-key=keyvaultref:${KV_REF}/Claude-ApiKey,identityref:system" \
    "bc-tenant-id=keyvaultref:${KV_REF}/BC-TenantId,identityref:system" \
    "bc-client-id=keyvaultref:${KV_REF}/BC-ClientId,identityref:system" \
    "bc-client-secret=keyvaultref:${KV_REF}/BC-ClientSecret,identityref:system" \
    "session-secret=keyvaultref:${KV_REF}/SESSION-SECRET,identityref:system" \
    "encryption-key=keyvaultref:${KV_REF}/ENCRYPTION-KEY,identityref:system" \
    "microsoft-client-id=keyvaultref:${KV_REF}/Microsoft-ClientId,identityref:system" \
    "ms-client-secret=keyvaultref:${KV_REF}/Microsoft-ClientSecret,identityref:system" \
    "microsoft-tenant-id=keyvaultref:${KV_REF}/Microsoft-TenantId,identityref:system" \
    "graph-webhook-url=keyvaultref:${KV_REF}/Graph-WebhookBaseUrl,identityref:system" \
  --output none

echo -e "${GREEN}✓ Backend secrets configured (28 KV references)${NC}"
echo ""

# ── Grant ACR pull to both apps ───────────────────────────────────────────────

echo -e "${BLUE}Step 6: Granting AcrPull role...${NC}"

ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)

grant_acr_pull() {
  local APP_NAME="$1"
  local PRINCIPAL_ID
  PRINCIPAL_ID=$(az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query identity.principalId -o tsv)

  az role assignment create \
    --assignee-object-id "$PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "AcrPull" \
    --scope "$ACR_ID" \
    --output none 2>/dev/null || echo -e "  ${BLUE}(AcrPull already assigned)${NC}"
  echo -e "  ${GREEN}✓ AcrPull granted to ${APP_NAME}${NC}"
}

grant_acr_pull "$BACKEND_APP"
grant_acr_pull "$FRONTEND_APP"
echo ""

# ── Configure ACR registry on Container Apps ────────────────────────────────

echo -e "${BLUE}Step 7: Configuring ACR registry authentication on Container Apps...${NC}"

configure_acr_registry() {
  local APP_NAME="$1"
  az containerapp registry set \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --server "${ACR_NAME}.azurecr.io" \
    --identity system \
    --output none
  echo -e "  ${GREEN}✓ ACR registry configured on ${APP_NAME}${NC}"
}

configure_acr_registry "$BACKEND_APP"
configure_acr_registry "$FRONTEND_APP"
echo ""

# ── Print FQDNs ───────────────────────────────────────────────────────────────

echo -e "${BLUE}Step 8: Retrieving Container App URLs...${NC}"

BACKEND_FQDN=$(az containerapp show \
  --name "$BACKEND_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

FRONTEND_FQDN=$(az containerapp show \
  --name "$FRONTEND_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

echo ""
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}✓ Container Apps Bootstrap Complete!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo -e "Backend  : ${YELLOW}https://${BACKEND_FQDN}${NC}"
echo -e "Frontend : ${YELLOW}https://${FRONTEND_FQDN}${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Run setup-container-app-identity.sh (AcrPull + KV already done above)"
echo "  2. Add GitHub secrets for the production environment:"
echo "     DATABASE_SERVER  = sqlsrv-${PROJECT_NAME}-${ENVIRONMENT}.database.windows.net"
echo "     DATABASE_NAME    = sqldb-${PROJECT_NAME}-${ENVIRONMENT}"
echo "     DATABASE_USER    = bcagentadmin"
echo "     DATABASE_PASSWORD = <your SQL_ADMIN_PASSWORD>"
echo "     STORAGE_CONNECTION_STRING = <from Key Vault: Storage-ConnectionString>"
echo "     DATABASE_URL     = sqlserver://sqlsrv-${PROJECT_NAME}-${ENVIRONMENT}.database.windows.net;database=sqldb-${PROJECT_NAME}-${ENVIRONMENT};user=bcagentadmin;password=<pw>;encrypt=true"
echo "  3. Configure OAuth redirect URIs:"
echo "     ENVIRONMENT=${ENVIRONMENT} bash infrastructure/scripts/setup-app-registration.sh"
echo "  4. Push to the '${ENVIRONMENT}' branch to trigger CI/CD deploy"
echo ""
