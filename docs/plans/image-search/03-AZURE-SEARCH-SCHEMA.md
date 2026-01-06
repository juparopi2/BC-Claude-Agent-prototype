# Azure AI Search Schema - Semantic Image Search

**Fecha**: 2026-01-06
**Versión**: 1.0

---

## 1. Current Index Schema

**Index Name**: `file-chunks-index`

```typescript
// backend/src/services/search/schema.ts (current)
export const indexSchema: SearchIndex = {
  name: 'file-chunks-index',
  fields: [
    { name: 'chunkId', type: 'Edm.String', key: true, filterable: true },
    { name: 'fileId', type: 'Edm.String', filterable: true },
    { name: 'userId', type: 'Edm.String', filterable: true },
    { name: 'content', type: 'Edm.String', searchable: true },
    {
      name: 'contentVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 1536,  // Text embeddings only
      vectorSearchProfileName: 'hnsw-profile',
    },
    { name: 'chunkIndex', type: 'Edm.Int32', sortable: true },
    { name: 'tokenCount', type: 'Edm.Int32' },
    { name: 'embeddingModel', type: 'Edm.String', filterable: true },
    { name: 'createdAt', type: 'Edm.DateTimeOffset', sortable: true },
  ],
  vectorSearch: {
    algorithms: [
      {
        name: 'hnsw-algorithm',
        kind: 'hnsw',
        hnswParameters: {
          metric: 'cosine',
          m: 4,
          efConstruction: 400,
          efSearch: 500,
        },
      },
    ],
    profiles: [
      {
        name: 'hnsw-profile',
        algorithmConfigurationName: 'hnsw-algorithm',
      },
    ],
  },
};
```

---

## 2. Updated Index Schema

**Changes Required**:
1. Add `imageVector` field (1024 dimensions)
2. Add `isImage` boolean field for filtering
3. Add new HNSW profile for image vectors

```typescript
// backend/src/services/search/schema.ts (updated)
import { SearchIndex } from '@azure/search-documents';

export const INDEX_NAME = 'file-chunks-index';

export const indexSchema: SearchIndex = {
  name: INDEX_NAME,
  fields: [
    // ===== Existing Fields =====
    {
      name: 'chunkId',
      type: 'Edm.String',
      key: true,
      filterable: true,
    },
    {
      name: 'fileId',
      type: 'Edm.String',
      filterable: true,
    },
    {
      name: 'userId',
      type: 'Edm.String',
      filterable: true,
    },
    {
      name: 'content',
      type: 'Edm.String',
      searchable: true,
    },
    {
      name: 'contentVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 1536,
      vectorSearchProfileName: 'hnsw-profile',
    },
    {
      name: 'chunkIndex',
      type: 'Edm.Int32',
      sortable: true,
    },
    {
      name: 'tokenCount',
      type: 'Edm.Int32',
    },
    {
      name: 'embeddingModel',
      type: 'Edm.String',
      filterable: true,
    },
    {
      name: 'createdAt',
      type: 'Edm.DateTimeOffset',
      sortable: true,
      filterable: true,
    },

    // ===== NEW: Image Search Fields =====
    {
      name: 'imageVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 1024,  // Azure Vision embedding size
      vectorSearchProfileName: 'hnsw-profile-image',
    },
    {
      name: 'isImage',
      type: 'Edm.Boolean',
      filterable: true,
      defaultValue: 'false',
    },
  ],

  vectorSearch: {
    algorithms: [
      // Text algorithm (existing)
      {
        name: 'hnsw-algorithm',
        kind: 'hnsw',
        hnswParameters: {
          metric: 'cosine',
          m: 4,
          efConstruction: 400,
          efSearch: 500,
        },
      },
      // Image algorithm (NEW)
      {
        name: 'hnsw-algorithm-image',
        kind: 'hnsw',
        hnswParameters: {
          metric: 'cosine',
          m: 4,
          efConstruction: 400,
          efSearch: 500,
        },
      },
    ],
    profiles: [
      // Text profile (renamed for clarity)
      {
        name: 'hnsw-profile',
        algorithmConfigurationName: 'hnsw-algorithm',
      },
      // Image profile (NEW)
      {
        name: 'hnsw-profile-image',
        algorithmConfigurationName: 'hnsw-algorithm-image',
      },
    ],
  },
};
```

