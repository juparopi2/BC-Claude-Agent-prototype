#!/bin/bash
################################################################################
# Setup App Registration — Redirect URIs & OAuth Security Model
################################################################################
#
# Configures the Azure AD (Entra ID) App Registration for the MyWorkMate
# platform's OAuth incremental consent model.
#
# BACKGROUND:
# The platform uses a single App Registration for all Microsoft OAuth flows:
#   1. Login (openid, profile, email, offline_access, User.Read)
#   2. OneDrive connector (Files.Read.All) — incremental consent
#   3. SharePoint connector (Sites.Read.All, Files.Read.All) — incremental consent
#   4. Business Central connector (Financials.ReadWrite.All) — incremental consent
#
# Each flow uses a different redirect URI:
#   - /api/auth/callback           → main login
#   - /api/auth/callback/onedrive  → OneDrive OAuth consent
#   - /api/auth/callback/sharepoint→ SharePoint OAuth consent
#
# WHY THIS SCRIPT EXISTS:
# Azure App Registrations are Entra ID resources, NOT ARM resources.
# Bicep cannot manage them. This script is the IaC equivalent for
# App Registration configuration.
#
# INCREMENTAL CONSENT MODEL:
# Login requests only basic Graph scopes. Connector-specific scopes
# (Files.Read.All, Sites.Read.All, Financials.ReadWrite.All) are NOT
# pre-registered as "API permissions" because Microsoft supports
# dynamic/incremental consent — scopes are requested at runtime and
# the user consents on first use. Only redirect URIs must be
# pre-registered.
#
# IDEMPOTENT: Safe to run multiple times. Reads current state, merges
# with desired state, and only updates if there are changes.
#
# Prerequisites:
#   - Azure CLI (az) installed and logged in
#   - MICROSOFT_CLIENT_ID env var set (or uses default dev app ID)
#   - ENVIRONMENT env var set to 'dev' or 'prod'
################################################################################

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Configuration ────────────────────────────────────────────────────────────

ENVIRONMENT="${ENVIRONMENT:-dev}"
# Default to the BCAgent-Dev app registration
CLIENT_ID="${MICROSOFT_CLIENT_ID:-2066b7ec-a490-47d3-b75e-0b32f24209e6}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Setup App Registration (OAuth)${NC}"
echo -e "${BLUE}Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo -e "${BLUE}Client ID:   ${YELLOW}${CLIENT_ID}${NC}"
echo -e "${BLUE}========================================${NC}\n"

# ── Redirect URIs per environment ────────────────────────────────────────────

# Callback paths (same for all environments)
CALLBACK_PATHS=(
  "/api/auth/callback"
  "/api/auth/callback/onedrive"
  "/api/auth/callback/sharepoint"
)

case "$ENVIRONMENT" in
  dev)
    RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
    BACKEND_APP="app-bcagent-backend-dev"
    ;;
  prod)
    RESOURCE_GROUP="rg-myworkmate-app-prod"
    BACKEND_APP="app-myworkmate-backend-prod"
    ;;
  *)
    echo -e "${RED}Unknown environment: ${ENVIRONMENT}. Use 'dev' or 'prod'.${NC}"
    exit 1
    ;;
esac

# Resolve the backend FQDN dynamically from Azure
echo -e "${YELLOW}Resolving backend Container App FQDN...${NC}"
BACKEND_FQDN=$(az containerapp show \
  --name "$BACKEND_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null)

if [ -z "$BACKEND_FQDN" ] || [ "$BACKEND_FQDN" = "null" ]; then
  echo -e "${RED}✗ Could not resolve FQDN for ${BACKEND_APP} in ${RESOURCE_GROUP}.${NC}"
  echo -e "${RED}  Is the Container App deployed?${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Backend FQDN: ${BACKEND_FQDN}${NC}"

case "$ENVIRONMENT" in
  dev)
    BASE_URLS=(
      "http://localhost:3002"
      "https://${BACKEND_FQDN}"
    )
    ;;
  prod)
    BASE_URLS=(
      "https://${BACKEND_FQDN}"
    )
    ;;
  *)
    echo -e "${RED}Unknown environment: ${ENVIRONMENT}. Use 'dev' or 'prod'.${NC}"
    exit 1
    ;;
