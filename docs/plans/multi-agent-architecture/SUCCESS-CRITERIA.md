# Success Criteria & Verification Checklist

**Documento**: Entregables y criterios de verificación por fase
**Última Actualización**: 2026-02-11 (Phase 9 planificado, PRD-062/PRD-080 status corregidos)
**Propósito**: Base de conocimiento para validar que cada fase funciona correctamente y que no hay regresiones

---

## Estado Actual del Proyecto

| Fase | Estado | PRDs Completados | Pendientes |
|------|--------|-----------------|------------|
| Fase 0: Refactoring | ✅ COMPLETADO | PRD-001, 003, 004, 005 | PRD-002 (DEPRECATED) |
| Fase 0.5: Model Abstraction | 🔴 NO INICIADO | - | PRD-006 |
| Fase 1: TDD Foundation | 🟡 PARCIAL | PRD-011 | PRD-010 |
| Fase 2: Extended State | ✅ COMPLETADO | PRD-020 | - |
| Fase 3: Supervisor | ✅ COMPLETADO | PRD-030, PRD-032 | - |
| Fase 4: Handoffs | ✅ COMPLETADO | PRD-040 | - |
| Fase 5: Graphing Agent | ✅ COMPLETADO | PRD-050 | - |
| Fase 6: UI | ✅ COMPLETADO | PRD-060, PRD-061, PRD-062 | - |
| Fase 7: Agent-Specific UI | 🔴 NO INICIADO | - | PRD-070 (Rendering Framework), PRD-071 (Citation UI) |
| Fase 8: Optimization | 🟡 PARCIAL | PRD-080 (infra only) | PRD-080 Phase 8.3 (cache metrics) |
| Fase 9: Graph Optimization | 🟡 PARCIAL | PRD-090 | PRD-091 (Event Integrity) |

---

## Fase 0: Refactoring - Verificación ✅

### Entregables Completados
- [x] FileService descompuesto en 6 módulos especializados (PRD-001)
- [x] AgentOrchestrator descompuesto en 8 módulos (PRD-003)
- [x] Files routes descompuestas en 16 módulos (PRD-004)
- [x] MessageQueue descompuesta en módulos (PRD-005)
- [x] Stateless architecture con ExecutionContext pattern

### Criterios de Verificación Permanentes
- [ ] Ningún archivo >300 líneas en los módulos refactorizados
- [ ] `npm run -w backend test:unit` pasa (3104+ tests)
- [ ] `npm run verify:types` pasa sin errores

---

## Fase 1: TDD Foundation + Agent Registry - Verificación 🟡

### Entregables Completados (PRD-011)
- [x] `AgentRegistry` singleton en `modules/agents/core/registry/AgentRegistry.ts`
- [x] Definitions: BC Agent (7 static tools), RAG Agent (1 tool), Supervisor (no tools)
- [x] `GET /api/agents` endpoint autenticado retorna `AgentUISummary[]`
- [x] Constantes en `@bc-agent/shared`: `AGENT_ID`, `AGENT_DISPLAY_NAME`, `AGENT_ICON`, `AGENT_COLOR`

### Pendiente (PRD-010)
- [ ] LangSmith evaluation infrastructure
- [ ] Datasets de routing para supervisor
- [ ] `createTestContext()` helper estandarizado

### Criterios de Verificación
- [ ] `GET /api/agents` retorna los 3 agentes con estructura correcta
- [ ] `getAgentRegistry().getWorkerAgents()` retorna BC y RAG agents (no supervisor)
- [ ] `registry.getToolsForAgent('bc-agent')` retorna 7 tools
- [ ] `registry.getToolsForAgent('rag-agent')` retorna 1 tool (static `knowledgeSearchTool`)

---

## Fase 2: Extended State Schema - Verificación ✅

### Entregables Completados (PRD-020)
- [x] `ExtendedAgentStateAnnotation` con `currentAgentIdentity`, `AgentContext`
- [x] `AgentStateAnnotation` es alias backward-compatible
- [x] `ToolExecution` type para tracking de herramientas
- [x] `AgentChangedEvent` + Zod schemas en `@bc-agent/shared`
- [x] Reducers para `messages`, `currentAgentIdentity`, `context`, `toolExecutions`

### Criterios de Verificación Permanentes
- [ ] `currentAgentIdentity` se propaga en responses de BC y RAG agents
- [ ] `usedModel` tracking en cada response
- [ ] `toolExecutions` array populated después de tool calls
- [ ] Contract tests pasan: `npx vitest run "contract"`

---

## Fase 3: Supervisor - Verificación ✅

