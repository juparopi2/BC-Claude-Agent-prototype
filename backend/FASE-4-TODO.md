# FASE 4: Embeddings y Búsqueda Semántica - TODO

**Fecha creación**: 2025-12-10
**Objetivo**: Implementar sistema RAG completo con chunking, embeddings y búsqueda vectorial usando TDD
**Cobertura objetivo**: 70%+ en todos los servicios

---

## ✅ COMPLETADO (Semana 1: Chunking - Parcial)

### 1.1 RecursiveChunkingStrategy ✅
- **Tests**: 22/22 pasando (100%)
- **Líneas**: ~280 líneas implementación + 220 tests
- **Funcionalidad**:
  - División jerárquica: párrafos → oraciones → palabras
  - Respeta límite de tokens (512 default)
  - Overlap inteligente (50 tokens default, solo cuando divide por tamaño)
  - Metadata completa (chunkIndex, tokenCount, offsets)
  - Manejo de edge cases (texto vacío, whitespace, caracteres especiales)

### 1.2 SemanticChunkingStrategy ✅
- **Tests**: 20/20 pasando (100%)
- **Líneas**: ~280 líneas implementación
- **Funcionalidad**:
  - Detecta límites de tópicos (párrafos)
  - Mantiene oraciones relacionadas juntas
  - Nunca divide mid-sentence
  - Overlap para contexto cuando necesario
  - Fallback a división por palabras

### 1.3 RowBasedChunkingStrategy ⚠️ INCOMPLETO
- **Tests**: 15/19 pasando (79%) - **4 TESTS FALLANDO**
- **Líneas**: ~250 líneas implementación
- **Funcionalidad implementada**:
  - Detecta formato (markdown vs CSV)
  - Preserva headers en cada chunk (funcional)
  - Maneja non-table text gracefully
- **BUGS A ARREGLAR** (crítico para calidad):
  1. ❌ Token estimation imprecisa para tablas grandes
  2. ❌ No divide correctamente con límites pequeños (50-100 tokens)
  3. ❌ Chunks exceden maxTokens en algunos casos
  4. ❌ Lógica de división necesita refactor

---

## 🔴 PENDIENTE - PRIORIDAD ALTA

### 1.3.1 Arreglar RowBasedChunkingStrategy (CRÍTICO)

**Problema actual**:
- 4 tests fallando relacionados con token limits estrictos
- Chunks de 201 tokens cuando max es 50
- No divide tablas grandes en múltiples chunks

**Causa raíz identificada**:
- Estimación de tokens (chars/3) no es suficientemente precisa
- Lógica de división acumula demasiadas filas antes de dividir
- No valida que cada chunk respete maxTokens después de crearlo

**Enfoque de solución**:
1. **Mejorar token estimation**:
   - Usar conteo de palabras + símbolos especiales
   - Para tablas: contar pipes `|` y dashes `-` como tokens individuales
   - Fórmula: `words * 1.3 + specialChars * 0.5`

2. **Refactorizar lógica de chunking**:
   ```typescript
   // Algoritmo correcto:
   for (const row of dataRows) {
     const testChunk = currentChunk.concat(row);
     const testText = testChunk.join('\n');
     const tokens = estimateTokenCount(testText);

     if (tokens <= maxTokens) {
       currentChunk.push(row);
     } else {
       // VALIDAR que currentChunk no está vacío
       if (currentChunk.length > headerRowCount) {
         chunks.push(currentChunk.join('\n'));
         // VALIDAR token count del chunk guardado
         assert(estimateTokenCount(chunks[chunks.length - 1]) <= maxTokens);
       }
       currentChunk = [header, separator, row];
     }
   }
   ```

3. **Agregar validación post-chunking**:
   - Verificar que TODOS los chunks respetan maxTokens
   - Si no, throw error explicativo (no silent failure)

**Tests específicos a arreglar**:
1. `should preserve table headers in each chunk` (maxTokens: 50, 4 rows)
2. `should chunk large tables into manageable sizes` (maxTokens: 100, 50 rows)
3. `should preserve CSV headers in each chunk` (maxTokens: 30, 5 rows)
4. `should respect max token limit` (maxTokens: 50, 30 rows)

