# Evolución de la Arquitectura de Búsqueda: Multimodal + Agentic Retrieval

> **Fecha**: 2026-03-23
> **Estado**: Análisis y Recomendación
> **Alcance**: Pipeline de búsqueda RAG, búsqueda de imágenes, Azure Agentic Retrieval

---

## 1. Estado Actual del Sistema

### Arquitectura de Embeddings Existente

| Componente | Modelo | Dimensiones | Estado |
|---|---|---|---|
| **Text Embeddings** | OpenAI `text-embedding-3-small` | 1536 | Producción |
| **Image Embeddings** | Azure Vision `VectorizeImage` | 1024 | Producción |
| **Image Query (text→image)** | Azure Vision `VectorizeText` | 1024 | Producción |
| **Image Captions** | Azure Vision Image Analysis API | N/A (texto) | Producción |

### Índice de Azure AI Search (`file-chunks-index`)

| Campo | Tipo | Dims | Propósito |
|---|---|---|---|
| `contentVector` | Collection(Single) | 1536 | Embedding de texto (OpenAI) |
| `imageVector` | Collection(Single) | 1024 | Embedding de imagen (Vision) |
| `content` | String | — | Texto extraído o caption de imagen |
| `isImage` | Boolean | — | Discriminador texto/imagen |
| `userId` | String | — | Aislamiento multi-tenant |
| `fileStatus` | String | — | Soft-delete (`deleting`) |

**Perfiles vectoriales**: Dos HNSW separados — `hnsw-profile` (texto 1536d) y `hnsw-profile-image` (imagen 1024d).

### Infraestructura Provisionada

- **Azure AI Search**: Basic tier, West Europe
- **Azure OpenAI**: S0, text-embedding-3-small (120K TPM dev / 200K TPM prod)
- **Azure Computer Vision**: S1, West Europe
- **Azure Document Intelligence**: S0, East US (OCR para PDFs)
- **IaC**: Bicep con módulos (`cognitive.bicep`, `data.bicep`)

### Pipeline de Indexación Actual

```
Upload → FILE_PROCESSING (extrae texto/imagen) → FILE_CHUNKING (512 tokens, 50 overlap)
  ├─ Texto → EMBEDDING_GENERATION (text-embedding-3-small) → Azure AI Search (contentVector)
  └─ Imagen → VectorizeImage (1024d) → Azure AI Search (imageVector)
               + Image Analysis (caption) → content field + contentVector
```

### Capacidades de Búsqueda Actuales

| Tipo de búsqueda | Implementado | Cómo funciona |
|---|---|---|
| Texto → Texto | ✅ | Hybrid search (keyword + contentVector) + Semantic Ranker |
| Texto → Imagen | ✅ | VectorizeText genera vector 1024d, busca en imageVector |
| Imagen → Imagen | ✅ Parcial | Embedding almacenado, pero no hay tool del agente para recibir imagen como query |
| Caption search | ✅ | Captions indexadas como `content`, buscables por texto |
| Multi-tenant | ✅ | `userId eq '{ID}'` en todo query |

---

## 2. Azure Agentic Retrieval — Evaluación

### Qué es
Pipeline de multi-query en Azure AI Search que usa un LLM (gpt-4o/4.1/5) para descomponer preguntas complejas en subqueries paralelas, ejecutarlas contra múltiples knowledge sources, y fusionar resultados con semantic reranking.

### Qué aporta vs lo actual

| Capacidad | Sistema actual | Con Agentic Retrieval |
|---|---|---|
| Query decomposition | Manual (1 query) | Automática (LLM genera ~3 subqueries) |
| Chat history context | No integrado en search | LLM usa historial para contextualizar |
| Multi-source search | 1 índice | Múltiples knowledge sources en paralelo |
| Spell correction / synonyms | No | Incluido en query planning |
| Answer synthesis | No (solo chunks) | Opcional — respuesta con citas |
| Query planning control | Total | Automático (no customizable) |

### Limitaciones críticas para MyWorkMate