### Entregables Completados (PRD-030)
- [x] `createSupervisor()` compila con BC Agent + RAG Agent
- [x] `createReactAgent()` instances con tools y prompts del registry
- [x] Slash commands preservados: `/bc`, `/search`, `/rag` bypass supervisor
- [x] `SupervisorGraphAdapter` implementa `ICompiledGraph`
- [x] `result-adapter.ts` mapea output → `AgentState` (identity, tools, model)
- [x] `interrupt()` + `Command({ resume })` para human-in-the-loop
- [x] WebSocket `supervisor:resume` handler en server.ts
- [x] Old code eliminado: `router.ts`, `graph.ts`, `AgentFactory.ts`, `check_graph.ts`

### Entregables Completados (PRD-032)
- [x] `MSSQLSaver` custom checkpointer (reemplaza `MemorySaver`)
- [x] Persistencia durable en Azure SQL via Prisma
- [x] `AgentAnalyticsService` con MERGE upsert atómico
- [x] API endpoints: `GET /api/analytics/agents`, `GET /api/analytics/agents/:id/daily`
- [x] Prisma schema: 3 tablas nuevas, 1 eliminada (legacy `checkpoints`)
- [x] 34 tests nuevos (21 MSSQLSaver + 13 Analytics), 3020 tests totales

### Escenarios de Verificación E2E (PRD-030)

#### Routing Básico
- [ ] "Show me customer ABC" → routes to BC Agent
- [ ] "/search payment terms" → routes to RAG Agent (slash command bypass)
- [ ] "What does my contract say about SLA?" → routes to RAG Agent (supervisor decision)
- [ ] Ambiguous query → supervisor decides based on context

#### Multi-Step Coordination
- [ ] "Find my latest invoice over $5000 and show its details" → supervisor calls BC Agent potentially multiple times
- [ ] Supervisor evaluates partial results and decides next action

#### Event Pipeline Integrity
- [ ] Events emitidos en orden correcto: `session_start` → `tool_use`/`tool_result` → `message` → `complete`
- [ ] `currentAgentIdentity` populated en cada response
- [ ] `usedModel` refleja modelo real usado por agente

#### Interrupt/Resume
- [ ] Agent calls `interrupt()` → execution pauses
- [ ] `approval_requested` event emitido al frontend
- [ ] User responds via `supervisor:resume` → execution continues from interrupt point
- [ ] Result incluye datos post-interrupt

#### Slash Command Fast Path
- [ ] `/bc show customers` → bypasses supervisor LLM, goes directly to BC Agent
- [ ] `/search invoices` → bypasses supervisor, goes to RAG Agent
- [ ] `/rag payment terms` → same as `/search`
- [ ] Normal message without slash → goes through supervisor

### Danger Points / Regresiones a Monitorear

| Riesgo | Qué Verificar | Comando |
|--------|---------------|---------|
| Event pipeline breaks | Events emitidos correctamente al frontend | Manual: enviar mensaje y verificar events en browser console |
| Checkpoint persistence | Estado persiste entre reinicios | Enviar mensaje → reiniciar server → enviar follow-up (contexto debe mantenerse) |
| Tool execution deduplication | No duplicate tool events | Check `seenToolIds` en ExecutionContext |
| userId propagation | RAG Agent recibe userId via configurable | Verificar semantic search filtra por user |
| Model billing accuracy | `usedModel` matches actual model invoked | Check response metadata |
| Analytics no bloquea flujo | `recordInvocation` falla sin afectar invoke | Simular DB failure, verificar que invoke completa |

---

## Fase 4: Handoffs - Verificación ✅

### Entregables Completados (PRD-040)
- [x] `createAgentHandoffTool()` factory con `Command.PARENT` + `getCurrentTaskInput()` (patrón oficial LangGraph)
- [x] `buildHandoffToolsForAgent()`: genera `transfer_to_<target>` tools per-agent desde registry
- [x] BC Agent: 7 domain tools + `transfer_to_rag-agent` handoff tool
- [x] RAG Agent: 1 search tool + `transfer_to_bc-agent` handoff tool
- [x] `addHandoffBackMessages: true` en `createSupervisor()` para historial de transiciones
- [x] `detectHandoffs()` en result-adapter.ts escanea ToolMessages con patrón `transfer_to_*`
- [x] `HandoffDetectionInfo` type con `fromAgent`/`toAgent` identity pairs
- [x] WebSocket `agent:select` handler con session ownership validation
- [x] `processUserAgentSelection()` valida: agent exists, user-selectable, not system agent
- [x] `agent_changed` event emitido con `handoffType: 'user_selection'`
- [x] Case `agent_changed` explícito en `ChatMessageHandler` switch (ya no cae en `default`)
- [x] `session-ownership.ts` migrado de `executeQuery` (raw SQL) a `prisma.sessions.findUnique()`
- [x] `HandoffType` + `AgentSelectData` + Zod schemas en `@bc-agent/shared`

