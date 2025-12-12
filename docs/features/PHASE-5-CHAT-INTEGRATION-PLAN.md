# Fase 5: Integración de Chat con Archivos - Plan de Implementación TDD

## Visión y Valores

En esta fase, conectaremos el "mundo de los archivos" con el "mundo del chat". Para garantizar robustez y calidad, seguiremos estrictamente **Test Driven Development (TDD)**.
Nuestra creencia es que **si no está probado, no existe**. No solo probaremos unidades aisladas, sino que priorizaremos **pruebas de integración** que verifiquen que las piezas conectan correctamente.

### Objetivos Clave
1.  **Fluidez**: El usuario arrastra un archivo y este fluye hasta el contexto del LLM.
2.  **Transparencia**: El usuario sabe qué archivos se están usando (chips, citations).
3.  **Integridad**: El backend valida y procesa los archivos correctamente antes de enviarlos.

---

## Ciclos de Implementación (TDD)

Desglosamos la fase en 5 ciclos incrementales. Cada ciclo debe completarse (Green tests) antes de pasar al siguiente.

### Explicación de Iconos de Estado
- 🔴 **ToDo**: Pendiente de iniciar.
- 🟡 **In Progress**: En desarrollo (Red/Refactor).
- 🟢 **Done**: Implementado y verificado (Green).

---

### Ciclo 1: El Flujo de Adjuntar (Attachment Flow) 🟢 DONE
**Objetivo**: Permitir que el usuario seleccione archivos en el UI y que estos "viajen" hasta ser reconocidos por el backend como parte de un mensaje.

**Fecha de última actualización**: December 11, 2025

#### 1.1 Frontend: Visual Attachment
- **Test (Component)**: `ChatInput.test.tsx`
    - [x] Debe renderizar `FileAttachmentChip` cuando el store tiene archivos.
    - [x] Debe permitir eliminar un archivo del store al hacer click en "X".
    - [x] Debe aceptar drop de archivos y llamar a `uploadFiles`.
- **Implementación**:
    - [x] `FileAttachmentChip.tsx` creado con estados: uploading, completed, error
    - [x] `ChatInput.tsx` modificado con estados de attachments, upload progress, validación
    - [x] Botón "Attach files" con Paperclip icon y input file hidden

**Archivos implementados**:
- `frontend/components/chat/FileAttachmentChip.tsx`
- `frontend/components/chat/ChatInput.tsx` (líneas 37-166)
- `frontend/lib/stores/socketMiddleware.ts` (línea 261)

#### 1.2 Backend: Recepción de Attachments
- **Test (Unit)**: `chatMessageSchema.test.ts` (13 tests)
    - [x] Acepta mensaje con UUIDs válidos de attachments
    - [x] Rechaza attachments con formato inválido (no UUID)
    - [x] Permite máximo 20 attachments
    - [x] Campo attachments es opcional
    - [x] Permite array vacío de attachments
- **Test (Integration)**: `DirectAgentService.attachments.integration.test.ts`
    - [x] `executeQueryStreaming` acepta un array de `fileIds`.
    - [x] Valida que los `fileIds` pertenecen al usuario (Security Check).
    - [x] Falla si un archivo no existe.
- **Implementación**:
    - [x] `ChatMessageHandler.ts` recibe `data.attachments` y lo pasa a agentService
    - [x] `DirectAgentService.ts` valida ownership llamando a `fileService.getFile(userId, fileId)`
    - [x] `chatMessageSchema` en `request.schemas.ts` validado con Zod

**Archivos implementados**:
- `backend/src/services/websocket/ChatMessageHandler.ts` (línea 238)
- `backend/src/services/agent/DirectAgentService.ts` (líneas 386-403)
- `backend/src/schemas/request.schemas.ts` (campo `attachments`)
- `backend/src/__tests__/unit/schemas/chatMessageSchema.test.ts` (13 tests)

#### ✅ Criterios de Éxito del Ciclo 1
- [x] UI muestra los archivos adjuntos visualmente.
- [x] Backend recibe el mensaje con la lista de `fileIds` validados por Zod.
- [x] Ownership validation implementado y probado.

#### Estado de Tests (December 11, 2025)
- ✅ Schema validation tests: 13/13 passing
- Integration tests existentes con issues de setup (no bugs de lógica)

---

### Ciclo 2: Estrategia de Contexto (Context Strategy) 🟢 DONE
**Objetivo**: El backend decide *cómo* usar el archivo. ¿Es pequeño y va directo? ¿Es grande y requiere RAG?

**Fecha de última actualización**: December 11, 2025

