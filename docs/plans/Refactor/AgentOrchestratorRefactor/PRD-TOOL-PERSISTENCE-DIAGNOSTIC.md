# PRD: Diagnóstico de Persistencia de Tools en Agent Orchestrator

> **Fecha**: 2026-01-05
> **Versión**: 1.0
> **Autor**: Engineering Team
> **Status**: Diagnóstico Completo - Soluciones Propuestas
> **Contexto**: Post-implementación de PRD-AGENT-ORCHESTRATOR-REFACTOR

---

## Executive Summary

### Problema Identificado

Después de la implementación del refactor del Agent Orchestrator, se detectaron problemas críticos en el flujo de persistencia de eventos de tools:

1. **Secuencias Rotas**: Después de un refresh, las secuencias muestran gaps (1 → 2 → 5 → 8 en lugar de 1 → 2 → 3 → 4...)
2. **Múltiples Persistencias**: Un solo tool execution genera 5+ entradas en la base de datos
3. **Input/Output Fragmentados**: Los argumentos del tool y su resultado se guardan en registros separados
4. **Errores de Log**: "Tool use event NOT persisted" y "CRITICAL: Complete message NOT marked as persisted"

### Causa Raíz

Existen **5 rutas de persistencia independientes** que se ejecutan simultáneamente para el mismo tool:

```
Tool Execution
    │
    ├─→ 1. AgentOrchestrator.persistAsyncEvent(tool_request)
    │       └─→ persistToolEventsAsync() → 2 sequence numbers
    │
    ├─→ 2. AgentOrchestrator.persistAsyncEvent(tool_response)
    │       └─→ persistToolEventsAsync() → 2 sequence numbers MÁS
    │
    └─→ 3. ChatMessageHandler fallback (persistenceState ≠ 'persisted')
            └─→ handleToolUse() → 1+ sequence numbers ADICIONALES
```

### Impacto

| Área | Impacto |
|------|---------|
| **UX** | El usuario ve mensajes duplicados o en orden incorrecto después de refresh |
| **Storage** | 5x más datos almacenados de lo necesario |
| **Billing** | Posible doble conteo de tool executions |
| **Debugging** | Difícil rastrear el flujo real de un tool execution |

---

## 1. Diagnóstico Técnico Detallado

### 1.1 Bug #1: `persistToolEventsAsync()` Siempre Persiste AMBOS Eventos

**Archivo**: `backend/src/domains/agent/persistence/PersistenceCoordinator.ts`
**Líneas**: 425-513

```typescript
persistToolEventsAsync(sessionId: string, executions: ToolExecution[]): void {
  (async () => {
    for (const exec of executions) {
      // SIEMPRE persiste tool_use_requested → Sequence N
      const toolUseDbEvent = await this.eventStore.appendEvent(
        sessionId,
        'tool_use_requested',
        {
          tool_use_id: exec.toolUseId,
          tool_name: exec.toolName,
          tool_args: exec.toolInput,
          timestamp: exec.timestamp,
          persistenceState: 'persisted',
        }
      );

      await this.messageQueue.addMessagePersistence({...});

      // SIEMPRE persiste tool_use_completed → Sequence N+1
      const toolResultDbEvent = await this.eventStore.appendEvent(
        sessionId,
        'tool_use_completed',
        {
          tool_use_id: exec.toolUseId,
          result: exec.toolOutput,
          success: exec.success,
          error: exec.error,
          timestamp: exec.timestamp,
          persistenceState: 'persisted',
        }
      );

      await this.messageQueue.addMessagePersistence({...});
    }
  })();
}
```

**Problema**:
- Este método SIEMPRE crea 2 entradas (tool_use_requested + tool_use_completed)
- Se llama múltiples veces para el mismo tool
- No hay deduplicación por `toolUseId`

### 1.2 Bug #2: `persistAsyncEvent()` Llama Duplicado

**Archivo**: `backend/src/domains/agent/orchestration/AgentOrchestrator.ts`
**Líneas**: 484-514

