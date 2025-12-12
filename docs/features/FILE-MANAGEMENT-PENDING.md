# Sistema de Archivos - Trabajo Pendiente

**Última actualización**: December 11, 2025
**Estado actual**: 1968 tests passing

Este documento consolida el trabajo pendiente del sistema de archivos. Las fases 1-5 (backend) están completas.

---

## Resumen de Estado

| Fase | Estado | Notas |
|------|--------|-------|
| Fase 1: Infraestructura | ✅ Completo | DB, Blob, API |
| Fase 1.5-1.7: Tracking | ✅ Backend completo | Frontend UI pendiente |
| Fase 2: UI Archivos | ✅ Completo | FileExplorer funcional |
| Fase 3: Procesamiento | ✅ Completo | PDF, DOCX, Excel, Text |
| Fase 4: Embeddings | ✅ Completo | Chunking, Search, FileChunkingService |
| Fase 5: Chat Integration | ✅ Backend completo | Búsqueda automática + CitationLink pendientes |
| Fase 6: Polish | ❌ No iniciado | Preview, thumbnails, cache |

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

### 2. Búsqueda Semántica Automática (Sin Adjuntos)

**Prioridad**: Alta
**Ubicación**: `DirectAgentService.ts`

Cuando el usuario envía un mensaje SIN adjuntos manuales, el sistema debería:
1. Detectar que no hay `attachments[]`
2. Llamar `VectorSearchService.searchFiles(userId, query)`
3. Si `score > threshold` → incluir chunks como contexto
4. Agregar metadata para citations automáticas

```typescript
// Pseudocódigo en DirectAgentService.executeQueryStreaming()
if (!attachments || attachments.length === 0) {
  const relevantFiles = await vectorSearchService.searchFiles(userId, prompt);
  if (relevantFiles.some(f => f.score > SEMANTIC_THRESHOLD)) {
    // Incluir como contexto
  }
}
```

**Tareas**:
```
[ ] Definir SEMANTIC_THRESHOLD (sugerido: 0.7)
[ ] Implementar lógica en DirectAgentService
[ ] Tests unitarios para búsqueda automática
[ ] Tests de integración E2E
```

---

### 3. Frontend: CitationLink Component

**Prioridad**: Media
**Dependencia**: Backend ya parsea y persiste citations

```
[ ] CitationLink.tsx - Renderiza [filename.ext] como link clickeable
[ ] Click abre archivo en nuevo tab o modal
[ ] Tooltip con nombre completo del archivo
[ ] Estilo visual distintivo (color, icono)
```

**Regex para detectar**: `/\[([^\]]+\.[^\]]+)\]/g`

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

#### Vista Previa de Archivos
```
[ ] Modal de preview para imágenes
[ ] Preview de PDF (embed o iframe)
[ ] Preview de texto/código
[ ] Fallback para tipos no soportados
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

## Changelog

| Fecha | Cambio |
|-------|--------|
| 2025-12-11 | Documento creado consolidando trabajo pendiente |
| 2025-12-11 | FileChunkingService implementado (eslabón perdido del pipeline) |