**Tiempo estimado**: 2-3 horas

---

### 1.4 ChunkingStrategyFactory + ChunkFixture

**Objetivo**: Factory pattern para crear estrategias + fixture para tests

**Archivos a crear**:
1. `backend/src/services/chunking/ChunkingStrategyFactory.ts`
2. `backend/src/__tests__/fixtures/ChunkFixture.ts`
3. `backend/src/__tests__/unit/services/chunking/ChunkingStrategyFactory.test.ts`

**Factory Pattern**:
```typescript
export class ChunkingStrategyFactory {
  static create(
    type: ChunkingStrategyType,
    options: ChunkingOptions
  ): ChunkingStrategy {
    switch (type) {
      case 'recursive':
        return new RecursiveChunkingStrategy(options);
      case 'semantic':
        return new SemanticChunkingStrategy(options);
      case 'row-based':
        return new RowBasedChunkingStrategy(options);
      default:
        throw new Error(`Unknown chunking strategy: ${type}`);
    }
  }

  static createForFileType(mimeType: string): ChunkingStrategy {
    // Heurística inteligente:
    // - text/csv, application/vnd.ms-excel → row-based
    // - text/markdown, text/plain → semantic
    // - default → recursive
  }
}
```

**Fixture Pattern** (siguiendo FileFixture):
```typescript
export class ChunkFixture {
  static createChunk(overrides?: Partial<ChunkResult>): ChunkResult {
    return {
      text: 'Sample chunk text with multiple sentences.',
      chunkIndex: 0,
      tokenCount: 12,
      startOffset: 0,
      endOffset: 42,
      ...overrides
    };
  }

  static createMultipleChunks(count: number): ChunkResult[] {
    return Array.from({ length: count }, (_, i) =>
      ChunkFixture.createChunk({
        chunkIndex: i,
        text: `Chunk ${i} content with some text.`,
        startOffset: i * 50,
        endOffset: (i + 1) * 50
      })
    );
  }

  // Presets para casos comunes
  static Presets = {
    shortParagraph: () => ChunkFixture.createChunk({
      text: 'This is a short paragraph.',
      tokenCount: 7
    }),

    longDocument: () => ChunkFixture.createMultipleChunks(10),

    tableRows: () => ChunkFixture.createChunk({
      text: '| Name | Age |\n|------|-----|\n| John | 30 |',
      tokenCount: 15
    })
  };
}
```

**Tests a escribir** (mínimo 10 tests):
1. Factory crea estrategia correcta por tipo
2. Factory valida opciones requeridas
3. Factory detecta tipo por MIME type
4. Factory rechaza tipos inválidos
5. Fixture crea chunk válido
6. Fixture crea múltiples chunks con índices correctos
7. Fixture presets funcionan correctamente

**Tiempo estimado**: 2-3 horas

---

## 🟡 PENDIENTE - SEMANA 2-4 (DETALLADO)

---

## SEMANA 2: EmbeddingService (4-5 días)

### 2.1 EmbeddingService - Text Embeddings (Día 1-2)

**Archivos a crear**:
- `backend/src/services/embeddings/EmbeddingService.ts` (~350 líneas)
- `backend/src/services/embeddings/types.ts` (interfaces)
- `backend/src/__tests__/unit/services/embeddings/EmbeddingService.test.ts` (~400 líneas)

**Arquitectura**:
```typescript
export class EmbeddingService {
  private static instance?: EmbeddingService;
  private openaiClient?: OpenAIClient; // Lazy init (patrón PdfProcessor)
  private cache?: Redis; // Cache de embeddings

  async generateTextEmbedding(text: string, userId: string): Promise<TextEmbedding>;
  async generateTextEmbeddingsBatch(texts: string[], userId: string): Promise<TextEmbedding[]>;

  private async getOrCreateClient(): Promise<OpenAIClient>;
  private getCacheKey(text: string): string;
}

interface TextEmbedding {
  embedding: number[]; // 1536 dimensions para text-embedding-3-small
  model: string;
  tokenCount: number;
  userId: string;
  createdAt: Date;
}
```