```typescript
private persistAsyncEvent(
  event: NormalizedAgentEvent,
  sessionId: string
): void {
  if (event.type === 'tool_request') {
    const toolReqEvent = event as NormalizedToolRequestEvent;
    const persistenceExec: PersistenceToolExecution = {
      toolUseId: toolReqEvent.toolUseId,
      toolName: toolReqEvent.toolName,
      toolInput: toolReqEvent.args,
      toolOutput: '',  // ⚠️ OUTPUT VACÍO
      success: true,
      timestamp: toolReqEvent.timestamp,
    };
    this.persistenceCoordinator.persistToolEventsAsync(sessionId, [persistenceExec]);
  } else if (event.type === 'tool_response') {
    const toolRespEvent = event as NormalizedToolResponseEvent;
    const persistenceExec: PersistenceToolExecution = {
      toolUseId: toolRespEvent.toolUseId,
      toolName: toolRespEvent.toolName,
      toolInput: {},  // ⚠️ INPUT VACÍO
      toolOutput: toolRespEvent.result ?? '',
      success: toolRespEvent.success,
      error: toolRespEvent.error,
      timestamp: toolRespEvent.timestamp,
    };
    this.persistenceCoordinator.persistToolEventsAsync(sessionId, [persistenceExec]);
  }
}
```

**Problema**:
- Se llama para `tool_request` con `toolOutput: ''`
- Se llama OTRA VEZ para `tool_response` con `toolInput: {}`
- Cada llamada genera 2 entradas en EventStore
- **Total del Orchestrator**: 4 sequence numbers por tool

### 1.3 Bug #3: ChatMessageHandler Fallback Crea Más Duplicados

**Archivo**: `backend/src/services/websocket/ChatMessageHandler.ts`
**Líneas**: 319-362

```typescript
case 'tool_use':
  if ((event as ToolUseEvent).persistenceState === 'persisted') {
    this.logger.debug('✅ Tool use event already persisted by AgentOrchestrator');
  } else if ((event as ToolUseEvent).persistenceState === 'transient') {
    this.logger.debug('⏩ Tool use event is transient (skipping persistence)');
  } else {
    // ❌ SIEMPRE entra aquí porque persistenceState es 'pending'
    this.logger.error('❌ Tool use event NOT persisted by AgentOrchestrator');
    await this.handleToolUse(event as ToolUseEvent, sessionId, userId);
  }
  break;
```

**Causa**: En `AgentOrchestrator.toAgentEvent()` (línea 362):
```typescript
persistenceState: normalized.persistenceStrategy === 'transient'
  ? 'transient' as const
  : 'pending' as const,  // ⚠️ Siempre 'pending', nunca 'persisted'
```

### 1.4 Bug #4: Input/Output Fragmentados

El diseño actual persiste input y output en momentos diferentes:

| Evento | toolInput | toolOutput | Problema |
|--------|-----------|------------|----------|
| tool_request → persist | ✅ Presente | ❌ Vacío | Output no disponible aún |
| tool_response → persist | ❌ Vacío | ✅ Presente | Input perdido |

**Resultado**: No hay un registro unificado con input Y output juntos.

---

## 2. Flujo de Persistencia Actual (Diagrama)

### 2.1 Flujo Completo de un Tool Execution

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          TOOL EXECUTION FLOW                                  │
└──────────────────────────────────────────────────────────────────────────────┘

1. BC Agent ejecuta tool
   │
   ▼
2. BatchResultNormalizer.normalize()
   ├── Crea NormalizedToolRequestEvent  { type: 'tool_request', args }
   └── Crea NormalizedToolResponseEvent { type: 'tool_response', result }
   │
   ▼
