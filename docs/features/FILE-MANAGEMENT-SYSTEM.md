# Sistema de Gestión de Archivos - Documento de Arquitectura

## 1. Resumen Ejecutivo

El Sistema de Gestión de Archivos es una funcionalidad core de BC Claude Agent que permite a los usuarios:

- **Subir y organizar archivos** en una estructura jerárquica de carpetas
- **Usar archivos como contexto** en conversaciones con el agente de IA
- **Buscar archivos semánticamente** mediante embeddings vectoriales
- **Recibir citations** con referencias a los archivos utilizados en las respuestas

### Alcance

| Funcionalidad | Incluido |
|---------------|----------|
| Upload de archivos (drag & drop) | Si |
| Estructura de carpetas jerárquica | Si |
| Sistema de favoritos | Si |
| Adjuntar archivos al chat | Si |
| Búsqueda semántica (texto) | Si |
| Búsqueda semántica (imágenes) | Si |
| Citations en respuestas | Si |
| Vista previa de archivos | Si |

---

## 2. Implementation Status

### Phase 1: Infrastructure Base ✅ COMPLETE

**Status**: Production-ready (100% complete)
**Completion**: December 8, 2025
**Test Coverage**: 33 tests passing (17 unit + 16 integration with Azurite)

#### Implemented Components

**Database Layer**:
- Tables: `files`, `file_chunks`, `message_file_attachments` (✅ migrated to Azure SQL DEV on December 8, 2025)
- Migration: `backend/migrations/003-create-files-tables.sql`
- Indexes: 7 performance-optimized indexes (verified in production)

**Service Layer**:
- `FileService` (`backend/src/services/files/FileService.ts`)
  - 9 CRUD methods: getFiles, getFile, createFolder, createFileRecord, updateFile, toggleFavorite, moveFile, deleteFile, getFileCount
  - 88% test coverage (31 tests)
  - Pattern: Singleton + Dependency Injection

- `FileUploadService` (`backend/src/services/files/FileUploadService.ts`)
  - 8 methods: generateBlobPath, validateFileType, validateFileSize, uploadToBlob, downloadFromBlob, deleteFromBlob, generateSasToken, blobExists
  - Smart upload strategy: single-put < 256MB, block upload >= 256MB
  - 17 unit tests (validation logic) + 16 integration tests (Azurite)

**API Layer**:
- Routes: `backend/src/routes/files.ts` (7 endpoints)
- Base path: `/api/files`
- Authentication: Microsoft OAuth (authenticateMicrosoft middleware)
- Validation: Zod schemas for all inputs

**Type System**:
- Definitions: `backend/src/types/file.types.ts` (15 types)
- Test fixtures: `backend/src/__tests__/fixtures/FileFixture.ts` (11 presets)
- Dual system: DB (snake_case) ↔ API (camelCase)

**Azure Infrastructure**:
- Container: `user-files` in `sabcagentdev` storage account (✅ verified functional December 8, 2025)
- Lifecycle policy: `infrastructure/blob-lifecycle-policy.json` (✅ applied with Hot→Cool→Archive tiering)
- Setup script: `infrastructure/setup-file-storage.sh`
- Cost optimization: Hot→Cool→Archive tiering

**Development Environment**:
- **Azurite** configured for local Blob Storage emulation (eliminates Azure SDK mocking issues)
- Dual environment variables:
  - `STORAGE_CONNECTION_STRING_TEST` - Azurite connection for local development
  - `STORAGE_CONNECTION_STRING` - Production Azure Blob Storage for CI/CD
- Integration tests use fallback strategy: TEST → production → hardcoded Azurite

#### File Locations

**Core Implementation**:
- Services: `backend/src/services/files/`
- Routes: `backend/src/routes/files.ts`
- Types: `backend/src/types/file.types.ts`
- Migration: `backend/migrations/003-create-files-tables.sql`

**Testing**:
- FileService tests: `backend/src/__tests__/unit/services/files/FileService.test.ts` (31 tests)
- FileUploadService unit tests: `backend/src/__tests__/unit/services/files/FileUploadService.test.ts` (17 validation tests)
- FileUploadService integration tests: `backend/src/__tests__/integration/files/FileUploadService.integration.test.ts` (16 Azurite tests)
- Fixtures: `backend/src/__tests__/fixtures/FileFixture.ts`