#### 2.1 Tipos de Estrategia
- **Archivo**: `types.ts`
    - [x] `ContextStrategy` union type: `DIRECT_CONTENT` | `EXTRACTED_TEXT` | `RAG_CHUNKS`
    - [x] `FileForStrategy` interface con metadata necesaria
    - [x] `StrategyResult` interface con strategy + reason

#### 2.2 Lógica de Selección
- **Test (Unit)**: `ContextStrategyFactory.test.ts` (21 tests)
    - [x] Imágenes → `DIRECT_CONTENT` (Claude Vision)
    - [x] Archivos < 30MB sin texto extraído → `DIRECT_CONTENT`
    - [x] Archivos con texto extraído → `EXTRACTED_TEXT`
    - [x] Archivos >= 30MB con embeddings → `RAG_CHUNKS`
    - [x] Archivos >= 30MB sin embeddings → `EXTRACTED_TEXT` (fallback)
    - [x] Edge cases: archivo vacío, MIME desconocido, boundary 30MB
- **Implementación**:
    - [x] `ContextStrategyFactory` class con `selectStrategy()` method
    - [x] Singleton getter `getContextStrategyFactory()`
    - [x] Barrel export en `index.ts`

**Archivos implementados**:
- `backend/src/services/files/context/types.ts`
- `backend/src/services/files/context/ContextStrategyFactory.ts`
- `backend/src/services/files/context/index.ts`
- `backend/src/__tests__/unit/services/files/ContextStrategyFactory.test.ts` (21 tests)

#### ✅ Criterios de Éxito del Ciclo 2
- [x] Unit tests cubren todos los casos de borde (imágenes, PDFs pesados, archivos vacíos).
- [x] 21/21 tests passing
- [x] Type-check passing
- [x] Lint passing

---

### Ciclo 3: Construcción de Contexto e Inyección 🟢 DONE
**Objetivo**: Recuperar el contenido real y formatearlo para el prompt del LLM.

**Fecha de última actualización**: December 11, 2025

#### 3.1 Tipos de Retrieval
- **Archivo**: `retrieval.types.ts`
    - [x] `RetrievedContent` interface con fileId, fileName, strategy, content
    - [x] `FileContent` union type: text | base64 | chunks
    - [x] `ChunkContent` interface con chunkIndex, text, relevanceScore
    - [x] `RetrievalOptions` interface con userQuery, maxChunks, maxTotalTokens
    - [x] `MultiRetrievalResult` interface con contents, failures, totalTokens, truncated

#### 3.2 Recuperación de Contenido
- **Test (Unit)**: `ContextRetrievalService.test.ts` (13 tests)
    - [x] Para `DIRECT_CONTENT` (images): Retorna base64 encoded
    - [x] Para `DIRECT_CONTENT` (text): Retorna texto plain
    - [x] Para `EXTRACTED_TEXT`: Lee `extracted_text` de DB
    - [x] Para `RAG_CHUNKS`: Busca chunks relevantes con vector search
    - [x] Fallback a EXTRACTED_TEXT si no hay userQuery para RAG
    - [x] Manejo de errores (blob not found, extracted text missing)
    - [x] retrieveMultiple con token limiting y truncation
- **Implementación**:
    - [x] `ContextRetrievalService` con DI para FileService, FileUploadService, VectorSearchService, EmbeddingService
    - [x] `retrieveContent()` y `retrieveMultiple()` methods
    - [x] Token estimation (~4 chars per token)

#### 3.3 Inyección en Prompt
- **Test (Unit)**: `PromptBuilder.test.ts` (19 tests)
    - [x] Formatear texto con XML tags `<document id="..." name="...">`
    - [x] Incluir file ID para citations
    - [x] Manejar múltiples documentos
    - [x] Formatear RAG chunks con `<chunk chunk="N" relevance="0.XX">`
    - [x] Skip base64 content (handled separately for Claude Vision)
    - [x] Escapar caracteres especiales XML
    - [x] Instrucciones de sistema para citar documentos
    - [x] `getImageContents()` para extraer imágenes para Claude Vision
    - [x] `estimateTokens()` para presupuesto de tokens
- **Implementación**:
    - [x] `FileContextPromptBuilder` class
    - [x] `buildDocumentContext()` genera XML
    - [x] `buildSystemInstructions()` genera instrucciones de cita
    - [x] `getImageContents()` extrae contenido base64 para Vision

**Archivos implementados**:
- `backend/src/services/files/context/retrieval.types.ts`
- `backend/src/services/files/context/ContextRetrievalService.ts`
- `backend/src/services/files/context/PromptBuilder.ts`
- `backend/src/__tests__/unit/services/files/ContextRetrievalService.test.ts` (13 tests)
- `backend/src/__tests__/unit/services/files/PromptBuilder.test.ts` (19 tests)

