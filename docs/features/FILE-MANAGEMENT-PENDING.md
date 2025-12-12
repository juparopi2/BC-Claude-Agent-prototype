# Sistema de Archivos - Trabajo Pendiente

**Última actualización**: December 12, 2025
**Estado actual**: 2039 tests passing (backend), 288 tests passing (frontend)

Este documento consolida el trabajo pendiente del sistema de archivos. Las fases 1-5 están completas.

---

## Resumen de Estado

| Fase | Estado | Notas |
|------|--------|-------|
| Fase 1: Infraestructura | ✅ Completo | DB, Blob, API |
| Fase 1.5-1.7: Tracking | ✅ Backend completo | Frontend UI pendiente |
| Fase 2: UI Archivos | ✅ Completo | FileExplorer funcional |
| Fase 3: Procesamiento | ✅ Completo | PDF, DOCX, Excel, Text |
| Fase 4: Embeddings | ✅ Completo | Chunking, Search, FileChunkingService |
| Fase 5: Chat Integration | ✅ Completo | SemanticSearchService + CitationLink implementados |
| Fase 5.5: Sprint 1 | ✅ Completo | Citations end-to-end + FilePreviewModal |
| Fase 6: Polish | ❌ No iniciado | Thumbnails, cache |

---

## Trabajo Pendiente

### 1. Frontend: Dashboard de Uso y Billing

**Prioridad**: Media
**Dependencia**: Backend API ya existe (`/api/usage/*`, `/api/billing/*`)

```
[ ] usageStore.ts - Zustand store para estado de uso
[ ] UsageDashboard.tsx - Vista principal de métricas
[ ] QuotaProgressBar.tsx - Barra de progreso por cuota
[ ] UsageChart.tsx - Gráfico histórico de uso
[ ] BillingHistory.tsx - Lista de facturas
[ ] PaygSettings.tsx - Configuración Pay-As-You-Go
[ ] QuotaAlertBanner.tsx - Alertas de cuota en UI
[ ] UpgradeModal.tsx - Modal para upgrade de plan
```

**WebSocket Events** (backend emite, frontend debe escuchar):
```
[ ] 'usage:updated' - Actualización en tiempo real
[ ] 'usage:alert' - Alerta de cuota (80%, 90%, 100%)
[ ] 'usage:quota_exceeded' - Límite alcanzado
```

---

### 2. ✅ Búsqueda Semántica Automática (UseMyContext) - COMPLETADO

**Commit**: `88831e1` (December 12, 2025)
**Ubicación**: `DirectAgentService.ts`, `SemanticSearchService.ts`

**Implementado**:
- `SemanticSearchService` busca archivos relevantes por query
- `DirectAgentService` llama automáticamente cuando `enableAutoSemanticSearch: true`
- Threshold configurable (default: 0.7)
- Prioriza attachments manuales sobre búsqueda automática
- 12 tests unitarios en `DirectAgentService.semanticSearch.test.ts`

**API**:
```typescript
await agentService.executeQueryStreaming({
  prompt: "¿Qué dice el contrato sobre pagos?",
  enableAutoSemanticSearch: true,  // Activa búsqueda semántica
  semanticThreshold: 0.7,          // Score mínimo (opcional)
  maxSemanticFiles: 3              // Máximo archivos (opcional)
});
```

---

### 3. ✅ Frontend: CitationLink Component - COMPLETADO

**Commit**: `88831e1` (December 12, 2025)
**Ubicación**: `frontend/components/chat/CitationLink.tsx`

**Implementado**:
- Renderiza `[filename.ext]` como botones clickeables
- Iconos por tipo: PDF, Excel, imágenes, código, archivos comprimidos
- Tooltip con nombre completo
- Estado disabled para archivos no encontrados
- Integración lista con `MarkdownRenderer`

**Uso**:
```tsx
<CitationLink
  fileName="contrato.pdf"
  fileId="uuid-123"
  onOpen={(fileId) => openFilePreview(fileId)}
/>
```

---

### 4. Mejoras de UX en FileExplorer

**Prioridad**: Baja