### Escenarios de Verificación E2E (PRD-040)

#### Agent-to-Agent Handoffs
- [ ] BC Agent delega a RAG Agent via `transfer_to_rag-agent` tool
- [ ] RAG Agent delega a BC Agent via `transfer_to_bc-agent` tool
- [ ] Handoff tool no requiere args del LLM (target baked-in)
- [ ] Message history preservado durante handoff (`addHandoffBackMessages`)

#### User-Initiated Agent Selection
- [ ] Frontend envía `agent:select` → backend valida ownership → emite `agent_changed`
- [ ] Selección de agent no existente → error handled gracefully
- [ ] Selección de supervisor (system agent) → rejected

#### Handoff Detection
- [ ] `detectHandoffs()` detecta `transfer_to_*` ToolMessages en result
- [ ] `adaptSupervisorResult()` incluye handoff info en state
- [ ] `agent_changed` event incluye `handoffType` discriminator

### Danger Points / Regresiones a Monitorear

| Riesgo | Qué Verificar | Comando |
|--------|---------------|---------|
| Circular handoffs (A→B→A→...) | `recursionLimit: 50` previene loops infinitos | Verificar que supervisor termina |
| `getCurrentTaskInput()` fuera de contexto | Solo se llama dentro de `createReactAgent` ToolNode | Verificar que handoff tools solo se usan en react agents |
| Session ownership Prisma migration | Tests de ownership siguen pasando | `npx vitest run "session-ownership"` |
| Handoff tool schema vacío | LLM no pasa args innecesarios | Verificar `z.object({})` en tool schema |

---

## Fase 5: Graphing Agent - Verificación ✅

### Entregables Completados (PRD-050)
- [x] `AGENT_ID.GRAPHING_AGENT = 'graphing-agent'` en `@bc-agent/shared` constants
- [x] `AGENT_DISPLAY_NAME['graphing-agent'] = 'Data Visualization Expert'`
- [x] `AGENT_ICON['graphing-agent'] = '📈'`, `AGENT_COLOR['graphing-agent'] = '#F59E0B'`
- [x] Graphing Agent registrado en `AgentRegistry` con 3 tools
- [x] `list_available_charts` tool retorna catálogo de 10 tipos
- [x] `get_chart_details` tool retorna schema JSON per chart type
- [x] `validate_chart_config` tool valida contra Zod schema
- [x] Config validado incluye `_type: 'chart_config'` como discriminador para PRD-070
- [x] 10 Zod schemas: `bar`, `stacked_bar`, `line`, `area`, `donut`, `bar_list`, `combo`, `kpi`, `kpi_grid`, `table`
- [x] `ChartConfigSchema` discriminated union en `@bc-agent/shared`
- [ ] Frontend `ChartRenderer` renderiza los 10 tipos usando Tremor components (diferido a PRD-070)
- [x] Handoff tools inyectados: `transfer_to_bc-agent`, `transfer_to_rag-agent`
- [ ] `@tremor/react` instalado como frontend dependency (diferido a PRD-070)

### Criterios de Verificación
```bash
npx vitest run "chart-config"     # Chart schema validation (10 types)
npx vitest run "graphing"         # Graphing agent tool tests
npx vitest run "agent-builders"   # Verify handoff injection includes graphing agent
```

### Danger Points
| Riesgo | Qué Verificar | Mitigación |
|--------|---------------|------------|
| ScatterChart API Tremor | Props exactas de `<ScatterChart>` | Verificar contra docs Tremor (Context7) |
| Chart data validation | Zod schemas rejectan data malformada | Unit tests con edge cases (empty arrays, >max items) |
| `stacked_bar` min 2 categories | Schema enforce `categories.min(2)` | Test: single category → ZodError |

---

## Fase 6: UI Components - Verificación ✅

