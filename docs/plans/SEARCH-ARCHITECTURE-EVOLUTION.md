# RAG Agent: Estabilización y Optimización de Tools

> **Fecha**: 2026-03-24
> **Estado**: ~~Propuesta de implementación~~ → **Superseded by [RAG Agent Stabilization PRDs](./rag-agent-stabilization/00-INDEX.md)**
> **Alcance**: Consolidación de tools del agente RAG, eliminación de ambiguedades, quick wins
>
> **NOTA**: Este documento fue la investigación inicial. El plan de ejecución completo, incluyendo Power Search Tool, Cohere Embed 4, y búsqueda avanzada, está en [`docs/plans/rag-agent-stabilization/`](./rag-agent-stabilization/00-INDEX.md).

---

## 1. Resumen Ejecutivo de la Investigación

Se investigaron tres líneas para evolucionar la búsqueda:

1. **Azure Agentic Retrieval**: Preview sin SLA ni fecha de GA. Solo soporta texto como input (no imágenes). Requiere modelos OpenAI exclusivamente para query planning. Agrega latencia y costo sin resolver nuestros casos de uso clave. **Descartado.**

2. **Migración a modelo multimodal unificado**: Azure Vision (1024d, 70 palabras max) es insuficiente para RAG textual. Cohere Embed v4 requiere migración total sin vectorizer nativo en AI Search. Ningún modelo multimodal iguala a text-embedding-3-small para documentos de negocio. **Descartado.**

3. **Optimización del stack actual**: La arquitectura dual (text-embedding-3-small 1536d + Azure Vision 1024d) ya es la recomendada por Microsoft para producción. El foco debe ser **estabilizar los tools del agente**, no cambiar modelos. **Aprobado.**

**Conclusión**: No migrar. Invertir en que el agente RAG use correctamente lo que ya tiene.

---

## 2. Problema Actual: Ambiguedad entre Tools

### Tools actuales (3)

| Tool | Propósito | Modo de búsqueda |
|---|---|---|
| `search_knowledge` | Búsqueda general + filtros por tipo/fecha | Texto (1536d + Semantic Ranker) |
| `visual_image_search` | Búsqueda visual por descripción | Imagen (1024d, sin Semantic Ranker) |
| `find_similar_images` | Imágenes similares a una referencia | Imagen-a-imagen (vector puro 1024d) |

### El problema de ambiguedad

Cuando el usuario dice **"busca fotos de carros rojos"**, el LLM tiene dos opciones válidas:

1. `search_knowledge(query: "carros rojos", fileTypeCategory: "images")` — busca imágenes cuyo **caption textual** mencione "carros rojos" (modo texto)
2. `visual_image_search(query: "carros rojos")` — busca imágenes que **visualmente se parezcan** a carros rojos (modo imagen)

El system prompt intenta resolver esto con reglas como "use visual_image_search when describing WHAT images look like" vs "use search_knowledge when browsing images". Pero esta distinción es subjetiva y el LLM frecuentemente elige mal.

**Resultado**: El agente a veces usa la tool incorrecta, o peor, no usa ninguna de las dos porque no puede decidir.

---

## 3. Propuesta: Consolidar a 2 Tools Sin Ambiguedad

### Regla de diseño

El criterio de decisión debe ser **la naturaleza del input**, no la intención inferida:

- **Input = texto** → `search_knowledge` (siempre)
- **Input = referencia a imagen existente** → `find_similar_images` (siempre)

### Tool 1: `search_knowledge` (unificado)

Absorbe `visual_image_search`. Cuando `fileTypeCategory: 'images'`, el service layer automáticamente usa **modo imagen** (1024d, sin Semantic Ranker). Cuando es cualquier otra categoría o sin filtro, usa **modo texto** (1536d + Semantic Ranker).

```typescript
// Cambio en la implementación (NO en el schema del tool)
const searchMode = fileTypeCategory === 'images' ? 'image' : 'text';
const maxFiles = fileTypeCategory === 'images' ? 10 : 5;

const results = await searchService.searchRelevantFiles({
  userId,
  query,
  maxFiles,
  threshold: SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER,
  filterMimeTypes: mimeTypes ? [...mimeTypes] : undefined,
  searchMode, // <-- automático basado en fileTypeCategory
  dateFilter: ...,
  additionalFilter: ...,
});
```

