#!/bin/bash
################################################################################
# BC-Claude-Agent-Prototype - Azure Resources Deployment Script
################################################################################
# This script creates all necessary Azure resources following the naming
# conventions defined in docs/02-core-concepts/05-AZURE_NAMING_CONVENTIONS.md
################################################################################

set -e  # Exit on error

# Configuration
SUBSCRIPTION_ID="5343f6e1-f251-4b50-a592-18ff3e97eaa7"
LOCATION="westeurope"

# Resource Groups (already exist)
RG_APP="rg-BCAgentPrototype-app-dev"
RG_DATA="rg-BCAgentPrototype-data-dev"
RG_SEC="rg-BCAgentPrototype-sec-dev"

# Resource Names (following Azure naming conventions)
KEYVAULT_NAME="kv-bcagent-dev"
MI_BACKEND_NAME="mi-bcagent-backend-dev"
MI_FRONTEND_NAME="mi-bcagent-frontend-dev"
SQL_SERVER_NAME="sqlsrv-bcagent-dev"
SQL_DB_NAME="sqldb-bcagent-dev"
REDIS_NAME="redis-bcagent-dev"
STORAGE_NAME="sabcagentdev"  # Must be lowercase, no hyphens
ACR_NAME="crbcagentdev"  # Must be alphanumeric only
CAE_NAME="cae-bcagent-dev"
BACKEND_APP_NAME="app-bcagent-backend-dev"
FRONTEND_APP_NAME="app-bcagent-frontend-dev"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}BC-Claude-Agent Azure Deployment${NC}"
echo -e "${BLUE}================================${NC}\n"

# Set subscription
echo -e "${GREEN}Setting Azure subscription...${NC}"
az account set --subscription $SUBSCRIPTION_ID

################################################################################
# PHASE 1: Security Resources (rg-BCAgentPrototype-sec-dev)
################################################################################

echo -e "\n${GREEN}Phase 1: Creating security resources...${NC}"

# 1.1 Create Key Vault
echo -e "${BLUE}Creating Key Vault: $KEYVAULT_NAME${NC}"
az keyvault create \
  --name $KEYVAULT_NAME \
  --resource-group $RG_SEC \
  --location $LOCATION \
  --enable-rbac-authorization false \
  --sku standard \
  --output none 2>/dev/null || echo -e "${BLUE}(Key Vault already exists)${NC}"

echo -e "${GREEN}✓ Key Vault ready${NC}"

# 1.2 Create Managed Identities
echo -e "${BLUE}Creating Managed Identity for Backend: $MI_BACKEND_NAME${NC}"
az identity create \
  --name $MI_BACKEND_NAME \
  --resource-group $RG_SEC \
  --location $LOCATION \
  --output none 2>/dev/null || echo -e "${BLUE}(Backend MI already exists)${NC}"

BACKEND_MI_ID=$(az identity show --name $MI_BACKEND_NAME --resource-group $RG_SEC --query id -o tsv)

echo -e "${GREEN}✓ Backend Managed Identity ready${NC}"

echo -e "${BLUE}Creating Managed Identity for Frontend: $MI_FRONTEND_NAME${NC}"
az identity create \
  --name $MI_FRONTEND_NAME \
  --resource-group $RG_SEC \
  --location $LOCATION \
  --output none 2>/dev/null || echo -e "${BLUE}(Frontend MI already exists)${NC}"

FRONTEND_MI_ID=$(az identity show --name $MI_FRONTEND_NAME --resource-group $RG_SEC --query id -o tsv)

echo -e "${GREEN}✓ Frontend Managed Identity ready${NC}"

# 1.3 Get Managed Identity Principal IDs for Key Vault access
BACKEND_MI_PRINCIPAL_ID=$(az identity show --name $MI_BACKEND_NAME --resource-group $RG_SEC --query principalId -o tsv)

# Grant Backend MI access to Key Vault secrets
echo -e "${BLUE}Granting Key Vault access to Backend MI...${NC}"
az keyvault set-policy \
  --name $KEYVAULT_NAME \
  --object-id $BACKEND_MI_PRINCIPAL_ID \
  --secret-permissions get list \
  --output none

echo -e "${GREEN}✓ Key Vault access granted${NC}"

################################################################################
# PHASE 2: Data Resources (rg-BCAgentPrototype-data-dev)
################################################################################