### Entregables Completados (PRD-060)
- [x] Agent selector dropdown en ChatInput: Auto (🎯), BC Expert (📊), Knowledge (🧠), Charts (📈) - shadcn Select
- [x] `agentStateStore` con `currentAgentIdentity: AgentIdentity | null`
- [x] Case `agent_changed` en `processAgentEventSync.ts` actualiza `currentAgentIdentity`
- [x] Case `content_refused` y `session_end` en event handler
- [x] `ApprovalDialog` component para `approval_requested` events (inline card, not modal)
- [x] Respuesta UI via `supervisor:resume` WebSocket event (`SocketClient.respondToApproval()`)
- [x] `targetAgentId` threaded por backend: ChatMessageHandler → AgentOrchestrator → ExecutionPipeline → MessageContextBuilder → SupervisorGraphAdapter
- [x] Graph Agent option con color `#F59E0B` (amber) e icon `📈`
- [x] `AgentBadge` en mensajes assistant en ChatContainer
- [x] `uiPreferencesStore` con `selectedAgentId` persistido en localStorage
- [x] `useMyContext` sincronizado con `selectedAgentId === 'rag-agent'` (backward compat)
- [x] `SocketClient.sendMessage()` soporta `targetAgentId`
- [x] `useSocketConnection.sendMessage()` soporta `targetAgentId`
- [x] Toggle "My Files" reemplazado por `AgentSelectorDropdown`
- [x] `/new` page y `/chat/[sessionId]` page actualizados para agent routing

### Entregables Completados (PRD-061)
- [x] `isInternal?: boolean` field en `BaseAgentEvent`, `BaseMessage`, `BaseNormalizedEvent` (shared)
- [x] `MessageNormalizer.ts` tags handoff-back messages con `isInternal: true` (no filtra)
- [x] `BatchResultNormalizer.ts` marca `transfer_to_*` tool events con `isInternal: true`
- [x] `ExecutionPipeline.ts` popula `handoffType` en eventos `agent_changed`
- [x] `EventConverter.ts` propaga `isInternal` de NormalizedEvent a AgentEvent
- [x] `agentWorkflowStore` con `AgentProcessingGroup[]` tracking (startTurn, addGroup, markLastGroupFinal)
- [x] `uiPreferencesStore` toggle `showAgentWorkflow` persistido en localStorage
- [x] `processAgentEventSync.ts` integra workflow lifecycle (session_start, agent_changed, thinking_complete, tool_use, message, complete)
- [x] `AgentProcessingSection` component: collapsible sections per-agent con shadcn Collapsible
- [x] `AgentTransitionIndicator` component: divider visual entre agentes con handoff type + reason
- [x] `ChatContainer` conditional rendering: workflow sections vs flat message list
- [x] `InputOptionsBar` workflow toggle con icono Layers
- [x] `reconstructFromMessages()` reconstruye workflow groups desde `agent_identity` en session reload
- [x] Handoff-back messages persisten en DB con `isInternal: true`

### Entregables Completados (PRD-062)
- [x] ~~`tool_choice: 'any'` enforcement en `agent-builders.ts`~~ **IMPLEMENTADO via PRD-090** — `FirstCallToolEnforcer` hybrid approach (tool_choice: 'any' on first call, 'auto' on subsequent). See GAP-008 resolved.
- [x] BC Agent prompt mejorado con 5 Critical Execution Rules + tool mapping explícito (7 tools)
- [x] RAG Agent prompt mejorado con 4 Critical Execution Rules + search tool mapping
- [x] Graphing Agent prompt mejorado con 6 Critical Execution Rules + validation workflow
- [x] Supervisor prompt mejorado: router-only, no direct answers policy
- [x] Fix targetAgentId warning en `supervisor-graph.ts` (excluir `'supervisor'` del check, cambiar warn a debug)

### Criterios de Verificación (Fase 6)
```bash
# Type check y tests
npm run build:shared                # Build shared package
npm run verify:types                # Type check shared + frontend
npm run -w backend test:unit        # Backend tests
npm run -w bc-agent-frontend test   # Frontend tests
npm run -w bc-agent-frontend lint   # Frontend lint

# Tests específicos PRD-061
npx vitest run "agentWorkflowStore"        # Workflow store tests
npx vitest run "AgentProcessingSection"    # UI component tests

# Tests específicos PRD-062
npx vitest run "agent-builders"            # Tool choice enforcement tests
npx vitest run "bc-agent"                  # BC Agent definition tests
npx vitest run "rag-agent"                 # RAG Agent definition tests
npx vitest run "graphing-agent"            # Graphing Agent definition tests

# Manual: verificar workflow visibility
# 1. Enviar mensaje que trigger handoffs (e.g., "List customers and search for invoices")
# 2. Verificar en UI: secciones colapsables por agente, AgentTransitionIndicator entre ellos
# 3. Verificar workflow toggle persiste en localStorage
# 4. Verificar que mensajes finales (end_turn, !isInternal) aparecen fuera del collapsible

# Manual: verificar tool enforcement (PRD-062)
npx tsx scripts/inspect-session.ts "<session-id>" --verbose --events
# Esperar: mensajes tool_use con domain tools (listAllEntities, searchEntityOperations, etc.)
# NO esperar: mensajes text genéricos sin tool calls
```

