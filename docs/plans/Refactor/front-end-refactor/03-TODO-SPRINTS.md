# TODO: Sprints del Refactor Frontend

**Fecha de Inicio**: 2025-12-25
**Estado**: En Progreso
**Filosofía**: Test-Driven Development (TDD)

---

## Principios de Desarrollo

### Documentación Sin Referencias al Pasado

> **REGLA CRÍTICA**: Al escribir código nuevo, documentar como si fuera código original.
> NO mencionar migraciones, refactors, ni código anterior.

```typescript
// ❌ PROHIBIDO - Referencias al pasado
/**
 * Reemplaza chatStore.handleAgentEvent()
 * Migrado del archivo anterior durante Sprint 2.
 * Antes esto estaba en un solo archivo grande.
 */

// ✅ CORRECTO - Documentación limpia
/**
 * Procesa eventos del agente y actualiza los stores correspondientes.
 * Soporta 16 tipos de eventos incluyendo streaming y tools.
 *
 * @param event - Evento recibido del WebSocket
 * @example
 * streamProcessor.processEvent(messageChunkEvent);
 */
```

**Justificación**:
- El código debe ser autoexplicativo sin contexto histórico
- Nuevos desarrolladores no necesitan saber "cómo era antes"
- Evita confusión sobre qué es legacy y qué es actual
- Mantiene la documentación limpia y profesional

### Gestión de Código Deprecated

1. **Durante el refactor**: Marcar con `@deprecated` + JSDoc explicando el reemplazo
2. **Post-refactor**: Eliminar completamente en Sprint 7
3. **Nunca**: Dejar código comentado "por si acaso"

```typescript
// Durante el refactor - OK temporalmente
/**
 * @deprecated Usar `streamingStore.appendMessageChunk()` en su lugar.
 * Este método será eliminado en Sprint 7.
 */
appendStreamContent(content: string): void { ... }

// Post-refactor - El método NO existe, fue eliminado
```

---

## Estrategia de Testing

### Principio Guía: "Un Query, Múltiples Validaciones"

Consumir tokens de API real de forma eficiente: un único mensaje al agente que valide toda la cadena de eventos.

```
┌─────────────────────────────────────────────────────────┐
│  MEGA-TEST E2E: Un query que valida:                    │
├─────────────────────────────────────────────────────────┤
│ ✓ session_start llega                                   │
│ ✓ user_message_confirmed con sequenceNumber             │
│ ✓ thinking_chunk* acumulados (si Extended Thinking)     │
│ ✓ thinking_complete antes de message_chunk              │
│ ✓ message_chunk* ordenados por eventIndex               │
│ ✓ message final con contenido completo                  │
│ ✓ tool_use → tool_result correlacionados                │
│ ✓ complete termina el flujo                             │
│ ✓ Page refresh reconstruye toda la conversación         │
│ ✓ sequenceNumber presente en eventos persistidos        │
└─────────────────────────────────────────────────────────┘
```

### Thresholds de Coverage

| Área | Threshold | Justificación |
|------|-----------|---------------|
| **Global** | 70% | Estándar industria para desarrollo activo |
| **Stores** | 90% | Críticos para integridad de datos |
| **Services** | 80% | Lógica de negocio importante |
| **Components** | 70% | Balance UX vs esfuerzo |

### Estructura de Tests E2E (Híbrido)

| Tipo | Propósito | Consumo Tokens |
|------|-----------|----------------|
| **Mega-test Happy Path** | Valida flujo completo con 1 query | Bajo |
| **Tests Edge Cases** | Errores, timeouts, edge cases | Separados |
| **Tests de Files** | Upload, embeddings, búsqueda | Separados |

### Stack de Testing

- **Unit/Integration**: Vitest + React Testing Library
- **Mocking**: MSW (HTTP) + socketMock.ts (Socket.IO)
- **E2E**: Playwright con API real
- **Factories**: AgentEventFactory.ts (16 tipos)

---

## Leyenda de Estados

```
[ ] Pendiente
[~] En progreso
[x] Completado
[!] Bloqueado
```