echo -e "\n${GREEN}Phase 2: Creating data resources...${NC}"

# 2.1 Create Azure SQL Server
echo -e "${BLUE}Creating Azure SQL Server: $SQL_SERVER_NAME${NC}"

# Check if SQL_ADMIN_PASSWORD is already set, otherwise prompt
if [ -z "$SQL_ADMIN_PASSWORD" ]; then
  echo -e "${RED}Please enter SQL Server admin password (min 8 chars, uppercase, lowercase, number, special char):${NC}"
  read -s SQL_ADMIN_PASSWORD
fi

az sql server create \
  --name $SQL_SERVER_NAME \
  --resource-group $RG_DATA \
  --location $LOCATION \
  --admin-user bcagentadmin \
  --admin-password "$SQL_ADMIN_PASSWORD" \
  --output none

echo -e "${GREEN}✓ SQL Server created${NC}"

# Enable Azure services access
echo -e "${BLUE}Enabling Azure services access to SQL Server...${NC}"
az sql server firewall-rule create \
  --name "AllowAzureServices" \
  --resource-group $RG_DATA \
  --server $SQL_SERVER_NAME \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0 \
  --output none

echo -e "${GREEN}✓ Firewall rule created${NC}"

# 2.2 Create SQL Database
echo -e "${BLUE}Creating SQL Database: $SQL_DB_NAME${NC}"
az sql db create \
  --name $SQL_DB_NAME \
  --resource-group $RG_DATA \
  --server $SQL_SERVER_NAME \
  --service-objective S0 \
  --backup-storage-redundancy Local \
  --output none

echo -e "${GREEN}✓ SQL Database created${NC}"

# Get SQL connection string
SQL_CONNECTION_STRING="Server=tcp:${SQL_SERVER_NAME}.database.windows.net,1433;Initial Catalog=${SQL_DB_NAME};Persist Security Info=False;User ID=bcagentadmin;Password=${SQL_ADMIN_PASSWORD};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"

# 2.3 Create Azure Cache for Redis
echo -e "${BLUE}Creating Azure Cache for Redis: $REDIS_NAME${NC}"
az redis create \
  --name $REDIS_NAME \
  --resource-group $RG_DATA \
  --location $LOCATION \
  --sku Basic \
  --vm-size c0 \
  --output none

echo -e "${GREEN}✓ Redis Cache created (this may take a few minutes to complete)${NC}"

# Get Redis connection string
REDIS_HOST=$(az redis show --name $REDIS_NAME --resource-group $RG_DATA --query hostName -o tsv)
REDIS_KEY=$(az redis list-keys --name $REDIS_NAME --resource-group $RG_DATA --query primaryKey -o tsv)
REDIS_CONNECTION_STRING="${REDIS_HOST}:6380,password=${REDIS_KEY},ssl=True,abortConnect=False"

# 2.4 Create Storage Account
echo -e "${BLUE}Creating Storage Account: $STORAGE_NAME${NC}"
az storage account create \
  --name $STORAGE_NAME \
  --resource-group $RG_DATA \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2 \
  --access-tier Hot \
  --output none

echo -e "${GREEN}✓ Storage Account created${NC}"

# Get Storage connection string
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
  --name $STORAGE_NAME \
  --resource-group $RG_DATA \
  --query connectionString -o tsv)

################################################################################
# PHASE 3: Application Resources (rg-BCAgentPrototype-app-dev)
################################################################################

echo -e "\n${GREEN}Phase 3: Creating application resources...${NC}"

# 3.1 Create Container Registry
echo -e "${BLUE}Creating Container Registry: $ACR_NAME${NC}"
az acr create \
  --name $ACR_NAME \
  --resource-group $RG_APP \
  --location $LOCATION \
  --sku Basic \
  --admin-enabled true \
  --output none 2>/dev/null || echo -e "${BLUE}(Container Registry already exists)${NC}"

echo -e "${GREEN}✓ Container Registry ready${NC}"

# 3.1.1 Get ACR resource ID
ACR_ID=$(az acr show --name $ACR_NAME --resource-group $RG_APP --query id -o tsv)

# 3.1.2 Assign AcrPull role to Backend Managed Identity
echo -e "${BLUE}Assigning AcrPull role to Backend MI...${NC}"
az role assignment create \
  --assignee $BACKEND_MI_PRINCIPAL_ID \
  --role "AcrPull" \
  --scope $ACR_ID \
  --output none 2>/dev/null || echo -e "${BLUE}(Role assignment already exists)${NC}"