3. AgentOrchestrator.processNormalizedEvent()
   │
   ├── Para tool_request:
   │   │
   │   ├── toAgentEvent() → persistenceState: 'pending'
   │   ├── emitEventSync() → WebSocket recibe evento
   │   └── persistAsyncEvent() ──────────────────────────────────┐
   │                                                              │
   │       ┌──────────────────────────────────────────────────────┘
   │       ▼
   │       persistToolEventsAsync([{ toolInput: args, toolOutput: '' }])
   │       │
   │       ├── appendEvent('tool_use_requested')  → Seq 3
   │       ├── messageQueue.add(tool_use)
   │       ├── appendEvent('tool_use_completed')  → Seq 4  ⚠️ Con output vacío!
   │       └── messageQueue.add(tool_result)
   │
   └── Para tool_response:
       │
       ├── toAgentEvent() → persistenceState: 'pending'
       ├── emitEventSync() → WebSocket recibe evento
       └── persistAsyncEvent() ──────────────────────────────────┐
                                                                  │
           ┌──────────────────────────────────────────────────────┘
           ▼
           persistToolEventsAsync([{ toolInput: {}, toolOutput: result }])
           │
           ├── appendEvent('tool_use_requested')  → Seq 5  ⚠️ Con input vacío!
           ├── messageQueue.add(tool_use)
           ├── appendEvent('tool_use_completed')  → Seq 6
           └── messageQueue.add(tool_result)
   │
   ▼
4. ChatMessageHandler.handleAgentEvent()
   │
   ├── Recibe tool_use con persistenceState: 'pending'
   │   └── ❌ "NOT persisted" → handleToolUse()
   │       │
   │       └── MessageService.saveToolUseMessage()
   │           └── appendEvent('tool_use_requested')  → Seq 7
   │
   └── Recibe tool_result con persistenceState: 'pending'
       └── ❌ "NOT persisted" → handleToolResult()
           │
           └── MessageService.updateToolResult()  (ya no crea seq adicional)

═══════════════════════════════════════════════════════════════════════════════
RESULTADO: 5+ sequence numbers para UN SOLO tool execution
═══════════════════════════════════════════════════════════════════════════════
```

### 2.2 Tabla de Rutas de Persistencia

| # | Origen | Método | Event Type | Seq | Input | Output |
|---|--------|--------|------------|-----|-------|--------|
| 1 | Orchestrator (tool_request) | persistToolEventsAsync | tool_use_requested | N | ✅ | ❌ |
| 2 | Orchestrator (tool_request) | persistToolEventsAsync | tool_use_completed | N+1 | ✅ | ❌ |
| 3 | Orchestrator (tool_response) | persistToolEventsAsync | tool_use_requested | N+2 | ❌ | ✅ |
| 4 | Orchestrator (tool_response) | persistToolEventsAsync | tool_use_completed | N+3 | ❌ | ✅ |
| 5 | ChatMessageHandler fallback | saveToolUseMessage | tool_use_requested | N+4 | ✅ | ❌ |

---

## 3. Verificación con SQL

### 3.1 Encontrar Tools con Múltiples Sequences

```sql
-- Azure SQL: Identificar duplicados de tool persistence
SELECT
  JSON_VALUE(data, '$.tool_use_id') as tool_id,
  JSON_VALUE(data, '$.tool_name') as tool_name,
  COUNT(*) as persistence_count,
  STRING_AGG(CAST(sequence_number AS VARCHAR), ', ') WITHIN GROUP (ORDER BY sequence_number) as sequences,
  STRING_AGG(event_type, ', ') WITHIN GROUP (ORDER BY sequence_number) as event_types
FROM message_events
WHERE session_id = 'A8095573-D705-423B-AE68-8C0B3B2586F9'
  AND event_type IN ('tool_use_requested', 'tool_use_completed')
GROUP BY JSON_VALUE(data, '$.tool_use_id'), JSON_VALUE(data, '$.tool_name')
HAVING COUNT(*) > 2
ORDER BY MIN(sequence_number);
```

### 3.2 Ver Timeline Completo de un Tool

```sql
-- Timeline detallado de eventos para un tool específico
SELECT
  sequence_number,
  event_type,
  JSON_VALUE(data, '$.tool_use_id') as tool_id,
  JSON_VALUE(data, '$.tool_name') as tool_name,
  CASE
    WHEN JSON_VALUE(data, '$.tool_args') IS NOT NULL
         AND JSON_VALUE(data, '$.tool_args') != '{}'
    THEN 'HAS_INPUT'
    ELSE 'NO_INPUT'
  END as has_input,
  CASE
    WHEN JSON_VALUE(data, '$.result') IS NOT NULL
         AND JSON_VALUE(data, '$.result') != ''
    THEN 'HAS_OUTPUT'
    ELSE 'NO_OUTPUT'
  END as has_output,
  timestamp
