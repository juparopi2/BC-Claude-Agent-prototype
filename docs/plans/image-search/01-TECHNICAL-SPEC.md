# Technical Specification - Semantic Image Search

**Fecha**: 2026-01-06
**Versión**: 1.0

---

## 1. Contexto del Sistema Actual

### 1.1 Flujo Actual de Imágenes (ROTO)

```typescript
// FileProcessingService.ts - línea ~144
public async processFile(job: FileProcessingJob): Promise<void> {
  // ...
  const result: ExtractionResult = await processor.extractText(buffer, fileName);
  // ⚠️ Para imágenes: result contiene embedding pero NO se persiste

  await this.updateStatus(userId, fileId, 'completed', result.text);
  // ⚠️ Solo guarda result.text (placeholder "[Image: filename.jpg]")
}

// FileChunkingService.ts - línea ~114
if (IMAGE_MIME_TYPES.has(mimeType)) {
  await this.updateEmbeddingStatus(fileId, 'completed');  // ⚠️ FALSO POSITIVO
  return { fileId, chunkCount: 0, totalTokens: 0 };       // ⚠️ NO HAY INDEXACIÓN
}
```

### 1.2 Recursos Azure Verificados

```bash
# Verificado via AZ CLI 2026-01-06
az resource list --resource-group rg-bcagent-app-dev --query "[].{name:name, type:type}"

# Computer Vision (VectorizeImage API)
Name: cv-bcagent-dev
Type: Microsoft.CognitiveServices/accounts
SKU: S1
Region: West Europe

# Azure AI Search (Vector Index)
Name: search-bcagent-dev
Type: Microsoft.Search/searchServices
SKU: Basic
Region: West Europe

# Límites relevantes:
# - Basic SKU: 15 índices, 5GB storage, 3 réplicas
# - Vector fields: Hasta 4096 dimensiones por campo
# - Multiple vector fields: SOPORTADO
```

### 1.3 Configuración Existente

```typescript
// backend/src/infrastructure/config/models.ts - línea ~478
export const AzureServiceConfigs: Record<AzureServiceRole, AzureServiceConfig> = {
  image_embedding: {
    role: 'image_embedding',
    description: 'Convert images to vectors for visual similarity search',
    modelId: 'vectorize-image',
    apiVersion: '2024-02-01',
    dimensions: 1024,  // ✅ Ya definido
    tier: 'standard',
  },
  // ...
};

// backend/src/infrastructure/config/pricing.config.ts - línea ~35
export const UNIT_COSTS = {
  image_embedding: 0.0001,  // ✅ $0.10 per 1,000 images
  // ...
};

// backend/src/infrastructure/config/environment.ts - línea ~99
AZURE_VISION_ENDPOINT: z.string().url().optional(),
AZURE_VISION_KEY: z.string().optional(),
```

---

## 2. Especificación de Componentes

### 2.1 ImageProcessor (Modificación)

**Archivo**: `backend/src/services/files/processors/ImageProcessor.ts`

**Cambio**: El método `extractText` debe retornar el embedding en el resultado.

```typescript
// types.ts - Actualizar ExtractionResult
export interface ExtractionResult {
  text: string;
  metadata: ExtractionMetadata;
  imageEmbedding?: number[];  // NUEVO: embedding 1024d para imágenes
}

// ImageProcessor.ts - Modificar extractText
async extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
  // ... existing code ...

  const embedding = await embeddingService.generateImageEmbedding(
    buffer,
    'image-processor',
    fileName
  );

  return {
    text: `[Image: ${fileName}] Format: ${imageFormat}, Size: ${buffer.length} bytes`,
    metadata,
    imageEmbedding: embedding.embedding,  // NUEVO: Incluir embedding
  };
}
```

**Consideraciones**:
- NO cambiar la firma del método (backward compatible)
- El campo `imageEmbedding` es opcional (solo para imágenes)
- Mantener logging existente

---

### 2.2 FileProcessingService (Modificación)

**Archivo**: `backend/src/services/files/FileProcessingService.ts`

**Cambio**: Persistir embedding después de extracción exitosa.