**Tests a escribir** (15-20 tests):
1. **Configuration & Client Init** (5 tests):
   - Should throw error when AZURE_OPENAI_ENDPOINT not configured
   - Should throw error when AZURE_OPENAI_KEY not configured
   - Should create OpenAI client only once (lazy init)
   - Should reuse singleton instance
   - Should accept custom dependencies for testing

2. **Text Embedding Generation** (6 tests):
   - Should generate embedding for single text chunk
   - Should generate embedding with 1536 dimensions
   - Should include model name in response
   - Should include token count
   - Should batch multiple chunks efficiently (16 chunks/request max)
   - Should handle empty text gracefully

3. **Caching** (4 tests):
   - Should cache embeddings in Redis (7-day TTL)
   - Should return cached embedding on second call
   - Should use userId in cache key for multi-tenant
   - Should handle cache miss gracefully

4. **Error Handling & Retries** (5 tests):
   - Should retry on rate limit (429 status, exponential backoff)
   - Should NOT retry on auth error (401)
   - Should handle network timeout
   - Should log detailed error context
   - Should truncate text exceeding 8191 tokens

**Integration Tests** (skippable, 3 tests):
```typescript
// backend/src/__tests__/integration/embeddings/EmbeddingService.integration.test.ts
describe('EmbeddingService Integration', () => {
  beforeAll(() => {
    if (process.env.SKIP_EXPENSIVE_TESTS === 'true') {
      test.skip('Skipping expensive tests');
    }
  });

  it('should generate real embeddings from Azure OpenAI');
  it('should handle rate limiting in real scenario');
  it('should batch 50 texts successfully');
});
```

**Tiempo estimado**: 2 días
**Cobertura objetivo**: 90%+

---

### 2.2 EmbeddingService - Image Embeddings (Día 3)

**Extensión de EmbeddingService**:
```typescript
export class EmbeddingService {
  private visionClient?: ComputerVisionClient; // Lazy init

  async generateImageEmbedding(buffer: Buffer, userId: string): Promise<ImageEmbedding>;
  async generateImageEmbeddingsBatch(buffers: Buffer[], userId: string): Promise<ImageEmbedding[]>;
}

interface ImageEmbedding {
  embedding: number[]; // 1024 dimensions para Computer Vision
  model: string;
  imageSize: number; // bytes
  userId: string;
  createdAt: Date;
}
```

**Tests adicionales** (8 tests):
1. Should generate image embedding from buffer
2. Should generate embedding with 1024 dimensions
3. Should handle invalid image format
4. Should handle image too large (>4MB)
5. Should batch multiple images (max 10/request)
6. Should cache image embeddings (hash of buffer as key)
7. Should handle Computer Vision API errors
8. Should respect rate limits (1000 images/hour)

**Tiempo estimado**: 1 día
**Cobertura objetivo**: 85%+

---

### 2.3 Error Handling y Retries (Día 4)

**Retry Logic Implementation**:
```typescript
private async withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (this.shouldRetry(error) && attempt < maxRetries) {
        const delay = this.calculateBackoff(attempt);
        await this.sleep(delay);
        continue;
      }
      throw error;
    }
  }
}

private shouldRetry(error: any): boolean {
  // Retry on: 429 (rate limit), 503 (service unavailable), network errors
  // Don't retry on: 401 (auth), 400 (bad request), 404 (not found)
}

private calculateBackoff(attempt: number): number {
  // Exponential backoff: 2^attempt * 1000ms (max 30s)
  return Math.min(Math.pow(2, attempt) * 1000, 30000);
}
```

**Tests adicionales** (7 tests):
1. Should retry on 429 with exponential backoff
2. Should retry on 503 service unavailable
3. Should NOT retry on 401 unauthorized
4. Should NOT retry on 400 bad request
5. Should respect max retries limit
6. Should log each retry attempt
7. Should include retry-after header in backoff calculation

**Tiempo estimado**: 1 día

---

### 2.4 EmbeddingFixture + Integration Tests (Día 5)