1. **Preview sin SLA** — `2025-11-01-preview`. Sin fecha de GA (marzo 2026). Breaking changes entre versiones.
2. **Solo texto como input de query** — El query planner NO puede recibir imágenes. No soporta "buscar imágenes similares a esta foto".
3. **Modelos LLM limitados** — Solo gpt-4o, gpt-4.1, gpt-5 para query planning. No Claude.
4. **Semantic ranker incompatible con nested multi-vector** — Si usas campos vectoriales complejos (nested), el semantic ranker no funciona.
5. **Latencia adicional** — ~2-3 segundos extra por query planning LLM.
6. **Costo dual** — Azure AI Search tokens + Azure OpenAI tokens para query planning.
7. **`filterAddOn` funciona** — `userId eq 'X'` se aplica a TODAS las subqueries. Multi-tenant seguro.

### Veredicto: NO migrar a Agentic Retrieval ahora

**Razones:**
- Preview con breaking changes activos — riesgo para producción
- No resuelve el caso de uso de image-as-query (búsqueda visual)
- Agrega costo y latencia por un query planning que podemos implementar nosotros con Claude
- El Supervisor agent ya hace routing inteligente — la descomposición de queries se puede hacer en el RAG agent

**Monitorear para futuro:**
- Cuando llegue a GA con SLA
- Si agregan soporte para image queries
- Si agregan soporte para modelos no-OpenAI en query planning

---

## 3. Modelos Multimodales de Embeddings — Evaluación

### Modelos evaluados

| Modelo | Dims | Modalidades | Azure | Estado | Precio |
|---|---|---|---|---|---|
| **Azure AI Vision** | 1024 | Texto + Imagen | ✅ Nativo | **GA** | $0.014/1K text, $0.10/1K img |
| **Cohere Embed v4** | 256-1536 | Texto + Imagen + Interleaved | ✅ AI Foundry | **GA** | ~$0.12/MTok |
| **Gemini Embedding 2** | 768-3072 | Texto + Imagen + Audio + Video | ❌ Solo Google | Preview | $0.20/MTok |
| **Amazon Titan MM** | 256-1024 | Texto + Imagen | ❌ Solo AWS | GA | $0.0008/1K tok |
| **OpenAI CLIP** | 512-768 | Texto + Imagen | ❌ Self-host | Open source | Infra propia |
| **OpenAI text-embedding-3** | 1536-3072 | Solo texto | ✅ | GA | $0.02-0.13/MTok |

### Análisis: ¿Unificar en un solo modelo multimodal?

#### Opción A: Modelo unificado (Azure Vision para todo)
- **Pro**: Un solo espacio vectorial, cross-modal nativo, arquitectura simple
- **Contra**: Texto limitado a 70 palabras, 1024d — **significativamente peor para RAG textual** vs text-embedding-3-small (8K tokens, 1536d)
- **Veredicto**: ❌ Inaceptable para RAG de documentos de negocio

#### Opción B: Modelo unificado (Cohere Embed v4)
- **Pro**: 128K tokens, 1536d, multimodal nativo, interleaved text+image
- **Contra**: Azure limita a un tipo de input por request. Requiere migrar TODOS los embeddings. Sin vectorizer nativo en AI Search.
- **Veredicto**: ⚠️ Prometedor pero requiere migración completa y cambio de vectorizer

#### Opción C: Dual-model mejorado (Recomendado)
- Mantener text-embedding-3-small (1536d) para RAG textual de alta calidad
- Mantener Azure Vision (1024d) para búsqueda visual
- Mejorar el pipeline de captions para bridge text↔image
- Agregar tools del agente para image-as-query
- **Veredicto**: ✅ **Mejor relación costo/beneficio/riesgo**

---

## 4. Arquitectura Recomendada: Evolución Incremental

### Fase 1: Mejoras al sistema actual (sin cambio de modelos)

#### 1.1 Image Search Tool para el agente RAG

Agregar un tool dedicado `searchImagesTool` que permita al agente RAG:
- Buscar imágenes por descripción textual (text→image via VectorizeText)
- Buscar imágenes similares a una imagen referenciada (image→image via embedding almacenado)
- Filtrar por tipo MIME, fecha, scope

```typescript
// Nuevo tool: searchImagesTool
{
  name: 'searchImages',
  description: 'Search for images by visual description or similarity to another image',
  parameters: {
    query: z.string().describe('Visual description of what to find'),
    similarToFileId: z.string().optional().describe('Find images visually similar to this file'),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }
}
```

#### 1.2 Mejora de Image Captions con LLM