```typescript
// Después de línea ~198 (Step 5)
if (result.imageEmbedding && result.imageEmbedding.length > 0) {
  await this.persistImageEmbedding(userId, fileId, result.imageEmbedding);
}

// Nuevo método privado
private async persistImageEmbedding(
  userId: string,
  fileId: string,
  embedding: number[]
): Promise<void> {
  const { getImageEmbeddingRepository } = await import(
    '@/repositories/ImageEmbeddingRepository'
  );
  const repository = getImageEmbeddingRepository();

  await repository.upsert({
    fileId,
    userId,
    embedding,
    dimensions: embedding.length,
    model: 'azure-vision-vectorize-image',
    modelVersion: '2024-02-01',
  });

  this.logger.info({ fileId, userId, dimensions: embedding.length },
    'Image embedding persisted to database');
}
```

---

### 2.3 ImageEmbeddingRepository (Nuevo)

**Archivo**: `backend/src/repositories/ImageEmbeddingRepository.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from '@/infrastructure/database/database';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'ImageEmbeddingRepository' });

export interface ImageEmbeddingRecord {
  id: string;
  fileId: string;
  userId: string;
  embedding: number[];
  dimensions: number;
  model: string;
  modelVersion: string;
  createdAt: Date;
}

export interface UpsertImageEmbeddingParams {
  fileId: string;
  userId: string;
  embedding: number[];
  dimensions: number;
  model: string;
  modelVersion: string;
}

export class ImageEmbeddingRepository {
  private static instance: ImageEmbeddingRepository;

  static getInstance(): ImageEmbeddingRepository {
    if (!ImageEmbeddingRepository.instance) {
      ImageEmbeddingRepository.instance = new ImageEmbeddingRepository();
    }
    return ImageEmbeddingRepository.instance;
  }

  async upsert(params: UpsertImageEmbeddingParams): Promise<string> {
    const { fileId, userId, embedding, dimensions, model, modelVersion } = params;

    // Check if exists
    const existing = await this.getByFileId(fileId, userId);

    if (existing) {
      // Update
      await executeQuery(
        `UPDATE image_embeddings
         SET embedding = @embedding,
             dimensions = @dimensions,
             model = @model,
             model_version = @modelVersion,
             updated_at = GETUTCDATE()
         WHERE file_id = @fileId AND user_id = @userId`,
        {
          fileId,
          userId,
          embedding: JSON.stringify(embedding),
          dimensions,
          model,
          modelVersion,
        }
      );
      logger.debug({ fileId, userId }, 'Image embedding updated');
      return existing.id;
    }

    // Insert
    const id = uuidv4();
    await executeQuery(
      `INSERT INTO image_embeddings
       (id, file_id, user_id, embedding, dimensions, model, model_version, created_at)
       VALUES (@id, @fileId, @userId, @embedding, @dimensions, @model, @modelVersion, GETUTCDATE())`,
      {
        id,
        fileId,
        userId,
        embedding: JSON.stringify(embedding),
        dimensions,
        model,
        modelVersion,
      }
    );

    logger.debug({ id, fileId, userId }, 'Image embedding inserted');
    return id;
  }

  async getByFileId(fileId: string, userId: string): Promise<ImageEmbeddingRecord | null> {
    const result = await executeQuery<{
      id: string;
      file_id: string;
      user_id: string;
      embedding: string;
      dimensions: number;
      model: string;
      model_version: string;
      created_at: Date;
    }>(
      `SELECT id, file_id, user_id, embedding, dimensions, model, model_version, created_at
       FROM image_embeddings
       WHERE file_id = @fileId AND user_id = @userId`,
      { fileId, userId }
    );

    const row = result.recordset[0];
    if (!row) return null;

    return {
      id: row.id,
      fileId: row.file_id,
      userId: row.user_id,
      embedding: JSON.parse(row.embedding),
      dimensions: row.dimensions,
      model: row.model,
      modelVersion: row.model_version,
      createdAt: row.created_at,
    };
  }

  async deleteByFileId(fileId: string, userId: string): Promise<boolean> {
    const result = await executeQuery(
      `DELETE FROM image_embeddings WHERE file_id = @fileId AND user_id = @userId`,
      { fileId, userId }
    );
    return result.rowsAffected[0] > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await executeQuery(
      `DELETE FROM image_embeddings WHERE user_id = @userId`,
      { userId }
    );
    return result.rowsAffected[0];
  }
}

export function getImageEmbeddingRepository(): ImageEmbeddingRepository {
  return ImageEmbeddingRepository.getInstance();
}
```