**Fixture Factory**:
```typescript
// backend/src/__tests__/fixtures/EmbeddingFixture.ts
export class EmbeddingFixture {
  static createTextEmbedding(overrides?: Partial<TextEmbedding>): TextEmbedding {
    return {
      embedding: this.createDeterministicEmbedding(1536),
      model: 'text-embedding-3-small',
      tokenCount: 42,
      userId: 'user-test-123',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      ...overrides
    };
  }

  static createImageEmbedding(overrides?: Partial<ImageEmbedding>): ImageEmbedding {
    return {
      embedding: this.createDeterministicEmbedding(1024),
      model: 'computer-vision-4',
      imageSize: 1024 * 50, // 50KB
      userId: 'user-test-123',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      ...overrides
    };
  }

  // Deterministic embeddings for testing (seeded random)
  private static createDeterministicEmbedding(dimensions: number): number[] {
    const seed = 42;
    return Array.from({ length: dimensions }, (_, i) => {
      const x = Math.sin(seed + i) * 10000;
      return (x - Math.floor(x)) * 2 - 1; // Range: [-1, 1]
    });
  }

  static Presets = {
    shortText: () => EmbeddingFixture.createTextEmbedding({ tokenCount: 10 }),
    longText: () => EmbeddingFixture.createTextEmbedding({ tokenCount: 500 }),
    smallImage: () => EmbeddingFixture.createImageEmbedding({ imageSize: 1024 * 10 }),
    largeImage: () => EmbeddingFixture.createImageEmbedding({ imageSize: 1024 * 1024 * 3 }),
  };
}
```

**Tests del Fixture** (5 tests):
1. Should create valid text embedding
2. Should create valid image embedding
3. Should respect overrides
4. Should create deterministic embeddings (same input = same output)
5. Presets should work correctly

**Tiempo estimado**: 1 día

**TOTAL SEMANA 2**: 20-25 tests, 85%+ cobertura, 5 días

---

## SEMANA 3: VectorSearchService (4-5 días)

### 3.1 VectorSearchService - Index Management (Día 1-2)

**Archivos a crear**:
- `backend/src/services/search/VectorSearchService.ts` (~450 líneas)
- `backend/src/services/search/types.ts`
- `backend/src/services/search/schema.ts` (index definition)
- `backend/src/__tests__/unit/services/search/VectorSearchService.test.ts` (~500 líneas)

**Arquitectura**:
```typescript
export class VectorSearchService {
  private static instance?: VectorSearchService;
  private searchClient?: SearchClient; // Lazy init
  private indexClient?: SearchIndexClient;

  async ensureIndexExists(): Promise<void>;
  async deleteIndex(): Promise<void>;
  async getIndexStats(): Promise<IndexStats>;

  private createIndexSchema(): SearchIndex;
}

// Index Schema (HNSW configuration)
const indexSchema: SearchIndex = {
  name: 'file-chunks-index',
  fields: [
    { name: 'chunkId', type: 'Edm.String', key: true },
    { name: 'fileId', type: 'Edm.String', filterable: true },
    { name: 'userId', type: 'Edm.String', filterable: true }, // Multi-tenant
    { name: 'content', type: 'Edm.String', searchable: true },
    {
      name: 'contentVector',
      type: 'Collection(Edm.Single)',
      dimensions: 1536,
      vectorSearchProfile: 'hnsw-profile',
      stored: false // 50% storage savings
    },
    { name: 'chunkIndex', type: 'Edm.Int32' },
    { name: 'tokenCount', type: 'Edm.Int32' },
    { name: 'createdAt', type: 'Edm.DateTimeOffset' }
  ],
  vectorSearch: {
    profiles: [{
      name: 'hnsw-profile',
      algorithm: 'hnsw-algorithm'
    }],
    algorithms: [{
      name: 'hnsw-algorithm',
      kind: 'hnsw',
      hnswParameters: {
        m: 4,                    // Lower for precision
        efConstruction: 400,     // Standard
        efSearch: 500,           // Higher for better recall
        metric: 'cosine'
      }
    }]
  }
};
```

