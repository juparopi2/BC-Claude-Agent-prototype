# PRD: Agent Orchestrator Refactor - Normalización de Eventos

> **Fecha**: 2026-01-04
> **Versión**: 1.0
> **Autor**: Engineering Team
> **Status**: Draft - Pending Approval

---

## Executive Summary

### Problema

El `AgentOrchestrator` actual tiene una arquitectura que **extrae estáticamente** contenido del resultado de LangGraph en lugar de **normalizar eventos**. Esto resulta en:

1. **Lógica condicional hardcodeada**: El orden de emisión está fijo (`thinking → tools → message → complete`)
2. **No escalable**: Si el grafo crece (múltiples agentes, paralelización), la lógica se rompe
3. **Adapter subutilizado**: `AnthropicStreamAdapter` existe pero solo se usa para `normalizeStopReason()`
4. **Tipos duplicados**: 3 sistemas de tipos diferentes (EventStore, Shared, Normalized) sin mapeo claro

### Visión

Transformar el sistema a una arquitectura donde:

1. **El grafo se ejecuta** → Devuelve `AgentState` con mensajes en orden
2. **Los mensajes se normalizan** → Un adapter convierte cada mensaje a eventos canónicos
3. **Los eventos se emiten en orden** → Sin condicionales, iterando la lista normalizada
4. **La persistencia es genérica** → Un método por tipo de evento normalizado

### Beneficios

- **Escalabilidad**: Soporta grafos complejos con múltiples agentes y paralelización
- **Desacoplamiento**: La lógica de Anthropic queda aislada en adapters
- **Trazabilidad**: Tipos unificados permiten seguir el flujo de datos
- **Multi-provider ready**: Preparado para OpenAI, Google, etc.

---

## 1. Estado Actual

### 1.1 Flujo de Ejecución Actual

```
AgentOrchestrator.executeAgentSync()
│
├── 1. createExecutionContextSync()
├── 2. emit session_start
├── 3. persistUserMessage() → emit user_message_confirmed
├── 4. graph.invoke() ─────────────────────┐
│                                          │
│   ┌──────────────────────────────────────┘
│   │
│   └── AgentState { messages[], toolExecutions[] }
│
├── 5. extractContent(state) ◄── PROBLEMA: Extracción estática
│       ├── findThinkingInAllMessages()
│       ├── extractContentBlocks(lastMessage)
│       ├── extractStopReason()
│       └── extractUsage()
│
├── 6. if (thinking) { emit thinking_complete } ◄── PROBLEMA: Condicionales
├── 7. for (tool of tools) { emit tool_use, tool_result }
├── 8. persistAgentMessage()
├── 9. emit message
└── 10. emit complete
```

### 1.2 Archivos Actuales Involucrados

| Archivo | Responsabilidad | Estado |
|---------|-----------------|--------|
| `domains/agent/orchestration/AgentOrchestrator.ts` | Coordinación central | **MODIFICAR** |
| `domains/agent/orchestration/ResultExtractor.ts` | Extracción estática | **ELIMINAR** |
| `domains/agent/orchestration/ExecutionContextSync.ts` | Contexto por ejecución | Mantener |
| `shared/providers/adapters/AnthropicStreamAdapter.ts` | Normalización streaming | **ELIMINAR** (no se usa) |
| `shared/providers/adapters/StreamAdapterFactory.ts` | Factory de adapters | **ELIMINAR** (reemplazado) |
| `shared/providers/interfaces/INormalizedEvent.ts` | Tipos normalizados | **EXTENDER** |
| `domains/agent/persistence/PersistenceCoordinator.ts` | Persistencia | Mantener |
| `modules/agents/orchestrator/state.ts` | Estado LangGraph | Mantener |
| `packages/shared/src/types/agent.types.ts` | Tipos compartidos | **EXTENDER** |

### 1.3 Análisis de Tipos Actuales

#### Problema: Triple Sistema de Tipos

```
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 1: Frontend (@bc-agent/shared/types/agent.types.ts)       │
│  - AgentEventType: 13 tipos (session_start, message, etc.)      │
│  - Convención: camelCase                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↕ GAP
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 2: EventStore (services/events/EventStore.ts)             │
│  - EventType: 14 tipos (user_message_sent, etc.)                │
│  - Convención: snake_case                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↕ GAP
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 3: Normalized (shared/providers/interfaces)               │
│  - NormalizedEventType: 7 tipos (reasoning_delta, etc.)         │
│  - Convención: snake_case                                        │
└─────────────────────────────────────────────────────────────────┘
```