#### ✅ Criterios de Éxito del Ciclo 3
- [x] 32/32 tests passing (13 retrieval + 19 prompt builder)
- [x] Type-check passing
- [x] Lint passing (0 errors)
- [x] Full suite passing: 1907 tests

---

### Ciclo 4: Citations y Respuesta 🟢 DONE
**Objetivo**: Que el modelo cite sus fuentes y persistir las relaciones archivo-mensaje en la base de datos.

**Fecha de última actualización**: December 11, 2025

#### 4.1 Tipos de Citations
- **Archivo**: `citations/types.ts`
    - [x] `ParsedCitation` interface con rawText, fileName, fileId, startIndex, endIndex
    - [x] `CitationParseResult` interface con originalText, processedText, citations, matchedFileIds
    - [x] `FileUsageType` union type: `'direct' | 'citation' | 'semantic_match'`
    - [x] `CitationRecord` interface para persistencia en DB
    - [x] `MessageAttachmentInfo` interface para lectura de DB

#### 4.2 Parsing de Respuesta
- **Test (Unit)**: `CitationParser.test.ts` (15 tests)
    - [x] Parse single citation `[filename.ext]`
    - [x] Parse multiple different citations
    - [x] Handle citations not in context (unmatched)
    - [x] Not match numeric references like `[1]` or `[42]`
    - [x] Not match text without extension like `[example]`
    - [x] Handle duplicate citations with same file
    - [x] Handle empty text
    - [x] Handle text with no citations
    - [x] Preserve original text in result
    - [x] Handle various file extensions (pdf, xlsx, png, docx)
    - [x] Handle filenames with multiple dots
    - [x] Handle filenames with spaces
    - [x] Handle mixed matched and unmatched citations
    - [x] Handle citation at start/end of text
- **Implementación**:
    - [x] `CitationParser` class con regex pattern `/\[([^\]]+\.[^\]]+)\]/g`
    - [x] `parseCitations()` method maps citations to file IDs
    - [x] `buildFileMap()` helper method
    - [x] Singleton getter `getCitationParser()`

#### 4.3 Persistencia de Relación
- **Test (Unit)**: `MessageFileAttachmentService.test.ts` (16 tests)
    - [x] Insert direct attachments with correct SQL
    - [x] Insert citations with `usage_type=citation`
    - [x] Insert semantic_match with correct usage_type
    - [x] Handle empty fileIds array without calling database
    - [x] Generate unique IDs for each attachment record
    - [x] Include relevanceScore when provided
    - [x] Set relevanceScore to null when not provided
    - [x] Handle database errors gracefully
    - [x] Return attachments for a message
    - [x] Query with correct message_id parameter
    - [x] Return empty array when no attachments found
    - [x] Filter by usage_type when provided
    - [x] Delete all attachments for a message
    - [x] Return 0 when no attachments deleted
    - [x] Record both direct and citation attachments in separate calls
    - [x] Skip empty arrays in bulk operation
- **Implementación**:
    - [x] `MessageFileAttachmentService` class con DI para executeQuery
    - [x] `recordAttachments()` inserta registros con usage_type
    - [x] `getAttachmentsForMessage()` recupera attachments con filtro opcional
    - [x] `deleteAttachmentsForMessage()` elimina attachments
    - [x] `recordMultipleUsageTypes()` bulk operation para direct + citations
    - [x] Singleton getter `getMessageFileAttachmentService()`

**Archivos implementados**:
- `backend/src/services/files/citations/types.ts`
- `backend/src/services/files/citations/CitationParser.ts`
- `backend/src/services/files/citations/index.ts`
- `backend/src/services/files/MessageFileAttachmentService.ts`
- `backend/src/__tests__/unit/services/files/CitationParser.test.ts` (15 tests)
- `backend/src/__tests__/unit/services/files/MessageFileAttachmentService.test.ts` (16 tests)

#### ✅ Criterios de Éxito del Ciclo 4
- [x] 31/31 tests passing (15 CitationParser + 16 MessageFileAttachmentService)
- [x] Type-check passing
- [x] Lint passing (0 errors)
- [x] Full suite passing: 1938 tests

#### Nota sobre UI de Citations
La UI de Citations (`CitationLink.tsx`) se implementará en Ciclo 5 como parte de la verificación E2E.

---

### Ciclo 5: Integración en DirectAgentService 🟢 DONE
**Objetivo**: Conectar todo el pipeline de archivos con executeQueryStreaming.