**Tests a escribir** (10 tests):
1. Should create index with HNSW configuration
2. Should skip index creation if already exists
3. Should validate HNSW parameters
4. Should create index with correct field types
5. Should set contentVector as stored:false
6. Should configure cosine similarity metric
7. Should delete index successfully
8. Should get index statistics
9. Should throw error on invalid configuration
10. Should lazy-initialize clients

**Tiempo estimado**: 2 días

---

### 3.2 Document Indexing (Batch) (Día 3)

**Métodos adicionales**:
```typescript
export class VectorSearchService {
  async indexChunk(chunk: FileChunkWithEmbedding): Promise<string>;
  async indexChunksBatch(chunks: FileChunkWithEmbedding[]): Promise<string[]>;

  private validateChunk(chunk: FileChunkWithEmbedding): void;
  private chunkToSearchDocument(chunk: FileChunkWithEmbedding): any;
}

interface FileChunkWithEmbedding {
  chunkId: string;
  fileId: string;
  userId: string;
  content: string;
  embedding: number[]; // 1536 dimensions
  chunkIndex: number;
  tokenCount: number;
}
```

**Tests adicionales** (8 tests):
1. Should index single chunk with embedding
2. Should batch index multiple chunks (max 1000/request)
3. Should validate chunk has required fields
4. Should validate embedding dimensions (1536)
5. Should handle indexing failure with retry
6. Should log successful indexing
7. Should include userId in document for multi-tenant
8. Should return search document IDs

**Tiempo estimado**: 1 día

---

### 3.3 Vector Search + Hybrid Search (Día 4)

**Métodos de búsqueda**:
```typescript
export class VectorSearchService {
  async search(query: SearchQuery): Promise<SearchResult[]>;
  async hybridSearch(query: HybridSearchQuery): Promise<SearchResult[]>;
}

interface SearchQuery {
  embedding: number[];
  userId: string; // Multi-tenant filter
  top: number; // default: 10
  filter?: string; // OData filter
}

interface HybridSearchQuery extends SearchQuery {
  text: string; // For BM25 keyword search
  vectorWeight: number; // 0-1, default: 0.7
  keywordWeight: number; // 0-1, default: 0.3
}

interface SearchResult {
  chunkId: string;
  fileId: string;
  content: string;
  score: number; // Similarity score
  chunkIndex: number;
}
```

**Tests adicionales** (10 tests):
1. Should search by embedding vector
2. Should filter results by userId (multi-tenant)
3. Should return top K results (default: 10)
4. Should return results sorted by score (descending)
5. Should handle empty results gracefully
6. Should apply OData filter correctly
7. Should perform hybrid search (vector + keyword)
8. Should respect vectorWeight and keywordWeight
9. Should handle search timeout
10. Should log search queries for debugging

**Tiempo estimado**: 1 día

---

### 3.4 Document Deletion + Multi-Tenant (Día 5)

**Métodos de eliminación**:
```typescript
export class VectorSearchService {
  async deleteChunk(searchDocumentId: string): Promise<void>;
  async deleteChunksForFile(fileId: string, userId: string): Promise<number>;
  async deleteChunksForUser(userId: string): Promise<number>;

  private buildDeleteFilter(fileId: string, userId: string): string;
}
```

**Tests adicionales** (7 tests):
1. Should delete single chunk by ID
2. Should delete all chunks for a file
3. Should enforce userId in deletion (multi-tenant)
4. Should return count of deleted documents
5. Should handle deletion of non-existent chunks
6. Should batch delete chunks (max 1000/request)
7. Should log deletion operations

**Integration Tests** (5 tests):
```typescript
// backend/src/__tests__/integration/search/VectorSearchService.integration.test.ts
describe('VectorSearchService Integration', () => {
  it('should index and search documents end-to-end');
  it('should respect multi-tenant isolation');
  it('should perform hybrid search with real data');
  it('should delete documents successfully');
  it('should handle index with 10K+ documents');
});
```

**Tiempo estimado**: 1 día

**TOTAL SEMANA 3**: 25-30 tests, 80%+ cobertura, 5 días

---

## SEMANA 4: MessageQueue Integration (3-4 días)