---

## Sprint 1: Infrastructure + Testing Foundation ✅ COMPLETADO

**Objetivo**: Establecer fundación sólida de testing e iniciar extracción de infrastructure layer.

**Estado**: ✅ **COMPLETADO** (2025-12-25)
**Auditoría QA**: APROBADO - 338/338 tests pasando, 54.27% coverage

### Pre-requisitos
- [x] Documentación completada (00, 01, 02)
- [x] Vitest configurado
- [x] MSW configurado

### Entregables

#### 1.1 Completar Tests de ChatInput ✅
- [x] **Test**: `__tests__/components/chat/ChatInput.test.tsx` (22 tests)
  - [x] Test de envío de mensaje (6 tests)
  - [x] Test de file attachments (5 tests)
  - [x] Test de toggles (thinking, semantic search) (4 tests)
  - [x] Test de keyboard shortcuts (Enter, Shift+Enter)
- [x] Coverage: >80% del componente

#### 1.2 Crear Mega-test E2E de Chat ✅
- [x] **Test**: `e2e/frontend/chat-complete-flow.spec.ts` (3 tests, 216 LOC)
  - [x] Un único mensaje que active Extended Thinking
  - [x] Validar secuencia completa de eventos
  - [x] Validar page refresh reconstruye mensajes
  - [x] Validar thinking aparece antes de mensaje
- [x] Usar helpers reutilizables