**Infrastructure**:
- Lifecycle policy: `infrastructure/blob-lifecycle-policy.json`
- Setup script: `infrastructure/setup-file-storage.sh`

#### Phase 1 Completion Summary (December 8, 2025)

**Completed Items** ✅:
- [x] Database migration executed in Azure SQL DEV
- [x] Azure Blob Storage configured with lifecycle policy
- [x] Azurite configured for local development and CI/CD
- [x] Integration tests migrated from unit tests (16 tests with Azurite)
- [x] Dual environment variable strategy implemented (TEST + production)
- [x] All tests passing: 17 unit + 16 integration = 33 total tests
- [x] No .env.test file (consolidated into single .env with dual variables)

**Next Phases**:
- [ ] Fase 2: UI Components (FileExplorer, drag-and-drop)
- [ ] Fase 3: Document Processing (PDF, DOCX text extraction)
- [x] Fase 4 Week 1: Chunking Strategies ✅ (December 10, 2025)
- [x] Fase 4 Week 2: EmbeddingService ✅ (December 10, 2025)
- [x] Fase 4 Week 3: Vector Search (Azure AI Search integration) ✅ (December 10, 2025)
- [x] Fase 4 Week 4: MessageQueue Integration ✅ (December 11, 2025)
- [x] Fase 5: Chat Integration ✅ COMPLETE (December 11, 2025)

#### Fase 5 Complete (December 11, 2025)

**Ciclo 1: Attachment Flow** ✅
- ✅ Frontend: `FileAttachmentChip.tsx` component with upload progress
- ✅ Frontend: `ChatInput.tsx` integrated with attachments state
- ✅ Frontend: `socketMiddleware.ts` sends attachments to backend
- ✅ Backend: `ChatMessageHandler.ts` receives `data.attachments`
- ✅ Backend: `DirectAgentService.ts` validates file ownership
- ✅ Backend: Zod schema validation for attachments

**Ciclo 2-3: Context Strategy & Retrieval** ✅
- ✅ `ContextStrategyFactory` - Strategy selection (DIRECT_CONTENT, EXTRACTED_TEXT, RAG_CHUNKS)
- ✅ `ContextRetrievalService` - Content retrieval by strategy
- ✅ `PromptBuilder` - XML context formatting, system instructions

**Ciclo 4: Citations** ✅
- ✅ `CitationParser` - Parse [filename.ext] citations from response
- ✅ `MessageFileAttachmentService` - Persist attachments to DB

**Ciclo 5: DirectAgentService Integration** ✅
- ✅ `prepareFileContext()` integrated in executeQueryStreaming
- ✅ `recordFileUsage()` integrated with fire-and-forget pattern

**Ciclo 6: E2E Integration Tests** ✅
- ✅ `FileTestHelper` for Azure Blob/SQL integration tests
- ✅ 13 integration tests (ownership, context, citations, errors, images, usage)
- ✅ Full suite: 1961 tests passing

**Test Coverage**:
- 107 unit tests (Fase 5)
- 13 integration tests (Ciclo 6)
- Total: 120 tests for chat integration feature

---

## 3. Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────────┐ │
│  │ FileExplorer│  │  ChatInput   │  │       Right Panel (Files Tab)   │ │
│  │  Component  │  │ (Drop Zone)  │  │  - File Tree                    │ │
│  └──────┬──────┘  └──────┬───────┘  │  - Upload Zone                  │ │
│         │                │          │  - Favorites View               │ │
│         └────────┬───────┘          └─────────────────────────────────┘ │
│                  │                                                       │
│         ┌────────▼────────┐                                             │
│         │   fileStore     │  (Zustand)                                  │
│         │   chatStore     │                                             │
│         └────────┬────────┘                                             │
└──────────────────┼──────────────────────────────────────────────────────┘
                   │ REST API + WebSocket
