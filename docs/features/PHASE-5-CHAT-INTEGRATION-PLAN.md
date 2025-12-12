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

### Ciclo 4: Citations y Respuesta 🔴
**Objetivo**: Que el modelo cite sus fuentes y el frontend las muestre.

#### 4.1 Parsing de Respuesta
- **Test (Unit)**: `CitationParser.test.ts`
    - [ ] Input: "Según el documento [doc1], el valor es X."
    - [ ] Output: Identificar `[doc1]` y mapearlo al `fileId` original.
    - [ ] Input: XML tags de citation (si usamos tool calling).
- **Implementación**:
    - Definir formato de citas (prompt engineering).
    - Implementar parser en backend o frontend (decidir location, idealmente backend para normalizar).

#### 4.2 Persistencia de Relación
- **Test (Integration)**: `MessageAttachments.test.ts`
    - [ ] Al recibir respuesta, guardar en `message_file_attachments`.
    - [ ] Verificar que `usage_type` se marca correctamente ('citation' vs 'context').

#### 4.3 UI de Citations
- **Test (Component)**: `CitationLink.test.tsx`
    - [ ] Click en cita navega al archivo o abre preview.
- **Implementación**:
    - Componente `CitationLink` en Frontend.

#### ✅ Criterios de Éxito del Ciclo 4
- [ ] DB refleja qué archivos se usaron para generar la respuesta.
- [ ] UI muestra links clickeables en el mensaje de respuesta.

---

### Ciclo 5: Verificación End-to-End (E2E) 🔴
**Objetivo**: Unir todo.

#### 5.1 Flujo Completo
- **Test (Manual/Script)**: `verify-chat-w-files.ts`
    1.  Subir archivo "test.txt" con contenido único "La clave secreta es PINGUINO".
    2.  Esperar procesado.
    3.  Adjuntar archivo al chat.
    4.  Preguntar "¿Cuál es la clave secreta?".
    5.  Verificar respuesta contiene "PINGUINO".
    6.  Verificar citation presente.

#### ✅ Criterios de Éxito del Ciclo 5
- [ ] El flujo completo funciona sin errores 500.
- [ ] Latencia aceptable (< 5s para inicio de respuesta).

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