**Descripcion propuesta del tool:**

```
Search the user's knowledge base for relevant files. Returns documents with
citations and relevance scores.

Use fileTypeCategory to narrow results:
- 'documents': PDF, Word, TXT, Markdown files
- 'spreadsheets': Excel, CSV files
- 'images': JPEG, PNG, GIF, WebP (automatically uses visual similarity matching)
- 'code': JSON, JS, HTML, CSS files

When searching for images, describe the visual content (colors, objects, scenes).
When searching for documents, describe the information you need.
```

**Schema** (sin cambios al schema actual — solo cambia la implementación):

```typescript
z.object({
  query: z.string().describe(
    'Search query. For documents: describe the information needed. ' +
    'For images: describe visual content (e.g., "red truck", "organizational chart", "damaged parts").'
  ),
  fileTypeCategory: z.enum(['images', 'documents', 'spreadsheets', 'code']).optional()
    .describe(
      'Filter by file type. When set to "images", search uses visual similarity matching. ' +
      'Omit for cross-type search.'
    ),
  dateFrom: z.string().optional()
    .describe('ISO date (YYYY-MM-DD). Only return files modified from this date onward.'),
  dateTo: z.string().optional()
    .describe('ISO date (YYYY-MM-DD). Only return files modified up to this date.'),
})
```

### Tool 2: `find_similar_images` (sin cambios)

Se mantiene exactamente como está. Su input es fundamentalmente diferente: **una referencia a una imagen existente** (fileId o chatAttachmentId), no un texto.

```
Find images visually similar to a specific reference image.
Use ONLY when the user points to an existing image and wants similar ones.
Requires either a fileId (from @mention or previous search results)
or a chatAttachmentId (from an image attached to the chat).
```

### Matriz de decisión (cero ambiguedad)

| Escenario del usuario | Tool | Parámetros |
|---|---|---|
| "busca documentos sobre ventas Q4" | `search_knowledge` | `query: "ventas Q4"` |
| "busca archivos de enero" | `search_knowledge` | `query: "*", dateFrom: "2026-01-01", dateTo: "2026-01-31"` |
| "busca hojas de cálculo de presupuesto" | `search_knowledge` | `query: "presupuesto", fileTypeCategory: "spreadsheets"` |
| "busca fotos de carros rojos" | `search_knowledge` | `query: "carros rojos", fileTypeCategory: "images"` |
| "muestra mis imágenes" | `search_knowledge` | `query: "*", fileTypeCategory: "images"` |
| "busca imágenes de partes dañadas" | `search_knowledge` | `query: "damaged parts", fileTypeCategory: "images"` |
| "busca imágenes parecidas a @foto.jpg" | `find_similar_images` | `fileId: "UUID-from-mention"` |
| "encuentra fotos similares a la que te adjunté" | `find_similar_images` | `chatAttachmentId: "attachment-id"` |

**Regla simple para el LLM**: Si el usuario tiene una imagen de referencia → `find_similar_images`. En todo otro caso → `search_knowledge`.

---

## 4. System Prompt Propuesto

```
You are the Knowledge Base specialist within MyWorkMate.

TOOLS (2 tools):
1. search_knowledge — Search files by text query. Supports filtering by file type and date range.
   - For images: set fileTypeCategory to "images" and describe what the images look like
   - For documents/spreadsheets/code: describe the information you need
   - For date filtering: use dateFrom/dateTo with a broad query like "*"

2. find_similar_images — Find images similar to a SPECIFIC reference image.
   - Use ONLY when the user references an existing image (via @mention or chat attachment)
   - Requires fileId (from mention's id attribute) or chatAttachmentId

DECISION RULE:
- User has a reference image → find_similar_images
- Everything else → search_knowledge

EXECUTION RULES:
1. MUST call a tool for EVERY message. NEVER answer from training data.
2. If no results found, say so and suggest uploading relevant documents.
3. Always cite source documents (fileName + relevant excerpts).
4. Can call tools multiple times to refine results.

PARAMETER TIPS:
- @MENTIONED FILES: Use the UUID from <mention id="..."> attribute, NEVER the filename
- @MENTIONED FOLDERS: Search is automatically scoped — no special action needed
- DATE SEARCHES: Use query "*" with dateFrom/dateTo (semantic query not needed for pure date filtering)
- COMBINED FILTERS: Can combine date + fileTypeCategory in one call
```