echo -e "${GREEN}✓ ACR permissions configured${NC}"

# 3.2 Create Container Apps Environment
echo -e "${BLUE}Creating Container Apps Environment: $CAE_NAME${NC}"
az containerapp env create \
  --name $CAE_NAME \
  --resource-group $RG_APP \
  --location $LOCATION \
  --output none

echo -e "${GREEN}✓ Container Apps Environment created${NC}"

################################################################################
# PHASE 4: Configure Key Vault Secrets
################################################################################

echo -e "\n${GREEN}Phase 4: Configuring Key Vault secrets...${NC}"

# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 32)

# Business Central credentials (MUST be provided as environment variables)
# Required environment variables:
# - BC_TENANT_ID: Your Business Central Tenant ID
# - BC_CLIENT_ID: Your Business Central Application (client) ID
# - BC_CLIENT_SECRET: Your Business Central Client Secret
if [ -z "$BC_TENANT_ID" ] || [ -z "$BC_CLIENT_ID" ] || [ -z "$BC_CLIENT_SECRET" ]; then
    echo -e "${RED}ERROR: Business Central credentials must be provided as environment variables${NC}"
    echo -e "${RED}Please set: BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET${NC}"
    exit 1
fi

# Add secrets to Key Vault
echo -e "${BLUE}Adding secrets to Key Vault...${NC}"

az keyvault secret set --vault-name $KEYVAULT_NAME --name "BC-TenantId" --value "$BC_TENANT_ID" --output none
az keyvault secret set --vault-name $KEYVAULT_NAME --name "BC-ClientId" --value "$BC_CLIENT_ID" --output none
az keyvault secret set --vault-name $KEYVAULT_NAME --name "BC-ClientSecret" --value "$BC_CLIENT_SECRET" --output none
az keyvault secret set --vault-name $KEYVAULT_NAME --name "JWT-Secret" --value "$JWT_SECRET" --output none
az keyvault secret set --vault-name $KEYVAULT_NAME --name "SqlDb-ConnectionString" --value "$SQL_CONNECTION_STRING" --output none
az keyvault secret set --vault-name $KEYVAULT_NAME --name "Redis-ConnectionString" --value "$REDIS_CONNECTION_STRING" --output none
az keyvault secret set --vault-name $KEYVAULT_NAME --name "Storage-ConnectionString" --value "$STORAGE_CONNECTION_STRING" --output none

echo -e "${GREEN}✓ Secrets configured${NC}"

echo -e "\n${RED}IMPORTANT: Please add your Claude API key manually:${NC}"
echo -e "${BLUE}az keyvault secret set --vault-name $KEYVAULT_NAME --name \"Claude-ApiKey\" --value \"YOUR_CLAUDE_API_KEY\"${NC}"

################################################################################
# PHASE 5: Summary and Next Steps
################################################################################

echo -e "\n${GREEN}================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}================================${NC}\n"

echo -e "${BLUE}Resource Summary:${NC}"
echo -e "  Key Vault: $KEYVAULT_NAME"
echo -e "  SQL Server: $SQL_SERVER_NAME"
echo -e "  SQL Database: $SQL_DB_NAME"
echo -e "  Redis Cache: $REDIS_NAME"
echo -e "  Storage Account: $STORAGE_NAME"
echo -e "  Container Registry: $ACR_NAME"
echo -e "  Container Apps Environment: $CAE_NAME"
echo -e "  Backend Managed Identity: $MI_BACKEND_NAME"
echo -e "  Frontend Managed Identity: $MI_FRONTEND_NAME"

echo -e "\n${BLUE}Next Steps:${NC}"
echo -e "  1. Add your Claude API key to Key Vault"
echo -e "  2. Initialize the database schema (run backend/scripts/init-db.sql)"
echo -e "  3. Build and deploy backend application"
echo -e "  4. Build and deploy frontend application"

echo -e "\n${BLUE}Connection Strings (saved in Key Vault):${NC}"
echo -e "  SQL: Server=${SQL_SERVER_NAME}.database.windows.net, DB=${SQL_DB_NAME}"
echo -e "  Redis: ${REDIS_HOST}"
echo -e "  ACR: ${ACR_NAME}.azurecr.io"

echo -e "\n${GREEN}Script completed successfully!${NC}"