Reemplazar Azure Vision Image Analysis captions (genéricos) con captions generadas por Claude/GPT-4o:
- Descripciones más ricas y contextuales
- Incluir colores, objetos, texto en imagen (OCR visual), composición
- Indexar caption extendida en `content` para mejor bridge text↔image

#### 1.3 Image Comparison Tool

Tool que permite al usuario comparar dos archivos/imágenes:

```typescript
{
  name: 'compareFiles',
  description: 'Compare two files or images visually or by content',
  parameters: {
    fileId1: z.string(),
    fileId2: z.string(),
    comparisonType: z.enum(['visual', 'content', 'both']),
  }
}
```

### Fase 2: Optimización del pipeline de embeddings

#### 2.1 Azure Vision Vectorizer nativo en AI Search

Configurar el vectorizer `aiServicesVision` directamente en el índice para que Azure AI Search pueda vectorizar queries automáticamente:

```json
{
  "vectorizers": [
    {
      "name": "openai-vectorizer",
      "kind": "azureOpenAI",
      "azureOpenAIParameters": {
        "resourceUri": "https://<openai>.openai.azure.com/",
        "deploymentId": "text-embedding-3-small",
        "modelName": "text-embedding-3-small"
      }
    },
    {
      "name": "vision-vectorizer",
      "kind": "aiServicesVision",
      "aiServicesVisionParameters": {
        "resourceUri": "https://<vision>.cognitiveservices.azure.com/",
        "modelVersion": "2023-04-15"
      }
    }
  ]
}
```

**Beneficio**: Habilita query-time vectorization integrada. Necesario si en el futuro adoptamos Agentic Retrieval.

#### 2.2 Mejorar caption embeddings

Actualmente las imágenes tienen caption como `content` y opcionalmente `contentVector` (embedding del caption). Asegurar que **todas** las imágenes tengan:
- `imageVector` (1024d) — para búsqueda visual
- `contentVector` (1536d del caption) — para búsqueda semántica por texto
- `content` (caption enriquecido) — para keyword search y semantic ranker

### Fase 3: Evaluación de Cohere Embed v4 (futuro)

#### Cuándo evaluar
- Si Azure AI Foundry mejora la integración (vectorizer nativo para Cohere)
- Si necesitamos embeddings de documentos interleaved (PDF pages con texto+imágenes como unidad)
- Si la calidad de texto RAG con Cohere v4 (1536d) iguala o supera a text-embedding-3-small

#### Qué evaluaría
- Quality benchmark: Cohere v4 1536d vs text-embedding-3-small 1536d en nuestros documentos
- Cross-modal quality: Cohere v4 text→image vs Azure Vision text→image
- Costo total: Cohere vs OpenAI + Vision separados
- Complejidad de migración: re-embed todos los documentos

### Fase 4: Agentic Retrieval (futuro, post-GA)

#### Cuándo adoptar
- Cuando Azure Agentic Retrieval alcance GA con SLA
- Prerequisito: vectorizers nativos ya configurados (Fase 2.1)
- Prerequisito: semantic configuration validada

#### Qué aportaría
- Query decomposition automática para preguntas complejas
- Chat history como contexto de búsqueda
- Answer synthesis con citas directas
- MCP endpoint para integración con otros agentes

#### Qué mantendríamos
- El índice `file-chunks-index` sin cambios
- El pipeline de indexación sin cambios
- Los tools del agente RAG como fallback/complemento
- Multi-tenant via `filterAddOn`

---

## 5. Tools del Agente RAG — Definición Propuesta

### Inventario actual
| Tool | Estado | Propósito |
|---|---|---|
| `searchKnowledgeTool` | ✅ Existe | Búsqueda unificada texto + imagen |

### Inventario propuesto

| Tool | Estado | Propósito |
|---|---|---|
| `searchKnowledge` | ✅ Mantener | Búsqueda semántica de documentos (texto RAG) |
| `searchImages` | 🆕 Nuevo | Búsqueda visual por descripción o similitud |
| `compareFiles` | 🆕 Nuevo | Comparación visual/contenido entre archivos |
| `getFileDetails` | 🆕 Evaluar | Obtener metadatos + preview de un archivo específico |

### Flujo de decisión del agente