FROM message_events
WHERE session_id = 'A8095573-D705-423B-AE68-8C0B3B2586F9'
  AND JSON_VALUE(data, '$.tool_use_id') = 'toolu_016sNkGK2H5pxDGwF71pUKNQ'
ORDER BY sequence_number;
```

### 3.3 Verificar Gaps en Secuencias

```sql
-- Encontrar gaps en la secuencia
WITH numbered AS (
  SELECT
    sequence_number,
    LAG(sequence_number) OVER (ORDER BY sequence_number) as prev_seq
  FROM message_events
  WHERE session_id = 'A8095573-D705-423B-AE68-8C0B3B2586F9'
)
SELECT
  prev_seq + 1 as gap_start,
  sequence_number - 1 as gap_end,
  sequence_number - prev_seq - 1 as gap_size
FROM numbered
WHERE sequence_number - prev_seq > 1;
```

### 3.4 Contar Duplicados por Sesión

```sql
-- Resumen de duplicados por sesión
SELECT
  session_id,
  COUNT(DISTINCT JSON_VALUE(data, '$.tool_use_id')) as unique_tools,
  COUNT(*) as total_tool_events,
  CAST(COUNT(*) AS FLOAT) / NULLIF(COUNT(DISTINCT JSON_VALUE(data, '$.tool_use_id')), 0) as avg_events_per_tool
FROM message_events
WHERE event_type IN ('tool_use_requested', 'tool_use_completed')
  AND created_at > DATEADD(day, -1, GETUTCDATE())
GROUP BY session_id
HAVING COUNT(*) > COUNT(DISTINCT JSON_VALUE(data, '$.tool_use_id')) * 2
ORDER BY total_tool_events DESC;
```

---

## 4. Estrategia de Logging

### 4.1 Configuración por Variable de Entorno

El sistema usa Pino como logger. Se pueden configurar estas variables:

#### Opción A: Filtrar por Servicio

```bash
# Solo ver logs de los servicios relevantes
LOG_SERVICES=AgentOrchestrator,PersistenceCoordinator,ChatMessageHandler,MessageService,EventStore npm run dev
```

**Implementación requerida** en `backend/src/shared/utils/logger.ts`:

```typescript
const allowedServices = process.env.LOG_SERVICES?.split(',') ?? [];

export function createChildLogger(service: string) {
  if (allowedServices.length > 0 && !allowedServices.includes(service)) {
    return silentLogger; // Logger que no emite nada
  }
  return baseLogger.child({ service });
}
```

#### Opción B: Filtrar por Patrón

```bash
# Filtrar logs que contengan ciertos patrones
LOG_PATTERN="persist|sequence|tool" npm run dev
```

**Implementación** (usando pino-pretty con grep):

```bash
npm run dev 2>&1 | grep -E "persist|sequence|tool"
```

#### Opción C: Logger de Diagnóstico Temporal

Agregar un logger específico con prefijo `[DIAG]`:

```typescript
// En PersistenceCoordinator.ts
private diagLogger = createChildLogger('DIAG:Persistence');

persistToolEventsAsync(sessionId: string, executions: ToolExecution[]): void {
  this.diagLogger.info({
    action: 'persistToolEventsAsync_CALLED',
    sessionId,
    toolUseIds: executions.map(e => e.toolUseId),
    caller: new Error().stack?.split('\n')[2]?.trim(), // Muestra quién llamó
  });
  // ...
}
```

### 4.2 Logs de Diagnóstico Recomendados

Agregar estos logs temporales para rastrear el flujo:

```typescript
// En AgentOrchestrator.persistAsyncEvent()
this.logger.info({
  tag: '[DIAG]',
  action: 'persistAsyncEvent',
  eventType: event.type,
  toolUseId: event.type === 'tool_request' ? (event as any).toolUseId : (event as any).toolUseId,
  hasInput: event.type === 'tool_request',
  hasOutput: event.type === 'tool_response',
}, 'Persistence triggered');