---

## 3. Migration Strategy

### 3.1 Option A: In-Place Update (Recommended)

Azure AI Search allows adding new fields to existing indexes without downtime.

```typescript
// VectorSearchService.ts - New method
async updateIndexSchema(): Promise<void> {
  if (!this.indexClient) {
    await this.initializeClients();
  }

  try {
    // Get current index
    const currentIndex = await this.indexClient.getIndex(INDEX_NAME);

    // Check if imageVector already exists
    const hasImageVector = currentIndex.fields.some(f => f.name === 'imageVector');

    if (hasImageVector) {
      logger.info('Index already has imageVector field');
      return;
    }

    // Add new fields
    const updatedFields = [
      ...currentIndex.fields,
      {
        name: 'imageVector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        vectorSearchDimensions: 1024,
        vectorSearchProfileName: 'hnsw-profile-image',
      },
      {
        name: 'isImage',
        type: 'Edm.Boolean',
        filterable: true,
      },
    ];

    // Update vector search config
    const updatedVectorSearch = {
      algorithms: [
        ...currentIndex.vectorSearch.algorithms,
        {
          name: 'hnsw-algorithm-image',
          kind: 'hnsw',
          hnswParameters: {
            metric: 'cosine',
            m: 4,
            efConstruction: 400,
            efSearch: 500,
          },
        },
      ],
      profiles: [
        ...currentIndex.vectorSearch.profiles,
        {
          name: 'hnsw-profile-image',
          algorithmConfigurationName: 'hnsw-algorithm-image',
        },
      ],
    };

    // Update index
    await this.indexClient.createOrUpdateIndex({
      ...currentIndex,
      fields: updatedFields,
      vectorSearch: updatedVectorSearch,
    });

    logger.info('Index schema updated with image search fields');
  } catch (error) {
    logger.error({ error }, 'Failed to update index schema');
    throw error;
  }
}
```

### 3.2 Option B: Recreate Index (If Update Fails)

Only use if in-place update is not possible.

```typescript
async recreateIndexWithImageSupport(): Promise<void> {
  // 1. Export existing documents
  const documents = await this.exportAllDocuments();

  // 2. Delete old index
  await this.deleteIndex();

  // 3. Create new index with updated schema
  await this.ensureIndexExists();

  // 4. Re-index documents
  await this.reindexDocuments(documents);
}
```

---

## 4. Document Formats

### 4.1 Text Chunk Document (Existing)

```json
{
  "chunkId": "chunk-uuid-123",
  "fileId": "file-uuid-456",
  "userId": "user-uuid-789",
  "content": "This is the text content of the chunk...",
  "contentVector": [0.1, 0.2, ...],  // 1536 floats
  "imageVector": null,
  "chunkIndex": 0,
  "tokenCount": 128,
  "embeddingModel": "text-embedding-3-small",
  "createdAt": "2026-01-06T12:00:00Z",
  "isImage": false
}
```

### 4.2 Image Document (New)

```json
{
  "chunkId": "img_file-uuid-456",  // Prefixed with 'img_'
  "fileId": "file-uuid-456",
  "userId": "user-uuid-789",
  "content": "[Image: product-photo.jpg]",
  "contentVector": null,
  "imageVector": [0.3, 0.4, ...],  // 1024 floats
  "chunkIndex": 0,
  "tokenCount": 0,
  "embeddingModel": "azure-vision-vectorize-image",
  "createdAt": "2026-01-06T12:00:00Z",
  "isImage": true
}
```

---

## 5. Search Queries

### 5.1 Text Search (Existing - Unchanged)

```typescript
const searchOptions = {
  filter: `userId eq '${userId}'`,
  top: 10,
  vectorSearchOptions: {
    queries: [
      {
        kind: 'vector',
        vector: queryEmbedding,  // 1536d
        fields: ['contentVector'],
        kNearestNeighborsCount: 10,
      },
    ],
  },
};

const results = await searchClient.search('*', searchOptions);
```

### 5.2 Image Search (New)

```typescript
const searchOptions = {
  filter: `userId eq '${userId}' and isImage eq true`,
  top: 10,
  vectorSearchOptions: {
    queries: [
      {
        kind: 'vector',
        vector: queryEmbedding,  // 1024d from VectorizeText
        fields: ['imageVector'],
        kNearestNeighborsCount: 10,
      },
    ],
  },
};

const results = await searchClient.search('*', searchOptions);
```