```
[ ] 2.3.5 Drag & drop para mover archivos entre carpetas
[ ] 3.5.4 Mostrar estado de procesamiento en tiempo real
[ ] 5.1.4 Aceptar archivos desde FileExplorer al ChatInput
[ ] 5.2.4 Click en chip para preview del archivo
```

---

### 5. Fase 6: Optimización y Polish

**Prioridad**: Baja (post-MVP)

#### ✅ Vista Previa de Archivos - COMPLETADO
```
[x] Modal de preview para imágenes
[x] Preview de PDF (embed o iframe)
[x] Preview de texto/código (syntax highlight)
[x] Fallback para tipos no soportados (download)
```

#### Thumbnails
```
[ ] Generar thumbnails al subir imágenes
[ ] Almacenar en Blob (path separado)
[ ] Servir en listado de archivos
[ ] Lazy loading
```

#### Caché de Búsquedas
```
[ ] Cachear resultados por query hash (Redis)
[ ] TTL de 5 minutos
[ ] Invalidar al subir/eliminar archivos
```

#### Tests E2E
```
[ ] Test E2E: upload archivo
[ ] Test E2E: crear carpeta
[ ] Test E2E: adjuntar a chat
[ ] Test E2E: búsqueda semántica
```

---

## Pipeline E2E Verificado (December 11, 2025)

```
Upload → FileProcessingService → FILE_CHUNKING → FileChunkingService
              (text extraction)                         ↓
                                                ChunkingStrategy
                                                        ↓
                                               INSERT file_chunks
                                                        ↓
                                             EMBEDDING_GENERATION
                                                        ↓
                                               EmbeddingService
                                                        ↓
                                             Azure AI Search index
```

**Estado**: Pipeline completo implementado con FileChunkingService como eslabón entre extracción de texto y generación de embeddings.

---

## Archivos de Referencia

Si necesitas contexto sobre la arquitectura implementada:
- `backend/src/services/files/` - Servicios de archivos
- `backend/src/services/chunking/` - Estrategias de chunking
- `backend/src/services/embeddings/` - EmbeddingService
- `backend/src/services/search/` - VectorSearchService
- `backend/src/services/queue/MessageQueue.ts` - Colas BullMQ
- `frontend/components/files/` - Componentes UI de archivos

---

## Orden de Implementación Propuesto

### ✅ Sprint 1: Integración Frontend Chat - COMPLETADO
**Objetivo**: Hacer que la búsqueda semántica y citations funcionen end-to-end
**Fecha**: December 12, 2025

| # | Tarea | Estado |
|---|-------|--------|
| 1.1 | Backend: `citedFiles` en evento `complete` | ✅ Completo |
| 1.2 | Frontend: `citationFileMap` en chatStore | ✅ Completo |
| 1.3 | Frontend: MessageBubble → MarkdownRenderer wiring | ✅ Completo |
| 1.4 | Frontend: FilePreviewModal (PDF, images, text/code) | ✅ Completo |
| 1.5 | Frontend: Citation click → FilePreviewModal integration | ✅ Completo |

**Archivos modificados/creados**:
- `packages/shared/src/types/agent.types.ts` - CitedFile interface, CompleteEvent.citedFiles
- `backend/src/services/agent/DirectAgentService.ts` - Build citedFiles from fileContext
- `backend/src/services/agent/messages/MessageEmitter.ts` - emitComplete with citedFiles
- `frontend/lib/stores/chatStore.ts` - citationFileMap state + complete event handler
- `frontend/lib/stores/filePreviewStore.ts` - NEW: Zustand store for preview modal
- `frontend/components/modals/FilePreviewModal.tsx` - NEW: Preview modal component
- `frontend/components/chat/MessageBubble.tsx` - citationFileMap/onCitationOpen props
- `frontend/components/chat/ChatContainer.tsx` - handleCitationOpen → openPreview
- `frontend/components/files/FileList.tsx` - Uses FilePreviewModal

**Tests**: 59 new tests (8 backend citedFiles + 16 MessageBubble + 33 FilePreview + 6 integration)

**Entregable**: ✅ Usuario puede chatear, el agente usa archivos relevantes, las citations son clickeables y abren preview.

---