### GAPs Resueltos en Fase 6
- **GAP-001**: `agent_changed` procesado en frontend, `agentStateStore` con `currentAgentIdentity`, `ApprovalDialog` para interrupt/resume (PRD-060)
- **GAP-004**: `agent_changed` emitido para supervisor routing (complementa user selection de PRD-040) (PRD-060)
- **GAP-006**: Sin referencias a `router.ts` ni PRD-031 (PRD-060)
- **GAP-008**: Tool usage enforcement implemented via PRD-090 (`FirstCallToolEnforcer` hybrid approach) + prompt engineering from PRD-062

---

## Fase 7: Agent-Specific UI Rendering - Verificación 🟡

**Estado**: 🟡 PARCIAL (PRD-070 completado, PRD-071 pendiente)

### Entregables Completados (PRD-070)
- [ ] `isAgentRenderedResult()` type guard exportado desde `@bc-agent/shared`
- [ ] `AgentRenderedResultType` union type: `'chart_config' | 'citation_result' | 'bc_entity'`
- [ ] `AgentRenderedResultBase` interface con `_type: string` discriminador
- [ ] `rendererRegistry.ts` extensible con `registerRenderer()` / `getRendererLoader()`
- [ ] Renderers lazy-loaded via `React.lazy()` + dynamic import
- [ ] `AgentResultRenderer` component con `Suspense` fallback (loading skeleton)
- [ ] `chart_config` → `ChartRenderer` (PRD-050)
- [ ] `citation_result` → `CitationRenderer` (PRD-071)
- [ ] Unknown `_type` → fallback a `MarkdownRenderer` (sin breaking changes)
- [ ] Missing `_type` → fallback a `MarkdownRenderer`
- [ ] Integration transparente con `MessageList.tsx`

### Entregables Esperados (PRD-071)
- [ ] `CitationResultSchema` Zod schema con `_type: 'citation_result'` discriminador
- [ ] `CitedDocumentSchema` con metadata: nombre, tipo, tamaño, lastModified
- [ ] `CitationPassageSchema` con excerpt, startOffset, endOffset, relevanceScore
- [ ] `knowledgeSearchTool` output enriquecido con metadata de citaciones
- [ ] `CitationRenderer` registrado en PRD-070 renderer registry
- [ ] `CitationCard` component: file name, relevance badge, excerpt, source icon
- [ ] `CitationList` component: collapsible list de `CitationCard`s
- [ ] Relevance color coding: green >= 80%, yellow >= 60%, gray < 60%
- [ ] `citationStore.ts` (Zustand) para expanded/collapsed state

### Criterios de Verificación
```bash
npx vitest run "citation"           # Citation schema + rendering tests
npx vitest run "agent-rendered"     # isAgentRenderedResult type guard tests
npx vitest run "renderer"           # Renderer registry tests
npm run -w bc-agent-frontend test   # Full frontend tests
npm run verify:types                # Type check
```

---

## Fase 8: Optimization - Verificación 🟡

**Estado**: 🟡 PARCIAL (Infrastructure completada, métricas pendientes)

### Entregables Completados (PRD-080 — Infrastructure Only)
- [x] `promptCaching: true` en todos los agent configs (`models.ts:142,156,170,184`)
- [x] `cache_control: { type: 'ephemeral' }` en system prompts (`agent-builders.ts:66-73`, `supervisor-graph.ts:91-99`)
- [x] `anthropic-beta: prompt-caching-2024-07-31` header en `ModelFactory.ts:167-169`

### Pendiente (PRD-080 Phase 8.3)
- [ ] Cache hit metrics tracking en `AgentAnalyticsService`
- [ ] Dashboard de cache hit rate por agente
- [ ] Alertas si cache hit rate cae por debajo de umbral

### Criterios de Verificación
```bash
# Verify prompt caching headers are sent
# Check response headers for cache_creation_input_tokens vs cache_read_input_tokens
# Currently requires manual log inspection — automated metrics pending Phase 8.3
```

---

## Fase 9: Graph Optimization - Verificación 🟡

**Estado**: 🟡 PLANIFICADO (PRD-090 y PRD-091 documentados, implementación pendiente)

### PRD-090: Agent Graph Logic Optimization ✅
- [x] Hybrid first-step tool enforcement (`tool_choice: 'any'` on first call, `'auto'` on subsequent)
- [x] `FirstCallToolEnforcer` utility in `core/langchain/FirstCallToolEnforcer.ts`
- [x] `tool_choice` + thinking guard in `agent-builders.ts` (throws if both active)
- [x] Multi-step reasoning instructions in BC, RAG, and Graphing agent prompts
- [x] Unit tests: `FirstCallToolEnforcer.test.ts` (10 tests), `agent-builders.test.ts` (updated)
- [ ] End-to-end verification: BC Agent calls `get_endpoint_documentation` for endpoint queries

