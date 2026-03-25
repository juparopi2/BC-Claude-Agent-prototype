#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
ENVIRONMENT="${ENVIRONMENT:-dev}"

case "$ENVIRONMENT" in
  dev)
    RESOURCE_GROUP="rg-BCAgentPrototype-data-dev"
    SEARCH_SERVICE_NAME="search-bcagent-dev"
    KEY_VAULT_NAME="kv-bcagent-dev"
    ;;
  prod)
    RESOURCE_GROUP="rg-myworkmate-data-prod"
    SEARCH_SERVICE_NAME="search-myworkmate-prod"
    KEY_VAULT_NAME="kv-myworkmate-prod"
    ;;
  *)
    echo -e "${RED}Unknown environment: $ENVIRONMENT. Use 'dev' or 'prod'.${NC}"
    exit 1
    ;;
esac

INDEX_NAME="file-chunks-index-v2"
API_VERSION="2025-08-01-preview"

echo -e "${BLUE}=== Azure AI Search Index Schema Update (V2) ===${NC}"
echo -e "Environment: ${ENVIRONMENT}"
echo -e "Service: ${SEARCH_SERVICE_NAME}"
echo -e "Index: ${INDEX_NAME}"
echo -e "API Version: ${API_VERSION}"
echo ""

# Step 1: Get Admin Key
echo -e "${BLUE}Step 1: Getting Admin Key...${NC}"
SEARCH_KEY=$(az search admin-key show \
  --resource-group "$RESOURCE_GROUP" \
  --service-name "$SEARCH_SERVICE_NAME" \
  --query primaryKey -o tsv)

if [ -z "$SEARCH_KEY" ]; then
  echo -e "${RED}✗ Failed to get admin key${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Admin key retrieved${NC}"

SEARCH_ENDPOINT="https://${SEARCH_SERVICE_NAME}.search.windows.net"

# Step 2: Load vectorizer configuration
# Prefer environment variables (local use); fall back to Key Vault (CI/CD)
echo -e "\n${BLUE}Step 2: Loading vectorizer configuration...${NC}"

if [ -n "$COHERE_VECTORIZER_ENDPOINT" ]; then
  RESOLVED_VECTORIZER_URI="$COHERE_VECTORIZER_ENDPOINT"
  echo -e "${GREEN}✓ COHERE_VECTORIZER_ENDPOINT loaded from environment${NC}"
elif [ -n "$COHERE_ENDPOINT" ]; then
  RESOLVED_VECTORIZER_URI="$COHERE_ENDPOINT"
  echo -e "${YELLOW}⚠ COHERE_VECTORIZER_ENDPOINT not set — using COHERE_ENDPOINT fallback${NC}"
else
  echo -e "${YELLOW}  Fetching COHERE-VECTORIZER-ENDPOINT from Key Vault ${KEY_VAULT_NAME}...${NC}"
  RESOLVED_VECTORIZER_URI=$(az keyvault secret show \
    --vault-name "$KEY_VAULT_NAME" \
    --name "COHERE-VECTORIZER-ENDPOINT" \
    --query value -o tsv 2>/dev/null || true)
  if [ -z "$RESOLVED_VECTORIZER_URI" ]; then
    echo -e "${RED}✗ Could not resolve vectorizer URI from environment or Key Vault${NC}"
    echo -e "${RED}  Set COHERE_VECTORIZER_ENDPOINT (or COHERE_ENDPOINT) env var, or ensure COHERE-VECTORIZER-ENDPOINT exists in Key Vault ${KEY_VAULT_NAME}${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ COHERE-VECTORIZER-ENDPOINT loaded from Key Vault${NC}"
fi

if [ -n "$COHERE_VECTORIZER_KEY" ]; then
  RESOLVED_VECTORIZER_KEY="$COHERE_VECTORIZER_KEY"
  echo -e "${GREEN}✓ COHERE_VECTORIZER_KEY loaded from environment${NC}"
elif [ -n "$COHERE_API_KEY" ]; then
  RESOLVED_VECTORIZER_KEY="$COHERE_API_KEY"
  echo -e "${YELLOW}⚠ COHERE_VECTORIZER_KEY not set — using COHERE_API_KEY fallback${NC}"
else
  echo -e "${YELLOW}  Fetching COHERE-VECTORIZER-KEY from Key Vault ${KEY_VAULT_NAME}...${NC}"
  RESOLVED_VECTORIZER_KEY=$(az keyvault secret show \
    --vault-name "$KEY_VAULT_NAME" \
    --name "COHERE-VECTORIZER-KEY" \
    --query value -o tsv 2>/dev/null || true)
  if [ -z "$RESOLVED_VECTORIZER_KEY" ]; then
    echo -e "${RED}✗ Could not resolve vectorizer API key from environment or Key Vault${NC}"
    echo -e "${RED}  Set COHERE_VECTORIZER_KEY (or COHERE_API_KEY) env var, or ensure COHERE-VECTORIZER-KEY exists in Key Vault ${KEY_VAULT_NAME}${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ COHERE-VECTORIZER-KEY loaded from Key Vault${NC}"