### Sprint 2: Dashboard de Uso (Media prioridad, Valor de negocio)
**Objetivo**: Visibilidad de consumo y quotas para usuarios

| # | Tarea | Esfuerzo | Dependencia |
|---|-------|----------|-------------|
| 2.1 | `usageStore.ts` - Zustand store con fetch inicial | 3h | Backend API existe |
| 2.2 | `UsageDashboard.tsx` - Vista con métricas principales | 4h | 2.1 |
| 2.3 | `QuotaProgressBar.tsx` - Barras de progreso por tipo | 2h | 2.1 |
| 2.4 | WebSocket listener para `usage:updated` y `usage:alert` | 3h | 2.1 |
| 2.5 | `QuotaAlertBanner.tsx` - Banner global de alertas | 2h | 2.4 |

**Entregable**: Usuario ve su consumo en tiempo real con alertas de cuota.

---

### ✅ Sprint 3: Preview de Archivos - COMPLETADO (merged into Sprint 1)
**Objetivo**: Ver contenido de archivos sin descargar
**Fecha**: December 12, 2025

| # | Tarea | Estado |
|---|-------|--------|
| 3.1 | `FilePreviewModal.tsx` - Modal contenedor | ✅ Completo |
| 3.2 | Preview de imágenes (inline) | ✅ Completo |
| 3.3 | Preview de PDF (embed/iframe) | ✅ Completo |
| 3.4 | Preview de texto/código (syntax highlight) | ✅ Completo |
| 3.5 | Fallback para tipos no soportados (download) | ✅ Completo |

**Entregable**: ✅ Click en archivo abre modal con preview del contenido.

---

### Sprint 4: UX FileExplorer (Baja prioridad, Nice-to-have)
**Objetivo**: Mejorar experiencia de gestión de archivos

| # | Tarea | Esfuerzo | Dependencia |
|---|-------|----------|-------------|
| 4.1 | Drag & drop para mover archivos entre carpetas | 6h | - |
| 4.2 | Estado de procesamiento en tiempo real | 4h | - |
| 4.3 | Aceptar archivos desde FileExplorer al ChatInput | 4h | Sprint 1 |
| 4.4 | Click en chip de adjunto para preview | 2h | Sprint 3 |

---

### Sprint 5: Optimización (Post-MVP)
**Objetivo**: Performance y escalabilidad

| # | Tarea | Esfuerzo | Dependencia |
|---|-------|----------|-------------|
| 5.1 | Thumbnails para imágenes (generar + Blob storage) | 6h | - |
| 5.2 | Caché de búsquedas (Redis, TTL 5min) | 4h | - |
| 5.3 | Lazy loading de thumbnails en FileExplorer | 3h | 5.1 |
| 5.4 | Tests E2E completos (upload, folder, chat, search) | 8h | Todo |

---

## Recomendación de Orden

```
Sprint 1 (1-2 días)   → ✅ COMPLETO - MVP funcional con citations
Sprint 2 (2-3 días)   → Valor de negocio (billing visibility)
Sprint 3 (1-2 días)   → ✅ COMPLETO (merged into Sprint 1) - UX mejorada (preview)
Sprint 4 (2-3 días)   → Nice-to-have
Sprint 5 (2-3 días)   → Post-MVP optimización
```

**Completado**: Sprint 1 + Sprint 3
**Siguiente recomendado**: Sprint 2 (Dashboard de Uso) o Sprint 4 (UX FileExplorer)

---

## Changelog

| Fecha | Cambio |
|-------|--------|
| 2025-12-12 | **Sprint 1 COMPLETO**: citedFiles backend, citationFileMap frontend, FilePreviewModal, citation→preview integration |
| 2025-12-12 | **Sprint 3 COMPLETO** (merged into Sprint 1): FilePreviewModal con soporte PDF, images, text/code |
| 2025-12-12 | SemanticSearchService y CitationLink implementados (commit 88831e1) |
| 2025-12-12 | Reorganizado pendientes con orden de implementación propuesto |
| 2025-12-11 | Documento creado consolidando trabajo pendiente |
| 2025-12-11 | FileChunkingService implementado (eslabón perdido del pipeline) |