### 4.1 Agregar EMBEDDING_GENERATION Queue (Día 1)

**Modificación de MessageQueue existente**:
```typescript
// backend/src/services/queue/MessageQueue.ts

export enum QueueName {
  MESSAGE_PERSISTENCE = 'message-persistence',
  FILE_PROCESSING = 'file-processing',
  USAGE_AGGREGATION = 'usage-aggregation',
  EMBEDDING_GENERATION = 'embedding-generation' // NUEVO
}

export interface EmbeddingGenerationJob {
  fileId: string;
  userId: string;
  chunks: Array<{
    id: string;
    text: string;
    chunkIndex: number;
    tokenCount: number;
  }>;
}

export class MessageQueue {
  async addEmbeddingGenerationJob(job: EmbeddingGenerationJob): Promise<string>;

  private async processEmbeddingGeneration(job: Job<EmbeddingGenerationJob>): Promise<void>;
}
```

**Tests a escribir** (7 tests):
1. Should register EMBEDDING_GENERATION queue
2. Should create worker with concurrency 5
3. Should set retry policy (3 attempts, exponential backoff)
4. Should enqueue embedding job
5. Should enforce rate limit per user (100 jobs/hour)
6. Should emit progress events via WebSocket
7. Should handle job failure gracefully

**Tiempo estimado**: 1 día

---

### 4.2 Worker Logic (Chunking → Embedding → Indexing) (Día 2)

**Pipeline completo**:
```typescript
private async processEmbeddingGeneration(job: Job<EmbeddingGenerationJob>): Promise<void> {
  const { fileId, userId, chunks } = job.data;

  try {
    // Step 1: Generate embeddings (batch)
    const embeddings = await embeddingService.generateTextEmbeddingsBatch(
      chunks.map(c => c.text),
      userId
    );

    // Step 2: Combine chunks with embeddings
    const chunksWithEmbeddings: FileChunkWithEmbedding[] = chunks.map((chunk, i) => ({
      chunkId: `${fileId}-chunk-${chunk.chunkIndex}`,
      fileId,
      userId,
      content: chunk.text,
      embedding: embeddings[i].embedding,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount
    }));

    // Step 3: Index in Azure AI Search (batch)
    const searchDocIds = await vectorSearchService.indexChunksBatch(chunksWithEmbeddings);

    // Step 4: Update file_chunks table with search_document_id
    await this.updateFileChunksTable(chunks, searchDocIds);

    // Step 5: Emit progress via WebSocket
    await this.emitProgress(userId, fileId, 100);

  } catch (error) {
    logger.error({ error, fileId, userId }, 'Embedding generation failed');
    throw error;
  }
}
```

**Tests a escribir** (8 tests):
1. Should generate embeddings for all chunks
2. Should index chunks in Azure AI Search
3. Should update file_chunks table with search IDs
4. Should emit WebSocket progress events
5. Should handle partial failures gracefully
6. Should retry on transient errors
7. Should log detailed error context
8. Should update file status to 'indexed' on completion

**Tiempo estimado**: 1 día

---

### 4.3 Pipeline End-to-End Test (Día 3)

**Test completo del flujo**:
```typescript
// backend/src/__tests__/integration/embeddings/pipeline.integration.test.ts

describe('Embedding Pipeline E2E', () => {
  it('should process file from upload to searchable', async () => {
    // 1. Upload file
    const file = FileFixture.Presets.invoice();
    const uploadResult = await fileUploadService.uploadFile(file, userId);

    // 2. Trigger file processing
    await messageQueue.addFileProcessingJob({
      fileId: uploadResult.fileId,
      userId
    });

    // Wait for processing
    await waitForJobCompletion('file-processing');

    // 3. Verify chunks created
    const chunks = await db.query('SELECT * FROM file_chunks WHERE file_id = @fileId');
    expect(chunks.length).toBeGreaterThan(0);

    // 4. Trigger embedding generation
    await messageQueue.addEmbeddingGenerationJob({
      fileId: uploadResult.fileId,
      userId,
      chunks: chunks.map(c => ({ id: c.id, text: c.content, ... }))
    });

    // Wait for embedding
    await waitForJobCompletion('embedding-generation');

    // 5. Verify search works
    const searchResults = await vectorSearchService.search({
      embedding: testEmbedding,
      userId,
      top: 5
    });

    expect(searchResults).toHaveLength(5);
    expect(searchResults[0].fileId).toBe(uploadResult.fileId);
  });

  it('should handle 100 files concurrently');
  it('should respect rate limits');
  it('should recover from partial failures');
});
```