```
User query → Supervisor → RAG Agent
  ├─ "busca documentos sobre ventas Q4" → searchKnowledge(query, fileType: 'documents')
  ├─ "encuentra imágenes con carros rojos" → searchImages(query: 'carros rojos')
  ├─ "busca imágenes parecidas a este archivo" → searchImages(similarToFileId: 'FILE-UUID')
  ├─ "compara estos dos archivos" → compareFiles(fileId1, fileId2)
  └─ "busca todo sobre el proyecto X" → searchKnowledge(query) + searchImages(query)
```

---

## 6. Impacto en Infraestructura

### Fase 1 — Sin cambios de infraestructura
- Solo cambios de código (tools del agente, mejora de captions)
- Usa recursos ya provisionados (Azure Vision S1, OpenAI)

### Fase 2 — Cambio menor en index schema
- Agregar vectorizers al índice via script (`update-search-index-schema.sh`)
- **NO requiere re-indexar** documentos existentes
- Script actualizado:

```bash
# Agregar a update-search-index-schema.sh
"vectorizers": [
  {
    "name": "openai-vectorizer",
    "kind": "azureOpenAI",
    ...
  },
  {
    "name": "vision-vectorizer",
    "kind": "aiServicesVision",
    ...
  }
]
```

### Fase 3-4 — Evaluación futura
- Cohere: requeriría agregar Azure AI Foundry endpoint en `cognitive.bicep`
- Agentic Retrieval: requeriría crear Knowledge Base + Knowledge Source (REST API, no Bicep)

---

## 7. Estimación de Costos

### Costos actuales (estimados)

| Recurso | Costo/mes (dev) | Costo/mes (prod) |
|---|---|---|
| Azure AI Search (Basic) | ~$70 | ~$70 |
| OpenAI Embeddings (text-embedding-3-small) | ~$2-5 | ~$10-20 |
| Azure Vision (S1) | ~$10-15 | ~$20-50 |
| Semantic Ranker | Incluido en Basic+ | Incluido |

### Costos adicionales por fase

| Fase | Costo adicional |
|---|---|
| Fase 1 (tools + captions LLM) | +$5-15/mes (Claude/GPT-4o para captions mejoradas) |
| Fase 2 (vectorizers) | $0 (configuración, no consumo nuevo) |
| Fase 3 (Cohere eval) | +$20-50 uno-vez (benchmark) |
| Fase 4 (Agentic Retrieval) | +$5-15/mes (LLM query planning) + $0.022/MTok (search tokens) |

---

## 8. Decisiones Pendientes

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| 1 | ¿Mejorar captions con LLM? | Claude / GPT-4o / mantener Vision API | GPT-4o (menor latencia, ya provisionado) |
| 2 | ¿Agregar `searchImages` tool ya? | Sí / Esperar Agentic Retrieval | Sí — valor inmediato, independiente |
| 3 | ¿Configurar vectorizers nativos? | Ahora / Con Agentic Retrieval | Ahora — prerequisito y mejora independiente |
| 4 | ¿Evaluar Cohere v4? | Ahora / Q3 2026 | Q3 2026 — esperar mejor integración Azure |
| 5 | ¿Image-as-query input en UI? | Upload / Clipboard / Referencia archivo | Referencia archivo (simpler, ya están indexados) |

---

## 9. Resumen Ejecutivo

### Situación
El sistema ya tiene una arquitectura de búsqueda multimodal funcional con text embeddings (1536d) e image embeddings (1024d) en espacios vectoriales separados. Azure Agentic Retrieval ofrece query decomposition automatizada pero está en preview sin SLA.

### Recomendación
**Evolución incremental** en 4 fases, no migración disruptiva:

1. **Ahora**: Agregar tools especializados (searchImages, compareFiles) + mejorar captions con LLM
2. **Corto plazo**: Configurar vectorizers nativos en el índice
3. **Medio plazo**: Evaluar Cohere Embed v4 cuando mejore la integración Azure
4. **Futuro**: Adoptar Agentic Retrieval cuando alcance GA

### Por qué no unificar a un solo modelo multimodal ahora
- Azure Vision (1024d, 70 palabras max) es **insuficiente** para RAG textual de documentos de negocio
- Cohere v4 requiere migración completa y no tiene vectorizer nativo en AI Search
- La arquitectura dual actual es la recomendada por Microsoft para producción

### Valor inmediato sin riesgo
Los tools `searchImages` y `compareFiles` se pueden implementar **con la infraestructura existente**, sin cambiar modelos ni migrar datos. El usuario obtiene capacidad de búsqueda visual inmediata.