---

### 2.4 VectorSearchService (Modificación)

**Archivo**: `backend/src/services/search/VectorSearchService.ts`

**Cambios**:
1. Método `indexImageEmbedding` para indexar imágenes
2. Método `searchImages` para buscar por query texto

```typescript
// Agregar al final de la clase

/**
 * Index an image embedding for visual search
 */
async indexImageEmbedding(params: {
  fileId: string;
  userId: string;
  embedding: number[];
  fileName: string;
}): Promise<string> {
  if (!this.searchClient) {
    await this.initializeClients();
  }
  if (!this.searchClient) {
    throw new Error('Failed to initialize search client');
  }

  const { fileId, userId, embedding, fileName } = params;
  const documentId = `img_${fileId}`;

  const document = {
    chunkId: documentId,
    fileId,
    userId,
    content: `[Image: ${fileName}]`,
    contentVector: null,  // No text vector
    imageVector: embedding,  // NEW: Image vector field
    chunkIndex: 0,
    tokenCount: 0,
    embeddingModel: 'azure-vision-vectorize-image',
    createdAt: new Date(),
    isImage: true,  // NEW: Flag to distinguish from text chunks
  };

  const result = await this.searchClient.uploadDocuments([document]);

  if (result.results.some(r => !r.succeeded)) {
    throw new Error('Failed to index image embedding');
  }

  logger.info({ fileId, userId, documentId }, 'Image embedding indexed');
  return documentId;
}

/**
 * Search images by text query (multimodal search)
 */
async searchImages(params: {
  queryEmbedding: number[];
  userId: string;
  top?: number;
  minScore?: number;
}): Promise<ImageSearchResult[]> {
  if (!this.searchClient) {
    await this.initializeClients();
  }
  if (!this.searchClient) {
    throw new Error('Failed to initialize search client');
  }

  const { queryEmbedding, userId, top = 10, minScore = 0.5 } = params;

  // SECURITY: Always filter by userId
  const searchFilter = `userId eq '${userId}' and isImage eq true`;

  const searchOptions = {
    filter: searchFilter,
    top,
    vectorSearchOptions: {
      queries: [
        {
          kind: 'vector',
          vector: queryEmbedding,
          fields: ['imageVector'],  // Search ONLY image vector field
          kNearestNeighborsCount: top,
        },
      ],
    },
  };

  const searchResults = await this.searchClient.search('*', searchOptions);

  const results: ImageSearchResult[] = [];
  for await (const result of searchResults.results) {
    if (result.score >= minScore) {
      const doc = result.document as {
        chunkId: string;
        fileId: string;
        content: string;
      };
      results.push({
        fileId: doc.fileId,
        score: result.score,
        content: doc.content,
      });
    }
  }

  // Track usage
  this.trackSearchUsage(userId, 'image', results.length, top).catch(err => {
    logger.warn({ err, userId }, 'Failed to track image search usage');
  });

  return results;
}
```

---

### 2.5 ImageSearchService (Nuevo)

**Archivo**: `backend/src/services/search/ImageSearchService.ts`

