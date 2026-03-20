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
    ;;
  prod)
    RESOURCE_GROUP="rg-myworkmate-data-prod"
    SEARCH_SERVICE_NAME="search-myworkmate-prod"
    ;;
  *)
    echo -e "${RED}Unknown environment: $ENVIRONMENT. Use 'dev' or 'prod'.${NC}"
    exit 1
    ;;
esac

INDEX_NAME="file-chunks-index"
API_VERSION="2024-07-01"

echo -e "${BLUE}=== Azure AI Search Index Schema Update ===${NC}"
echo -e "Environment: ${ENVIRONMENT}"
echo -e "Service: ${SEARCH_SERVICE_NAME}"
echo -e "Index: ${INDEX_NAME}"
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

# Full index schema — all fields matching the dev index
FULL_SCHEMA=$(cat <<'EOF'
{
  "name": "file-chunks-index",
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
      "name": "contentVector",
      "type": "Collection(Edm.Single)",
      "searchable": true,
      "retrievable": true,
      "dimensions": 1536,
      "vectorSearchProfile": "hnsw-profile"
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
      "name": "imageVector",
      "type": "Collection(Edm.Single)",
      "searchable": true,
      "retrievable": false,
      "dimensions": 1024,
      "vectorSearchProfile": "hnsw-profile-image"
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
        "name": "hnsw-profile",
        "algorithm": "hnsw-algorithm"
      },
      {
        "name": "hnsw-profile-image",
        "algorithm": "hnsw-algorithm-image"
      }
    ],
    "algorithms": [
      {
        "name": "hnsw-algorithm",
        "kind": "hnsw",
        "hnswParameters": {
          "m": 4,
          "efConstruction": 400,
          "efSearch": 500,
          "metric": "cosine"
        }
      },
      {
        "name": "hnsw-algorithm-image",
        "kind": "hnsw",
        "hnswParameters": {
          "m": 4,
          "efConstruction": 400,
          "efSearch": 500,
          "metric": "cosine"
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

# The complete set of fields that must be present in the index
REQUIRED_FIELDS=(
  "chunkId"
  "fileId"
  "userId"
  "content"
  "contentVector"
  "chunkIndex"
  "tokenCount"
  "embeddingModel"
  "createdAt"
  "imageVector"
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

# Step 2: Check if index exists
echo -e "\n${BLUE}Step 2: Checking whether index exists...${NC}"
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
  echo -e "\n${BLUE}Step 3: Creating index with full schema...${NC}"

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

  echo -e "\n${BLUE}Step 3: Checking for missing fields...${NC}"

  MISSING_FIELDS=()
  for FIELD in "${REQUIRED_FIELDS[@]}"; do
    if ! echo "$CURRENT_BODY" | grep -q "\"$FIELD\""; then
      MISSING_FIELDS+=("$FIELD")
    fi
  done

  # Also check that semantic configuration is present
  HAS_SEMANTIC=true
  if ! echo "$CURRENT_BODY" | grep -q '"semantic"'; then
    HAS_SEMANTIC=false
    echo -e "${YELLOW}⚠ Semantic configuration missing${NC}"
  fi

  if [ ${#MISSING_FIELDS[@]} -eq 0 ] && [ "$HAS_SEMANTIC" = "true" ]; then
    echo -e "${GREEN}✓ Index schema is up to date — no update needed${NC}"
    exit 0
  fi

  if [ ${#MISSING_FIELDS[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠ Missing fields:${NC}"
    for FIELD in "${MISSING_FIELDS[@]}"; do
      echo "    - $FIELD"
    done
  fi

  echo -e "\n${BLUE}Step 4: Updating index schema via PUT...${NC}"

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

# Step 5: Verify the result
echo -e "\n${BLUE}Step 5: Verifying index schema...${NC}"
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

if [ "$VERIFY_FAILED" = "true" ]; then
  echo -e "\n${RED}✗ Verification failed — one or more fields or configurations are missing${NC}"
  exit 1
fi

echo -e "\n${GREEN}=== Schema update complete! ===${NC}"
echo -e "Index '${INDEX_NAME}' on '${SEARCH_SERVICE_NAME}' is fully up to date."