esac

# Build full redirect URI list
DESIRED_URIS=()
for base in "${BASE_URLS[@]}"; do
  for path in "${CALLBACK_PATHS[@]}"; do
    DESIRED_URIS+=("${base}${path}")
  done
done

# ── Validate prerequisites ───────────────────────────────────────────────────

echo -e "${YELLOW}Validating prerequisites...${NC}"

if ! command -v az &>/dev/null; then
  echo -e "${RED}✗ Azure CLI (az) is not installed.${NC}"
  exit 1
fi

if ! az account show &>/dev/null; then
  echo -e "${RED}✗ Not logged in to Azure CLI. Run 'az login' first.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Azure CLI is installed and logged in${NC}"

# ── Get current state ────────────────────────────────────────────────────────

echo -e "\n${BLUE}Reading current App Registration state...${NC}"

CURRENT_URIS_JSON=$(az ad app show --id "$CLIENT_ID" --query "web.redirectUris" -o json 2>/dev/null)

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Failed to read App Registration. Check CLIENT_ID and permissions.${NC}"
  exit 1
fi

# Parse current URIs into array
CURRENT_URIS=()
while IFS= read -r uri; do
  # Strip quotes and whitespace
  uri=$(echo "$uri" | tr -d '"' | tr -d ' ' | tr -d ',')
  [ -n "$uri" ] && [ "$uri" != "[" ] && [ "$uri" != "]" ] && CURRENT_URIS+=("$uri")
done <<< "$CURRENT_URIS_JSON"

echo -e "${GREEN}✓ Current redirect URIs (${#CURRENT_URIS[@]}):${NC}"
for uri in "${CURRENT_URIS[@]}"; do
  echo -e "    ${uri}"
done

# ── Calculate diff and merge ─────────────────────────────────────────────────

echo -e "\n${BLUE}Calculating required changes...${NC}"

# Merge: current URIs + desired URIs (deduplicated)
MERGED_URIS=()

# Add all current URIs first
for uri in "${CURRENT_URIS[@]}"; do
  MERGED_URIS+=("$uri")
done

# Add desired URIs that are not already present
MISSING_URIS=()
for desired in "${DESIRED_URIS[@]}"; do
  found=false
  for current in "${CURRENT_URIS[@]}"; do
    if [ "$desired" = "$current" ]; then
      found=true
      break
    fi
  done
  if [ "$found" = false ]; then
    MISSING_URIS+=("$desired")
    MERGED_URIS+=("$desired")
  fi
done

if [ ${#MISSING_URIS[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ All redirect URIs are already registered. No changes needed.${NC}"
else
  echo -e "${YELLOW}Missing redirect URIs (${#MISSING_URIS[@]}):${NC}"
  for uri in "${MISSING_URIS[@]}"; do
    echo -e "    ${YELLOW}+ ${uri}${NC}"
  done

  # ── Update App Registration ──────────────────────────────────────────────

  echo -e "\n${BLUE}Updating App Registration redirect URIs...${NC}"
  echo -e "${BLUE}(az ad app update --web-redirect-uris replaces the full list)${NC}"

  az ad app update \
    --id "$CLIENT_ID" \
    --web-redirect-uris "${MERGED_URIS[@]}"

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ App Registration updated successfully${NC}"
  else
    echo -e "${RED}✗ Failed to update App Registration${NC}"
    exit 1
  fi
fi

# ── Print summary ────────────────────────────────────────────────────────────

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ App Registration Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Final redirect URIs (${#MERGED_URIS[@]}):${NC}"
for uri in "${MERGED_URIS[@]}"; do
  echo -e "  ✅ ${uri}"
done
echo ""
echo -e "${BLUE}OAuth Security Model:${NC}"
echo -e "  Login scopes:      openid, profile, email, offline_access, User.Read"
echo -e "  OneDrive (demand): Files.Read.All"
echo -e "  SharePoint (demand): Sites.Read.All, Files.Read.All"
echo -e "  BC (demand):       Financials.ReadWrite.All"
echo ""
echo -e "${YELLOW}Verification:${NC}"
echo -e "  az ad app show --id ${CLIENT_ID} --query web.redirectUris"
echo ""