fi

# Full V2 index schema — single unified embeddingVector field (1536d, Cohere Embed v4)
# Source of truth: backend/src/services/search/schema.ts
FULL_SCHEMA=$(cat <<EOF
{
  "name": "file-chunks-index-v2",
  "fields": [
    {
      "name": "chunkId",
      "type": "Edm.String",
      "key": true,
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": false
    },
    {
      "name": "fileId",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": true
    },
    {
      "name": "userId",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": false
    },
    {
      "name": "content",
      "type": "Edm.String",
      "searchable": true,
      "filterable": false,
      "sortable": false,
      "facetable": false,
      "analyzer": "standard.lucene"
    },
    {
      "name": "embeddingVector",
      "type": "Collection(Edm.Single)",
      "searchable": true,
      "retrievable": true,
      "dimensions": 1536,
      "vectorSearchProfile": "hnsw-profile-unified"
    },
    {
      "name": "chunkIndex",
      "type": "Edm.Int32",
      "searchable": false,
      "filterable": true,
      "sortable": true,
      "facetable": false
    },
    {
      "name": "tokenCount",
      "type": "Edm.Int32",
      "searchable": false,
      "filterable": true,
      "sortable": true,
      "facetable": false
    },
    {
      "name": "embeddingModel",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": true
    },
    {
      "name": "createdAt",
      "type": "Edm.DateTimeOffset",
      "searchable": false,
      "filterable": true,
      "sortable": true,
      "facetable": false
    },
    {
      "name": "isImage",
      "type": "Edm.Boolean",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": true
    },
    {
      "name": "mimeType",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": true
    },
    {
      "name": "fileStatus",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": true
    },
    {
      "name": "fileModifiedAt",
      "type": "Edm.DateTimeOffset",
      "searchable": false,
      "filterable": true,
      "sortable": true,
      "facetable": false
    },
    {
      "name": "fileName",
      "type": "Edm.String",
      "searchable": true,
      "filterable": true,
      "sortable": false,
      "facetable": false,
      "analyzer": "standard.lucene"
    },
    {
      "name": "sizeBytes",
      "type": "Edm.Int32",
      "searchable": false,
      "filterable": true,
      "sortable": true,
      "facetable": false
    },
    {
      "name": "siteId",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": true
    },
    {
      "name": "sourceType",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": true
    },
    {
      "name": "parentFolderId",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": false
    }
  ],
  "vectorSearch": {
    "profiles": [
      {
        "name": "hnsw-profile-unified",
        "algorithm": "hnsw-unified",
        "vectorizer": "cohere-vectorizer"
      }
    ],
    "algorithms": [
      {
        "name": "hnsw-unified",
        "kind": "hnsw",
        "hnswParameters": {
          "m": 4,
          "efConstruction": 400,
          "efSearch": 500,
          "metric": "cosine"
        }
      }
    ],
    "vectorizers": [
      {
        "name": "cohere-vectorizer",
        "kind": "aml",
        "amlParameters": {
          "uri": "${RESOLVED_VECTORIZER_URI}",
          "key": "${RESOLVED_VECTORIZER_KEY}",
          "modelName": "Cohere-embed-v4"
        }
      }
    ]
  },
  "semantic": {
    "defaultConfiguration": "semantic-config",
    "configurations": [
      {
        "name": "semantic-config",
        "prioritizedFields": {
          "prioritizedContentFields": [
            { "fieldName": "content" }
          ]
        }
      }
    ]
  }
}
EOF
)

# The complete set of fields that must be present in the V2 index
REQUIRED_FIELDS=(
  "chunkId"
  "fileId"
  "userId"
  "content"
  "embeddingVector"
  "chunkIndex"
  "tokenCount"
  "embeddingModel"
  "createdAt"
  "isImage"
  "mimeType"
  "fileStatus"
  "fileModifiedAt"
  "fileName"
  "sizeBytes"
  "siteId"
  "sourceType"
  "parentFolderId"
)

# Step 3: Check if index exists
echo -e "\n${BLUE}Step 3: Checking whether index exists...${NC}"
CURRENT_SCHEMA=$(curl -s -w "\n%{http_code}" \
  "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_KEY}")

CURRENT_HTTP=$(echo "$CURRENT_SCHEMA" | tail -1)
CURRENT_BODY=$(echo "$CURRENT_SCHEMA" | sed '$d')

if [ "$CURRENT_HTTP" = "404" ]; then
  # ----------------------------------------------------------------
  # INDEX DOES NOT EXIST — create it
  # ----------------------------------------------------------------
  echo -e "${YELLOW}⚠ Index not found — creating from scratch...${NC}"
  echo -e "\n${BLUE}Step 4: Creating index with full V2 schema...${NC}"

  CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${SEARCH_ENDPOINT}/indexes?api-version=${API_VERSION}" \
    -H "api-key: ${SEARCH_KEY}" \
    -H "Content-Type: application/json" \
    -d "$FULL_SCHEMA")

  CREATE_HTTP=$(echo "$CREATE_RESPONSE" | tail -1)
  CREATE_BODY=$(echo "$CREATE_RESPONSE" | sed '$d')

  if [ "$CREATE_HTTP" = "200" ] || [ "$CREATE_HTTP" = "201" ]; then
    echo -e "${GREEN}✓ Index created successfully (HTTP $CREATE_HTTP)${NC}"
  else
    echo -e "${RED}✗ Failed to create index (HTTP $CREATE_HTTP)${NC}"
    echo "$CREATE_BODY" | head -30
    exit 1
  fi