// En PersistenceCoordinator.persistToolEventsAsync()
this.logger.info({
  tag: '[DIAG]',
  action: 'persistToolEventsAsync',
  toolUseId: exec.toolUseId,
  hasToolInput: !!exec.toolInput && Object.keys(exec.toolInput).length > 0,
  hasToolOutput: !!exec.toolOutput && exec.toolOutput !== '',
}, 'About to create EventStore entries');

// En ChatMessageHandler (case 'tool_use')
this.logger.info({
  tag: '[DIAG]',
  action: 'ChatMessageHandler.tool_use',
  persistenceState: (event as ToolUseEvent).persistenceState,
  willTriggerFallback: (event as ToolUseEvent).persistenceState !== 'persisted',
}, 'Tool use event received');
```

### 4.3 Comando para Filtrar en Runtime

```bash
# Filtrar solo logs de diagnóstico
npm run dev 2>&1 | grep "\[DIAG\]"

# Con formato JSON procesable
npm run dev 2>&1 | grep "\[DIAG\]" | jq '.'

# Guardar a archivo para análisis
npm run dev 2>&1 | grep "\[DIAG\]" > diagnostic_$(date +%Y%m%d_%H%M%S).log
```

---

## 5. Soluciones Propuestas

### 5.1 Solución 1: Unificar Persistencia en tool_response (Recomendada)

**Concepto**: Solo persistir cuando tenemos AMBOS input Y output.

**Cambios**:

```typescript
// AgentOrchestrator.ts - NUEVO
private pendingToolInputs = new Map<string, {
  args: Record<string, unknown>;
  toolName: string;
  timestamp: string;
}>();

private persistAsyncEvent(event: NormalizedAgentEvent, sessionId: string): void {
  if (event.type === 'tool_request') {
    // Solo guardar en memoria, NO persistir
    const toolReqEvent = event as NormalizedToolRequestEvent;
    this.pendingToolInputs.set(toolReqEvent.toolUseId, {
      args: toolReqEvent.args,
      toolName: toolReqEvent.toolName,
      timestamp: toolReqEvent.timestamp,
    });
    return; // NO llamar a persistToolEventsAsync aquí
  }

  if (event.type === 'tool_response') {
    const toolRespEvent = event as NormalizedToolResponseEvent;
    const pending = this.pendingToolInputs.get(toolRespEvent.toolUseId);

    if (!pending) {
      this.logger.warn({ toolUseId: toolRespEvent.toolUseId }, 'tool_response without matching tool_request');
      return;
    }

    // AHORA SÍ persistir con input + output unificados
    this.persistenceCoordinator.persistToolEventsAsync(sessionId, [{
      toolUseId: toolRespEvent.toolUseId,
      toolName: pending.toolName,
      toolInput: pending.args,        // ✅ Del tool_request
      toolOutput: toolRespEvent.result ?? '',  // ✅ Del tool_response
      success: toolRespEvent.success,
      error: toolRespEvent.error,
      timestamp: toolRespEvent.timestamp,
    }]);

    this.pendingToolInputs.delete(toolRespEvent.toolUseId);
  }
}
```

**Pros**:
- Un solo registro por tool con input + output
- Solo 2 sequence numbers (tool_use_requested + tool_use_completed)
- Datos completos en cada registro

**Cons**:
- Si tool_response nunca llega, el input se pierde
- Requiere manejo de timeout/cleanup del Map

**Esfuerzo**: Medio (2-3 días)

### 5.2 Solución 2: Eliminar Fallback de ChatMessageHandler

**Concepto**: El Orchestrator es la única fuente de persistencia.

**Cambios**:

```typescript
// ChatMessageHandler.ts - MODIFICAR
case 'tool_use':
  if ((event as ToolUseEvent).persistenceState !== 'persisted') {
    // SOLO loggear, NO persistir
    this.logger.warn({
      toolUseId: (event as ToolUseEvent).toolUseId,
      persistenceState: (event as ToolUseEvent).persistenceState,
    }, 'Tool use event not marked as persisted (expected behavior in async flow)');
    // NO llamar a handleToolUse() - esto crea duplicados
  }
  break;

