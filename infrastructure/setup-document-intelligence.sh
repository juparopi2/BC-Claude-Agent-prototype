#!/bin/bash
# ==============================================================================
# Setup Azure Document Intelligence Resource
# ==============================================================================
#
# This script provisions Azure Document Intelligence (Form Recognizer) for
# Phase 3: Document Processing in the BC Claude Agent project.
#
# Resource Details:
#   - Name: di-bcagent-dev (pattern: {type}-{workload}-{environment})
#   - SKU: S0 (Standard tier for production use with OCR)
#   - Region: eastus (supports prebuilt-read model)
#   - Kind: FormRecognizer
#
# Prerequisites:
#   - Azure CLI installed and authenticated (az login)
#   - Subscription: 5343f6e1-f251-4b50-a592-18ff3e97eaa7
#   - Resource group exists: rg-BCAgentPrototype-app-dev
#   - Key Vault exists: kv-bcagent-dev
#
# Usage:
#   chmod +x setup-document-intelligence.sh
#   ./setup-document-intelligence.sh
#
# ==============================================================================

set -e  # Exit on any error

# Configuration
RESOURCE_NAME="di-bcagent-dev"
RESOURCE_GROUP="rg-BCAgentPrototype-app-dev"
LOCATION="eastus"
SKU="S0"
KEY_VAULT="kv-bcagent-dev"
SUBSCRIPTION="5343f6e1-f251-4b50-a592-18ff3e97eaa7"

echo "=============================================="
echo "Azure Document Intelligence Setup"
echo "=============================================="
echo ""
echo "Configuration:"
echo "  Resource Name:  $RESOURCE_NAME"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Location:       $LOCATION"
echo "  SKU:            $SKU"
echo "  Key Vault:      $KEY_VAULT"
echo ""

# Set subscription
echo "[1/5] Setting subscription..."
az account set --subscription "$SUBSCRIPTION"
echo "      Subscription set to: $SUBSCRIPTION"

# Check if resource already exists
echo ""
echo "[2/5] Checking if resource exists..."
EXISTING=$(az cognitiveservices account show \
    --name "$RESOURCE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "name" -o tsv 2>/dev/null || echo "")

if [ -n "$EXISTING" ]; then
    echo "      Resource already exists: $RESOURCE_NAME"
    echo "      Skipping creation, will retrieve keys..."
else
    # Create Document Intelligence resource
    echo ""
    echo "[3/5] Creating Document Intelligence resource..."
    az cognitiveservices account create \
        --name "$RESOURCE_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --kind "FormRecognizer" \
        --sku "$SKU" \
        --location "$LOCATION" \
        --yes
    echo "      Resource created successfully"
fi

# Get endpoint
echo ""
echo "[4/5] Retrieving endpoint and keys..."
ENDPOINT=$(az cognitiveservices account show \
    --name "$RESOURCE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.endpoint" -o tsv)

KEY=$(az cognitiveservices account keys list \
    --name "$RESOURCE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "key1" -o tsv)

echo "      Endpoint: $ENDPOINT"
echo "      Key:      ${KEY:0:8}********"

# Store in Key Vault
echo ""
echo "[5/5] Storing secrets in Key Vault..."
az keyvault secret set \
    --vault-name "$KEY_VAULT" \
    --name "DocumentIntelligence-Endpoint" \
    --value "$ENDPOINT" \
    --output none

az keyvault secret set \
    --vault-name "$KEY_VAULT" \
    --name "DocumentIntelligence-Key" \
    --value "$KEY" \
    --output none

echo "      Secrets stored in Key Vault: $KEY_VAULT"

echo ""
echo "=============================================="
echo "Setup Complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "  1. Add to backend/.env:"
echo "     AZURE_DI_ENDPOINT=$ENDPOINT"
echo "     AZURE_DI_KEY=<get from Key Vault or above>"
echo ""
echo "  2. For local development, you can also get the key with:"
echo "     az keyvault secret show --vault-name $KEY_VAULT --name DocumentIntelligence-Key --query value -o tsv"
echo ""
echo "  3. Verify the resource in Azure Portal:"
echo "     https://portal.azure.com/#resource/subscriptions/$SUBSCRIPTION/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.CognitiveServices/accounts/$RESOURCE_NAME"
echo ""
echo "Pricing (S0 tier):"
echo "  - Read API (prebuilt-read): \$1.50 per 1,000 pages"
echo "  - Free tier available: 500 pages/month (F0 SKU)"
echo ""