#### Duplicaciones Identificadas

| Concepto | Shared | EventStore | Normalized | Acción |
|----------|--------|------------|------------|--------|
| User message | `user_message_confirmed` | `user_message_sent` | - | Unificar |
| Agent message | `message` | `agent_message_sent` | `content_delta` | Mapear |
| Thinking | `thinking_complete` | `agent_thinking_block` | `reasoning_delta` | Mapear |
| Tool use | `tool_use` | `tool_use_requested` | `tool_call` | Mapear |
| Tool result | `tool_result` | `tool_use_completed` | - | Agregar |
| Stop reason | `StopReason` (13 valores) | - | `NormalizedStopReason` (4) | Mapear |

---

## 2. Arquitectura Propuesta

### 2.1 Nuevo Flujo de Ejecución

```
AgentOrchestrator.executeAgentSync()
│
├── 1. createExecutionContextSync()
├── 2. emit session_start
├── 3. persistUserMessage() → emit user_message_confirmed
├── 4. graph.invoke()
│       └── AgentState { messages[], toolExecutions[] }
│
├── 5. BatchResultNormalizer.normalize(state) ◄── NUEVO
│       │
│       │  Para cada mensaje en state.messages (EN ORDEN):
│       │    ├── Detectar tipo por content blocks
│       │    ├── Mapear a NormalizedAgentEvent
│       │    └── Preservar orden original
│       │
│       └── NormalizedAgentEvent[]
│
├── 6. for (event of normalizedEvents) {    ◄── SIN CONDICIONALES
│       emit(event)
│       persist(event)  ◄── Método genérico
│   }
│
└── 7. emit complete
```

### 2.2 Nuevo Componente: BatchResultNormalizer

```typescript
// Ubicación: backend/src/shared/providers/normalizers/BatchResultNormalizer.ts

interface IBatchResultNormalizer {
  /**
   * Normaliza el resultado completo de graph.invoke()
   * @param state - AgentState final del grafo
   * @param adapter - Adapter específico del provider (Anthropic, OpenAI, etc.)
   * @returns Array de eventos normalizados EN ORDEN
   */
  normalize(state: AgentState, adapter: IProviderAdapter): NormalizedAgentEvent[];
}
```

### 2.3 Tipos Normalizados Unificados

```typescript
// Ubicación: packages/shared/src/types/normalized-events.types.ts

/**
 * Tipo canónico de evento normalizado.
 * Todos los providers (Anthropic, OpenAI, etc.) se mapean a estos tipos.
 */
type NormalizedEventType =
  | 'session_start'      // Inicio de sesión
  | 'user_message'       // Mensaje del usuario confirmado
  | 'thinking'           // Bloque de pensamiento (si el provider lo soporta)
  | 'tool_request'       // Solicitud de herramienta
  | 'tool_response'      // Resultado de herramienta
  | 'assistant_message'  // Respuesta del asistente
  | 'error'              // Error
  | 'complete';          // Fin de ejecución

/**
 * Evento normalizado base.
 * Contiene todos los campos necesarios para emisión y persistencia.
 */
interface NormalizedAgentEvent {
  type: NormalizedEventType;

  // Identificadores
  eventId: string;
  sessionId: string;
  messageId?: string;

  // Contenido (varía según tipo)
  content?: string;

  // Metadata específica por tipo
  metadata: {
    // Para thinking
    thinkingContent?: string;

    // Para tool_request/tool_response
    toolUseId?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    toolSuccess?: boolean;
    toolError?: string;

    // Para assistant_message
    stopReason?: NormalizedStopReason;
    model?: string;

    // Para todos
    tokenUsage?: {
      input: number;
      output: number;
      thinking?: number;
    };
  };

  // Ordenamiento
  originalIndex: number;  // Posición en el array de mensajes original

  // Persistencia
  persistenceStrategy: 'sync' | 'async' | 'transient';
}
```

### 2.4 Adapter Refactorizado

> **Decisión Confirmada**: Eliminar `AnthropicStreamAdapter` por completo y crear un nuevo `AnthropicAdapter` que maneje toda la lógica de normalización para batch/invoke mode. El streaming adapter no se usa actualmente y se elimina para evitar código muerto.