### PRD-091: Event Transmission, Persistence & Integrity Verification
- [ ] `message_type: 'transition'` for persisting `agent_changed` events
- [ ] `EventSequencer` counts transition events for sequence pre-allocation
- [ ] `EventPersister` handles transition message persistence
- [ ] `ChatMessageHandler` false CRITICAL log fix (check `isInternal`)
- [ ] `reconstructFromMessages()` uses transition messages for explicit group boundaries
- [ ] Supervisor empty message investigation (bookkeeping vs lost content)
- [ ] `TransitionMessageResponse` type in `@bc-agent/shared`
- [ ] Frontend `TransitionMessage` renderer component

### Criterios de Verificación
```bash
# PRD-090: Tool enforcement
npm run -w backend test:unit              # All tests pass
npx vitest run "agent-builders"           # Tool enforcement tests
npx vitest run "FirstCallToolEnforcer"    # Wrapper tests (new)
npx vitest run "ModelFactory"             # Guard tests

# PRD-091: Event integrity
npx vitest run "EventPersister"           # Transition persistence tests
npx vitest run "EventSequencer"           # Sequence counting tests
npx vitest run "agentWorkflowStore"       # Reconstruction tests
npx vitest run "ChatMessageHandler"       # Fixed CRITICAL log tests

# Manual: tool enforcement
# 1. Send "What endpoints does Customer have?" → logs show domain tool_use events
# 2. npx tsx scripts/inspect-session.ts "<id>" --verbose --events

# Manual: event integrity
# 1. Send multi-agent query → verify agent transitions visible live
# 2. Refresh page → verify transitions still visible after reload
# 3. SELECT * FROM messages WHERE message_type = 'transition'
```

### Danger Points / Regresiones a Monitorear

| Riesgo | Qué Verificar | Comando/Acción |
|--------|---------------|----------------|
| `tool_choice: 'any'` infinite loop (GAP-009) | Hybrid enforcement terminates naturally (not at recursionLimit: 50) | Check log: `totalSteps` should be 3-8, not 50 |
| `tool_choice` + thinking constraint | Workers with thinking disabled can use `tool_choice: 'any'`; if thinking is later enabled, `tool_choice` MUST be removed | `npx vitest run "ModelFactory"` parameterized test |
| Transition message persistence | `message_type: 'transition'` rows in DB don't break existing queries | `SELECT COUNT(*) FROM messages GROUP BY message_type` |
| `reconstructFromMessages()` backward compat | Old sessions without transition messages still reconstruct correctly | Load a pre-Phase-9 session and verify workflow groups appear |
| Sequence number allocation | Transition events get unique sequence numbers | `npx vitest run "EventSequencer"` |

---

## Gaps Identificados (No Cubiertos en Ningún PRD)

### ~~GAP-001: Frontend WebSocket Event Handling para Multi-Agent~~ ✅ RESUELTO

**Resolución (PRD-060)**: Implementado en `processAgentEventSync.ts`:
- `agent_changed` case → actualiza `agentStateStore.currentAgentIdentity`
- `content_refused` case → marca agent como no-busy, notifica error
- `session_end` case → limpia agent identity y busy state
- `ApprovalDialog` component para approval_requested events con approve/reject
- `SocketClient.respondToApproval()` para `supervisor:resume`
- `agentStateStore` extendido con `currentAgentIdentity: AgentIdentity | null`

### ~~GAP-002: PRD-032 Checkpointer Incompatible con Azure SQL~~ ✅ RESUELTO

**Resolución**: Se implementó `MSSQLSaver` custom checkpointer extendiendo `BaseCheckpointSaver` de `@langchain/langgraph-checkpoint` con Prisma Client. No se necesitó `@langchain/langgraph-checkpoint-postgres`. Resuelto en PRD-032.

### GAP-003: Supervisor Error Handling & Retry ⚠️ PARCIALMENTE RESUELTO

**Descripción**: Si el supervisor LLM falla (rate limit, timeout, network error), no hay retry logic ni fallback.

**Parcialmente resuelto**: Con `MSSQLSaver` (PRD-032), el estado de conversación ahora persiste entre reinicios del servidor. Sin embargo, no hay retry logic para fallos de LLM.

**Impacto residual**: Rate limits de Haiku pueden bloquear routing. No hay fallback automático.

**Recomendación**: Crear PRD-033 para retry logic y error recovery.

