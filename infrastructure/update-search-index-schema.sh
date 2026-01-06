#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
RESOURCE_GROUP="rg-BCAgentPrototype-data-dev"
SEARCH_SERVICE_NAME="search-bcagent-dev"
INDEX_NAME="file-chunks-index"
API_VERSION="2024-07-01"

echo -e "${BLUE}=== Azure AI Search Index Schema Update ===${NC}"
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

# Step 2: Check if index exists and has imageVector
echo -e "\n${BLUE}Step 2: Checking current index schema...${NC}"
CURRENT_SCHEMA=$(curl -s "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_KEY}")

# Check for errors
if echo "$CURRENT_SCHEMA" | grep -q '"error"'; then
  echo -e "${RED}✗ Index not found or error:${NC}"
  echo "$CURRENT_SCHEMA" | head -20
  exit 1
fi

# Check if imageVector already exists
if echo "$CURRENT_SCHEMA" | grep -q '"imageVector"'; then
  echo -e "${GREEN}✓ Index already has imageVector field - no update needed${NC}"
  exit 0
fi

echo -e "${YELLOW}⚠ Index missing imageVector field - updating...${NC}"

# Step 3: Create updated schema JSON
# IMPORTANT: We preserve the existing algorithm name (hnsw-algorithm) and profile name (hnsw-profile)
# and ADD new ones for images (hnsw-algorithm-image, hnsw-profile-image)
echo -e "\n${BLUE}Step 3: Preparing updated schema...${NC}"

UPDATED_SCHEMA=$(cat <<'EOF'
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
      "retrievable": false,
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
  }
}
EOF
)

# Step 4: Update the index
echo -e "\n${BLUE}Step 4: Updating index schema...${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
  "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_KEY}" \
  -H "Content-Type: application/json" \
  -d "$UPDATED_SCHEMA")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "204" ]; then
  echo -e "${GREEN}✓ Index schema updated successfully!${NC}"
  echo ""
  echo -e "${BLUE}New fields added:${NC}"
  echo "  - imageVector (Collection(Edm.Single), 1024 dimensions)"
  echo "  - isImage (Edm.Boolean, filterable)"
  echo ""
  echo -e "${BLUE}New vector search profiles:${NC}"
  echo "  - hnsw-profile-image"
  echo "  - hnsw-algorithm-image"
else
  echo -e "${RED}✗ Failed to update index (HTTP $HTTP_CODE)${NC}"
  echo "$BODY" | head -30
  exit 1
fi

# Step 5: Verify the update
echo -e "\n${BLUE}Step 5: Verifying update...${NC}"
VERIFY=$(curl -s "${SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=${API_VERSION}" \
  -H "api-key: ${SEARCH_KEY}")

if echo "$VERIFY" | grep -q '"imageVector"'; then
  echo -e "${GREEN}✓ Verified: imageVector field exists${NC}"
else
  echo -e "${RED}✗ Verification failed: imageVector not found${NC}"
  exit 1
fi

if echo "$VERIFY" | grep -q '"isImage"'; then
  echo -e "${GREEN}✓ Verified: isImage field exists${NC}"
else
  echo -e "${RED}✗ Verification failed: isImage not found${NC}"
  exit 1
fi

echo -e "\n${GREEN}=== Schema update complete! ===${NC}"
echo -e "You can now upload images and they will be indexed correctly."