```typescript
// Ubicación: backend/src/shared/providers/adapters/AnthropicAdapter.ts

/**
 * Adapter para normalizar resultados de Anthropic (batch/invoke mode).
 * REEMPLAZA a AnthropicStreamAdapter que será eliminado.
 */
interface IAnthropicAdapter extends IProviderAdapter {
  /**
   * Normaliza un mensaje de LangChain a eventos normalizados.
   * Un mensaje puede producir múltiples eventos (ej: thinking + text + tool_use)
   */
  normalizeMessage(message: BaseMessage, index: number): NormalizedAgentEvent[];

  /**
   * Detecta el tipo de contenido de un bloque.
   */
  detectBlockType(block: ContentBlock): 'thinking' | 'text' | 'tool_use';

  /**
   * Normaliza stop reason de Anthropic a canónico.
   */
  normalizeStopReason(reason: AnthropicStopReason): NormalizedStopReason;

  /**
   * Extrae uso de tokens del mensaje.
   */
  extractUsage(message: BaseMessage): TokenUsage | null;
}
```

---

## 3. Mapeo de Tipos Anthropic → Canónicos

### 3.1 Content Blocks → Eventos

| Anthropic Block Type | Campo | Evento Normalizado | Notas |
|---------------------|-------|-------------------|-------|
| `thinking` | `block.thinking` | `thinking` | Extended thinking (Claude 3.5+) |
| `text` | `block.text` | `assistant_message` | Contenido visible |
| `tool_use` | `block.id`, `block.name`, `block.input` | `tool_request` | Solicitud de tool |

### 3.2 Stop Reasons → Canónicos

| Anthropic | OpenAI | Canónico | Significado |
|-----------|--------|----------|-------------|
| `end_turn` | `stop` | `success` | Completó normalmente |
| `tool_use` | `tool_calls` | `success` | Quiere usar tools (continúa) |
| `max_tokens` | `length` | `max_tokens` | Límite de tokens |
| `stop_sequence` | - | `success` | Hit stop sequence |
| `pause_turn` | - | `paused` | SDK 0.71+ pause |
| `refusal` | `content_filter` | `refused` | Política de contenido |

### 3.3 Response Metadata → Token Usage

```typescript
// Anthropic (vía LangChain)
message.response_metadata?.usage = {
  input_tokens: number;
  output_tokens: number;
}

// O alternativa
message.usage_metadata = {
  input_tokens: number;
  output_tokens: number;
}

// Normalizado
tokenUsage = {
  input: number;
  output: number;
  thinking?: number;  // Si hay extended thinking
}
```

---

## 4. Plan de Implementación (TDD)

### Phase 0: Preparación (1 sesión)

#### 0.1 Verificar Estado Base
- [ ] `npm run verify:types` pasa
- [ ] `npm run -w backend lint` pasa
- [ ] `npm run -w backend test:unit` pasa
- [ ] `npm run -w backend test:integration` pasa

#### 0.2 Crear Estructura de Archivos
```
backend/src/shared/providers/
├── adapters/
│   ├── AnthropicStreamAdapter.ts  (existente - mantener para futuro streaming)
│   ├── AnthropicBatchAdapter.ts   ◄── NUEVO
│   └── index.ts
├── normalizers/
│   ├── BatchResultNormalizer.ts   ◄── NUEVO
│   ├── types.ts                   ◄── NUEVO
│   └── index.ts
└── interfaces/
    ├── IProviderAdapter.ts        ◄── NUEVO (interfaz común)
    └── INormalizedEvent.ts        (existente - extender)
```

### Phase 1: Tipos y Interfaces (TDD)

#### 1.1 Definir NormalizedAgentEvent
```
Test: normalized-event.types.test.ts
├── describe('NormalizedAgentEvent')
│   ├── it('should have all required base fields')
│   ├── it('should have type-specific metadata for thinking')
│   ├── it('should have type-specific metadata for tool_request')
│   └── it('should have persistenceStrategy for each type')
```

#### 1.2 Definir IProviderAdapter Interface
```
Test: provider-adapter.interface.test.ts
├── describe('IProviderAdapter')
│   ├── it('should define normalizeMessage method')
│   ├── it('should define normalizeStopReason method')
│   └── it('should define extractUsage method')
```