case 'tool_result':
  if ((event as ToolResultEvent).persistenceState !== 'persisted') {
    this.logger.warn({
      toolUseId: (event as ToolResultEvent).toolUseId,
    }, 'Tool result event not marked as persisted (expected behavior in async flow)');
    // NO llamar a handleToolResult()
  }
  break;
```

**Pros**:
- Cambio mínimo
- Elimina 1-2 sequences duplicadas

**Cons**:
- No resuelve las 4 sequences del Orchestrator
- No unifica input/output

**Esfuerzo**: Bajo (0.5 días)

### 5.3 Solución 3: Deduplicación por toolUseId

**Concepto**: Bloquear persistencia si ya existe.

**Cambios**:

```typescript
// PersistenceCoordinator.ts - MODIFICAR
private persistedTools = new Map<string, Set<string>>(); // sessionId -> Set<toolUseId>

persistToolEventsAsync(sessionId: string, executions: ToolExecution[]): void {
  if (!this.persistedTools.has(sessionId)) {
    this.persistedTools.set(sessionId, new Set());
  }
  const sessionSet = this.persistedTools.get(sessionId)!;

  (async () => {
    for (const exec of executions) {
      if (sessionSet.has(exec.toolUseId)) {
        this.logger.debug({ toolUseId: exec.toolUseId }, 'Duplicate persistence blocked');
        continue;
      }
      sessionSet.add(exec.toolUseId);

      // ... resto del código de persistencia
    }
  })();
}
```

**Pros**:
- Garantiza solo 2 sequences por tool
- No requiere cambiar la estructura de llamadas

**Cons**:
- El primer persist (con output vacío) gana
- No resuelve el problema de input/output fragmentados
- El Map puede crecer sin límite (memory leak)

**Esfuerzo**: Bajo (1 día)

### 5.4 Solución 4: Refactor Completo de Tool Lifecycle (Ideal)

**Concepto**: Máquina de estados explícita para tools.

```typescript
// Nuevo: ToolLifecycleManager.ts
interface ToolState {
  toolUseId: string;
  sessionId: string;
  state: 'requested' | 'executing' | 'completed' | 'failed';
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  requestedAt: string;
  completedAt?: string;
  persistedAt?: string;
  sequenceNumber?: number;
}

class ToolLifecycleManager {
  private tools = new Map<string, ToolState>();

  onToolRequested(sessionId: string, toolUseId: string, args: Record<string, unknown>): void {
    this.tools.set(toolUseId, {
      toolUseId,
      sessionId,
      state: 'requested',
      args,
      requestedAt: new Date().toISOString(),
    });
  }

  onToolCompleted(toolUseId: string, result: string): void {
    const tool = this.tools.get(toolUseId);
    if (!tool) return;

    tool.state = 'completed';
    tool.result = result;
    tool.completedAt = new Date().toISOString();

    // AHORA persistir con estado completo
    this.persistTool(tool);
  }