**Tests adicionales** (5 tests):
1. End-to-end pipeline test (upload → process → embed → search)
2. Concurrent file processing (100 files)
3. Rate limit enforcement
4. Partial failure recovery
5. WebSocket event verification

**Tiempo estimado**: 1 día

---

### 4.4 WebSocket Progress Events (Día 4 - opcional)

**Eventos adicionales**:
```typescript
// Eventos durante embedding generation
socket.emit('agent:event', {
  type: 'embedding_progress',
  data: {
    fileId,
    progress: 50, // 0-100
    stage: 'generating_embeddings', // 'chunking' | 'generating_embeddings' | 'indexing'
    chunksProcessed: 25,
    chunksTotal: 50
  }
});
```

**Tests** (3 tests):
1. Should emit embedding progress events
2. Should emit stage transitions
3. Should emit completion event

**Tiempo estimado**: 0.5 días (opcional)

**TOTAL SEMANA 4**: 15-20 tests, 75%+ cobertura, 4 días

---

## 📊 RESUMEN TOTAL FASE 4

| Semana | Componente | Tests | Cobertura | Días | Estado |
|--------|------------|-------|-----------|------|--------|
| 1 | Chunking Strategies | 60+ | 90%+ | 5 | ⚠️ 93% completo |
| 2 | EmbeddingService | 20-25 | 85%+ | 5 | 🔴 Pendiente |
| 3 | VectorSearchService | 25-30 | 80%+ | 5 | 🔴 Pendiente |
| 4 | MessageQueue Integration | 15-20 | 75%+ | 4 | 🔴 Pendiente |
| **TOTAL** | **Fase 4 Completa** | **120-135** | **82%+** | **19 días** | **5% completo** |

**Costo estimado Fase 4**:
- Desarrollo: $255/mes (Azure AI Search + OpenAI)
- CI/CD: $10/mes (integration tests)
- **Total: $265/mes**

---

## 🔧 INFRAESTRUCTURA PENDIENTE

### Azure Resources a Provisionar

1. **Azure AI Search** (Standard S1)
   - Script: `infrastructure/setup-ai-search.sh`
   - Costo: $250/mes
   - Configuración HNSW: m=4, efConstruction=400, efSearch=500

2. **Azure OpenAI** (Standard S0)
   - Script: `infrastructure/setup-azure-openai.sh`
   - Modelo: text-embedding-3-small (120K TPM)
   - Costo: ~$5/mes

3. **Azure Computer Vision** (Standard S1) - Fase 4.2
   - Script: `infrastructure/setup-azure-vision.sh`
   - Costo: $1/1K imágenes

### Variables de Entorno a Agregar

Archivo: `backend/src/config/environment.ts`

```typescript
// Fase 4: RAG
AZURE_SEARCH_ENDPOINT: z.string().url().optional(),
AZURE_SEARCH_KEY: z.string().optional(),
AZURE_SEARCH_INDEX_NAME: z.string().default('document-chunks-dev'),

AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
AZURE_OPENAI_KEY: z.string().optional(),
AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().default('text-embedding-3-small'),

RAG_CHUNK_SIZE: z.string().default('512').transform(Number),
RAG_CHUNK_OVERLAP: z.string().default('50').transform(Number),
RAG_TOP_K_RESULTS: z.string().default('10').transform(Number),

SKIP_EXPENSIVE_TESTS: z.string().default('false').transform(v => v === 'true'),
```

---

## 📊 MÉTRICAS DE PROGRESO

### Tests por Servicio