### 5.3 Hybrid Search (Future Enhancement)

Search both text and images:

```typescript
const searchOptions = {
  filter: `userId eq '${userId}'`,
  top: 20,
  vectorSearchOptions: {
    queries: [
      // Text vector search
      {
        kind: 'vector',
        vector: textQueryEmbedding,  // 1536d
        fields: ['contentVector'],
        kNearestNeighborsCount: 10,
        weight: 0.5,
      },
      // Image vector search
      {
        kind: 'vector',
        vector: imageQueryEmbedding,  // 1024d
        fields: ['imageVector'],
        kNearestNeighborsCount: 10,
        weight: 0.5,
      },
    ],
  },
};
```

---

## 6. Index Limits (Basic SKU)

| Resource | Limit | Current Usage | After Update |
|----------|-------|---------------|--------------|
| Indexes | 15 | 1 | 1 |
| Fields per index | 100 | 9 | 11 |
| Vector dimensions | 4096 max | 1536 | 1536 + 1024 |
| Vector fields | 16 | 1 | 2 |
| Storage | 5 GB | ~100 MB | ~150 MB |

All limits are within bounds.

---

## 7. Performance Tuning

### 7.1 HNSW Parameters

```typescript
hnswParameters: {
  metric: 'cosine',     // Best for normalized embeddings
  m: 4,                 // Number of bi-directional links (4-100)
  efConstruction: 400,  // Controls index quality (100-1000)
  efSearch: 500,        // Controls search accuracy (100-1000)
}
```

**Trade-offs**:
- Higher `m` = better recall, more memory
- Higher `efConstruction` = better index quality, slower indexing
- Higher `efSearch` = better search quality, slower queries

### 7.2 Recommended Settings by Workload

| Workload | m | efConstruction | efSearch |
|----------|---|----------------|----------|
| Low latency | 4 | 200 | 200 |
| Balanced | 4 | 400 | 500 |
| High recall | 8 | 600 | 800 |

Current settings (Balanced) are appropriate for our use case.

---

## 8. Monitoring

### 8.1 Index Statistics

```typescript
async getIndexStats(): Promise<{
  documentCount: number;
  textChunks: number;
  imageDocuments: number;
}> {
  const totalCount = await this.searchClient.getDocumentsCount();

  // Count images
  const imageSearch = await this.searchClient.search('*', {
    filter: 'isImage eq true',
    top: 0,
    includeTotalCount: true,
  });

  return {
    documentCount: totalCount,
    imageDocuments: imageSearch.count || 0,
    textChunks: totalCount - (imageSearch.count || 0),
  };
}
```

### 8.2 Search Latency Tracking

```typescript
async searchWithMetrics(query: SearchQuery): Promise<{
  results: SearchResult[];
  latencyMs: number;
}> {
  const start = performance.now();
  const results = await this.search(query);
  const latencyMs = performance.now() - start;

  // Log to Application Insights
  logger.info({
    operation: 'vector_search',
    latencyMs,
    resultCount: results.length,
    userId: query.userId,
  }, 'Search completed');

  return { results, latencyMs };
}
```

---

## 9. Rollback Plan

If image search causes issues:

1. **Disable image indexing** (code change)
2. **Remove image documents** from index:
   ```typescript
   const imageIds = await getImageDocumentIds();
   await searchClient.deleteDocuments('chunkId', imageIds);
   ```
3. **Keep schema** (empty imageVector fields are fine)
4. **Investigate and fix**
5. **Re-enable and re-index**

Schema rollback is NOT recommended as it requires index recreation.

---

## 10. Checklist

- [ ] Update `schema.ts` with new fields
- [ ] Test schema update in DEV
- [ ] Run `updateIndexSchema()` in DEV
- [ ] Verify field created via Azure Portal
- [ ] Test image document upload
- [ ] Test image search query
- [ ] Deploy to STAGING
- [ ] Run migration in STAGING
- [ ] Performance test (100 images)
- [ ] Deploy to PRODUCTION
- [ ] Run migration in PRODUCTION
- [ ] Monitor for 24h