  private async persistTool(tool: ToolState): Promise<void> {
    if (tool.persistedAt) return; // Ya persistido

    // Persistir una sola vez con todos los datos
    // ...
    tool.persistedAt = new Date().toISOString();
  }
}
```

**Pros**:
- Modelo de datos limpio y consistente
- Estados claros y trazables
- Fácil de extender para nuevos estados (cancelled, timeout, etc.)
- Perfecto para billing y analytics

**Cons**:
- Refactor significativo
- Requiere migración de datos existentes
- Más código a mantener

**Esfuerzo**: Alto (1-2 semanas)

---

## 6. Matriz de Comparación

| Criterio | Sol 1 (Unificar) | Sol 2 (Sin Fallback) | Sol 3 (Dedup) | Sol 4 (Lifecycle) |
|----------|------------------|----------------------|---------------|-------------------|
| Esfuerzo | Medio | Bajo | Bajo | Alto |
| Riesgo | Bajo | Muy Bajo | Bajo | Medio |
| Completitud | Alta | Parcial | Parcial | Total |
| Input+Output Unificado | ✅ | ❌ | ❌ | ✅ |
| Sequences Correctas | ✅ | Parcial | ✅ | ✅ |
| Escalable | ✅ | ❌ | ❌ | ✅ |

---

## 7. Plan de Implementación Recomendado

### Fase 1: Quick Win (Inmediato)

**Objetivo**: Eliminar la mayoría de duplicados con cambio mínimo.

1. Implementar **Solución 2** (Eliminar fallback de ChatMessageHandler)
2. Implementar **Solución 3** (Deduplicación por toolUseId)

**Resultado esperado**: De 5+ sequences por tool → 2-4 sequences

### Fase 2: Unificación (Corto plazo)

**Objetivo**: Input y output juntos, secuencias correctas.

1. Implementar **Solución 1** (Unificar persistencia en tool_response)
2. Agregar cleanup del Map con TTL

**Resultado esperado**: 2 sequences exactas por tool, datos unificados

### Fase 3: Arquitectura Ideal (Mediano plazo)

**Objetivo**: Sistema robusto y extensible.

1. Diseñar **Solución 4** (Tool Lifecycle Manager) como parte del siguiente refactor
2. Migrar datos históricos
3. Agregar métricas de tool execution

---

## 8. Métricas de Éxito

### 8.1 KPIs a Medir

| Métrica | Valor Actual | Objetivo |
|---------|--------------|----------|
| Sequences por tool | 5+ | 2 |
| Duplicados en message_events | ~60% | 0% |
| Errores "NOT persisted" | Frecuente | 0 |
| Input+Output completo | ~50% | 100% |

### 8.2 Query de Monitoreo

```sql
-- Ejecutar diariamente para medir progreso
SELECT
  CAST(created_at AS DATE) as date,
  COUNT(DISTINCT JSON_VALUE(data, '$.tool_use_id')) as unique_tools,
  COUNT(*) as total_events,
  CAST(COUNT(*) AS FLOAT) / NULLIF(COUNT(DISTINCT JSON_VALUE(data, '$.tool_use_id')), 0) as events_per_tool
FROM message_events
WHERE event_type IN ('tool_use_requested', 'tool_use_completed')
  AND created_at > DATEADD(day, -7, GETUTCDATE())
GROUP BY CAST(created_at AS DATE)
ORDER BY date DESC;
```

---

## 9. Apéndice

### 9.1 Session ID de Referencia

El análisis se realizó usando la sesión: `A8095573-D705-423B-AE68-8C0B3B2586F9`

### 9.2 Archivos Críticos

| Archivo | Responsabilidad |
|---------|-----------------|
| `backend/src/domains/agent/orchestration/AgentOrchestrator.ts` | Coordinación y emisión |
| `backend/src/domains/agent/persistence/PersistenceCoordinator.ts` | Persistencia de eventos |
| `backend/src/services/websocket/ChatMessageHandler.ts` | Fallback de persistencia |
| `backend/src/services/events/EventStore.ts` | Generación de sequences |
| `backend/src/services/messages/MessageService.ts` | Almacenamiento de mensajes |
| `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts` | Normalización de eventos |

### 9.3 Relacionado

- [PRD-AGENT-ORCHESTRATOR-REFACTOR.md](./PRD-AGENT-ORCHESTRATOR-REFACTOR.md) - PRD original del refactor
- [01-CONTRATO-INTERNO-BACKEND.md](../contracts/01-CONTRATO-INTERNO-BACKEND.md) - Contrato interno del backend