| Servicio | Tests Escritos | Tests Pasando | Cobertura | Estado |
|----------|----------------|---------------|-----------|--------|
| RecursiveChunking | 22 | 22 (100%) | 100% | ✅ Completo |
| SemanticChunking | 20 | 20 (100%) | 100% | ✅ Completo |
| RowBasedChunking | 19 | 15 (79%) | ~80% | ⚠️ Bugs críticos |
| ChunkingFactory | 0 | 0 | 0% | 🔴 Pendiente |
| **TOTAL Semana 1** | **61** | **57 (93%)** | **90%** | **⚠️ Incompleto** |

### Archivos Creados (Semana 1)

✅ **Implementación** (7 archivos):
1. `backend/src/services/chunking/types.ts`
2. `backend/src/services/chunking/RecursiveChunkingStrategy.ts`
3. `backend/src/services/chunking/SemanticChunkingStrategy.ts`
4. `backend/src/services/chunking/RowBasedChunkingStrategy.ts`
5. `backend/src/services/chunking/index.ts`

✅ **Tests** (3 archivos):
6. `backend/src/__tests__/unit/services/chunking/RecursiveChunkingStrategy.test.ts`
7. `backend/src/__tests__/unit/services/chunking/SemanticChunkingStrategy.test.ts`
8. `backend/src/__tests__/unit/services/chunking/RowBasedChunkingStrategy.test.ts`

🔴 **Pendientes** (3 archivos):
9. `backend/src/services/chunking/ChunkingStrategyFactory.ts`
10. `backend/src/__tests__/fixtures/ChunkFixture.ts`
11. `backend/src/__tests__/unit/services/chunking/ChunkingStrategyFactory.test.ts`

---

## 🎯 PRÓXIMOS PASOS (Orden de Ejecución)

### AHORA (Prioridad 1)
1. ✅ Crear este archivo TODO
2. 🔴 **Arreglar RowBasedChunkingStrategy** (4 tests fallando)
   - Refactorizar token estimation
   - Corregir lógica de división
   - Validar chunks post-creación
   - Verificar 19/19 tests pasando

### HOY (Prioridad 2)
3. 🔴 **Implementar ChunkingStrategyFactory**
   - Escribir tests (RED)
   - Implementar factory (GREEN)
   - Crear ChunkFixture
   - Verificar todos los tests pasan

### MAÑANA (Prioridad 3)
4. 🔴 **Verificar integración completa Semana 1**
   - Correr todos los tests de chunking
   - Verificar coverage ≥90%
   - Build exitoso sin errores
   - Lint y type-check limpios

### SIGUIENTE (Semana 2)
5. 🟡 Comenzar EmbeddingService con TDD
6. 🟡 Provisionar Azure OpenAI
7. 🟡 Configurar variables de entorno

---

## 🚨 PRINCIPIOS A SEGUIR

### ❌ NO Hacer:
- NO omitir funcionalidad "porque es difícil"
- NO dejar tests fallando "porque son edge cases"
- NO justificar bugs con "es aceptable"
- NO pasar a siguiente fase con trabajo incompleto

### ✅ SÍ Hacer:
- **Calidad impecable**: Todos los tests deben pasar
- **TDD estricto**: RED → GREEN → REFACTOR siempre
- **Cobertura alta**: 70%+ mínimo, apuntar a 90%+
- **Documentar blockers**: Si hay problema técnico real, documentarlo
- **Pedir ayuda**: Si bloqueado, pedir clarificación al usuario

---

## 📝 NOTAS

**Lecciones aprendidas**:
- Token estimation para tablas es más complejo que texto plano
- Pipes `|` y espaciado en markdown incrementan token count significativamente
- Tests con limits muy pequeños (50 tokens) exponen bugs sutiles
- Validación post-chunking es crítica para garantizar correctitud

**Decisiones técnicas**:
- Usar chars/3 como baseline, ajustar con conteo de símbolos especiales
- Overlap solo cuando texto se divide por tamaño (no para splits naturales)
- Factory pattern para facilitar selección de estrategia
- Fixture pattern para tests consistentes

**Bloqueadores actuales**:
- Ninguno técnico - solo necesita tiempo de implementación
- RowBasedChunkingStrategy requiere refactor cuidadoso