### Phase 2: AnthropicBatchAdapter (TDD)

#### 2.1 Tests Primero
```
Test: AnthropicBatchAdapter.test.ts
├── describe('normalizeMessage')
│   ├── describe('simple text message')
│   │   ├── it('should produce assistant_message event')
│   │   └── it('should extract content from text block')
│   │
│   ├── describe('thinking + text message')
│   │   ├── it('should produce thinking event first')
│   │   ├── it('should produce assistant_message event second')
│   │   └── it('should preserve order via originalIndex')
│   │
│   ├── describe('tool_use message')
│   │   ├── it('should produce tool_request event')
│   │   ├── it('should extract toolUseId from block.id')
│   │   └── it('should extract toolArgs from block.input')
│   │
│   ├── describe('mixed content blocks')
│   │   ├── it('should handle thinking + text + tool_use')
│   │   └── it('should produce events in block order')
│   │
│   └── describe('ReAct loop (multiple messages)')
│       ├── it('should find thinking in first AI message')
│       └── it('should find final content in last AI message')
│
├── describe('normalizeStopReason')
│   ├── it('should map end_turn to success')
│   ├── it('should map tool_use to success')
│   ├── it('should map max_tokens to max_tokens')
│   └── it('should default unknown to success with warning')
│
└── describe('extractUsage')
    ├── it('should extract from response_metadata.usage')
    ├── it('should fallback to usage_metadata')
    └── it('should return null if no usage found')
```

#### 2.2 Implementación
- Crear `AnthropicBatchAdapter.ts`
- Implementar cada método siguiendo los tests
- Aislar TODA la lógica específica de Anthropic aquí

### Phase 3: BatchResultNormalizer (TDD)

#### 3.1 Tests Primero
```
Test: BatchResultNormalizer.test.ts
├── describe('normalize')
│   ├── describe('simple response (text only)')
│   │   ├── it('should produce [assistant_message] array')
│   │   └── it('should set originalIndex correctly')
│   │
│   ├── describe('thinking + response')
│   │   ├── it('should produce [thinking, assistant_message]')
│   │   └── it('should preserve order')
│   │
│   ├── describe('tool execution')
│   │   ├── it('should produce [tool_request, tool_response, assistant_message]')
│   │   ├── it('should match toolUseId between request and response')
│   │   └── it('should include tool results from state.toolExecutions')
│   │
│   ├── describe('complex ReAct loop')
│   │   ├── it('should handle multiple tool calls')
│   │   ├── it('should maintain order across all messages')
│   │   └── it('should deduplicate tool events (if already in toolExecutions)')
│   │
│   └── describe('edge cases')
│       ├── it('should handle empty messages array')
│       ├── it('should handle no AI messages')
│       └── it('should handle malformed content blocks')
```

#### 3.2 Implementación
```typescript
class BatchResultNormalizer implements IBatchResultNormalizer {
  normalize(state: AgentState, adapter: IProviderAdapter): NormalizedAgentEvent[] {
    const events: NormalizedAgentEvent[] = [];

    // 1. Procesar cada mensaje EN ORDEN
    for (let i = 0; i < state.messages.length; i++) {
      const message = state.messages[i];
      const messageType = message._getType?.();

      if (messageType === 'ai' || messageType === 'assistant') {
        // Normalizar mensaje AI
        const normalizedEvents = adapter.normalizeMessage(message, i);
        events.push(...normalizedEvents);
      }
      // Human messages ya fueron emitidos como user_message_confirmed
      // Tool messages se procesan vía toolExecutions
    }

    // 2. Agregar tool_response events desde toolExecutions
    for (const exec of state.toolExecutions || []) {
      events.push(this.createToolResponseEvent(exec));
    }

    // 3. Ordenar por originalIndex
    events.sort((a, b) => a.originalIndex - b.originalIndex);

    return events;
  }
}
```

### Phase 4: Refactorizar AgentOrchestrator (TDD)

#### 4.1 Tests de Integración Actualizados
```
Test: AgentOrchestrator.integration.test.ts (MODIFICAR)
├── describe('executeAgentSync with BatchResultNormalizer')
│   ├── it('should emit events in normalized order')
│   ├── it('should not have conditional emission logic')
│   ├── it('should use generic persist method')
│   └── it('should maintain parity with old behavior')
```

