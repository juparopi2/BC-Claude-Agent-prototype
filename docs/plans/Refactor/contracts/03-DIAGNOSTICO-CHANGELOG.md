# Diagnóstico y Changelog de Fallos E2E

**Fecha de Creación**: 2025-12-23
**Estado**: En Análisis
**Prioridad**: CRÍTICA

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Fallos Actuales en Tests E2E](#fallos-actuales-en-tests-e2e)
3. [Análisis de Causa Raíz](#análisis-de-causa-raíz)
4. [Changelog de Correcciones](#changelog-de-correcciones)
5. [Insights y Aprendizajes](#insights-y-aprendizajes)

---

## Resumen Ejecutivo

### Métricas Actuales

| Métrica | Valor | Objetivo |
|---------|-------|----------|
| **Tests Fallando** | 16 | 0 |
| **Suites Afectadas** | 4 | 0 |
| **Tipo Principal** | FK Constraint Violations | - |
| **Impacto** | Alto - Pipeline bloqueado | - |

### Patrones Identificados

1. **FK Constraint Violations** (10 tests): Usuario no existe en tabla `users`
2. **Sequence Number = 0** (3 tests): EventStore no asigna secuencia
3. **Eventos Faltantes** (3 tests): Complete sin reason, eventos desordenados

---

## Fallos Actuales en Tests E2E

### Suite 1: E2E-09 Session Recovery (12 fallos)

**Archivo**: `backend/src/__tests__/e2e/flows/09-session-recovery.e2e.test.ts`

#### 1.1 Page Refresh Recovery (3 fallos)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 1 | `should retrieve full message history after disconnect` | `AssertionError: expected 1 >= 2` | L96 |
| 2 | `should preserve message order after recovery` | `AssertionError: expected [] to have a length of 3` | L139 |
| 3 | `should include assistant responses in recovered history` | `AssertionError: expected 0 > 0` | L177 |

**Síntoma Común**: Mensajes no persisten en la base de datos después de `disconnect()`.

**Análisis**:
```typescript
// El test espera:
expect(userMessages.length).toBeGreaterThanOrEqual(2); // FALLA: obtiene 1

// Causa probable:
// 1. MessageQueue async write no completa antes de disconnect
// 2. Timeout de MESSAGE_CLEANUP insuficiente
// 3. disconnect() cierra conexión antes de flush de cola
```

#### 1.2 WebSocket Reconnection (2 fallos)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 4 | `should receive new events after reconnection` | `TimeoutError: Join session timeout after 30000ms` | L217 |
| 5 | `should handle rapid disconnect/reconnect` | `FOREIGN KEY constraint failed` | L241 |

**Error FK Constraint** (Test #5):
```
FOREIGN KEY constraint failed
INSERT INTO sessions (id, user_id, ...)
VALUES ('...', '5ce7f8c8-d52d-475f-8d86-3705eb29be5d', ...)
```

**Análisis**:
- `user_id = 5ce7f8c8-d52d-475f-8d86-3705eb29be5d` no existe en tabla `users`
- Usuario creado en `beforeAll()` pero test corre con usuario inexistente
- **Problema de timing**: ¿Usuario se elimina antes de terminar tests?
- **Problema de paralelismo**: ¿Tests corren en paralelo compartiendo userId?

#### 1.3 Interrupted Stream Recovery (2 fallos)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 6 | `should handle disconnect during streaming` | `FOREIGN KEY constraint failed` | L272 |
| 7 | `should persist partial responses before disconnect` | `FOREIGN KEY constraint failed` | L305 |

**Mismo userId problemático**: `5ce7f8c8-d52d-475f-8d86-3705eb29be5d`

#### 1.4 Session Context Preservation (2 fallos)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 8 | `should maintain conversation context across reconnections` | `FOREIGN KEY constraint failed` | L343 |
| 9 | `should preserve session metadata` | `FOREIGN KEY constraint failed` | L378 |

#### 1.5 Multiple Session Recovery (1 fallo)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 10 | `should recover correct session when user has multiple` | `FOREIGN KEY constraint failed` | L411 |

#### 1.6 Error Recovery (2 fallos)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 11 | `should recover from connection errors` | `Error: Authentication required` | L468 |
| 12 | `should handle invalid session ID gracefully on recovery` | `Error: Authentication required` | L484 |

**Análisis Error de Autenticación**:
```typescript
// Los tests usan:
await client.connect();
await client.joinSession(testSession.id);

// Pero testSession se creó con testUser de beforeAll
// Si testUser ya no existe → autenticación falla
```

---

### Suite 2: WebSocket Agent Events (3 fallos)

**Archivo**: `backend/src/__tests__/e2e/websocket/events.ws.test.ts`

#### 2.1 user_message_confirmed event (1 fallo)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 13 | `should include sequence number and message ID` | `AssertionError: expected 0 > 0` | L100 |

**Error Completo**:
```typescript
const confirmEvent = await client.waitForAgentEvent('user_message_confirmed');
expect(confirmEvent.sequenceNumber).toBeGreaterThan(0); // FALLA: recibe 0
```

**Análisis**:
- `sequenceNumber = 0` indica que EventStore NO asignó secuencia
- Redis INCR retorna 0 → Redis no conectado O clave incorrecta
- Fallback a DB sin transacción → retorna default 0

**Posibles Causas**:
1. Redis no disponible en E2E tests
2. EventStore usa fallback DB pero query retorna 0
3. FakeAgentOrchestrator bypass EventStore por completo

#### 2.2 complete event (2 fallos)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 14 | `should receive complete event at the end` | `AssertionError: expected to have property "reason"` | ~L180 |
| 15 | `should be the last event in the sequence` | `AssertionError: expected 'message_chunk' to be 'complete'` | ~L190 |

**Error #14 - Missing Reason**:
```typescript
const completeEvent = events.find(e => e.type === 'complete');
expect(completeEvent).toHaveProperty('reason'); // FALLA: reason undefined
```

**Error #15 - Wrong Last Event**:
```typescript
const lastEvent = events[events.length - 1];
expect(lastEvent.type).toBe('complete'); // FALLA: recibe 'message_chunk'
```

**Análisis**:
- Complete event emitido SIN field `reason` (debería ser 'end_turn', 'max_tokens', etc.)
- Eventos llegan DESPUÉS de complete → orden incorrecto
- GraphStreamProcessor o AgentEventEmitter no emite complete correctamente

---

### Suite 3: Multi-Tool With Thinking Scenario (1 fallo)

**Archivo**: `backend/src/__tests__/e2e/scenarios/patterns/multi-tool-with-thinking.scenario.test.ts`

#### 3.1 Message Persistence (1 fallo)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 16 | `should persist assistant message` | `AssertionError: expected undefined to be defined` | ~L150 |

**Error Completo**:
```typescript
// scenarioResult.dbMessages contiene mensajes persistidos
const assistantMsg = scenarioResult.dbMessages.find(m => m.role === 'assistant');
expect(assistantMsg).toBeDefined(); // FALLA: undefined
```

**Análisis**:
- Mensaje de asistente NO se guarda en tabla `messages`
- MessageQueue async write no completa antes de query
- FakeAgentOrchestrator puede NO disparar real persistence

**Timing del Problema**:
```
1. Scenario ejecuta → eventos emitidos
2. beforeAll() termina → query a DB inmediata
3. MessageQueue.processToolMessage() aún en cola BullMQ
4. Query retorna vacío → test falla
```

---

### Suite 4: Tool Execution Error (2 fallos)

**Archivo**: `backend/src/__tests__/e2e/scenarios/patterns/tool-execution-error.scenario.test.ts` (inferido)

#### 4.1 Error Handling (2 fallos)

| # | Test | Error | Línea |
|---|------|-------|-------|
| 17 | `should have error in tool_result or error event` | `AssertionError: expected undefined to be defined` | TBD |
| 18 | `should have tool_use event before failure` | `AssertionError: expected undefined to be truthy` | TBD |

**Análisis Preliminar**:
- Error handling no emite eventos esperados (`error` o `tool_result` con error)
- Tool execution error flow no match contrato esperado
- Requiere verificar: `ToolExecutionProcessor` y manejo de errores en `GraphStreamProcessor`

---

## Análisis de Causa Raíz

### Categoría A: Foreign Key Constraint Violations

**Cantidad de Tests Afectados**: 10

**Causa Raíz Identificada**:

```typescript
// TestSessionFactory.createTestUser() crea usuario:
const testUser = await factory.createTestUser({ prefix: 'e2e_recovery_' });
// userId = '5ce7f8c8-d52d-475f-8d86-3705eb29be5d'

// Luego factory.createChatSession() intenta usar ese userId:
INSERT INTO sessions (id, user_id, ...)
VALUES ('...', '5ce7f8c8-d52d-475f-8d86-3705eb29be5d', ...)

// FALLA: usuario no existe en tabla users
```

**Hipótesis Principales**:

#### H1: Usuario Eliminado Prematuramente
```typescript
beforeAll(async () => {
  testUser = await factory.createTestUser(); // Crea user
  testSession = await factory.createChatSession(testUser.id); // OK aquí
});

// Pero durante tests...
it('test 1', async () => {
  // ¿factory.cleanup() llamado por otro test?
  // ¿Transacción rollback?
});
```

#### H2: Paralelismo de Tests
```typescript
// Vitest corre tests en paralelo por defecto
// Si dos tests usan mismo factory:
Test A: factory.createTestUser() → userId: 5ce7f8c8...
Test B: factory.createTestUser() → mismo userId (si usa seed fijo)

Test A: factory.cleanup() → DELETE FROM users WHERE id = '5ce7f8c8...'
Test B: factory.createChatSession() → FK CONSTRAINT FAIL
```

#### H3: Database Seeds Desactualizados
```typescript
// Si tests esperan usuario pre-existente en DB:
const EXPECTED_USER_ID = '5ce7f8c8-d52d-475f-8d86-3705eb29be5d';

// Pero DB se recreó (DROP + CREATE) sin seeds → usuario no existe
```

**Archivos Involucrados**:
- `backend/src/__tests__/integration/helpers/TestSessionFactory.ts`
- `backend/src/__tests__/e2e/flows/09-session-recovery.e2e.test.ts`
- `backend/src/__tests__/e2e/setup.e2e.ts`

**Acción Requerida**:
1. Verificar si `createTestUser()` inserta en DB o solo crea objeto
2. Revisar si `cleanup()` se llama entre tests (debería ser solo en `afterAll`)
3. Confirmar si tests corren en paralelo y comparten recursos
4. Validar que `beforeAll` completa ANTES de ejecutar tests

---

### Categoría B: Sequence Number = 0

**Cantidad de Tests Afectados**: 3 (+ probablemente otros no detectados)

**Causa Raíz Identificada**:

```typescript
// EventStore.saveUserMessage() debería retornar sequenceNumber > 0
const { sequenceNumber } = await eventStore.saveUserMessage(...);
// Pero retorna: sequenceNumber = 0

// Event emitido:
{
  type: 'user_message_confirmed',
  sequenceNumber: 0,  // ❌ INCORRECTO
  messageId: '...'
}
```

**Flujo Esperado**:
```typescript
// 1. Redis INCR (atómico)
const seq = await redis.incr(`session:${sessionId}:sequence`);
// seq = 1, 2, 3, ... (nunca 0)

// 2. Si Redis falla → Fallback a DB
const [result] = await db.query(`
  SELECT MAX(sequence_number) + 1 as next_seq
  FROM message_events
  WHERE session_id = @sessionId
`);
const seq = result.next_seq ?? 1; // Default 1, NO 0
```

**Flujo Actual (Problema)**:
```typescript
// Opción A: Redis no disponible en E2E
if (!redis.isConnected()) {
  // Fallback a DB
  const [result] = await db.query(...);
  return result.next_seq; // ¿Puede retornar 0 si query falla?
}

// Opción B: FakeAgentOrchestrator bypass EventStore
class FakeAgentOrchestrator {
  async execute() {
    // Emite eventos directamente SIN llamar EventStore
    this.emit('user_message_confirmed', {
      sequenceNumber: 0, // ❌ Hardcoded 0
      messageId: '...'
    });
  }
}
```

**Archivos Involucrados**:
- `backend/src/services/events/EventStore.ts` (líneas de fallback DB)
- `backend/src/__tests__/e2e/helpers/FakeAgentOrchestrator.ts`
- `backend/src/domains/agent/orchestration/AgentOrchestrator.ts`

**Acción Requerida**:
1. Verificar si Redis está disponible en tests E2E
2. Revisar fallback DB en EventStore (líneas ~150-200)
3. Confirmar si FakeAgentOrchestrator usa EventStore o emite directo
4. Asegurar que `sequenceNumber: 0` NUNCA se emite (mínimo 1)

---

### Categoría C: Complete Event Malformado

**Cantidad de Tests Afectados**: 2

**Causa Raíz Identificada**:

```typescript
// Complete event esperado:
{
  type: 'complete',
  reason: 'end_turn', // ❌ FALTA
  eventIndex: 15
}

// Complete event actual:
{
  type: 'complete',
  // reason: undefined ❌
  eventIndex: 15
}
```

**Origen del Problema**:

**Opción A: GraphStreamProcessor no extrae reason**
```typescript
// En GraphStreamProcessor.ts (hipotético)
case 'on_chat_model_end':
  const completeEvent = {
    type: 'complete',
    // ❌ FALTA: reason: event.data.output.stop_reason
  };
  this.emit('complete', completeEvent);
```

**Opción B: AgentEventEmitter no incluye reason**
```typescript
// En AgentEventEmitter.ts
emitComplete() {
  this.socket.emit('agent:event', {
    type: 'complete',
    eventIndex: this.tracker.next(),
    // ❌ FALTA: reason
  });
}
```

**Opción C: FakeAgentOrchestrator emite incompleto**
```typescript
// En FakeAgentOrchestrator.ts
this.responses.push({
  stopReason: 'end_turn', // Tiene reason aquí
});

// Pero al emitir:
this.emit('complete', {
  type: 'complete',
  // ❌ NO mapea stopReason → reason
});
```

**Archivos Involucrados**:
- `backend/src/domains/agent/streaming/GraphStreamProcessor.ts`
- `backend/src/domains/agent/emission/AgentEventEmitter.ts`
- `backend/src/__tests__/e2e/helpers/FakeAgentOrchestrator.ts`

**Acción Requerida**:
1. Buscar `emit('complete'` en codebase → verificar si incluye `reason`
2. Revisar contrato WebSocket (`docs/backend/websocket-contract.md`)
3. Agregar `reason` field en emisión de complete event
4. Validar que FakeAgentOrchestrator mapea `stopReason` correctamente

---

### Categoría D: Eventos Desordenados

**Cantidad de Tests Afectados**: 1

**Causa Raíz Identificada**:

```typescript
// Orden esperado:
events = [
  { type: 'user_message_confirmed', eventIndex: 0 },
  { type: 'message_chunk', eventIndex: 1 },
  { type: 'message_chunk', eventIndex: 2 },
  { type: 'complete', eventIndex: 3 } // ✅ Último
];

// Orden actual (problema):
events = [
  { type: 'user_message_confirmed', eventIndex: 0 },
  { type: 'message_chunk', eventIndex: 1 },
  { type: 'complete', eventIndex: 2 },       // ❌ Complete antes
  { type: 'message_chunk', eventIndex: 3 }   // ❌ Chunk después
];
```

**Hipótesis del Problema**:

#### H1: Race Condition en Emit
```typescript
// Dos threads emitiendo simultáneamente:
Thread A: emitComplete() → eventIndex: 2
Thread B: emitMessageChunk() → eventIndex: 3

// Pero Thread B llega primero al socket
Socket receives: chunk (3), then complete (2)
```

#### H2: Async Processing en GraphStreamProcessor
```typescript
async processStreamEvent(event) {
  if (event.type === 'on_chat_model_stream') {
    await this.processChunk(event); // Async
  } else if (event.type === 'on_chat_model_end') {
    this.emitComplete(); // Sync → llega primero
  }
}
```

#### H3: EventIndexTracker No Atómico
```typescript
class EventIndexTracker {
  private index = 0;

  next(): number {
    return this.index++; // ❌ NO atómico en async context
  }
}

// Si dos llamadas concurrentes:
Call A: next() → lee 5, retorna 5, escribe 6
Call B: next() → lee 5 (antes de write A), retorna 5, escribe 6
// Resultado: índices duplicados
```

**Archivos Involucrados**:
- `backend/src/domains/agent/emission/EventIndexTracker.ts`
- `backend/src/domains/agent/streaming/GraphStreamProcessor.ts`
- `backend/src/domains/agent/emission/AgentEventEmitter.ts`

**Acción Requerida**:
1. Revisar si `EventIndexTracker.next()` es thread-safe
2. Verificar orden de llamadas en GraphStreamProcessor
3. Agregar logs con timestamps para debugging
4. Considerar queue de emisión para garantizar orden

---

### Categoría E: Assistant Message No Persiste

**Cantidad de Tests Afectados**: 1

**Causa Raíz Identificada**:

```typescript
// Flujo esperado:
1. AgentOrchestrator.execute() → streaming completo
2. PersistenceCoordinator.persistAssistantMessage() → queue
3. MessageQueue.processMessage() → INSERT INTO messages
4. Test query DB → mensaje existe ✅

// Flujo actual (problema):
1. AgentOrchestrator.execute() → streaming completo
2. PersistenceCoordinator.persistAssistantMessage() → queue
3. beforeAll() termina → test query DB INMEDIATO
4. MessageQueue.processMessage() aún pending (BullMQ job)
5. Query retorna vacío → test falla ❌
```

**Problema de Timing**:
```typescript
beforeAll(async () => {
  scenarioResult = await registry.executeScenario('multi-tool-with-thinking');
  // executeScenario() retorna cuando streaming completa
  // PERO MessageQueue es ASYNC (BullMQ job)

  // Test query inmediato:
  const assistantMsg = scenarioResult.dbMessages.find(...); // ❌ Vacío
}, 120000);
```

**Solución Requerida**:
```typescript
beforeAll(async () => {
  scenarioResult = await registry.executeScenario('multi-tool-with-thinking');

  // ✅ Esperar flush de MessageQueue
  await drainMessageQueue(); // Helper que espera jobs completos

  // Ahora sí query DB
  const assistantMsg = scenarioResult.dbMessages.find(...); // ✅ Existe
}, 120000);
```

**Archivos Involucrados**:
- `backend/src/__tests__/e2e/helpers/ResponseScenarioRegistry.ts`
- `backend/src/__tests__/e2e/setup.e2e.ts` (helper `drainMessageQueue`)
- `backend/src/services/messages/MessageQueue.ts`

**Acción Requerida**:
1. Implementar `drainMessageQueue()` helper
2. Llamar en `executeScenario()` antes de retornar
3. Verificar que helper espera TODOS los jobs BullMQ
4. Considerar timeout configurable (default 5s)

---

### Categoría F: Tool Execution Error Handling

**Cantidad de Tests Afectados**: 2

**Análisis Preliminar**:

**Problema**: Cuando una ejecución de tool falla, el sistema NO emite eventos esperados.

**Contrato Esperado**:
```typescript
// Cuando tool execution falla:
events = [
  { type: 'tool_use', toolUseId: 'toolu_123', name: 'bc_customers_read' },
  { type: 'error', error: { message: 'API timeout', code: 'TIMEOUT' } },
  // O:
  { type: 'tool_result', toolUseId: 'toolu_123', isError: true, error: '...' }
];
```

**Contrato Actual (problema)**:
```typescript
// Tool falla pero NO hay eventos:
events = [
  { type: 'tool_use', toolUseId: 'toolu_123', name: 'bc_customers_read' },
  // ❌ NADA MÁS - silent failure
];
```

**Causa Probable**:
```typescript
// En ToolExecutionProcessor.ts
async executeTools(toolCalls) {
  for (const tool of toolCalls) {
    try {
      const result = await this.bcClient.execute(tool);
      this.emitter.emitToolResult(result);
    } catch (error) {
      // ❌ NO emite error event
      console.error('Tool execution failed:', error);
      // ¿Continúa loop? ¿Lanza error?
    }
  }
}
```

**Archivos Involucrados**:
- `backend/src/domains/agent/tools/ToolExecutionProcessor.ts`
- `backend/src/domains/agent/emission/AgentEventEmitter.ts`
- `backend/src/services/bc/BCClient.ts`

**Acción Requerida**:
1. Revisar manejo de errores en ToolExecutionProcessor
2. Implementar emisión de `error` event O `tool_result` con `isError: true`
3. Verificar que tests esperan el evento correcto
4. Documentar contrato en `docs/backend/websocket-contract.md`

---

## Changelog de Correcciones

### [COMPLETADO] Fix #7: Centralizar Normalización de StopReason en Providers

**Estado**: ✅ Completado
**Fecha**: 2025-12-23
**Prioridad**: ALTA (Arquitectura)
**Issue**: Lógica de normalización de `stopReason` hardcodeada en `AgentOrchestrator`

#### Problema Original

```typescript
// En AgentOrchestrator.ts (ANTES - MAL)
// Mapeo hardcodeado específico de Anthropic
const stopReasonToNormalized: Record<string, string> = {
  'end_turn': 'success',
  'max_tokens': 'max_turns',
  'tool_use': 'success',
  'stop_sequence': 'success',
};
const normalizedReason = stopReasonToNormalized[finalStopReason] ?? 'success';
```

**Problema**: Esta lógica específica de Anthropic estaba en el orchestrator,
violando el principio de que el orchestrator debe ser agnóstico al provider.

#### Solución Implementada

1. **Definir tipos normalizados** (`INormalizedEvent.ts`):
```typescript
export type NormalizedStopReason = 'success' | 'error' | 'max_turns' | 'user_cancelled';
export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
export type ProviderStopReason = AnthropicStopReason | OpenAIStopReason | string;
```

2. **Agregar método a interface** (`IStreamAdapter.ts`):
```typescript
interface IStreamAdapter {
  // ... métodos existentes ...
  normalizeStopReason(stopReason: ProviderStopReason): NormalizedStopReason;
}
```

3. **Implementar en adapter** (`AnthropicStreamAdapter.ts`):
```typescript
normalizeStopReason(stopReason: ProviderStopReason): NormalizedStopReason {
  const mapping: Record<string, NormalizedStopReason> = {
    'end_turn': 'success',
    'max_tokens': 'max_turns',
    'tool_use': 'success',
    'stop_sequence': 'success',
  };
  return mapping[stopReason] ?? 'success';
}
```

4. **Actualizar orchestrator** (`AgentOrchestrator.ts`):
```typescript
// DESPUÉS - BIEN (delegado al adapter)
const normalizedReason = adapter.normalizeStopReason(finalStopReason);
```

5. **Actualizar mock en tests** (`AgentOrchestrator.test.ts`):
```typescript
vi.mock('@shared/providers/adapters/StreamAdapterFactory', () => ({
  StreamAdapterFactory: {
    create: vi.fn(() => ({
      processChunk: vi.fn(),
      normalizeStopReason: vi.fn((stopReason: string) => {
        const mapping = { 'end_turn': 'success', /* ... */ };
        return mapping[stopReason] ?? 'success';
      }),
    })),
  },
}));
```

#### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `backend/src/shared/providers/interfaces/INormalizedEvent.ts` | Nuevos tipos: `NormalizedStopReason`, `AnthropicStopReason`, `ProviderStopReason` |
| `backend/src/shared/providers/interfaces/IStreamAdapter.ts` | Nuevo método: `normalizeStopReason()` |
| `backend/src/shared/providers/adapters/AnthropicStreamAdapter.ts` | Implementación de `normalizeStopReason()` |
| `backend/src/domains/agent/orchestration/AgentOrchestrator.ts` | Delega a adapter en lugar de mapeo inline |
| `backend/src/__tests__/unit/.../AgentOrchestrator.test.ts` | Mock actualizado con `normalizeStopReason` |

#### Verificación

```bash
# Lint
npm run lint  # ✅ 0 errores

# Build
npm run build  # ✅ 337 files compiled

# Tests unitarios
npm run test:unit  # ✅ 2141 passed
```

#### Beneficios

1. **Single Responsibility**: Cada adapter maneja su propia normalización
2. **Open/Closed**: Agregar nuevo provider solo requiere nuevo adapter
3. **Testabilidad**: Mock simple en tests
4. **Mantenibilidad**: Cambios de provider no afectan orchestrator
5. **Multi-Provider Ready**: Base para soportar OpenAI, Google, etc.

#### Patrón Aplicado

**Strategy Pattern**: El adapter actúa como estrategia de normalización.
AgentOrchestrator no necesita saber cómo normalizar, solo delega al adapter.

```
AgentOrchestrator ─────> IStreamAdapter ─────> AnthropicStreamAdapter
                              │
                              └──────────> (futuro) OpenAIStreamAdapter
```

---

### [PENDIENTE] Fix #1: Foreign Key Constraint Violations

**Estado**: No Iniciado
**Prioridad**: CRÍTICA
**Tests Afectados**: 10
**Issue**: Usuario test no existe en tabla `users` al crear sesión

#### Solución Propuesta

**Opción A: Verificar Inserción Real**
```typescript
// En TestSessionFactory.createTestUser()
async createTestUser(options) {
  const user = {
    id: uuidv4(),
    email: `${options.prefix}${Date.now()}@test.com`,
    ...
  };

  // ✅ Verificar INSERT real en DB
  await this.db.query(`
    INSERT INTO users (id, email, display_name, ...)
    VALUES (@id, @email, @displayName, ...)
  `, user);

  // ✅ Verificar que existe
  const [inserted] = await this.db.query(`
    SELECT * FROM users WHERE id = @id
  `, { id: user.id });

  if (!inserted) {
    throw new Error(`User ${user.id} not inserted in DB`);
  }

  return user;
}
```

**Opción B: Deshabilitar Paralelismo**
```typescript
// En vitest.config.ts
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // ✅ Un test a la vez
      }
    }
  }
});
```

**Opción C: Aislamiento por Test**
```typescript
// En 09-session-recovery.e2e.test.ts
describe('E2E-09: Session Recovery', () => {
  // ❌ NO shared state
  // let testUser: TestUser;

  // ✅ Create per-test
  beforeEach(async () => {
    const testUser = await factory.createTestUser({
      prefix: `e2e_recovery_${Date.now()}_`
    });
    // ...
  });
});
```

#### Archivos a Modificar

- `backend/src/__tests__/integration/helpers/TestSessionFactory.ts`
- `backend/src/__tests__/e2e/flows/09-session-recovery.e2e.test.ts`
- `backend/vitest.config.ts` (si opción B)

#### Verificación

```bash
# Después de fix:
cd backend && npm test -- 09-session-recovery.e2e.test.ts

# Todos los tests deben pasar (0 FK constraint errors)
```

#### Notas

- Priorizar Opción A (más robusto)
- Si persiste, combinar con Opción B (aislamiento)
- Opción C es fallback (menos eficiente)

---

### [PENDIENTE] Fix #2: Sequence Number = 0

**Estado**: No Iniciado
**Prioridad**: ALTA
**Tests Afectados**: 3
**Issue**: `user_message_confirmed` event tiene `sequenceNumber: 0`

#### Solución Propuesta

**Paso 1: Verificar Redis en E2E**
```typescript
// En setup.e2e.ts
import { getRedisClient } from '@/config/redis';

beforeAll(async () => {
  const redis = getRedisClient();

  // ✅ Verificar conexión
  const pong = await redis.ping();
  if (pong !== 'PONG') {
    throw new Error('Redis not available for E2E tests');
  }

  console.log('[E2E Setup] Redis connected');
});
```

**Paso 2: Fix Fallback DB en EventStore**
```typescript
// En EventStore.ts
private async getNextSequenceNumber(sessionId: string): Promise<number> {
  try {
    // Intentar Redis primero
    const seq = await this.redis.incr(`session:${sessionId}:sequence`);
    return seq; // Nunca 0 (INCR empieza en 1)
  } catch (error) {
    // Fallback a DB
    const [result] = await this.db.query<{ next_seq: number }>(`
      SELECT ISNULL(MAX(sequence_number), 0) + 1 as next_seq
      FROM message_events
      WHERE session_id = @sessionId
    `, { sessionId });

    const nextSeq = result?.next_seq ?? 1; // ✅ Default 1, NO 0

    if (nextSeq < 1) {
      throw new Error(`Invalid sequence number: ${nextSeq}`);
    }

    return nextSeq;
  }
}
```

**Paso 3: Fix FakeAgentOrchestrator**
```typescript
// En FakeAgentOrchestrator.ts
async execute(request) {
  // ✅ Usar EventStore real (no bypass)
  const { sequenceNumber, messageId } = await this.eventStore.saveUserMessage({
    sessionId: request.sessionId,
    userId: request.userId,
    content: request.message,
    role: 'user'
  });

  this.emitter.emit('user_message_confirmed', {
    sequenceNumber, // ✅ Valor real de EventStore
    messageId
  });

  // Continuar con fake responses...
}
```

#### Archivos a Modificar

- `backend/src/services/events/EventStore.ts` (líneas ~150-200)
- `backend/src/__tests__/e2e/helpers/FakeAgentOrchestrator.ts`
- `backend/src/__tests__/e2e/setup.e2e.ts` (verificación Redis)

#### Verificación

```bash
# Test específico:
cd backend && npm test -- events.ws.test.ts -t "should include sequence number"

# Verificar output:
# ✅ sequenceNumber: 1, 2, 3, ... (nunca 0)
```

#### Notas

- Si Redis no disponible en CI/CD, considerar mock que retorna secuencias válidas
- Agregar assertion en EventStore: `if (seq === 0) throw Error`
- Documentar en `CLAUDE.md` que sequence NUNCA es 0

---

### [PENDIENTE] Fix #3: Complete Event Missing Reason

**Estado**: No Iniciado
**Prioridad**: MEDIA
**Tests Afectados**: 1
**Issue**: Complete event no incluye field `reason`

#### Solución Propuesta

**Paso 1: Revisar Contrato WebSocket**
```typescript
// En docs/backend/websocket-contract.md (verificar)
interface CompleteEvent {
  type: 'complete';
  reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  eventIndex: number;
  sessionId: string;
  timestamp: string;
}
```

**Paso 2: Fix AgentEventEmitter**
```typescript
// En AgentEventEmitter.ts
emitComplete(reason: string) {
  const event = {
    type: 'complete',
    reason, // ✅ Incluir reason
    eventIndex: this.eventIndexTracker.next(),
    sessionId: this.sessionId,
    timestamp: new Date().toISOString()
  };

  this.socket.emit('agent:event', event);
  this.logger.debug({ event }, 'Emitted complete event');
}
```

**Paso 3: Fix GraphStreamProcessor**
```typescript
// En GraphStreamProcessor.ts
private handleChatModelEnd(event: LangGraphEvent) {
  const output = event.data?.output;
  const stopReason = output?.stop_reason ?? 'end_turn';

  // ✅ Pasar reason a emitter
  this.emitter.emitComplete(stopReason);
}
```

**Paso 4: Fix FakeAgentOrchestrator**
```typescript
// En FakeAgentOrchestrator.ts
async executeResponse(response: FakeResponse) {
  // ... emit chunks, tools, etc.

  // Al final:
  this.emitter.emitComplete(response.stopReason); // ✅ Mapear stopReason
}
```

#### Archivos a Modificar

- `backend/src/domains/agent/emission/AgentEventEmitter.ts`
- `backend/src/domains/agent/streaming/GraphStreamProcessor.ts`
- `backend/src/__tests__/e2e/helpers/FakeAgentOrchestrator.ts`
- `docs/backend/websocket-contract.md` (verificar contrato)

#### Verificación

```bash
cd backend && npm test -- events.ws.test.ts -t "should receive complete event at the end"

# Verificar event:
# {
#   type: 'complete',
#   reason: 'end_turn', // ✅ Presente
#   eventIndex: 10
# }
```

#### Notas

- Verificar que TODOS los emitters de complete incluyen reason
- Agregar type guard: `if (!reason) throw Error('Complete without reason')`
- Actualizar tests para verificar reason válido

---

### [PENDIENTE] Fix #4: Events After Complete

**Estado**: No Iniciado
**Prioridad**: ALTA
**Tests Afectados**: 1
**Issue**: `message_chunk` llega DESPUÉS de `complete` event

#### Solución Propuesta

**Paso 1: Agregar Estado "Completed"**
```typescript
// En GraphStreamProcessor.ts
class GraphStreamProcessor {
  private isCompleted = false;

  async processStreamEvent(event: LangGraphEvent) {
    // ✅ No procesar si ya completó
    if (this.isCompleted) {
      this.logger.warn({ event }, 'Event received after completion - ignoring');
      return;
    }

    if (event.event === 'on_chat_model_end') {
      this.handleChatModelEnd(event);
      this.isCompleted = true; // ✅ Marcar como completado
    } else {
      // Procesar otros eventos
      this.handleStreamEvent(event);
    }
  }
}
```

**Paso 2: Queue de Emisión**
```typescript
// En AgentEventEmitter.ts
class AgentEventEmitter {
  private eventQueue: Array<AgentEvent> = [];
  private emitting = false;

  async emit(event: AgentEvent) {
    this.eventQueue.push(event);

    if (!this.emitting) {
      await this.flushQueue();
    }
  }

  private async flushQueue() {
    this.emitting = true;

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();
      this.socket.emit('agent:event', event);

      // ✅ Si es complete, vaciar cola y terminar
      if (event.type === 'complete') {
        this.eventQueue = [];
        break;
      }
    }

    this.emitting = false;
  }
}
```

**Paso 3: EventIndexTracker Atómico**
```typescript
// En EventIndexTracker.ts
class EventIndexTracker {
  private index = 0;
  private lock = false;

  async next(): Promise<number> {
    // ✅ Spinlock simple para atomicidad
    while (this.lock) {
      await new Promise(resolve => setImmediate(resolve));
    }

    this.lock = true;
    const current = this.index++;
    this.lock = false;

    return current;
  }
}
```

#### Archivos a Modificar

- `backend/src/domains/agent/streaming/GraphStreamProcessor.ts`
- `backend/src/domains/agent/emission/AgentEventEmitter.ts`
- `backend/src/domains/agent/emission/EventIndexTracker.ts`

#### Verificación

```bash
cd backend && npm test -- events.ws.test.ts -t "should be the last event in the sequence"

# Verificar orden:
# events = [
#   { type: 'user_message_confirmed', eventIndex: 0 },
#   { type: 'message_chunk', eventIndex: 1 },
#   { type: 'complete', eventIndex: 2 } // ✅ Último
# ]
```

#### Notas

- Considerar usar queue library (ej: `p-queue`) para emisión
- Agregar test unitario para EventIndexTracker concurrencia
- Documentar invariante: "No events after complete"

---

### [PENDIENTE] Fix #5: Assistant Message Persistence

**Estado**: No Iniciado
**Prioridad**: MEDIA
**Tests Afectados**: 1
**Issue**: Mensaje de asistente no persiste antes de query en test

#### Solución Propuesta

**Paso 1: Implementar drainMessageQueue Helper**
```typescript
// En setup.e2e.ts
import { getMessageQueue } from '@services/messages/MessageQueue';

export async function drainMessageQueue(timeout = 10000): Promise<void> {
  const queue = getMessageQueue();
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const pendingCount = await queue.getJobCounts();

    if (pendingCount.waiting === 0 && pendingCount.active === 0) {
      console.log('[E2E] MessageQueue drained');
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`MessageQueue drain timeout after ${timeout}ms`);
}
```

**Paso 2: Integrar en ResponseScenarioRegistry**
```typescript
// En ResponseScenarioRegistry.ts
async executeScenario(scenarioId: string, factory, testUser): Promise<ScenarioResult> {
  // ... ejecutar scenario, recolectar eventos ...

  // ✅ Esperar flush de MessageQueue
  await drainMessageQueue();

  // Ahora query DB
  const dbMessages = await this.queryMessages(sessionId);
  const dbEvents = await this.queryEvents(sessionId);

  return {
    events,
    dbMessages, // ✅ Incluye assistant message
    dbEvents,
    durationMs
  };
}
```

**Paso 3: Alternativa - Polling en Test**
```typescript
// En multi-tool-with-thinking.scenario.test.ts
it('should persist assistant message', async () => {
  // Polling hasta que mensaje aparece
  let assistantMsg;
  const maxAttempts = 50; // 5 segundos

  for (let i = 0; i < maxAttempts; i++) {
    assistantMsg = scenarioResult.dbMessages.find(m => m.role === 'assistant');
    if (assistantMsg) break;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  expect(assistantMsg).toBeDefined();
});
```

#### Archivos a Modificar

- `backend/src/__tests__/e2e/setup.e2e.ts` (nuevo helper)
- `backend/src/__tests__/e2e/helpers/ResponseScenarioRegistry.ts`
- `backend/src/__tests__/e2e/scenarios/patterns/multi-tool-with-thinking.scenario.test.ts`

#### Verificación

```bash
cd backend && npm test -- multi-tool-with-thinking.scenario.test.ts

# Verificar:
# ✅ scenarioResult.dbMessages contiene assistant message
# ✅ No timeout errors
```

#### Notas

- Preferir `drainMessageQueue()` en `executeScenario()` (más limpio)
- Polling es fallback si drain no funciona
- Considerar configurar timeout en E2E config

---

### [PENDIENTE] Fix #6: Tool Execution Error Handling

**Estado**: No Iniciado
**Prioridad**: MEDIA
**Tests Afectados**: 2
**Issue**: Errores de tool execution no emiten eventos esperados

#### Solución Propuesta

**Paso 1: Definir Contrato de Error**
```typescript
// En types (backend/src/types/agent.types.ts)
interface ToolResultEvent {
  type: 'tool_result';
  toolUseId: string;
  toolName: string;
  isError: boolean;
  content?: string;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
  eventIndex: number;
}

// O emitir error event:
interface ErrorEvent {
  type: 'error';
  error: {
    message: string;
    code: string;
    toolUseId?: string; // Si es error de tool
  };
  eventIndex: number;
}
```

**Paso 2: Fix ToolExecutionProcessor**
```typescript
// En ToolExecutionProcessor.ts
async executeTools(toolCalls: ToolCall[]) {
  for (const tool of toolCalls) {
    try {
      const result = await this.bcClient.execute(tool);

      // ✅ Emit tool_result con éxito
      await this.emitter.emitToolResult({
        toolUseId: tool.id,
        toolName: tool.name,
        isError: false,
        content: JSON.stringify(result)
      });
    } catch (error) {
      // ✅ Emit tool_result con error
      await this.emitter.emitToolResult({
        toolUseId: tool.id,
        toolName: tool.name,
        isError: true,
        error: {
          message: error.message,
          code: error.code ?? 'TOOL_EXECUTION_ERROR',
          details: error.response?.data
        }
      });

      // ✅ También emit error event
      await this.emitter.emitError({
        message: `Tool ${tool.name} execution failed: ${error.message}`,
        code: 'TOOL_EXECUTION_ERROR',
        toolUseId: tool.id
      });
    }
  }
}
```

**Paso 3: Implementar emitError en AgentEventEmitter**
```typescript
// En AgentEventEmitter.ts
emitError(error: { message: string; code: string; toolUseId?: string }) {
  const event = {
    type: 'error',
    error,
    eventIndex: this.eventIndexTracker.next(),
    sessionId: this.sessionId,
    timestamp: new Date().toISOString()
  };

  this.socket.emit('agent:event', event);
  this.logger.error({ event }, 'Emitted error event');
}
```

#### Archivos a Modificar

- `backend/src/types/agent.types.ts` (tipos de eventos)
- `backend/src/domains/agent/tools/ToolExecutionProcessor.ts`
- `backend/src/domains/agent/emission/AgentEventEmitter.ts`
- `docs/backend/websocket-contract.md` (documentar error events)

#### Verificación

```bash
cd backend && npm test -- tool-execution-error.scenario.test.ts

# Verificar que test recibe:
# events = [
#   { type: 'tool_use', toolUseId: 'toolu_123' },
#   { type: 'tool_result', toolUseId: 'toolu_123', isError: true, error: {...} },
#   { type: 'error', error: { code: 'TOOL_EXECUTION_ERROR' } }
# ]
```

#### Notas

- Decidir si emitir SOLO `tool_result` con `isError: true` O ambos events
- Verificar que frontend maneja error events correctamente
- Agregar logging detallado de errores de tools

---

## Insights y Aprendizajes

Esta sección se poblará a medida que se implementen las correcciones.

### Insights Técnicos

#### 1. Test Isolation es Crítico

**Problema Encontrado**: Tests compartiendo `testUser` en `beforeAll` causan FK constraint violations.

**Lección**:
- Crear recursos per-test en `beforeEach` cuando sea posible
- Si se comparte en `beforeAll`, verificar que NO se elimine hasta `afterAll`
- Usar prefixes únicos con timestamp para evitar colisiones

**Aplicar a**:
- Todos los tests E2E
- Tests de integración que usan DB

#### 2. Async Queues Requieren Drain

**Problema Encontrado**: MessageQueue async escribe después de que test termina.

**Lección**:
- SIEMPRE implementar helper `drainQueue()` para tests
- Llamar drain ANTES de hacer assertions sobre DB
- Configurar timeout razonable (5-10s)

**Aplicar a**:
- ScenarioRegistry
- Cualquier test que use BullMQ o similar

#### 3. Sequence Numbers NUNCA Deben Ser 0

**Problema Encontrado**: EventStore retorna `sequenceNumber: 0` en fallback.

**Lección**:
- Sequences empiezan en 1 (Redis INCR behavior)
- Agregar assertion: `if (seq < 1) throw Error`
- Documentar invariante en código

**Aplicar a**:
- EventStore
- Cualquier código que maneje sequences

#### 4. Complete Event Debe Ser Último

**Problema Encontrado**: Eventos llegan después de complete.

**Lección**:
- Implementar flag `isCompleted` en processors
- Rechazar eventos después de complete
- Usar queue para garantizar orden

**Aplicar a**:
- GraphStreamProcessor
- AgentEventEmitter
- Cualquier streaming logic

#### 5. Contratos de Eventos Deben Ser Estrictos

**Problema Encontrado**: Complete event sin field `reason`.

**Lección**:
- Definir interfaces TypeScript estrictas
- Validar eventos antes de emitir
- Documentar en `websocket-contract.md`

**Aplicar a**:
- Todos los agent events
- Validation en emisión

### Patterns a Evitar

#### ❌ Shared State en beforeAll sin Cleanup Control

```typescript
// MAL
let testUser: TestUser;

beforeAll(async () => {
  testUser = await factory.createTestUser();
});

// Test puede fallar si otro test llama factory.cleanup()
```

#### ❌ Query DB sin Drain Queue

```typescript
// MAL
await executeScenario();
const messages = await queryDB(); // ❌ Queue aún procesando

// BIEN
await executeScenario();
await drainMessageQueue(); // ✅ Esperar flush
const messages = await queryDB();
```

#### ❌ Emitir Eventos sin Order Guarantee

```typescript
// MAL
this.emit('complete');
this.emit('message_chunk'); // ❌ Puede llegar después

// BIEN
if (this.isCompleted) return;
this.emit('message_chunk');
this.isCompleted = true;
this.emit('complete');
```

### Mejoras Futuras

#### 1. Test Helpers Mejorados

```typescript
// Implementar:
class E2ETestHelper {
  async createIsolatedUser(): Promise<TestUser> {
    // User único con cleanup automático
  }

  async drainAllQueues(): Promise<void> {
    // Drain MessageQueue + otros
  }

  async waitForDBSync(predicate: () => Promise<boolean>): Promise<void> {
    // Polling genérico
  }
}
```

#### 2. Event Validation Layer

```typescript
// Interceptor que valida TODOS los eventos:
class EventValidator {
  validate(event: AgentEvent) {
    if (event.type === 'complete' && !event.reason) {
      throw new Error('Complete event without reason');
    }
    if (event.sequenceNumber !== undefined && event.sequenceNumber < 1) {
      throw new Error(`Invalid sequence: ${event.sequenceNumber}`);
    }
    // ... más validaciones
  }
}
```

#### 3. E2E Test Reporter

```typescript
// Custom reporter que detecta patterns:
class E2EReporter {
  onTestFail(test, error) {
    if (error.message.includes('FOREIGN KEY')) {
      console.error('💥 FK CONSTRAINT: Check user creation in beforeAll');
    }
    if (error.message.includes('sequenceNumber')) {
      console.error('💥 SEQUENCE ERROR: Check EventStore/Redis');
    }
  }
}
```

#### 4. Documentation Sync

**Action Items**:
- [ ] Actualizar `docs/backend/websocket-contract.md` con TODOS los event types
- [ ] Agregar ejemplos de error events
- [ ] Documentar invariantes (sequence > 0, complete es último, etc.)
- [ ] Crear troubleshooting guide en `CLAUDE.md`

---

## Próximos Pasos

### Priorización

| # | Fix | Prioridad | Blocker | Effort |
|---|-----|-----------|---------|--------|
| 1 | FK Constraint Violations | 🔴 CRÍTICA | Sí | 2-3h |
| 2 | Sequence Number = 0 | 🟠 ALTA | No | 2-4h |
| 4 | Events After Complete | 🟠 ALTA | No | 3-4h |
| 3 | Complete Missing Reason | 🟡 MEDIA | No | 1-2h |
| 5 | Assistant Message Persistence | 🟡 MEDIA | No | 1-2h |
| 6 | Tool Error Handling | 🟡 MEDIA | No | 2-3h |

**Total Estimado**: 11-18 horas

### Orden de Ejecución Recomendado

1. **Fix #1 (FK Constraints)** - Desbloquea 10 tests
   - Implementar verificación de user insertion
   - Probar aislamiento per-test
   - Verificar cleanup en afterAll

2. **Fix #2 (Sequence Numbers)** - Desbloquea 3 tests
   - Fix EventStore fallback
   - Fix FakeAgentOrchestrator
   - Verificar Redis en E2E

3. **Fix #4 (Events After Complete)** - Desbloquea 1 test
   - Implementar flag isCompleted
   - Queue de emisión
   - EventIndexTracker atómico

4. **Fix #3 (Complete Reason)** - Desbloquea 1 test
   - Quick win
   - Mapear stopReason → reason

5. **Fix #5 (Assistant Persistence)** - Desbloquea 1 test
   - Implementar drainMessageQueue
   - Integrar en ScenarioRegistry

6. **Fix #6 (Tool Errors)** - Desbloquea 2 tests
   - Implementar error events
   - Update ToolExecutionProcessor

### Verificación Final

Después de TODAS las correcciones:

```bash
# Full E2E test suite
cd backend && npm run test:e2e

# Verificar:
# ✅ 0 tests fallando
# ✅ 0 FK constraint errors
# ✅ 0 sequenceNumber = 0
# ✅ 0 eventos desordenados
# ✅ 0 missing reason
# ✅ 0 persistence errors
```

---

*Última actualización: 2025-12-23*
*Documento vivo - actualizar con cada fix implementado*