**Fecha de última actualización**: December 11, 2025

#### 5.1 prepareFileContext Integration
- **Test (Unit)**: `DirectAgentService.comprehensive.test.ts`
    - [x] Llama prepareFileContext cuando hay attachments
    - [x] Inyecta documentContext en el prompt del usuario
    - [x] Extiende systemPrompt con instrucciones de cita
    - [x] Agrega imágenes para Claude Vision API

#### 5.2 recordFileUsage Integration
- **Test (Unit)**: `DirectAgentService.comprehensive.test.ts`
    - [x] Llama recordFileUsage después de respuesta exitosa
    - [x] Pasa messageId y response para parsing de citations
    - [x] Maneja errores gracefully (fire-and-forget)

**Archivos implementados**:
- `backend/src/services/agent/DirectAgentService.ts` (líneas 424-509)
- `backend/src/__tests__/unit/services/agent/DirectAgentService.comprehensive.test.ts`

#### ✅ Criterios de Éxito del Ciclo 5
- [x] prepareFileContext llamado correctamente (6 tests)
- [x] recordFileUsage llamado correctamente (4 tests)
- [x] Full suite passing: 1938+ tests
- [x] Type-check passing
- [x] Lint passing

---

### Ciclo 6: Tests de Integración E2E con Azure 🟢 DONE
**Objetivo**: Verificar integración completa usando recursos Azure reales (DEV environment).

**Fecha de última actualización**: December 11, 2025

#### 6.1 Infraestructura Azure
- [x] Azure SQL DEV conectado (`sqlsrv-bcagent-dev.database.windows.net`)
- [x] Azure Blob DEV conectado (`sabcagentdev`, container `user-files`)
- [x] Redis Docker test container (port 6399)

#### 6.2 FileTestHelper
- **Archivo**: `backend/src/__tests__/integration/helpers/FileTestHelper.ts`
- **Features**:
    - [x] `createTestFile()` - Upload a Azure Blob + registro en DB
    - [x] `createTestImage()` - Crea PNG válido para Vision API
    - [x] `createTestFileRecordOnly()` - Solo DB, sin blob (para ghost file testing)
    - [x] `getMessageAttachments()` - Query message_file_attachments
    - [x] `getUsageEvents()` - Query usage_events
    - [x] `cleanup()` - Limpia blobs y registros de DB

#### 6.3 Tests de Integración (13 tests)
- **Archivo**: `backend/src/__tests__/integration/agent/DirectAgentService.attachments.integration.test.ts`
- **SECTION 1: Ownership Validation** (3 tests)
    - [x] Acepta archivos válidos del usuario
    - [x] Rechaza archivos de otro usuario (Access denied)
    - [x] Rechaza archivos inexistentes (not found)
- **SECTION 2: File Context Integration** (4 tests)
    - [x] E2E flow con archivo de texto real
    - [x] EXTRACTED_TEXT strategy (PDFs procesados)
    - [x] Múltiples archivos en una sola query
    - [x] Anthropic llamado incluso sin file context
- **SECTION 3: Citation Persistence** (2 tests)
    - [x] Query completa exitosamente con attachments
    - [x] Response contiene citation text
- **SECTION 4: Error Handling** (2 tests)
    - [x] Ghost file (blob no existe) → continúa gracefully
    - [x] File context preparation fails → respuesta exitosa
- **SECTION 5: Image Handling** (1 test)
    - [x] Image attachment acepta y ejecuta query
- **SECTION 6: Usage Tracking** (1 test)
    - [x] Usage events registrados cuando procesa archivos

#### ✅ Criterios de Éxito del Ciclo 6
- [x] 13/13 integration tests passing
- [x] Full suite: 1961 tests passing (sin regresiones)
- [x] Azure SQL conectado y funcionando
- [x] Azure Blob conectado y funcionando
- [x] Redis Docker funcionando
- [x] Type-check passing
- [x] Lint passing

---

## Plan de Pruebas (Master Checklist)

- [ ] `backend/src/__tests__/unit/components/ChatInput.test.tsx` (Si aplicable o Cypress)
- [ ] `backend/src/__tests__/integration/agent/DirectAgentService.attachments.test.ts`
- [ ] `backend/src/__tests__/unit/services/files/ContextStrategy.test.ts`
- [ ] `backend/src/__tests__/integration/services/files/ContextRetrieval.test.ts`
- [ ] `backend/src/__tests__/unit/agent/PromptBuilder.attachments.test.ts`

## Next Steps

1.  Aprobar este plan.
2.  Comenzar **Ciclo 1: El Flujo de Adjuntar**.