### ~~GAP-004: Agent Changed Event no emitido por Supervisor~~ ✅ RESUELTO

**Resolución (PRD-040 + PRD-060)**:
- PRD-040: `agent_changed` emitido para user-initiated selection, `ChatMessageHandler` tiene case explícito, `detectHandoffs()` detecta handoffs
- PRD-060: Frontend procesa `agent_changed` events en `processAgentEventSync.ts`, `agentStateStore` actualiza `currentAgentIdentity`, `AgentBadge` muestra agente activo en mensajes

### GAP-005: Supervisor Prompt no tiene info de "cuándo usar interrupt()"

**Descripción**: El supervisor prompt generado por `buildSupervisorPrompt()` no instruye al supervisor sobre cuándo pausar y pedir clarificación al usuario via `interrupt()`.

**Impacto**: El supervisor nunca pedirá clarificación al usuario, incluso en situaciones ambiguas.

**Recomendación**: Mejorar prompt en implementación actual o en PRD-040.

### ~~GAP-006: PRD-060/061 tienen dependencias desactualizadas~~ ✅ RESUELTO

**Resolución**: PRD-060 v2.0 y PRD-061 v2.0 reescritos. Eliminadas todas las referencias a `router.ts` (eliminado en PRD-030) y PRD-031 (eliminado). PRD-060 ahora referencia `SupervisorGraphAdapter.invoke()` para `targetAgentId` bypass. PRD-061 renombrado a "Agent Activity Timeline" sin dependencia a PRD-031.

### ~~GAP-008: Tool Choice Enforcement NOT Implemented~~ ✅ RESUELTO

**Resolución (PRD-090)**: `FirstCallToolEnforcer` in `core/langchain/FirstCallToolEnforcer.ts` implements hybrid enforcement:
- First LLM call per thread_id: `tool_choice: 'any'` (must call a domain tool)
- Subsequent calls: `tool_choice: 'auto'` (natural ReAct termination)
- Integrated in `agent-builders.ts`: all worker agents use enforced model
- Guard: throws if agent has `thinking.type === 'enabled'` with tools (Anthropic constraint)
- Tests: 10 unit tests in `FirstCallToolEnforcer.test.ts`, updated `agent-builders.test.ts`

### ~~GAP-009: `tool_choice: 'any'` Infinite Loop Risk in ReAct Agents~~ ✅ RESUELTO

**Resolución (PRD-090)**: The hybrid approach in `FirstCallToolEnforcer` prevents infinite loops by only forcing `tool_choice: 'any'` on the first call. Subsequent calls use `'auto'`, allowing the agent to generate a final text response and terminate naturally. Agents complete in 2-6 ReAct iterations, not 50.

### GAP-007: ScatterChart Tremor API ⚠️ VERIFICAR

**Descripción**: PRD-050 incluye `scatter` como chart type #10 usando `<ScatterChart>` de Tremor. La API exacta de props (especialmente `x`, `y`, `size`, `category`) debe verificarse contra la versión instalada de `@tremor/react`.

**Impacto**: Bajo. Solo afecta implementación de scatter chart view.

**Recomendación**: Verificar API de Tremor ScatterChart al implementar PRD-050 (usar Context7 MCP).

---

## Verificación por Fase - Comandos Rápidos

```bash
# Verificación completa (correr después de cada PRD)
npm run build:shared                    # Build shared package
npm run verify:types                    # Type check shared + frontend
npm run -w backend lint                 # Backend lint (0 errors)
npm run -w backend test:unit            # Full backend unit tests (3036+)
npx vitest run "supervisor"             # Supervisor-specific tests (44)

# Tests específicos por módulo (Fases 0-4)
npx vitest run "agent-builders"         # Agent builder tests (8, includes handoff injection)
npx vitest run "result-adapter"         # Result adapter tests (includes detectHandoffs)
npx vitest run "slash-command"          # Slash command routing
npx vitest run "supervisor-prompt"      # Prompt generation tests
npx vitest run "supervisor-graph"       # Graph adapter tests
npx vitest run "MSSQLSaver"            # Checkpointer tests (21)
npx vitest run "AgentAnalyticsService"  # Analytics tests (13)
npx vitest run "handoff"               # Handoff-specific tests (15)
npx vitest run "session-ownership"      # Session ownership tests (48, Prisma-based)

# Tests Fase 5 (Graphing Agent)
npx vitest run "chart-config"           # Chart schema validation (10 types)
npx vitest run "graphing"               # Graphing agent tool tests

# Tests Fase 6 (Agent Selector UI)
npx vitest run "target-agent-routing"   # Backend: supervisor adapter routing (5 tests)
npx vitest run "ChatInput"              # Frontend: ChatInput component tests
npx vitest run "InputOptionsBar"        # Frontend: InputOptionsBar component tests

# Tests Fase 7 (Agent-Specific UI)
npx vitest run "agent-rendered"         # isAgentRenderedResult type guard tests
npx vitest run "renderer"               # Renderer registry tests
npx vitest run "citation"               # Citation schema + rendering tests

# Frontend (Fases 6-7)
npm run -w bc-agent-frontend test       # Frontend tests
npm run -w bc-agent-frontend lint       # Frontend lint

# Tests Fase 9 (Graph Optimization + Event Integrity)
npx vitest run "agent-builders"           # Tool enforcement tests (updated)
npx vitest run "FirstCallToolEnforcer"    # Hybrid tool enforcement wrapper tests (new)
npx vitest run "ModelFactory"             # Guard tests (tool_choice+thinking)
npx vitest run "EventPersister"           # Transition persistence tests
npx vitest run "EventSequencer"           # Sequence counting tests
npx vitest run "agentWorkflowStore"       # Reconstruction tests (updated)
npx vitest run "ChatMessageHandler"       # Fixed CRITICAL log tests
```

