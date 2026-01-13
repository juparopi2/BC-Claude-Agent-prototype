#!/bin/bash

# =============================================================================
# D26: Update Azure AI Search Index with Semantic Configuration
# =============================================================================
#
# Purpose: Enables Semantic Ranker on the existing file-chunks-index
# This allows for improved search relevance by using AI to understand
# the semantic meaning of content, especially important for image captions.
#
# Prerequisites:
# - Azure CLI installed and logged in (az login)
# - Existing search service with file-chunks-index
# - Semantic search enabled on the service (Basic tier = free semantic search)
#
# Usage:
#   ./update-search-semantic-config.sh
#
# The script will:
# 1. Get current index schema
# 2. Add semantic configuration if not present
# 3. Update the index
#
# Note: This is a non-destructive operation - existing data is preserved.
# =============================================================================

set -e

# Configuration
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-BCAgentPrototype-data-dev}"
SEARCH_SERVICE="${AZURE_SEARCH_SERVICE:-search-bcagent-dev}"
INDEX_NAME="file-chunks-index"
SEMANTIC_CONFIG_NAME="semantic-config"

echo "=== D26: Updating Azure AI Search Index with Semantic Configuration ==="
echo "Resource Group: $RESOURCE_GROUP"
echo "Search Service: $SEARCH_SERVICE"
echo "Index Name: $INDEX_NAME"
echo ""

# Get admin key
echo "Getting search admin key..."
ADMIN_KEY=$(az search admin-key show \
  --resource-group "$RESOURCE_GROUP" \
  --service-name "$SEARCH_SERVICE" \
  --query "primaryKey" \
  --output tsv)

if [ -z "$ADMIN_KEY" ]; then
  echo "ERROR: Failed to get admin key. Make sure you're logged in with 'az login'"
  exit 1
fi

SEARCH_ENDPOINT="https://${SEARCH_SERVICE}.search.windows.net"

# Check if index exists
echo "Checking if index exists..."
INDEX_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=2024-07-01" \
  -H "api-key: ${ADMIN_KEY}" \
  -H "Content-Type: application/json")

if [ "$INDEX_CHECK" != "200" ]; then
  echo "ERROR: Index '${INDEX_NAME}' does not exist. Run the application to create it first."
  exit 1
fi

echo "Index found. Getting current schema..."

# Get current index schema
CURRENT_SCHEMA=$(curl -s \
  -X GET "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=2024-07-01" \
  -H "api-key: ${ADMIN_KEY}" \
  -H "Content-Type: application/json")

# Check if semantic configuration already has a valid config (not null)
# Azure REST API uses "semantic" property
if echo "$CURRENT_SCHEMA" | grep -q "\"$SEMANTIC_CONFIG_NAME\""; then
  echo "Semantic configuration '${SEMANTIC_CONFIG_NAME}' already present. No update needed."
  exit 0
fi

echo "Adding semantic configuration..."

# Define the semantic config JSON
# Note: Azure REST API uses "prioritizedContentFields" (not "contentFields")
SEMANTIC_CONFIG='{
  "defaultConfiguration": "'"${SEMANTIC_CONFIG_NAME}"'",
  "configurations": [
    {
      "name": "'"${SEMANTIC_CONFIG_NAME}"'",
      "prioritizedFields": {
        "prioritizedContentFields": [
          { "fieldName": "content" }
        ]
      }
    }
  ]
}'

# Create updated schema with semantic configuration
# Note: Azure REST API uses "semantic" property (not "semanticSearch")
# We're using jq if available, otherwise fallback to node.js
if command -v jq &> /dev/null; then
  UPDATED_SCHEMA=$(echo "$CURRENT_SCHEMA" | jq --argjson semantic "$SEMANTIC_CONFIG" '
    .semantic = $semantic
  ')
elif command -v node &> /dev/null; then
  echo "Using node.js for JSON manipulation..."
  # Export semantic config as env var for node to access
  export SEMANTIC_CONFIG_JSON="$SEMANTIC_CONFIG"

  UPDATED_SCHEMA=$(echo "$CURRENT_SCHEMA" | node -e "
    let input = '';
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      try {
        const schema = JSON.parse(input);
        const semantic = JSON.parse(process.env.SEMANTIC_CONFIG_JSON);
        schema.semantic = semantic;
        console.log(JSON.stringify(schema));
      } catch(e) {
        console.error('JSON parsing error:', e.message);
        process.exit(1);
      }
    });
  ")
else
  echo "ERROR: Neither jq nor node.js available for JSON manipulation"
  exit 1
fi

# Update the index
echo "Updating index with semantic configuration..."
UPDATE_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=2024-07-01" \
  -H "api-key: ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d "$UPDATED_SCHEMA")

if [ "$UPDATE_RESULT" == "200" ] || [ "$UPDATE_RESULT" == "201" ] || [ "$UPDATE_RESULT" == "204" ]; then
  echo ""
  echo "=== SUCCESS ==="
  echo "Semantic configuration added to index '${INDEX_NAME}'"
  echo "Semantic Ranker is now available for search queries"
  echo ""
  echo "Usage in code:"
  echo "  searchOptions.queryType = 'semantic'"
  echo "  searchOptions.semanticConfigurationName = '${SEMANTIC_CONFIG_NAME}'"
else
  echo ""
  echo "=== ERROR ==="
  echo "Failed to update index. HTTP status: $UPDATE_RESULT"
  echo "Response:"
  curl -s \
    -X PUT "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=2024-07-01" \
    -H "api-key: ${ADMIN_KEY}" \
    -H "Content-Type: application/json" \
    -d "$UPDATED_SCHEMA"
  exit 1
fi