#### 4.2 Refactorizar executeAgentSync
```typescript
async executeAgentSync(...): Promise<AgentExecutionResult> {
  // ... setup ...

  // 4. EXECUTE GRAPH
  const result = await orchestratorGraph.invoke(inputs, config);

  // 5. NORMALIZE (nuevo)
  const adapter = BatchAdapterFactory.create('anthropic');
  const normalizedEvents = this.normalizer.normalize(result, adapter);

  // 6. EMIT + PERSIST (genérico, sin condicionales)
  for (const event of normalizedEvents) {
    await this.emitAndPersist(ctx, event);
  }

  // 7. COMPLETE
  this.emitEventSync(ctx, { type: 'complete', ... });

  return { ... };
}

private async emitAndPersist(ctx: ExecutionContextSync, event: NormalizedAgentEvent): Promise<void> {
  // Emit al frontend
  this.emitEventSync(ctx, this.toAgentEvent(event));

  // Persist según estrategia
  if (event.persistenceStrategy === 'sync') {
    await this.persistenceCoordinator.persistEvent(event);
  } else if (event.persistenceStrategy === 'async') {
    this.persistenceCoordinator.persistEventAsync(event);
  }
  // 'transient' no se persiste
}
```

### Phase 5: Deprecar Código Antiguo

#### 5.1 Marcar como @deprecated
```typescript
// ResultExtractor.ts
/**
 * @deprecated Use BatchResultNormalizer instead.
 * This extractor uses static heuristics that don't scale with complex graphs.
 * Will be removed in version 2.0.
 */
export function extractContent(state: AgentState): ExtractedContent {
  // ...
}
```

#### 5.2 Archivos a Deprecar
| Archivo | Razón | Acción |
|---------|-------|--------|
| `ResultExtractor.ts` | Reemplazado por BatchResultNormalizer | @deprecated → eliminar |
| `AnthropicStreamAdapter.processChunk()` | Solo para streaming futuro | Mantener, documentar uso futuro |

### Phase 6: Actualizar Tests E2E

#### 6.1 Verificar Scenarios Existentes
```
Test: multi-tool-with-thinking.scenario.test.ts
├── it('should emit events in correct order') ◄── Ya existe, debe seguir pasando
├── it('should have monotonic sequence numbers') ◄── Ya existe
└── it('should correlate tool_use with tool_result') ◄── Ya existe
```

Los tests E2E **NO deberían cambiar** si la paridad se mantiene.

### Phase 7: Cleanup Final

#### 7.1 Eliminar Código Deprecado
- [ ] Eliminar `ResultExtractor.ts` (después de verificar 0 imports)
- [ ] Eliminar tests de ResultExtractor
- [ ] Actualizar documentación (CLAUDE.md, contratos)

#### 7.2 Actualizar Contrato Backend
- [ ] Actualizar `01-CONTRATO-INTERNO-BACKEND.md` con nuevo flujo

---

## 5. Archivos a Crear

| Archivo | Descripción |
|---------|-------------|
| `packages/shared/src/types/normalized-events.types.ts` | **Tipos NormalizedAgentEvent (en shared)** |
| `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts` | Normalizador principal |
| `backend/src/shared/providers/adapters/AnthropicAdapter.ts` | **NUEVO** Adapter completo Anthropic |
| `backend/src/shared/providers/interfaces/IProviderAdapter.ts` | Interfaz común adapters |
| `backend/src/__tests__/unit/shared/providers/AnthropicAdapter.test.ts` | Tests unitarios adapter |
| `backend/src/__tests__/unit/shared/providers/normalizers/BatchResultNormalizer.test.ts` | Tests unitarios normalizer |

## 6. Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `backend/src/domains/agent/orchestration/AgentOrchestrator.ts` | Usar BatchResultNormalizer |
| `packages/shared/src/types/index.ts` | Exportar NormalizedAgentEvent |
| `packages/shared/src/index.ts` | Re-exportar tipos |
| `backend/src/__tests__/integration/.../AgentOrchestrator.integration.test.ts` | Actualizar tests |

## 7. Archivos a Deprecar/Eliminar