```typescript
import { EmbeddingService } from '@/services/embeddings/EmbeddingService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getFileService } from '@/services/files/FileService';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'ImageSearchService' });

export interface ImageSearchOptions {
  userId: string;
  query: string;
  top?: number;
  minScore?: number;
}

export interface ImageSearchResult {
  fileId: string;
  fileName: string;
  score: number;
  thumbnailUrl?: string;
}

export interface ImageSearchResponse {
  results: ImageSearchResult[];
  query: string;
  totalResults: number;
}

export class ImageSearchService {
  private static instance: ImageSearchService;
  private readonly logger = createChildLogger({ service: 'ImageSearchService' });

  static getInstance(): ImageSearchService {
    if (!ImageSearchService.instance) {
      ImageSearchService.instance = new ImageSearchService();
    }
    return ImageSearchService.instance;
  }

  /**
   * Search images by text query
   *
   * Uses Azure Vision VectorizeText to convert query to embedding,
   * then searches image embeddings in Azure AI Search.
   */
  async searchByText(options: ImageSearchOptions): Promise<ImageSearchResponse> {
    const { userId, query, top = 10, minScore = 0.5 } = options;

    this.logger.info({ userId, queryLength: query.length, top }, 'Starting image search');

    try {
      // 1. Generate text embedding for query using Azure Vision VectorizeText
      const embeddingService = EmbeddingService.getInstance();
      const queryEmbedding = await embeddingService.generateQueryEmbedding(query, userId);

      // 2. Search images
      const vectorSearchService = VectorSearchService.getInstance();
      const searchResults = await vectorSearchService.searchImages({
        queryEmbedding: queryEmbedding.embedding,
        userId,
        top,
        minScore,
      });

      // 3. Enrich results with file metadata
      const fileService = getFileService();
      const enrichedResults: ImageSearchResult[] = [];

      for (const result of searchResults) {
        let fileName = 'Unknown';
        let thumbnailUrl: string | undefined;

        try {
          const file = await fileService.getFile(userId, result.fileId);
          if (file) {
            fileName = file.name;
            thumbnailUrl = file.blobPath; // Could be replaced with actual thumbnail URL
          }
        } catch {
          // File might be deleted
        }

        enrichedResults.push({
          fileId: result.fileId,
          fileName,
          score: result.score,
          thumbnailUrl,
        });
      }

      this.logger.info({
        userId,
        query,
        resultsCount: enrichedResults.length,
      }, 'Image search completed');

      return {
        results: enrichedResults,
        query,
        totalResults: enrichedResults.length,
      };
    } catch (error) {
      this.logger.error({ error, userId, query }, 'Image search failed');
      throw error;
    }
  }
}

export function getImageSearchService(): ImageSearchService {
  return ImageSearchService.getInstance();
}
```

---

### 2.6 EmbeddingService (Modificación)

**Archivo**: `backend/src/services/embeddings/EmbeddingService.ts`

**Cambio**: Agregar método `generateQueryEmbedding` que usa VectorizeText de Azure Vision.

```typescript
// Agregar nuevo método

/**
 * Generate text embedding for image search query
 *
 * Uses Azure Vision VectorizeText API to create embedding in the same
 * 1024d space as image embeddings (multimodal compatibility).
 *
 * @param text - Query text to embed
 * @param userId - User ID for usage tracking
 * @returns Embedding result with 1024d vector
 */
async generateQueryEmbedding(text: string, userId: string): Promise<{
  embedding: number[];
  model: string;
}> {
  if (!this.config.visionEndpoint || !this.config.visionKey) {
    throw new Error('Azure Vision not configured for query embeddings');
  }

  const url = `${this.config.visionEndpoint}/computervision/retrieval:vectorizeText?api-version=2024-02-01&model-version=2023-04-15`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': this.config.visionKey,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure Vision VectorizeText failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as { vector: number[]; modelVersion: string };

  // Track usage
  const usageTrackingService = getUsageTrackingService();
  await usageTrackingService.trackEmbedding(
    userId,
    'query-embedding',
    1,
    'query',
    { model: 'azure-vision-vectorize-text', query_length: text.length }
  );

  return {
    embedding: result.vector,
    model: `azure-vision-${result.modelVersion}`,
  };
}
```

---

### 2.7 Azure AI Search Schema Update

**Archivo**: `backend/src/services/search/schema.ts`

```typescript
export const indexSchema: SearchIndex = {
  name: INDEX_NAME,
  fields: [
    // ... existing fields ...

    // NEW: Image vector field (1024 dimensions)
    {
      name: 'imageVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 1024,
      vectorSearchProfileName: 'hnsw-profile-image',
    },

    // NEW: Flag to identify image documents
    {
      name: 'isImage',
      type: 'Edm.Boolean',
      filterable: true,
      defaultValue: false,
    },
  ],
  vectorSearch: {
    algorithms: [
      // Existing text algorithm
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
      // NEW: Image algorithm (can use same params)
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
      // Existing text profile
      {
        name: 'hnsw-profile',
        algorithmConfigurationName: 'hnsw-algorithm',
      },
      // NEW: Image profile
      {
        name: 'hnsw-profile-image',
        algorithmConfigurationName: 'hnsw-algorithm-image',
      },
    ],
  },
};
```