---

## Changelog

| Fecha | Cambios |
|-------|---------|
| 2026-02-06 | Creación inicial: criterios de verificación para Fases 0-3. Identificados 6 gaps no cubiertos en PRDs existentes. |
| 2026-02-06 | PRD-032 completado. Fase 3 marcada como ✅ COMPLETADO. GAP-002 resuelto (MSSQLSaver). GAP-003 parcialmente resuelto (persistencia durable). Agregados tests de checkpointer y analytics a comandos de verificación. |
| 2026-02-09 | PRD-040 completado. Fase 4 marcada como ✅ COMPLETADO. Dynamic handoffs con Command pattern oficial LangGraph. `session-ownership.ts` migrado a Prisma. 16 tests nuevos, 3036 tests totales. Fase 5 desbloqueada. GAP-004 parcialmente resuelto (`agent_changed` ahora se emite en user selection y tiene case explícito en ChatMessageHandler). |
| 2026-02-09 | Documentación Fases 5-7 actualizada. PRD-050 reescrito v2.0 (10 chart types, catalog-driven, Tremor). PRD-060 v2.0 (GAP-006 resuelto, graphing agent pill, `agentStateStore`). PRD-061 v2.0 (Agent Activity Timeline, Opción C). **Nueva Fase 7**: PRD-070 (Rendering Framework con `_type` discriminator) + PRD-071 (RAG Citation UI). GAP-006 resuelto. GAP-007 creado (ScatterChart API). Agregados criterios de verificación para Fases 5, 6, 7 con comandos de test específicos. |
| 2026-02-09 | **PRD-050 y PRD-060 completados**. Fase 5 marcada ✅ (backend-only, frontend diferido a PRD-070). Fase 6 marcada 🟡 (PRD-060 completado, PRD-061 pendiente). PRD-060: Agent Selector UI full-stack implementado — `AgentSelectorDropdown` (shadcn Select), `AgentBadge`, `ApprovalDialog`, `targetAgentId` threaded por 5 capas backend, 3 nuevos event cases frontend. GAP-001 resuelto (frontend event handling). GAP-004 resuelto (agent_changed processing). Test counts actualizados: 3104 backend, 666 frontend. Agregados comandos de test específicos para Fase 6. |
| 2026-02-11 | **Fase 9 planificada**. PRD-090 (Graph Logic Optimization) y PRD-091 (Event Integrity Verification) creados. GAP-008 reabierto: `tool_choice: 'any'` nunca fue implementado en `agent-builders.ts` (PRD-062 falsely marked complete). GAP-009 creado: `tool_choice: 'any'` causa infinite loop en ReAct agents, requiere enfoque hibrido (first-call-only enforcement). PRD-080 documentado como parcialmente completo (infrastructure done, metrics pending). Fase 8 agregada al status table. Comandos de verificacion Fase 9 agregados. |
| 2026-02-11 | **PRD-090 implementado**. `FirstCallToolEnforcer` en `core/langchain/FirstCallToolEnforcer.ts`: hybrid tool_choice enforcement (any→auto). Integrado en `agent-builders.ts` con thinking guard. Multi-step tool usage prompts en BC, RAG, y Graphing agents. GAP-008 y GAP-009 resueltos. 10 tests nuevos (FirstCallToolEnforcer), agent-builders tests actualizados. Documentación actualizada: `models.ts` header, `core/langchain/CLAUDE.md`. |