| Archivo | Razón | Timeline |
|---------|-------|----------|
| `backend/src/domains/agent/orchestration/ResultExtractor.ts` | Reemplazado por BatchResultNormalizer | Eliminar en Phase 7 |
| `backend/src/shared/providers/adapters/AnthropicStreamAdapter.ts` | **No se usa** - eliminar | Eliminar en Phase 7 |
| `backend/src/shared/providers/adapters/StreamAdapterFactory.ts` | Reemplazado | Eliminar en Phase 7 |
| `backend/src/__tests__/unit/shared/providers/AnthropicStreamAdapter.test.ts` | Tests de código eliminado | Eliminar en Phase 7 |

---

## 8. Criterios de Aceptación

### Funcionales
- [ ] El sistema emite eventos en el mismo orden que el grafo los produce
- [ ] No hay lógica condicional (`if thinking`, `for tools`) en el orchestrator
- [ ] La persistencia usa un método genérico basado en el tipo de evento
- [ ] Los tests E2E existentes pasan sin modificaciones

### Técnicos
- [ ] `npm run verify:types` pasa
- [ ] `npm run -w backend lint` pasa
- [ ] `npm run -w backend test:unit` pasa (incluyendo nuevos tests)
- [ ] `npm run -w backend test:integration` pasa
- [ ] Cobertura de tests >= 80% para nuevos archivos

### Arquitecturales
- [ ] Toda lógica específica de Anthropic está en `AnthropicBatchAdapter`
- [ ] `BatchResultNormalizer` es provider-agnostic
- [ ] Los tipos están unificados en `NormalizedAgentEvent`
- [ ] El código deprecado está marcado con `@deprecated`

---

## 8.5 Mejora: Trazabilidad de Modelo y Eliminación de Hardcoding

### Problema Identificado

En `AgentOrchestrator.ts` hay valores hardcodeados que deberían ser dinámicos:

```typescript
// Línea 296 y 321 - HARDCODED (incorrecto)
model: 'claude-3-5-sonnet-20241022',

// Pero los agentes usan modelos diferentes:
// - BC Agent: HAIKU_4_5 (via getModelConfig('bc_agent'))
// - RAG Agent: HAIKU_4_5 (via getModelConfig('rag_agent'))
// - Router: HAIKU_3_5 (via getModelConfig('router'))
```

### Valores Hardcodeados a Eliminar

| Ubicación | Valor | Problema |
|-----------|-------|----------|
| `AgentOrchestrator.ts:296` | `model: 'claude-3-5-sonnet-20241022'` | No refleja modelo real usado |
| `AgentOrchestrator.ts:321` | `model: 'claude-3-5-sonnet-20241022'` | Duplicado del anterior |
| `AgentOrchestrator.ts:314` | `role: 'assistant'` | Debería derivarse del tipo de evento |
| Múltiples | `persistenceState: 'transient'/'persisted'` | Debería ser regla, no hardcoded |

### Solución Propuesta

#### 1. Agregar `usedModel` al AgentState

```typescript
// modules/agents/orchestrator/state.ts
export const AgentStateAnnotation = Annotation.Root({
  // ... existing fields ...

  /**
   * Model used by the active agent.
   * Set by each agent when it executes.
   */
  usedModel: Annotation<string | null>({
    reducer: (_, y) => y ?? null,
    default: () => null,
  }),
});
```

#### 2. Cada Agente Registra el Modelo Usado

```typescript
// modules/agents/business-central/bc-agent.ts
async invoke(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
  const bcConfig = getModelConfig('bc_agent');
  const model = ModelFactory.create({ ...bcConfig, ... });

  // ... ejecutar modelo ...

  return {
    messages: newMessages,
    toolExecutions,
    usedModel: bcConfig.modelName,  // ← NUEVO: Registrar modelo
  };
}
```

#### 3. Normalizer Extrae el Modelo del Estado

```typescript
// shared/providers/normalizers/BatchResultNormalizer.ts
normalize(state: AgentState, adapter: IProviderAdapter): NormalizedAgentEvent[] {
  const usedModel = state.usedModel ?? 'unknown';

  // Cada evento normalizado incluye el modelo real
  return events.map(e => ({
    ...e,
    metadata: { ...e.metadata, model: usedModel }
  }));
}
```

#### 4. PersistenceStrategy como Regla