┌──────────────────┼──────────────────────────────────────────────────────┐
│                  │              BACKEND                                  │
│         ┌────────▼────────┐                                             │
│         │   File Routes   │  /api/files/*                               │
│         └────────┬────────┘                                             │
│                  │                                                       │
│    ┌─────────────┼─────────────┬─────────────────────┐                  │
│    │             │             │                     │                  │
│    ▼             ▼             ▼                     ▼                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────────┐         │
│ │  File    │ │  File    │ │  Embedding   │ │ DirectAgent     │         │
│ │ Service  │ │ Upload   │ │  Service     │ │ Service         │         │
│ │          │ │ Service  │ │              │ │ (+ file context)│         │
│ └────┬─────┘ └────┬─────┘ └──────┬───────┘ └────────┬────────┘         │
│      │            │              │                   │                  │
└──────┼────────────┼──────────────┼───────────────────┼──────────────────┘
       │            │              │                   │
┌──────┼────────────┼──────────────┼───────────────────┼──────────────────┐
│      │            │              │                   │    AZURE         │
│      ▼            ▼              ▼                   ▼                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────────┐         │
│ │ Azure    │ │ Azure    │ │ Azure AI     │ │ Azure OpenAI    │         │
│ │ SQL DB   │ │ Blob     │ │ Search       │ │ (Embeddings)    │         │
│ │          │ │ Storage  │ │ (Vectors)    │ │                 │         │
│ └──────────┘ └──────────┘ └──────────────┘ └─────────────────┘         │
│                                                                         │
│              ┌──────────────────┐  ┌─────────────────────┐             │
│              │ Azure Computer   │  │ Azure Document      │             │
│              │ Vision (Images)  │  │ Intelligence (PDF)  │             │
│              └──────────────────┘  └─────────────────────┘             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Tipos de Archivo Soportados

### 4.1 Soporte Nativo (envío directo a Anthropic)

| Tipo | Extensiones | Límite | Procesamiento |
|------|-------------|--------|---------------|
| Imágenes | JPEG, PNG, GIF, WebP | 8000x8000px, 30MB | Claude Vision |
| PDF | .pdf | 30MB | Claude 3.5+ nativo |
| Texto | .txt, .md, .html | 30MB | Directo |

### 4.2 Conversión Requerida

| Tipo | Extensiones | Estrategia |
|------|-------------|------------|
| Word | .docx | Convertir a PDF o extraer texto |
| Excel | .xlsx, .xls | Extraer como CSV/Markdown |
| CSV | .csv | Enviar como texto |

### 4.3 Límites de API

| Endpoint | Límite |
|----------|--------|
| Messages API | 32 MB total |
| Files API (Beta) | 500 MB/archivo |
| Chat Web | 30 MB/archivo, 20 archivos/chat |

---

## 5. Estructura de Datos

### 5.1 Tabla `files`

```sql
CREATE TABLE files (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,
    parent_folder_id UNIQUEIDENTIFIER NULL,  -- NULL = root

    name NVARCHAR(500) NOT NULL,
    mime_type NVARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,
    blob_path NVARCHAR(1000) NOT NULL,

    is_folder BIT NOT NULL DEFAULT 0,
    is_favorite BIT NOT NULL DEFAULT 0,

    processing_status NVARCHAR(50) DEFAULT 'pending',
    embedding_status NVARCHAR(50) DEFAULT 'pending',
    extracted_text NVARCHAR(MAX) NULL,

    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_folder_id) REFERENCES files(id)
);
```

### 5.2 Tabla `file_chunks`

```sql
CREATE TABLE file_chunks (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    file_id UNIQUEIDENTIFIER NOT NULL,

    chunk_index INT NOT NULL,
    chunk_text NVARCHAR(MAX) NOT NULL,
    chunk_tokens INT NOT NULL,
    search_document_id NVARCHAR(255) NULL,

    created_at DATETIME2 DEFAULT GETUTCDATE(),

    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
```

### 5.3 Tabla `message_file_attachments`

```sql
CREATE TABLE message_file_attachments (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    message_id UNIQUEIDENTIFIER NOT NULL,
    file_id UNIQUEIDENTIFIER NOT NULL,

    usage_type NVARCHAR(50) NOT NULL,  -- 'direct', 'semantic_match', 'folder'
    relevance_score FLOAT NULL,

    created_at DATETIME2 DEFAULT GETUTCDATE(),

    FOREIGN KEY (file_id) REFERENCES files(id)
);
```

---

## 6. Flujos de Usuario

### 6.1 Subir Archivo

```
Usuario arrastra archivo a FileExplorer
         │
         ▼
Frontend valida tipo/tamaño
         │
         ▼
POST /api/files/upload
         │
         ▼
FileUploadService:
├── Genera blob path: {userId}/{path}/{filename}
├── Sube a Azure Blob Storage
├── Crea registro en DB (status: 'pending')
└── Retorna fileId + presigned URL
         │
         ▼
MessageQueue.addFileProcessingJob()
         │
         ▼
FileProcessingWorker (async):
├── Descarga archivo
├── Extrae texto según tipo
├── Actualiza extracted_text
└── Status: 'completed'
         │
         ▼
MessageQueue.addEmbeddingJob()
         │
         ▼
EmbeddingWorker (async):
├── Chunking (512-1024 tokens)
├── Genera embeddings (Azure OpenAI / Computer Vision)
├── Indexa en Azure AI Search
└── embedding_status: 'completed'
```

### 6.2 Adjuntar Archivo al Chat

```
Usuario arrastra archivo a ChatInput
         │
         ▼
chatStore.addAttachment({ fileId, fileName, source: 'drag_drop' })
         │
         ▼
UI muestra chip de archivo adjunto
         │
         ▼
Usuario escribe mensaje y envía
         │
         ▼
POST chat:message con attachments[]
         │
         ▼
Backend:
├── Valida ownership de archivos
├── Descarga archivos de Blob
├── Si < 30MB y soportado → envío directo
├── Si > 30MB → usa extracted_text o chunks
└── Incluye en request a Anthropic
         │
         ▼
Respuesta con citations
         │
         ▼
Frontend muestra CitationLinks
```

### 6.3 Búsqueda Semántica (Sin Adjuntos)

```
Usuario envía: "¿Qué dice la factura del cliente ABC?"
         │
         ▼
Backend detecta: no hay attachments manuales
         │
         ▼
VectorSearchService.searchFiles(userId, query):
├── Genera embedding del query
├── Busca en Azure AI Search (filter: userId)
└── Retorna top-K archivos relevantes
         │
         ▼
Si score > threshold:
├── Incluir chunks como contexto
├── Agregar metadata para citations
         │
         ▼
DirectAgentService construye prompt:
├── Mensaje original
├── Contexto de archivos relevantes
├── Instrucciones para citar fuentes
         │
         ▼
Respuesta incluye citations:
{
  "text": "Según la factura del cliente ABC...",
  "citations": [{ "fileId": "...", "fileName": "factura.pdf" }]
}
```

---

## 7. Sistema de Embeddings

### 7.1 Embeddings de Texto

**Modelo**: Azure OpenAI `text-embedding-3-small`
- **Dimensiones**: 1536
- **Costo**: $0.02/1M tokens
- **Uso**: Documentos PDF, DOCX, TXT, CSV

### 7.2 Embeddings de Imágenes

**Modelo**: Azure Computer Vision (Multimodal, tipo CLIP)
- **Dimensiones**: 1024
- **Costo**: $0.10/1,000 imágenes
- **Uso**: JPEG, PNG, GIF, WebP

**Ventaja clave**: Texto e imágenes comparten el mismo espacio vectorial, permitiendo buscar imágenes con queries de texto.

### 7.3 Configuración Azure AI Search

```json
{
  "name": "file-chunks-index",
  "fields": [
    { "name": "id", "type": "Edm.String", "key": true },
    { "name": "fileId", "type": "Edm.String", "filterable": true },
    { "name": "userId", "type": "Edm.String", "filterable": true },
    { "name": "contentVector", "type": "Collection(Edm.Single)",
      "dimensions": 1536,
      "vectorSearchProfile": "hnsw-profile"
    }
  ],
  "vectorSearch": {
    "algorithms": [{ "name": "hnsw", "kind": "hnsw", "metric": "cosine" }]
  }
}
```

---

## 8. Estrategia de Chunking

### 8.1 Configuración

```typescript
const ChunkingConfig = {
  targetTokens: 512,      // Tamaño objetivo
  maxTokens: 1024,        // Límite absoluto
  overlapTokens: 50,      // 10% overlap

  strategyByType: {
    'text/plain': 'semantic',
    'application/pdf': 'recursive',
    'text/csv': 'row_based',
    'image/*': 'single_chunk'
  }
};
```

### 8.2 Proceso

1. Extracción de texto
2. Limpieza y normalización
3. Detección de estructura (headers, párrafos)
4. Segmentación semántica
5. Ajuste de tamaño
6. Aplicar overlap
7. Generar embeddings

---

## 9. Seguridad Multi-Tenant

### 9.1 Aislamiento de Datos

```
┌───────────────────────────────────────────────────────┐
│                   Capa de Aplicación                   │
├───────────────────────────────────────────────────────┤
│  FileService.getFiles(userId, ...)                    │
│           ↓                                           │
│  SQL: WHERE user_id = @userId                         │
│           ↓                                           │
│  Blob: SAS token scoped to {userId}/*                 │
│           ↓                                           │
│  Search: filter=userId eq '{userId}'                  │
└───────────────────────────────────────────────────────┘
```

### 9.2 Validaciones Críticas

```typescript
async validateFileOwnership(userId: string, fileId: string): Promise<boolean> {
  const file = await db.query(
    `SELECT id FROM files WHERE id = @fileId AND user_id = @userId`,
    { fileId, userId }
  );
  return file.recordset.length > 0;
}
```

### 9.3 SAS Tokens

- Scope limitado al path del usuario
- Expiración de 1 hora
- Permisos específicos (read/write)

---

## 10. Infraestructura Azure

### 10.1 Recursos Existentes

| Recurso | Nombre | Uso |
|---------|--------|-----|
| Storage Account | `sabcagentdev` | Blob Storage para archivos |
| SQL Database | `sqldb-bcagent-dev` | Metadata de archivos |
| Redis Cache | `redis-bcagent-dev` | Caché de queries |
| Key Vault | `kv-bcagent-dev` | Secrets |

### 10.2 Recursos Nuevos Requeridos

| Recurso | Nombre | SKU | Costo/mes |
|---------|--------|-----|-----------|
| Azure AI Search | `search-bcagent-dev` | Basic | ~$73 |
| Azure OpenAI | `openai-bcagent-dev` | S0 | Variable |
| Azure Computer Vision | `cv-bcagent-dev` | S1 | Variable |

---

## 11. Sistema de Tracking, Auditoría y Billing

### 11.1 Arquitectura de Tracking

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TRACKING ARCHITECTURE                            │
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │   Service    │───▶│   Tracking   │───▶│     usage_events         │  │
│  │  (any op)    │    │  Middleware  │    │   (append-only log)      │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────┘  │
│                             │                        │                  │
│                             ▼                        ▼                  │
│                    ┌──────────────┐        ┌──────────────────────────┐ │
│                    │    Quota     │        │    BullMQ Worker         │ │
│                    │  Validator   │        │  (async aggregation)     │ │
│                    └──────────────┘        └──────────────────────────┘ │
│                             │                        │                  │
│                             ▼                        ▼                  │
│                    ┌──────────────┐        ┌──────────────────────────┐ │
│                    │ user_quotas  │        │   usage_aggregates       │ │
│                    │  (limits)    │        │   (rollups por periodo)  │ │
│                    └──────────────┘        └──────────────────────────┘ │
│                                                      │                  │
│                                                      ▼                  │
│                                            ┌──────────────────────────┐ │
│                                            │    billing_records       │ │
│                                            │   (facturas mensuales)   │ │
│                                            └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Tipos de Operaciones Trackeables

| Categoría | Operación | Unidad de Medida | Descripción |
|-----------|-----------|------------------|-------------|
| **Storage** | `file_upload` | bytes | Bytes subidos a Blob Storage |
| **Storage** | `file_download` | bytes | Bytes descargados |
| **Storage** | `storage_used` | bytes | Almacenamiento total consumido |
| **Processing** | `text_extraction` | pages | Páginas procesadas (PDF, DOCX) |
| **Processing** | `ocr_processing` | pages | Páginas con OCR aplicado |
| **Embeddings** | `text_embedding` | tokens | Tokens enviados a Azure OpenAI |
| **Embeddings** | `image_embedding` | images | Imágenes procesadas por Computer Vision |
| **Search** | `vector_search` | queries | Búsquedas semánticas ejecutadas |
| **Search** | `hybrid_search` | queries | Búsquedas híbridas (texto + vector) |
| **AI** | `claude_input_tokens` | tokens | Tokens de entrada a Claude API |
| **AI** | `claude_output_tokens` | tokens | Tokens de salida de Claude API |
| **AI** | `tool_execution` | calls | Llamadas a herramientas BC |

### 11.3 Estructura de Datos para Tracking

#### Tabla `usage_events` (Event Log - Append Only)

```sql
CREATE TABLE usage_events (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,
    session_id UNIQUEIDENTIFIER NULL,

    -- Clasificación de operación
    operation_category NVARCHAR(50) NOT NULL,  -- 'storage', 'processing', 'embeddings', 'search', 'ai'
    operation_type NVARCHAR(100) NOT NULL,      -- 'file_upload', 'text_embedding', etc.

    -- Métricas
    quantity BIGINT NOT NULL,                   -- Cantidad consumida
    unit NVARCHAR(50) NOT NULL,                 -- 'bytes', 'tokens', 'pages', 'queries', etc.

    -- Contexto para auditoría
    resource_id UNIQUEIDENTIFIER NULL,          -- file_id, message_id, etc.
    resource_type NVARCHAR(50) NULL,            -- 'file', 'message', 'session'
    metadata NVARCHAR(MAX) NULL,                -- JSON con detalles adicionales

    -- Costos calculados
    unit_cost_usd DECIMAL(18,8) NULL,           -- Costo por unidad en USD
    total_cost_usd DECIMAL(18,8) NULL,          -- quantity * unit_cost_usd

    -- Timestamps
    created_at DATETIME2 DEFAULT GETUTCDATE(),

    -- Índices
    INDEX IX_usage_events_user_date (user_id, created_at),
    INDEX IX_usage_events_category (operation_category, created_at),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### Tabla `user_quotas` (Límites por Usuario)

```sql
CREATE TABLE user_quotas (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL UNIQUE,
    plan_id NVARCHAR(50) NOT NULL DEFAULT 'basic',  -- 'basic', 'premium', 'enterprise'

    -- Límites mensuales
    storage_limit_bytes BIGINT NOT NULL DEFAULT 1073741824,        -- 1 GB
    documents_limit INT NOT NULL DEFAULT 100,
    images_limit INT NOT NULL DEFAULT 500,
    text_embedding_tokens_limit BIGINT NOT NULL DEFAULT 1000000,   -- 1M tokens
    image_embeddings_limit INT NOT NULL DEFAULT 500,
    vector_searches_limit INT NOT NULL DEFAULT 5000,
    claude_input_tokens_limit BIGINT NOT NULL DEFAULT 10000000,    -- 10M tokens
    claude_output_tokens_limit BIGINT NOT NULL DEFAULT 2000000,    -- 2M tokens

    -- Pay As You Go
    payg_enabled BIT NOT NULL DEFAULT 0,
    payg_spending_limit_usd DECIMAL(18,2) NULL,  -- Límite de gasto adicional

    -- Metadata
    billing_cycle_start DATE NOT NULL,  -- Inicio del ciclo de facturación
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### Tabla `usage_aggregates` (Rollups por Período)

```sql
CREATE TABLE usage_aggregates (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,

    -- Período
    period_type NVARCHAR(20) NOT NULL,  -- 'hourly', 'daily', 'monthly'
    period_start DATETIME2 NOT NULL,
    period_end DATETIME2 NOT NULL,

    -- Agregados por categoría
    storage_bytes_uploaded BIGINT NOT NULL DEFAULT 0,
    storage_bytes_current BIGINT NOT NULL DEFAULT 0,
    documents_processed INT NOT NULL DEFAULT 0,
    pages_extracted INT NOT NULL DEFAULT 0,
    ocr_pages_processed INT NOT NULL DEFAULT 0,
    text_embedding_tokens BIGINT NOT NULL DEFAULT 0,
    image_embeddings_count INT NOT NULL DEFAULT 0,
    vector_searches_count INT NOT NULL DEFAULT 0,
    claude_input_tokens BIGINT NOT NULL DEFAULT 0,
    claude_output_tokens BIGINT NOT NULL DEFAULT 0,
    tool_executions_count INT NOT NULL DEFAULT 0,

    -- Costos totales
    total_cost_usd DECIMAL(18,4) NOT NULL DEFAULT 0,

    -- Metadata
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),

    -- Índices
    INDEX IX_usage_aggregates_user_period (user_id, period_type, period_start),
    UNIQUE INDEX UX_usage_aggregates_unique (user_id, period_type, period_start),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### Tabla `billing_records` (Facturas Mensuales)

```sql
CREATE TABLE billing_records (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,

    -- Período de facturación
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,

    -- Plan base
    plan_id NVARCHAR(50) NOT NULL,
    plan_base_cost_usd DECIMAL(18,2) NOT NULL,

    -- Desglose de uso
    usage_breakdown NVARCHAR(MAX) NOT NULL,  -- JSON con detalle por operación

    -- Pay As You Go (sobrecargo)
    payg_cost_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
    payg_breakdown NVARCHAR(MAX) NULL,  -- JSON con detalle de excesos

    -- Totales
    subtotal_usd DECIMAL(18,2) NOT NULL,
    tax_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_usd DECIMAL(18,2) NOT NULL,

    -- Estado
    status NVARCHAR(50) NOT NULL DEFAULT 'pending',  -- 'pending', 'paid', 'failed', 'refunded'
    payment_date DATETIME2 NULL,
    payment_method NVARCHAR(100) NULL,
    payment_reference NVARCHAR(255) NULL,

    -- Timestamps
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),

    INDEX IX_billing_records_user_period (user_id, billing_period_start),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### Tabla `quota_alerts` (Alertas de Cuota)

```sql
CREATE TABLE quota_alerts (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,

    alert_type NVARCHAR(50) NOT NULL,     -- 'warning_80', 'warning_90', 'limit_reached', 'payg_started'
    quota_type NVARCHAR(100) NOT NULL,    -- 'storage', 'documents', 'embeddings', etc.

    current_usage BIGINT NOT NULL,
    limit_value BIGINT NOT NULL,
    percentage_used DECIMAL(5,2) NOT NULL,

    notification_sent BIT NOT NULL DEFAULT 0,
    notification_sent_at DATETIME2 NULL,

    created_at DATETIME2 DEFAULT GETUTCDATE(),

    INDEX IX_quota_alerts_user (user_id, created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 11.4 Modelo de Costos

#### Costos por Servicio (Azure)

| Servicio | Unidad | Costo Azure | Markup | Precio Final |
|----------|--------|-------------|--------|--------------|
| Blob Storage | GB/mes | $0.0184 | 2x | $0.04 |
| Text Embeddings | 1M tokens | $0.02 | 2x | $0.04 |
| Image Embeddings | 1,000 imágenes | $0.10 | 2x | $0.20 |
| Azure AI Search | Mes (Basic) | $73 | incluido | Plan |
| Document Intelligence | Página | $0.01 | 2x | $0.02 |
| Claude Input | 1M tokens | $3.00 | 1.5x | $4.50 |
| Claude Output | 1M tokens | $15.00 | 1.5x | $22.50 |

#### Límites por Plan

| Característica | Free | Básico ($25) | Premium ($200) | Enterprise |
|----------------|------|--------------|----------------|------------|
| Almacenamiento | 100 MB | 1 GB | 10 GB | Custom |
| Documentos/mes | 10 | 100 | 2,000 | Unlimited |
| Imágenes indexadas/mes | 50 | 500 | 10,000 | Unlimited |
| Text embedding tokens/mes | 100K | 1M | 20M | Custom |
| Image embeddings/mes | 50 | 500 | 10,000 | Unlimited |
| Búsquedas semánticas/mes | 500 | 5,000 | 50,000 | Unlimited |
| Claude input tokens/mes | 1M | 10M | 100M | Custom |
| Claude output tokens/mes | 200K | 2M | 20M | Custom |
| Pay As You Go | No | Sí | Sí | Sí |

#### Precios Pay As You Go (Sobrecargo)

| Recurso | Precio por unidad adicional |
|---------|----------------------------|
| Storage | $0.05/GB adicional |
| Documentos | $0.10/documento |
| Text embeddings | $0.05/100K tokens |
| Image embeddings | $0.25/100 imágenes |
| Búsquedas | $0.01/100 búsquedas |
| Claude input | $5.00/1M tokens |
| Claude output | $25.00/1M tokens |

### 11.5 Flujo de Tracking

```
Operación del usuario (ej: subir archivo)
         │
         ▼
┌─────────────────────────────┐
│   UsageTrackingMiddleware   │
│   - Intercepta operación    │
│   - Extrae métricas         │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│   QuotaValidatorService     │
│   - Consulta usage_aggregates│
│   - Compara con user_quotas │
│   - Si excede: PAYG o BLOCK │
└─────────────┬───────────────┘
              │
         ┌────┴────┐
         │         │
    Permitido   Bloqueado
         │         │
         ▼         ▼
┌─────────────┐  ┌─────────────────┐
│  Ejecutar   │  │  Retornar error │
│  operación  │  │  QUOTA_EXCEEDED │
└──────┬──────┘  └─────────────────┘
       │
       ▼
┌─────────────────────────────┐
│   UsageTrackingService      │
│   - INSERT en usage_events  │
│   - Emit WebSocket event    │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│   BullMQ: usage-aggregation │
│   - Update usage_aggregates │
│   - Check alert thresholds  │
│   - Create quota_alerts     │
└─────────────────────────────┘
```

### 11.6 API de Uso y Billing

```
GET  /api/usage/current                 # Uso actual del período
GET  /api/usage/history?period=monthly  # Histórico de uso
GET  /api/usage/quotas                  # Límites del usuario
GET  /api/billing/current               # Factura del período actual
GET  /api/billing/history               # Historial de facturas
GET  /api/billing/invoice/:id           # Detalle de factura específica
POST /api/billing/payg/enable           # Habilitar Pay As You Go
POST /api/billing/payg/disable          # Deshabilitar Pay As You Go
PUT  /api/billing/payg/limit            # Establecer límite de gasto PAYG
```

### 11.7 Eventos WebSocket de Uso

```typescript
// Actualización de uso en tiempo real
'usage:updated' → {
  quotaType: string,
  currentUsage: number,
  limit: number,
  percentageUsed: number
}

// Alerta de cuota
'usage:alert' → {
  alertType: 'warning_80' | 'warning_90' | 'limit_reached' | 'payg_started',
  quotaType: string,
  message: string
}

// Límite alcanzado (sin PAYG)
'usage:quota_exceeded' → {
  quotaType: string,
  action: 'blocked',
  upgradeUrl: string
}
```

---

## 12. API Reference

### 12.1 Endpoints REST

```
POST   /api/files/upload          # Subir archivo(s)
POST   /api/files/folders         # Crear carpeta
GET    /api/files                 # Listar archivos
GET    /api/files/:id             # Obtener archivo
GET    /api/files/:id/download    # Descargar archivo
DELETE /api/files/:id             # Eliminar
PATCH  /api/files/:id             # Actualizar (rename, move, favorite)
POST   /api/files/search          # Búsqueda semántica
```

### 12.2 Eventos WebSocket

```typescript
// Upload progress
'file:upload_progress' → { fileId, progress: number }

// Processing status
'file:processing_status' → { fileId, status: 'processing' | 'completed' | 'failed' }

// Embedding status
'file:embedding_status' → { fileId, status: 'processing' | 'completed' | 'failed' }
```

---

## 13. Referencias

- [Anthropic Files API](https://docs.claude.com/en/docs/build-with-claude/files)
- [Azure Multimodal Embeddings](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/concept-image-retrieval)
- [Azure AI Search Vector Search](https://learn.microsoft.com/en-us/azure/search/vector-search-overview)
- [Chunking Strategies for RAG](https://www.firecrawl.dev/blog/best-chunking-strategies-rag-2025)