#### 1.3 Extraer SocketClient ✅
- [x] **Test (TDD)**: `__tests__/infrastructure/socket/SocketClient.test.ts` (19 tests)
  - [x] Test de conexión
  - [x] Test de joinSession con session:ready (Gap #11 fix)
  - [x] Test de sendMessage
  - [x] Test de reconexión
- [x] **Código**: `src/infrastructure/socket/SocketClient.ts` (385 LOC)
  - [x] Extraer de `lib/services/socket.ts`
  - [x] Implementar patrón Promise para session:ready
- [x] Coverage: >90%

#### 1.4 Crear EventRouter ✅
- [x] **Test (TDD)**: `__tests__/infrastructure/socket/eventRouter.test.ts` (13 tests)
  - [x] Test de routing a stores correctos
  - [x] Test de filtrado por sessionId
  - [x] Test de ignorar eventos post-complete (Gap #6 fix)
- [x] **Código**: `src/infrastructure/socket/eventRouter.ts` (113 LOC)
- [x] Coverage: >90%

#### 1.5 Corrección: TRANSIENT_EVENT_TYPES a shared ✅
- [x] Mover `TRANSIENT_EVENT_TYPES` a `@bc-agent/shared` (single source of truth)
- [x] Exportar `isTransientEventType` desde shared
- [x] Frontend importa de shared (no define localmente)

### Tests de Validación del Sprint
- [x] `npm run test` pasa (338/338)
- [x] Coverage global > 50% (actual: 54.27%)
- [x] E2E mega-test pasa

### Criterios de Aceptación
- [x] ChatInput.test.tsx completado (22 tests, sin skips)
- [x] Mega-test E2E funcional (3 tests)
- [x] SocketClient extraído con tests (385 LOC, 19 tests)
- [x] EventRouter creado con tests (113 LOC, 13 tests)
- [x] No hay regresiones en tests existentes
- [x] Gap #6 y #11 implementados
- [x] Tipos alineados con @bc-agent/shared

---

## Sprint 2: Chat Domain - Stores 🔄 EN PROGRESO

**Objetivo**: Dividir `chatStore.ts` (711 LOC) en 3 stores especializados y corregir gaps P0.

**Estado**: Fase 1-2 completadas, Fase 3 (migración) pendiente
**Fecha de Inicio**: 2025-12-25

### Pre-requisitos
- [x] Sprint 1 completado (2025-12-25)
- [x] Tests del Sprint 1 pasan (338/338)

### Entregables

#### 2.1 Crear messageStore ✅
- [x] **Test (TDD)**: `__tests__/domains/chat/stores/messageStore.test.ts` (17 tests)
  - [x] Test de addMessage con sorting
  - [x] Test de updateMessage
  - [x] Test de optimistic messages
  - [x] Test de confirmOptimisticMessage (Gap #4 fix)
- [x] **Código**: `src/domains/chat/stores/messageStore.ts` (~190 LOC)
- [x] Patrón Singleton con Reset

#### 2.2 Crear streamingStore ✅
- [x] **Test (TDD)**: `__tests__/domains/chat/stores/streamingStore.test.ts` (18 tests)
  - [x] Test de appendMessageChunk con eventIndex (Gap #1 prep)
  - [x] Test de multi-block thinking con blockIndex (Gap #5 prep)
  - [x] Test de markComplete e ignorar chunks tardíos (Gap #6 fix)
  - [x] Test de reset limpia acumuladores (Gap #10 fix)
- [x] **Código**: `src/domains/chat/stores/streamingStore.ts` (~180 LOC)
- [x] Patrón Singleton con Reset

#### 2.3 Crear approvalStore ✅
- [x] **Test (TDD)**: `__tests__/domains/chat/stores/approvalStore.test.ts` (11 tests)
  - [x] Test de addPendingApproval
  - [x] Test de removePendingApproval
  - [x] Test de clearPendingApprovals
- [x] **Código**: `src/domains/chat/stores/approvalStore.ts` (~100 LOC)
- [x] Selector getPendingApprovalsArray con sorting

#### 2.4 Corregir Gaps P0 ✅ (en nuevos stores)
- [x] **Gap #4**: ID mismatch - matching por tempId + timestamp fallback (5s window)
- [x] **Gap #6**: isComplete flag ignora late chunks
- [x] **Gap #10**: reset() limpia todos los acumuladores

#### 2.5 Migrar componentes 🔄 PENDIENTE
- [ ] Actualizar ChatContainer.tsx → useMessageStore
- [ ] Actualizar ChatInput.tsx → useMessageStore, useStreamingStore
- [ ] Actualizar ThinkingDisplay.tsx → useStreamingStore
- [ ] Actualizar socketMiddleware.ts → nuevos stores
- [ ] Eliminar chatStore.ts

### Tests de Validación del Sprint
- [x] `npm run test` pasa (384/384 tests)
- [x] 46 tests nuevos para stores
- [x] Gaps P0 testeados
- [ ] Migración de componentes completa

### Criterios de Aceptación
- [x] 3 stores nuevos funcionando (messageStore, streamingStore, approvalStore)
- [x] Gaps #4, #6, #10 implementados
- [x] 46 tests nuevos pasando
- [ ] chatStore.ts eliminado
- [ ] Componentes migrados

---

## Sprint 3: Chat Domain - Services y Hooks

**Objetivo**: Crear StreamProcessor y hooks que encapsulan la lógica de stores.

**Duración Estimada**: 1 semana

### Pre-requisitos
- [ ] Sprint 2 completado
- [ ] Stores nuevos funcionando

### Entregables

#### 3.1 Crear StreamProcessor
- [ ] **Test (TDD)**: `__tests__/domains/chat/services/streamProcessor.test.ts`
  - [ ] Test de processEvent para cada tipo (16 tipos)
  - [ ] Test de flujo completo (session_start → complete)
  - [ ] Test de ignorar eventos post-complete
  - [ ] Test de multi-block thinking
- [ ] **Código**: `src/domains/chat/services/streamProcessor.ts` (~120 LOC)
- [ ] Coverage: >85%

#### 3.2 Crear useMessages Hook
- [ ] **Test (TDD)**: `__tests__/domains/chat/hooks/useMessages.test.ts`
  - [ ] Test de sortedMessages (memoizado)
  - [ ] Test de isEmpty
  - [ ] Test de re-render solo cuando cambian mensajes
- [ ] **Código**: `src/domains/chat/hooks/useMessages.ts` (~40 LOC)
- [ ] Coverage: >80%

#### 3.3 Crear useStreaming Hook
- [ ] **Test (TDD)**: `__tests__/domains/chat/hooks/useStreaming.test.ts`
  - [ ] Test de accumulatedContent
  - [ ] Test de thinkingBlocks (multi-block)
  - [ ] Test de isStreaming state
- [ ] **Código**: `src/domains/chat/hooks/useStreaming.ts` (~50 LOC)
- [ ] Coverage: >80%

#### 3.4 Crear useSendMessage Hook
- [ ] **Test (TDD)**: `__tests__/domains/chat/hooks/useSendMessage.test.ts`
  - [ ] Test de crear mensaje optimista
  - [ ] Test de llamar socketClient.sendMessage
  - [ ] Test de manejar error de envío
- [ ] **Código**: `src/domains/chat/hooks/useSendMessage.ts` (~60 LOC)
- [ ] Coverage: >80%

#### 3.5 Integration Tests de Flujos
- [ ] **Test**: `__tests__/domains/chat/integration/chatFlow.test.ts`
  - [ ] Flujo simple: mensaje → chunks → message → complete
  - [ ] Flujo con thinking: thinking_chunk* → message_chunk* → complete
  - [ ] Flujo con tool: tool_use → tool_result → message
  - [ ] Page refresh: reconstruir desde API

### Tests de Validación del Sprint
- [ ] `npm run test:unit` pasa
- [ ] `npm run test:integration` pasa
- [ ] Coverage global > 70%
- [ ] Hooks funcionando con stores nuevos

### Criterios de Aceptación
- [ ] StreamProcessor maneja 16 tipos de eventos
- [ ] Hooks encapsulan acceso a stores
- [ ] Integration tests prueban flujos completos
- [ ] No lógica en componentes (solo hooks)

---

## Sprint 4: Presentation Layer

**Objetivo**: Simplificar componentes de chat usando hooks, agregar component tests.

**Duración Estimada**: 1 semana

### Pre-requisitos
- [ ] Sprint 3 completado
- [ ] Hooks funcionando

### Entregables

#### 4.1 Refactorizar ChatInputBar
- [ ] **Test**: `__tests__/presentation/chat/ChatInputBar.test.tsx`
  - [ ] Test de render con/sin disabled
  - [ ] Test de submit con Enter
  - [ ] Test de submit con botón
  - [ ] Test de textarea expand
- [ ] **Código**: `src/presentation/chat/ChatInputBar.tsx` (~120 LOC)
  - [ ] Extraer de ChatInput.tsx
  - [ ] Usar hooks en lugar de store directo
- [ ] Coverage: >80%

#### 4.2 Crear AttachmentPreview
- [ ] **Test**: `__tests__/presentation/chat/AttachmentPreview.test.tsx`
  - [ ] Test de render lista de archivos
  - [ ] Test de remove file
  - [ ] Test de preview image
- [ ] **Código**: `src/presentation/chat/AttachmentPreview.tsx` (~60 LOC)
- [ ] Coverage: >80%

#### 4.3 Crear ThinkingBlock
- [ ] **Test**: `__tests__/presentation/chat/ThinkingBlock.test.tsx`
  - [ ] Test de render streaming
  - [ ] Test de collapse/expand
  - [ ] Test de multi-block rendering
- [ ] **Código**: `src/presentation/chat/ThinkingBlock.tsx` (~80 LOC)
- [ ] Coverage: >80%

#### 4.4 Crear StreamingIndicator
- [ ] **Test**: `__tests__/presentation/chat/StreamingIndicator.test.tsx`
  - [ ] Test de render con contenido
  - [ ] Test de typing animation
  - [ ] Test de cursor blinking
- [ ] **Código**: `src/presentation/chat/StreamingIndicator.tsx` (~40 LOC)
- [ ] Coverage: >80%

#### 4.5 E2E Visual Validation
- [ ] **Test**: `e2e/frontend/chat-visual.spec.ts`
  - [ ] Screenshot de streaming en progreso
  - [ ] Screenshot de thinking block
  - [ ] Screenshot de tool execution card
  - [ ] Comparación visual (opcional)

### Tests de Validación del Sprint
- [ ] `npm run test:unit` pasa
- [ ] `npm run test:e2e` pasa
- [ ] Coverage componentes > 70%
- [ ] No lógica en componentes

### Criterios de Aceptación
- [ ] ChatInput dividido en componentes pequeños
- [ ] Componentes solo renderizan (no lógica)
- [ ] Component tests completos
- [ ] E2E visual funciona

---

## Sprint 5: Files Domain

**Objetivo**: Dividir `fileStore.ts` (916 LOC) y crear tests de archivos.

**Duración Estimada**: 1.5 semanas

### Pre-requisitos
- [ ] Sprint 4 completado
- [ ] Chat domain funcionando

### Entregables

#### 5.1 Crear fileListStore
- [ ] **Test (TDD)**: `__tests__/domains/files/stores/fileListStore.test.ts`
  - [ ] Test de setFiles
  - [ ] Test de addFile
  - [ ] Test de deleteFile
  - [ ] Test de sorteo
- [ ] **Código**: `src/domains/files/stores/fileListStore.ts` (~80 LOC)
- [ ] Coverage: >90%

#### 5.2 Crear uploadStore
- [ ] **Test (TDD)**: `__tests__/domains/files/stores/uploadStore.test.ts`
  - [ ] Test de startUpload
  - [ ] Test de updateProgress
  - [ ] Test de completeUpload
  - [ ] Test de failUpload
- [ ] **Código**: `src/domains/files/stores/uploadStore.ts` (~100 LOC)
- [ ] Coverage: >90%

#### 5.3 Crear folderTreeStore
- [ ] **Test (TDD)**: `__tests__/domains/files/stores/folderTreeStore.test.ts`
  - [ ] Test de navigate
  - [ ] Test de createFolder
  - [ ] Test de breadcrumb
- [ ] **Código**: `src/domains/files/stores/folderTreeStore.ts` (~70 LOC)
- [ ] Coverage: >90%

#### 5.4 E2E de Files
- [ ] **Test**: `e2e/frontend/files-upload.spec.ts`
  - [ ] Upload de archivo
  - [ ] Verificar embeddings creados
  - [ ] Buscar archivo con semantic search
  - [ ] Adjuntar archivo a mensaje
- [ ] **Test**: `e2e/frontend/files-folder.spec.ts`
  - [ ] Crear carpeta
  - [ ] Mover archivo
  - [ ] Navegar árbol

### Tests de Validación del Sprint
- [ ] `npm run test:unit` pasa
- [ ] Coverage stores files > 90%
- [ ] E2E de files pasan

### Criterios de Aceptación
- [ ] fileStore.ts dividido en 3+ stores
- [ ] Upload funciona con progress tracking
- [ ] Embeddings verificados en E2E
- [ ] Backward compatibility mantenida

---

## Sprint 6: Polish & Gaps Restantes

**Objetivo**: Corregir gaps P2/P3, mejorar performance, documentar.

**Duración Estimada**: 1 semana

### Pre-requisitos
- [ ] Sprint 5 completado
- [ ] Todos los tests pasan

### Entregables

#### 6.1 Corregir Gaps P2
- [ ] **Gap #2**: persistenceState en UI
  - [ ] Test de indicador visual
  - [ ] Componente PersistenceIndicator
- [ ] **Gap #7**: turn_paused UI
  - [ ] Test de estado paused
  - [ ] UI de pausa
- [ ] **Gap #11**: session:ready antes de enviar
  - [ ] Test de await joinSession
  - [ ] Implementar Promise pattern

#### 6.2 Corregir Gaps P3
- [ ] **Gap #3**: correlationId para debugging
  - [ ] Almacenar en eventos
  - [ ] Dev tools filtering
- [ ] **Gap #8**: Sorting unificado
  - [ ] Eliminar duplicación
  - [ ] Un solo selector memoizado
- [ ] **Gap #12**: Tipos alineados con @bc-agent/shared
  - [ ] Audit de tipos
  - [ ] Mover a shared si necesario

#### 6.3 Paginación de Mensajes
- [ ] **Test**: `__tests__/domains/chat/hooks/usePagination.test.ts`
  - [ ] Test de loadMore
  - [ ] Test de cursor-based pagination
- [ ] **Código**: `src/domains/chat/hooks/usePagination.ts`
- [ ] **API**: Usar params `?limit=50&cursor=...`

#### 6.4 Performance Audit
- [ ] Verificar memoization de selectores
- [ ] Verificar re-renders innecesarios
- [ ] Lazy loading de componentes pesados

#### 6.5 Documentación
- [ ] Actualizar CLAUDE.md con nueva arquitectura
- [ ] README de domains/
- [ ] README de infrastructure/

### Tests de Validación del Sprint
- [ ] Todos los tests pasan
- [ ] Coverage global > 70%
- [ ] Coverage stores > 90%
- [ ] No hay gaps P0/P1 abiertos

### Criterios de Aceptación
- [ ] Todos los 12 gaps cerrados
- [ ] Performance verificada
- [ ] Documentación actualizada
- [ ] Código production-ready

---

## Sprint 7: Cleanup - Eliminación de Código Deprecated

**Objetivo**: Eliminar todo el código legacy marcado como deprecated y validar que el sistema funciona sin él.

**Duración Estimada**: 3-5 días

**IMPORTANTE**: Este sprint SOLO se ejecuta cuando todos los anteriores están 100% completos.

### Pre-requisitos
- [ ] Sprint 6 completado
- [ ] Todos los tests pasan (unit, integration, E2E)
- [ ] `npm run build` exitoso
- [ ] Review manual de funcionalidad crítica completado

### Entregables

#### 7.1 Verificación Pre-Eliminación
- [ ] Ejecutar verificación de imports deprecated:
  ```bash
  grep -r "from '@/lib/stores/" frontend/src/
  grep -r "from '@/lib/services/" frontend/src/
  grep -r "from '@/components/chat/ChatInput'" frontend/src/
  ```
- [ ] Confirmar: 0 resultados de imports deprecated
- [ ] Ejecutar suite completa de tests
- [ ] Verificar build production

#### 7.2 Eliminar Carpeta lib/stores/
- [ ] **Archivos a eliminar**:
  - [ ] `lib/stores/chatStore.ts` (711 LOC)
  - [ ] `lib/stores/fileStore.ts` (916 LOC)
  - [ ] `lib/stores/socketMiddleware.ts` (~150 LOC)
  - [ ] `lib/stores/index.ts` (si existe)
- [ ] **Tests a eliminar**:
  - [ ] `__tests__/stores/chatStore.test.ts`
  - [ ] `__tests__/stores/fileStore.test.ts`
  - [ ] (Mantener tests que fueron MOVIDOS, no duplicados)
- [ ] Verificar que tests pasan post-eliminación

#### 7.3 Eliminar Carpeta lib/services/
- [ ] **Archivos a eliminar**:
  - [ ] `lib/services/socket.ts` (395 LOC)
  - [ ] `lib/services/api.ts` (406 LOC)
  - [ ] `lib/services/chatApi.ts` (~200 LOC)
  - [ ] `lib/services/fileApi.ts` (563 LOC)
  - [ ] `lib/services/index.ts` (si existe)
- [ ] **Tests a eliminar**:
  - [ ] `__tests__/services/socket.test.ts`
  - [ ] `__tests__/services/api.test.ts`
  - [ ] (Mantener integration tests ADAPTADOS)
- [ ] Verificar que tests pasan post-eliminación

#### 7.4 Eliminar/Mover Componentes Legacy
- [ ] **Archivos a eliminar** (ya reemplazados):
  - [ ] `components/chat/ChatInput.tsx` (368 LOC)
  - [ ] `components/chat/ChatContainer.tsx` (~200 LOC)
- [ ] **Archivos a MOVER** (no eliminar, reubicar):
  - [ ] Otros componentes de `components/chat/` → `presentation/chat/`
- [ ] Verificar que build y tests pasan

#### 7.5 Consolidar Tipos
- [ ] Eliminar tipos duplicados en `lib/types/`
- [ ] Verificar que todos los tipos vienen de:
  - `@bc-agent/shared` (compartidos)
  - `domains/*/types/` (específicos de dominio)
- [ ] Eliminar `lib/types/` si está vacía

#### 7.6 Validación Final
- [ ] `npm run test` - Todos pasan
- [ ] `npm run test:e2e` - Todos pasan
- [ ] `npm run build` - Exitoso, sin warnings de imports
- [ ] `npm run lint` - Sin errores
- [ ] `npm run verify:types` - Sin errores de tipos
- [ ] Prueba manual de flujos críticos:
  - [ ] Enviar mensaje y recibir respuesta
  - [ ] Extended Thinking funciona
  - [ ] Tool execution funciona
  - [ ] Upload de archivo funciona
  - [ ] Page refresh reconstruye mensajes

### Commits de Eliminación

```bash
# Commit 1: Eliminar stores legacy
git add -A && git commit -m "chore: remove deprecated lib/stores/ (replaced by domains/)"

# Commit 2: Eliminar services legacy
git add -A && git commit -m "chore: remove deprecated lib/services/ (replaced by infrastructure/)"

# Commit 3: Eliminar/mover componentes
git add -A && git commit -m "chore: remove deprecated chat components (replaced by presentation/)"

# Commit 4: Consolidar tipos
git add -A && git commit -m "chore: consolidate types into domains/ and shared package"
```

### Criterios de Aceptación
- [ ] Carpeta `lib/stores/` eliminada
- [ ] Carpeta `lib/services/` eliminada
- [ ] Componentes legacy eliminados
- [ ] 0 imports de rutas deprecated
- [ ] Todos los tests pasan
- [ ] Build production exitoso
- [ ] **LOC eliminados**: ~3,500+ líneas de código legacy

---

## Métricas de Progreso

### Por Sprint

| Sprint | Estado | Coverage | Tests | Gaps Cerrados |
|--------|--------|----------|-------|---------------|
| 1 | [x] ✅ | 54.27% | 338/338 | 2/2 (Gap #6, #11) |
| 2 | [~] 🔄 | ~60% | 384/384 | 3/3 (Gap #4, #6, #10) |
| 3 | [ ] | -% | -/- | 0/0 |
| 4 | [ ] | -% | -/- | 0/0 |
| 5 | [ ] | -% | -/- | 0/0 |
| 6 | [ ] | -% | -/- | 0/9 |
| 7 | [ ] | -% | -/- | Cleanup |

### Totales

- **God Files Eliminados**: 0/6 (chatStore.ts pendiente de eliminar)
- **Gaps Cerrados**: 5/12 (Gap #4, #6 x2, #10, #11)
- **Coverage Global**: 50% → ~60%
- **Coverage Stores**: Nuevos stores ~90%+
- **LOC Máximo por Archivo**: 916 (fileStore.ts, no modificado aún)
- **LOC Legacy Eliminados**: 0 (pendiente migración)
- **LOC Infrastructure Nuevo**: 595 (SocketClient + EventRouter + types)
- **LOC Domain Stores Nuevo**: 470 (messageStore + streamingStore + approvalStore)
- **Tests Nuevos Sprint 2**: 46

---

## Comandos de Validación

```bash
# Unit tests
npm run -w bc-agent-frontend test

# Integration tests
npm run -w bc-agent-frontend test:integration

# Coverage report
npm run -w bc-agent-frontend test:coverage

# E2E tests (Playwright)
npm run test:e2e

# E2E solo frontend
npm run test:e2e -- --grep "frontend"

# Type check
npm run verify:types

# Lint
npm run -w bc-agent-frontend lint
```

---

## Referencias

- `00-ESTADO-ACTUAL.md` - Arquitectura actual
- `01-ANALISIS-GAPS.md` - 12 gaps detallados
- `02-ARQUITECTURA-OBJETIVO.md` - Screaming Architecture
- `02-CONTRATO-BACKEND-FRONTEND.md` - Contrato WebSocket

---

*Última actualización: 2025-12-25*