```typescript
// Definir regla de persistencia por tipo de evento
const PersistenceStrategyMap: Record<NormalizedEventType, PersistenceStrategy> = {
  'session_start': 'transient',
  'user_message': 'sync',
  'thinking': 'transient',  // O 'async' si queremos guardar thinking
  'tool_request': 'async',
  'tool_response': 'async',
  'assistant_message': 'sync',
  'error': 'transient',
  'complete': 'transient',
};

// En el normalizer
function getPersistenceStrategy(type: NormalizedEventType): PersistenceStrategy {
  return PersistenceStrategyMap[type] ?? 'transient';
}
```

### Beneficios

1. **Trazabilidad real**: Se persiste el modelo que REALMENTE se usó
2. **Billing preciso**: Los costos se calculan con el modelo correcto
3. **Debugging**: Se puede ver qué modelo procesó cada request
4. **Configuración centralizada**: `models.ts` es el único punto de verdad
5. **Sin hardcoding**: Los valores se derivan de reglas y estado

### Archivos Adicionales a Modificar

| Archivo | Cambio |
|---------|--------|
| `modules/agents/orchestrator/state.ts` | Agregar `usedModel` al estado |
| `modules/agents/business-central/bc-agent.ts` | Retornar `usedModel` |
| `modules/agents/rag-knowledge/rag-agent.ts` | Retornar `usedModel` |
| `modules/agents/orchestrator/router.ts` | Retornar `usedModel` (si aplica) |

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Breaking changes en evento order | Media | Alto | Tests de paridad obligatorios |
| Performance regression | Baja | Medio | Benchmark antes/después |
| Pérdida de datos en persistencia | Baja | Alto | Tests E2E con DB real |
| Incompatibilidad con frontend | Media | Alto | Usar tipos de @bc-agent/shared |

---

## 10. Dependencias

### Ningún cambio requerido en:
- Frontend (usa mismos tipos de @bc-agent/shared)
- Base de datos (schema no cambia)
- Redis/EventStore (misma API)
- LangGraph (misma invocación)

### Requiere:
- Actualización de CLAUDE.md
- Actualización de contratos en /docs/plans/Refactor/contracts/

---

## Apéndice A: Ejemplo de Flujo Completo

### Input: Usuario pregunta con thinking habilitado

```typescript
// graph.invoke() retorna:
AgentState = {
  messages: [
    HumanMessage("Create a sales order for customer X"),
    AIMessage({
      content: [
        { type: 'thinking', thinking: 'I need to...' },
        { type: 'text', text: 'I will create the order.' },
        { type: 'tool_use', id: 'toolu_01...', name: 'create_order', input: {...} }
      ],
      response_metadata: { stop_reason: 'tool_use', usage: {...} }
    }),
    ToolMessage("Order created: SO-001"),
    AIMessage({
      content: [{ type: 'text', text: 'Done! Order SO-001 created.' }],
      response_metadata: { stop_reason: 'end_turn', usage: {...} }
    })
  ],
  toolExecutions: [
    { toolUseId: 'toolu_01...', toolName: 'create_order', result: 'Order created: SO-001', success: true }
  ]
}
```

### Output: Eventos Normalizados (en orden)

```typescript
NormalizedAgentEvent[] = [
  { type: 'thinking', content: 'I need to...', originalIndex: 1 },
  { type: 'assistant_message', content: 'I will create the order.', originalIndex: 2 },
  { type: 'tool_request', metadata: { toolUseId: 'toolu_01...', ... }, originalIndex: 3 },
  { type: 'tool_response', metadata: { toolUseId: 'toolu_01...', result: '...', success: true }, originalIndex: 4 },
  { type: 'assistant_message', content: 'Done! Order SO-001 created.', originalIndex: 5 }
]
```

### Emisión (sin condicionales)

```typescript
for (const event of normalizedEvents) {
  emit(event);    // session_start ya emitido antes
  persist(event); // Según persistenceStrategy
}
emit({ type: 'complete' });
```

---

## Apéndice B: Mapeo de EventStore Types

Para mantener compatibilidad con EventStore, el normalizador mapea:

| NormalizedEventType | EventStore EventType | Notas |
|---------------------|---------------------|-------|
| `thinking` | `agent_thinking_block` | Bloque completo |
| `assistant_message` | `agent_message_sent` | Mensaje final |
| `tool_request` | `tool_use_requested` | Solicitud |
| `tool_response` | `tool_use_completed` | Resultado |
| `error` | `error_occurred` | Error |

---

*Documento generado: 2026-01-04*
*Próxima revisión: Antes de implementación*