elif [ "$CURRENT_HTTP" = "200" ]; then
  # ----------------------------------------------------------------
  # INDEX EXISTS — check for missing fields and update if needed
  # ----------------------------------------------------------------
  echo -e "${GREEN}✓ Index exists${NC}"

  echo -e "\n${BLUE}Step 4: Checking for missing fields...${NC}"

  MISSING_FIELDS=()
  for FIELD in "${REQUIRED_FIELDS[@]}"; do
    if ! echo "$CURRENT_BODY" | grep -q "\"$FIELD\""; then
      MISSING_FIELDS+=("$FIELD")
    fi
  done

  # Check that semantic configuration is present
  HAS_SEMANTIC=true
  if ! echo "$CURRENT_BODY" | grep -q '"semantic"'; then
    HAS_SEMANTIC=false
    echo -e "${YELLOW}⚠ Semantic configuration missing${NC}"
  fi

  # Check that the vectorizer is configured
  HAS_VECTORIZER=true
  if ! echo "$CURRENT_BODY" | grep -q '"cohere-vectorizer"'; then
    HAS_VECTORIZER=false
    echo -e "${YELLOW}⚠ Vectorizer configuration missing${NC}"
  fi

  if [ ${#MISSING_FIELDS[@]} -eq 0 ] && [ "$HAS_SEMANTIC" = "true" ] && [ "$HAS_VECTORIZER" = "true" ]; then
    echo -e "${GREEN}✓ Index schema is up to date — no update needed${NC}"
    exit 0
  fi

  if [ ${#MISSING_FIELDS[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠ Missing fields:${NC}"
    for FIELD in "${MISSING_FIELDS[@]}"; do
      echo "    - $FIELD"
    done
  fi

  echo -e "\n${BLUE}Step 5: Updating index schema via PUT...${NC}"

  UPDATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
    "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=${API_VERSION}" \
    -H "api-key: ${SEARCH_KEY}" \
    -H "Content-Type: application/json" \
    -d "$FULL_SCHEMA")

  UPDATE_HTTP=$(echo "$UPDATE_RESPONSE" | tail -1)
  UPDATE_BODY=$(echo "$UPDATE_RESPONSE" | sed '$d')

  if [ "$UPDATE_HTTP" = "200" ] || [ "$UPDATE_HTTP" = "201" ] || [ "$UPDATE_HTTP" = "204" ]; then
    echo -e "${GREEN}✓ Index schema updated successfully (HTTP $UPDATE_HTTP)${NC}"
  else
    echo -e "${RED}✗ Failed to update index (HTTP $UPDATE_HTTP)${NC}"
    echo "$UPDATE_BODY" | head -30
    exit 1
  fi

else
  # Unexpected HTTP status
  echo -e "${RED}✗ Unexpected response checking index (HTTP $CURRENT_HTTP)${NC}"
  echo "$CURRENT_BODY" | head -20
  exit 1
fi

# Step 6: Verify the result
echo -e "\n${BLUE}Step 6: Verifying index schema...${NC}"
VERIFY=$(curl -s \
  "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_KEY}")

VERIFY_FAILED=false

for FIELD in "${REQUIRED_FIELDS[@]}"; do
  if echo "$VERIFY" | grep -q "\"$FIELD\""; then
    echo -e "${GREEN}✓ Field present: $FIELD${NC}"
  else
    echo -e "${RED}✗ Field missing: $FIELD${NC}"
    VERIFY_FAILED=true
  fi
done

if echo "$VERIFY" | grep -q '"semantic"'; then
  echo -e "${GREEN}✓ Semantic configuration present${NC}"
else
  echo -e "${RED}✗ Semantic configuration missing${NC}"
  VERIFY_FAILED=true
fi

if echo "$VERIFY" | grep -q '"cohere-vectorizer"'; then
  echo -e "${GREEN}✓ Vectorizer configured: cohere-vectorizer (aml/Cohere-embed-v4)${NC}"
else
  echo -e "${RED}✗ Vectorizer missing: cohere-vectorizer not found in index response${NC}"
  VERIFY_FAILED=true
fi

if [ "$VERIFY_FAILED" = "true" ]; then
  echo -e "\n${RED}✗ Verification failed — one or more fields or configurations are missing${NC}"
  exit 1
fi

echo -e "\n${GREEN}=== Schema update complete! ===${NC}"
echo -e "Index '${INDEX_NAME}' on '${SEARCH_SERVICE_NAME}' is fully up to date."