---

## 5. Quick Wins — Implementación Inmediata

### 5.1 Merge `visual_image_search` en `search_knowledge` (code change)

**Archivo**: `backend/src/modules/agents/rag-knowledge/tools.ts`

**Cambio**: En `searchKnowledgeTool`, detectar `fileTypeCategory === 'images'` y pasar `searchMode: 'image'` + `maxFiles: 10` al service.

**Impacto**: Eliminar `visualImageSearchTool` y su registro. Reducir tools de 3 a 2.

**Esfuerzo**: ~30 min. Sin cambios en servicios de búsqueda, schema del índice, ni frontend.

### 5.2 Actualizar system prompt del agente RAG

**Archivo**: `backend/src/modules/agents/core/definitions/rag-agent.definition.ts`

**Cambio**: Reemplazar con el prompt propuesto en sección 4. Mucho más corto, sin ambiguedad.

**Esfuerzo**: ~15 min.

### 5.3 Actualizar registro de tools en el agente

**Archivo**: `backend/src/modules/agents/rag-knowledge/rag-agent.ts` (o donde se registren los tools)

**Cambio**: Remover `visualImageSearchTool` del array de tools del agente.

**Esfuerzo**: ~5 min.

### 5.4 Mejorar descripción de `find_similar_images`

**Cambio**: Hacer la descripción más explícita sobre cuándo usarlo.

```typescript
description:
  'Find images visually similar to a SPECIFIC reference image that the user has pointed to. ' +
  'Use ONLY when the user references an existing image (via @mention or chat attachment) ' +
  'and wants to find similar ones. Do NOT use for text-based image searches — ' +
  'use search_knowledge with fileTypeCategory "images" instead.'
```

**Esfuerzo**: ~5 min.

### 5.5 Agregar vectorizers nativos al índice de Azure AI Search

**Archivo**: `infrastructure/scripts/update-search-index-schema.sh`

**Cambio**: Agregar configuración de vectorizers al schema del índice. No cambia el comportamiento de búsqueda actual, pero habilita query-time vectorization integrada.

```json
{
  "vectorizers": [
    {
      "name": "openai-vectorizer",
      "kind": "azureOpenAI",
      "azureOpenAIParameters": {
        "resourceUri": "https://<openai-resource>.openai.azure.com/",
        "deploymentId": "text-embedding-3-small",
        "modelName": "text-embedding-3-small"
      }
    },
    {
      "name": "vision-vectorizer",
      "kind": "aiServicesVision",
      "aiServicesVisionParameters": {
        "resourceUri": "https://<vision-resource>.cognitiveservices.azure.com/",
        "modelVersion": "2023-04-15"
      }
    }
  ]
}
```

**Esfuerzo**: ~1 hora (script + validación en dev).

**Beneficio**: Azure AI Search puede vectorizar queries sin pasar por nuestro código. Prerequisito si en el futuro se adopta Agentic Retrieval o cualquier feature que requiera integrated vectorization.

---

## 6. Validación Post-Implementación

### Tests unitarios a agregar/modificar

1. **`search_knowledge` con `fileTypeCategory: 'images'`** — verificar que se pasa `searchMode: 'image'` y `maxFiles: 10`
2. **`search_knowledge` sin `fileTypeCategory`** — verificar que se mantiene `searchMode: 'text'` y `maxFiles: 5`
3. **`search_knowledge` con `fileTypeCategory: 'documents'`** — verificar modo texto con filtro MIME

### Escenarios de aceptación

| Input del usuario | Tool llamado | searchMode | Resultado esperado |
|---|---|---|---|
| "busca fotos de gatos" | `search_knowledge(images)` | `image` | Imágenes visualmente similares a gatos |
| "busca documentos de ventas" | `search_knowledge(documents)` | `text` | PDFs/DOCXs sobre ventas |
| "busca archivos de enero" | `search_knowledge(*)` | `text` | Todos los archivos de enero |
| "busca imágenes parecidas a @car.jpg" | `find_similar_images` | vector puro | Imágenes visualmente similares |
