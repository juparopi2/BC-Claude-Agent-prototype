# Success Criteria & Verification Checklist

**Documento**: Entregables y criterios de verificación por fase
**Última Actualización**: 2026-02-09 (PRD-040 completado)
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
| Fase 5: Graphing Agent | 🔴 NO INICIADO | - | PRD-050 |
| Fase 6: UI | 🔴 NO INICIADO | - | PRD-060, PRD-061 |

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
- [ ] `npm run -w backend test:unit` pasa (3036+ tests)
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

## Gaps Identificados (No Cubiertos en Ningún PRD)

### GAP-001: Frontend WebSocket Event Handling para Multi-Agent ⚠️ CRITICO

**Descripción**: El backend emite eventos nuevos (`agent_changed`, `approval_requested` con datos de interrupt, `supervisor:resume`) pero el frontend NO los procesa. Esto rompe la experiencia de usuario.

**Detalle**:
- `agent_changed` event: backend lo emite, frontend lo ignora (cae en `default` case de `processAgentEventSync.ts`)
- `approval_requested`: store existe (`approvalStore`) pero NO hay componente UI para mostrar la solicitud al usuario
- `supervisor:resume`: NO hay UI para que el usuario responda a interrupts
- `content_refused`: NO hay case en frontend event handler
- `session_end`: NO hay case en frontend event handler
- `agentStateStore` NO tiene campo `currentAgentIdentity` - no puede mostrar qué agente está activo

**Impacto**: Sin esto, el usuario no sabe qué agente está respondiendo, no puede aprobar/rechazar operaciones, y el interrupt/resume flow no funciona end-to-end.

**Recomendación**: Agregar a PRD-060 (Agent Selector UI) o crear un PRD nuevo PRD-033 específico.

### ~~GAP-002: PRD-032 Checkpointer Incompatible con Azure SQL~~ ✅ RESUELTO

**Resolución**: Se implementó `MSSQLSaver` custom checkpointer extendiendo `BaseCheckpointSaver` de `@langchain/langgraph-checkpoint` con Prisma Client. No se necesitó `@langchain/langgraph-checkpoint-postgres`. Resuelto en PRD-032.

### GAP-003: Supervisor Error Handling & Retry ⚠️ PARCIALMENTE RESUELTO

**Descripción**: Si el supervisor LLM falla (rate limit, timeout, network error), no hay retry logic ni fallback.

**Parcialmente resuelto**: Con `MSSQLSaver` (PRD-032), el estado de conversación ahora persiste entre reinicios del servidor. Sin embargo, no hay retry logic para fallos de LLM.

**Impacto residual**: Rate limits de Haiku pueden bloquear routing. No hay fallback automático.

**Recomendación**: Crear PRD-033 para retry logic y error recovery.

### GAP-004: Agent Changed Event no emitido por Supervisor ⚠️ PARCIALMENTE RESUELTO

**Descripción**: El `result-adapter.ts` detecta qué agente respondió, pero el `agent_changed` event type no se emite explícitamente cuando el supervisor cambia entre agentes. Solo se incluye `currentAgentIdentity` en el state.

**Parcialmente resuelto (PRD-040)**:
- `agent_changed` ahora se emite para user-initiated selection via `agent:select` WebSocket handler
- `ChatMessageHandler` tiene case `agent_changed` explícito con logging de `previousAgent`, `currentAgent`, `handoffType`
- `detectHandoffs()` en result-adapter detecta agent-to-agent handoffs via `transfer_to_*` ToolMessages

**Impacto residual**: El supervisor automatic routing aún no emite `agent_changed` events (solo agent-to-agent handoffs y user selection lo hacen). Frontend aún no procesa estos events.

**Recomendación**: Agregar emisión de `agent_changed` en `EventProcessor`/`AgentOrchestrator` cuando `currentAgentIdentity` cambia vs valor anterior. Completar en PRD-060.

### GAP-005: Supervisor Prompt no tiene info de "cuándo usar interrupt()"

**Descripción**: El supervisor prompt generado por `buildSupervisorPrompt()` no instruye al supervisor sobre cuándo pausar y pedir clarificación al usuario via `interrupt()`.

**Impacto**: El supervisor nunca pedirá clarificación al usuario, incluso en situaciones ambiguas.

**Recomendación**: Mejorar prompt en implementación actual o en PRD-040.

### GAP-006: PRD-060/061 tienen dependencias desactualizadas

**Descripción**:
- PRD-060 referencia `router.ts` para bypass de routing → `router.ts` ya no existe (eliminado en PRD-030)
- PRD-061 lista `PRD-031 (Plan Executor)` como dependencia → PRD-031 fue ELIMINADO
- PRD-060 §11.6 muestra código de `router.ts` → debe usar `slash-command-router.ts` o `supervisor-graph.ts`
- PRD-060 necesita integrar `targetAgentId` con el supervisor adapter, no con el router

**Recomendación**: Actualizar PRD-060 y PRD-061 para reflejar la arquitectura post-PRD-030.

---

## Verificación por Fase - Comandos Rápidos

```bash
# Verificación completa (correr después de cada PRD)
npm run build:shared                    # Build shared package
npm run verify:types                    # Type check shared + frontend
npm run -w backend lint                 # Backend lint (0 errors)
npm run -w backend test:unit            # Full backend unit tests (3036+)
npx vitest run "supervisor"             # Supervisor-specific tests (44)

# Tests específicos por módulo
npx vitest run "agent-builders"         # Agent builder tests (8, includes handoff injection)
npx vitest run "result-adapter"         # Result adapter tests (includes detectHandoffs)
npx vitest run "slash-command"          # Slash command routing
npx vitest run "supervisor-prompt"      # Prompt generation tests
npx vitest run "supervisor-graph"       # Graph adapter tests
npx vitest run "MSSQLSaver"            # Checkpointer tests (21)
npx vitest run "AgentAnalyticsService"  # Analytics tests (13)
npx vitest run "handoff"               # Handoff-specific tests (15)
npx vitest run "session-ownership"      # Session ownership tests (48, Prisma-based)

# Frontend (cuando PRD-060+ se implemente)
npm run -w bc-agent-frontend test       # Frontend tests
npm run -w bc-agent-frontend lint       # Frontend lint
```

---

## Changelog

| Fecha | Cambios |
|-------|---------|
| 2026-02-06 | Creación inicial: criterios de verificación para Fases 0-3. Identificados 6 gaps no cubiertos en PRDs existentes. |
| 2026-02-06 | PRD-032 completado. Fase 3 marcada como ✅ COMPLETADO. GAP-002 resuelto (MSSQLSaver). GAP-003 parcialmente resuelto (persistencia durable). Agregados tests de checkpointer y analytics a comandos de verificación. |
| 2026-02-09 | PRD-040 completado. Fase 4 marcada como ✅ COMPLETADO. Dynamic handoffs con Command pattern oficial LangGraph. `session-ownership.ts` migrado a Prisma. 16 tests nuevos, 3036 tests totales. Fase 5 desbloqueada. GAP-004 parcialmente resuelto (`agent_changed` ahora se emite en user selection y tiene case explícito en ChatMessageHandler). |