---

## 3. API Endpoints

### 3.1 Search Images

**Endpoint**: `GET /api/files/search/images`

**Query Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | Yes | Search query text |
| `top` | number | No | Max results (default: 10, max: 50) |
| `minScore` | number | No | Min similarity score (default: 0.5) |

**Response**:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "fileId": "uuid-123",
        "fileName": "metal-box-001.jpg",
        "score": 0.89,
        "thumbnailUrl": "/api/files/uuid-123/thumbnail"
      }
    ],
    "query": "cajas metálicas",
    "totalResults": 5
  }
}
```

**Implementation**:
```typescript
// routes/files.routes.ts

router.get('/search/images', authenticate, async (req, res) => {
  const { q, top = '10', minScore = '0.5' } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Query parameter q is required'
    });
  }

  const imageSearchService = getImageSearchService();
  const results = await imageSearchService.searchByText({
    userId: req.user.id,
    query: q,
    top: Math.min(parseInt(top as string, 10), 50),
    minScore: parseFloat(minScore as string),
  });

  return res.json({ success: true, data: results });
});
```

---

## 4. Efectos de Borde y Mitigaciones

### 4.1 Index Migration

**Problema**: El índice actual solo tiene `contentVector` (1536d). Agregar `imageVector` requiere migración.

**Mitigación**:
```typescript
// schema.ts - Hacer el campo nullable inicialmente
{
  name: 'imageVector',
  type: 'Collection(Edm.Single)',
  searchable: true,
  vectorSearchDimensions: 1024,
  vectorSearchProfileName: 'hnsw-profile-image',
  // No required - existing docs won't have this field
}
```

### 4.2 Concurrent Uploads

**Problema**: Múltiples imágenes subidas simultáneamente pueden causar race conditions.

**Mitigación**:
- Usar `UPSERT` pattern en repository
- Cada embedding tiene `fileId` único

### 4.3 Deletion Cascade

**Problema**: Cuando se elimina un archivo, el embedding debe eliminarse también.

**Mitigación**:
```sql
-- FK con CASCADE DELETE
ALTER TABLE image_embeddings
ADD CONSTRAINT FK_image_embeddings_files
FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE;
```

### 4.4 Re-indexing Existing Images

**Problema**: Imágenes ya subidas no tienen embeddings indexados.

**Mitigación**:
- Script de migración one-time
- Job en background que procesa imágenes pendientes

```typescript
// scripts/backfill-image-embeddings.ts
async function backfillImageEmbeddings() {
  const files = await db.query(`
    SELECT f.id, f.user_id, f.blob_path, f.mime_type
    FROM files f
    LEFT JOIN image_embeddings ie ON f.id = ie.file_id
    WHERE f.mime_type LIKE 'image/%'
    AND ie.id IS NULL
  `);

  for (const file of files) {
    await queue.add('reprocess-image', { fileId: file.id });
  }
}
```

---

## 5. Configuración de Constantes

**Archivo**: `backend/src/infrastructure/config/constants.ts`

```typescript
// Image Search Configuration
export const IMAGE_SEARCH_CONFIG = {
  /** Default number of results */
  DEFAULT_TOP: 10,

  /** Maximum number of results */
  MAX_TOP: 50,

  /** Default minimum similarity score */
  DEFAULT_MIN_SCORE: 0.5,

  /** Image embedding dimensions (Azure Vision) */
  EMBEDDING_DIMENSIONS: 1024,

  /** Azure Vision model version */
  MODEL_VERSION: '2023-04-15',

  /** Azure Vision API version */
  API_VERSION: '2024-02-01',
} as const;
```

---

## 6. Logging Requirements

Todos los componentes deben usar structured logging:

```typescript
// Correct
logger.info({ userId, fileId, dimensions: 1024 }, 'Image embedding indexed');

// Incorrect
console.log('Image embedding indexed for user ' + userId);
```

Log levels:
- `error`: Fallos que requieren atención
- `warn`: Situaciones inesperadas pero manejables
- `info`: Eventos importantes de negocio
- `debug`: Detalles técnicos para debugging
