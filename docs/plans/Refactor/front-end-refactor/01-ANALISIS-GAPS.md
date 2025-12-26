# Análisis de Gaps: Frontend vs. Contrato Backend

**Fecha**: 2025-12-25
**Estado**: En Progreso
**Referencia**: `docs/plans/Refactor/contracts/02-CONTRATO-BACKEND-FRONTEND.md`

---

## Resumen Ejecutivo

Este documento analiza las diferencias entre la implementación actual del frontend y el contrato definido por el backend. Se identifican **12 gaps** de distinta severidad que afectan la integridad de datos, experiencia de usuario y mantenibilidad.

### Severidad de Gaps

| Severidad | Cantidad | Descripción |
|-----------|----------|-------------|
| 🔴 Alta | 4 | Puede causar pérdida de datos o comportamiento incorrecto |
| 🟡 Media | 5 | Afecta UX o consistencia pero no es crítico |
| 🟢 Baja | 3 | Mejoras de código o documentación |

---

## Gap 1: `eventIndex` Ignorado en Eventos Transient

### Severidad: 🔴 Alta

### Contrato (líneas 94, 910-913)

```typescript
// BaseAgentEvent
eventIndex?: number;      // Contador local (eventos transient)

// Para eventos TRANSIENT (sequenceNumber ausente)
events.sort((a, b) =>
  (a.eventIndex || 0) - (b.eventIndex || 0)
);
```

### Implementación Actual (`chatStore.ts:69-74`)

```typescript
// State 3: Both are unpersisted (transient/streaming) - use blockIndex or eventIndex
const indexA = a.blockIndex ?? a.eventIndex ?? -1;
const indexB = b.blockIndex ?? b.eventIndex ?? -1;

if (indexA >= 0 && indexB >= 0 && indexA !== indexB) {
  return indexA - indexB;
}
```

### Problema

- El código SÍ usa `eventIndex`, pero está mezclado con `blockIndex`
- `blockIndex` es específico de thinking blocks, NO debería usarse para ordenamiento general
- No hay tracking de `eventIndex` recibido en eventos `message_chunk`

### Impacto

- Chunks de mensaje pueden desordenarse si llegan fuera de orden por la red
- Especialmente crítico con conexiones lentas o picos de red

### Solución Propuesta

1. Separar lógica de ordenamiento: `blockIndex` solo para thinking, `eventIndex` para todo lo demás
2. Almacenar `eventIndex` en cada chunk acumulado
3. Ordenar acumulador por `eventIndex` antes de renderizar

---

## Gap 2: `persistenceState` No Mostrado en UI

### Severidad: 🟡 Media

### Contrato (líneas 103-118)

```typescript
type PersistenceState =
  | 'pending'    // Emitido durante streaming, no persistido
  | 'queued'     // En cola para persistencia asíncrona
  | 'persisted'  // Exitosamente escrito en DB con sequenceNumber
  | 'failed'     // Falló la persistencia
  | 'transient'; // No destinado a persistencia (ej: message_chunk)

// Uso en Frontend:
// Mostrar indicador de persistencia según persistenceState
```

### Implementación Actual

- `persistenceState` se recibe pero NO se muestra al usuario
- No hay indicador visual de si el mensaje fue guardado

### Impacto

- Usuario no sabe si su mensaje fue persistido
- Si hay error de persistencia, el usuario no es informado
- Posible pérdida de contexto si el usuario cierra y el mensaje no guardó

### Solución Propuesta

```tsx
// Componente MessageBubble
function MessageBubble({ message }) {
  return (
    <div>
      {message.content}
      <PersistenceIndicator state={message.persistenceState} />
    </div>
  );
}

function PersistenceIndicator({ state }) {
  switch (state) {
    case 'pending': return <Clock className="animate-spin" />;
    case 'persisted': return <CheckCircle className="text-green-500" />;
    case 'failed': return <AlertCircle className="text-red-500" />;
    default: return null;
  }
}
```

---

## Gap 3: `correlationId` Ignorado

### Severidad: 🟢 Baja

### Contrato (línea 98)

```typescript
correlationId?: string;   // Vincula eventos relacionados
```

### Implementación Actual (`chatStore.ts:597`)

```typescript
const toolId = resultEvent.toolUseId || resultEvent.correlationId;
```

### Problema

- Solo se usa como fallback para `toolUseId`
- No se utiliza para agrupar eventos relacionados
- No hay tracing ni debugging basado en correlationId

### Impacto

- Debugging de flujos complejos es más difícil
- No se puede reconstruir la cadena de eventos en caso de error

### Solución Propuesta

1. Almacenar `correlationId` en cada mensaje
2. Permitir filtrar/agrupar por correlationId en dev tools
3. Usar en error reporting para contexto

---

## Gap 4: ID Mismatch en User Message Confirmation

### Severidad: 🔴 Alta

### Contrato (líneas 139-148)

```typescript
function handleUserMessageConfirmed(event: UserMessageConfirmedEvent) {
  updateMessage(event.messageId, {
    sequenceNumber: event.sequenceNumber,
    persistenceState: 'persisted'
  });
}
```

### Implementación Actual (`chatStore.ts:558-574`)

```typescript
case 'user_message_confirmed': {
  const confirmedEvent = event;
  actions.confirmOptimisticMessage(
    `optimistic-${confirmedEvent.eventId}`,  // ← Usa eventId, no messageId!
    {
      type: 'standard',
      id: confirmedEvent.messageId,
      // ...
    }
  );
  break;
}
```

### Problema

- El frontend crea mensajes optimistas con tempId custom (`temp-{uuid}`)
- El backend envía `user_message_confirmed` con su propio `eventId`
- NO HAY COINCIDENCIA entre `optimistic-${eventId}` y `temp-${uuid}`

### Evidencia de Fix Parcial (`chatStore.ts:287-304`)

```typescript
// FIX #4: Primero intentar eliminar por tempId
if (newOptimistic.has(tempId)) {
  newOptimistic.delete(tempId);
} else {
  // Si no encuentra por ID, buscar por contenido (fallback robusto)
  for (const [key, msg] of newOptimistic.entries()) {
    if (msg.content === confirmedMessage.content && msg.role === 'user') {
      newOptimistic.delete(key);
      break;
    }
  }
}
```

### Impacto

- El fallback por contenido es frágil (¿qué pasa si el usuario envía el mismo mensaje dos veces?)
- Race conditions posibles
- Mensajes duplicados pueden aparecer momentáneamente

### Solución Propuesta

1. **Opción A**: Frontend envía su tempId al backend, backend lo incluye en `user_message_confirmed`
2. **Opción B**: Backend genera UUID antes de persistir, frontend recibe `messageId` anticipadamente
3. **Mínimo viable**: Usar `content + timestamp` como key compuesta para matching

---

## Gap 5: Multi-Block Thinking No Soportado

### Severidad: 🟡 Media

### Contrato (líneas 256-260, 265-274)

```typescript
interface ThinkingChunkEvent extends BaseAgentEvent {
  type: 'thinking_chunk';
  content: string;
  blockIndex?: number;       // Índice de bloque (multi-block)
  messageId?: string;
  persistenceState: 'transient';
}

// Multi-block accumulation
const thinkingAccumulators = new Map<number, string>();

function handleThinkingChunk(event: ThinkingChunkEvent) {
  const index = event.blockIndex || 0;
  thinkingAccumulators.set(index, current + event.content);
  renderStreamingThinking(index, thinkingAccumulators.get(index)!);
}
```

### Implementación Actual (`chatStore.ts:353-365, 481-498`)

```typescript
// Estado: Solo UN string para thinking
streaming: {
  thinking: '',  // Single string, not Map
}

// Handler: Ignora blockIndex
case 'thinking_chunk': {
  const thinkingEvent = event as ThinkingChunkEvent;
  actions.appendThinkingContent(thinkingEvent.content);  // Concat directo
}
```

### Problema

- Solo hay UN acumulador de thinking (`streaming.thinking: string`)
- `blockIndex` se ignora completamente
- Si Claude genera múltiples bloques de thinking, se concatenan sin separación

### Impacto

- En conversaciones complejas con múltiples pasos de razonamiento, el thinking se mezcla
- No se puede colapsar/expandir bloques individuales

### Solución Propuesta

```typescript
// Estado
streaming: {
  thinkingBlocks: Map<number, string>;  // blockIndex -> content
}

// Handler
case 'thinking_chunk': {
  const { content, blockIndex = 0 } = event as ThinkingChunkEvent;
  set((state) => {
    const blocks = new Map(state.streaming.thinkingBlocks);
    blocks.set(blockIndex, (blocks.get(blockIndex) || '') + content);
    return { streaming: { ...state.streaming, thinkingBlocks: blocks } };
  });
}
```

---

## Gap 6: Streaming No Limpia Entre Turns

### Severidad: 🔴 Alta

### Contrato (líneas 860-862, 876-884)

```typescript
// Invariantes de Orden
// 3. Complete is terminal: `complete` es el último evento significativo
//    - Pueden llegar chunks transient después por buffering de WebSocket
//    - **Ignorar chunks después de recibir `complete`**

// Patrón recomendado
let isComplete = false;

function handleMessageChunk(event: MessageChunkEvent) {
  if (isComplete) {
    console.debug('[Ignored] Late chunk after complete');
    return;
  }
  accumulator.append(event.content);
}
```

### Implementación Actual

- NO hay flag `isComplete` para ignorar chunks tardíos
- `clearStreaming()` solo se llama en `session_start`
- Chunks de turn anterior pueden contaminar turn nuevo

### Impacto

- Chunks tardíos de una respuesta anterior pueden aparecer en la siguiente
- Especialmente crítico con latencia de red variable

### Evidencia

El handler de `complete` llama `endStreaming()` pero NO `clearStreaming()`:

```typescript
case 'complete': {
  actions.endStreaming();  // Solo marca isStreaming = false
  actions.setAgentBusy(false);
  // ...
}
```

### Solución Propuesta

```typescript
// Estado adicional
isComplete: boolean;

// En handleComplete
case 'complete':
  set({ isComplete: true });
  actions.clearStreaming();
  // ...

// En handleMessageChunk
case 'message_chunk':
  if (get().isComplete) return;  // Ignorar chunks tardíos
  // ...

// Al enviar nuevo mensaje
sendMessage() {
  set({ isComplete: false });
  actions.clearStreaming();
  // ...
}
```

---

## Gap 7: `turn_paused` Manejo Incompleto

### Severidad: 🟡 Media

### Contrato (líneas 556-569)

```typescript
interface TurnPausedEvent extends BaseAgentEvent {
  type: 'turn_paused';
  content?: string;      // Contenido parcial antes de pausa
  messageId: string;
  reason?: string;
}
```

### Implementación Actual (`chatStore.ts:682-685`)

```typescript
case 'turn_paused':
  // Agent paused - keep busy but stop streaming
  actions.endStreaming();
  break;
```

### Problema

- No se guarda el contenido parcial (`event.content`)
- No se muestra al usuario POR QUÉ pausó (`event.reason`)
- No hay UI que indique "Claude pausó, click para continuar"

### Impacto

- Usuario no entiende por qué Claude dejó de responder
- Contenido parcial se pierde

### Solución Propuesta

```typescript
case 'turn_paused': {
  const pausedEvent = event as TurnPausedEvent;

  // Guardar contenido parcial
  if (pausedEvent.content) {
    actions.addMessage({
      type: 'standard',
      content: pausedEvent.content,
      role: 'assistant',
      metadata: { paused: true, reason: pausedEvent.reason }
    });
  }

  // Mostrar indicador de pausa
  set({ isPaused: true, pauseReason: pausedEvent.reason });
  actions.endStreaming();
  break;
}
```

---

## Gap 8: Sorting Duplicado en 3 Lugares

### Severidad: 🟢 Baja

### Ubicaciones

1. `chatStore.ts:54-80` - Función `sortMessages()`
2. `chatStore.ts:260` - En `setMessages()`
3. `chatStore.ts:272` - En `addMessage()`
4. `chatStore.ts:309` - En `confirmOptimisticMessage()`
5. `chatStore.ts:702` - En selector `selectAllMessages()`

### Problema

- La misma lógica de sorting se ejecuta múltiples veces
- Inconsistencia potencial si se modifica uno y no los otros
- Performance innecesaria al ordenar repetidamente

### Impacto

- Mantenimiento difícil
- Posibles bugs si las implementaciones divergen

### Solución Propuesta

1. Mantener mensajes SIN ordenar en el store
2. Ordenar SOLO en el selector que se usa para renderizar
3. Usar `useMemo` en componentes para cachear resultado ordenado

```typescript
// Store: No ordenar
addMessage: (message) => set((state) => ({
  messages: [...state.messages, message]  // Sin sort
})),

// Selector: Ordenar una vez
export const selectSortedMessages = createSelector(
  (state: ChatStore) => state.messages,
  (state: ChatStore) => state.optimisticMessages,
  (messages, optimistic) => {
    return [...messages, ...Array.from(optimistic.values())]
      .sort(sortMessages);
  }
);
```

---

## Gap 9: No Hay Paginación de Mensajes

### Severidad: 🟡 Media

### Contrato

El API soporta paginación pero el frontend carga TODO:

```typescript
// API: GET /sessions/:sessionId/messages?limit=50&offset=0
// Frontend: GET /sessions/:sessionId/messages (sin parámetros)
```

### Implementación Actual

```typescript
// chatApi.ts
export async function getSessionMessages(sessionId: string) {
  // Carga TODOS los mensajes sin límite
}
```

### Impacto

- Conversaciones largas (100+ mensajes) causan lag
- Memory usage alto en cliente
- Primera carga lenta

### Solución Propuesta

```typescript
// Infinite scroll con cursor-based pagination
const [messages, setMessages] = useState<Message[]>([]);
const [cursor, setCursor] = useState<string | null>(null);

async function loadMore() {
  const { messages: newMessages, nextCursor } = await api.getMessages(
    sessionId,
    { limit: 50, cursor }
  );
  setMessages(prev => [...prev, ...newMessages]);
  setCursor(nextCursor);
}
```

---

## Gap 10: Acumuladores No Limpian en `message` Final

### Severidad: 🔴 Alta

### Contrato (líneas 956-963)

```typescript
function handleMessage(event: MessageEvent) {
  // Guardar mensaje final
  setMessages((prev) => [...prev, { ... }]);
  setCurrentChunk(''); // Limpiar acumulador  ← CRÍTICO
}
```

### Implementación Actual (`chatStore.ts:537-555`)

```typescript
case 'message': {
  const msgEvent = event as MessageEvent;
  actions.endStreaming();  // Solo marca isStreaming = false
  actions.addMessage({ ... });
  break;
}
```

### Problema

`endStreaming()` hace esto:

```typescript
endStreaming: () =>
  set((state) => ({
    streaming: {
      ...state.streaming,
      isStreaming: false,
      capturedThinking: state.streaming.thinking || null,  // Preserva thinking
    },
    // NO limpia streaming.content!
  })),
```

### Impacto

- `streaming.content` mantiene el contenido anterior
- Si el siguiente mensaje no tiene chunks (ej: error), se muestra contenido viejo
- Bug visual intermitente difícil de reproducir

### Solución Propuesta

```typescript
case 'message': {
  const msgEvent = event as MessageEvent;

  // Limpiar acumulador de mensaje (NO thinking, se preserva)
  set((state) => ({
    streaming: {
      ...state.streaming,
      content: '',  // LIMPIAR
      isStreaming: false,
    }
  }));

  actions.addMessage({ ... });
  break;
}
```

---

## Gap 11: `session:ready` No Esperado Antes de Enviar

### Severidad: 🟡 Media

### Contrato (líneas 1364-1374)

```typescript
// ❌ INCORRECTO
socket.emit('session:join', { sessionId });
socket.emit('chat:message', { ... }); // Demasiado pronto

// ✅ CORRECTO
socket.emit('session:join', { sessionId });
socket.once('session:ready', () => {
  socket.emit('chat:message', { ... }); // OK
});
```

### Implementación Actual (`socket.ts`)

```typescript
joinSession(sessionId: string): void {
  this.socket?.emit('session:join', { sessionId });
  // No espera session:ready
}
```

### Impacto

- Primer mensaje puede perderse si se envía antes de que el backend procese el join
- Race condition con conexiones lentas

### Solución Propuesta

```typescript
async joinSession(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Join timeout')), 5000);

    this.socket?.once('session:ready', () => {
      clearTimeout(timeout);
      resolve();
    });

    this.socket?.emit('session:join', { sessionId });
  });
}

// Uso
await socket.joinSession(sessionId);
socket.sendMessage({ ... }); // Ahora es seguro
```

---

## Gap 12: Tipos No Alineados con @bc-agent/shared

### Severidad: 🟢 Baja

### Contrato (líneas 1411-1432)

```typescript
import type {
  AgentEvent,
  MessageEvent,
  MessageChunkEvent,
  // ... 12 tipos más
} from '@bc-agent/shared';
```

### Implementación Actual

- Algunos tipos se importan de `@bc-agent/shared`
- Otros se definen localmente (duplicados)
- Inconsistencia en naming (`Message` vs `MessageEvent`)

### Ejemplos de Duplicación

```typescript
// chatStore.ts - Importa de shared
import type { Message } from '@bc-agent/shared';

// Pero también define localmente
export interface StreamingState { ... }  // Debería estar en shared?
export interface PendingApproval { ... }  // Debería estar en shared?
```

### Solución Propuesta

1. Auditar todos los tipos en frontend
2. Mover tipos compartidos a `@bc-agent/shared`
3. Re-exportar desde un barrel file local para conveniencia

---

## Matriz de Impacto vs. Esfuerzo

| Gap | Severidad | Esfuerzo | Prioridad |
|-----|-----------|----------|-----------|
| Gap 4: ID Mismatch | 🔴 Alta | Medio | P0 |
| Gap 6: Streaming Entre Turns | 🔴 Alta | Bajo | P0 |
| Gap 10: Acumuladores No Limpian | 🔴 Alta | Bajo | P0 |
| Gap 1: eventIndex Ignorado | 🔴 Alta | Medio | P1 |
| Gap 5: Multi-Block Thinking | 🟡 Media | Medio | P1 |
| Gap 7: turn_paused Incompleto | 🟡 Media | Bajo | P2 |
| Gap 2: persistenceState UI | 🟡 Media | Bajo | P2 |
| Gap 9: Paginación | 🟡 Media | Alto | P2 |
| Gap 11: session:ready | 🟡 Media | Bajo | P2 |
| Gap 8: Sorting Duplicado | 🟢 Baja | Medio | P3 |
| Gap 3: correlationId | 🟢 Baja | Bajo | P3 |
| Gap 12: Tipos No Alineados | 🟢 Baja | Medio | P3 |

---

## Tests E2E del Backend como Referencia

Los siguientes tests del backend definen el comportamiento esperado que el frontend debe soportar:

### Flujos Críticos

| Test | Archivo | Flujo |
|------|---------|-------|
| Mensaje simple | `e2e/agent-orchestrator.e2e.test.ts` | `user_message_confirmed → message_chunk* → message → complete` |
| Extended Thinking | `e2e/agent-orchestrator.e2e.test.ts` | `thinking_chunk* → thinking_complete → message_chunk* → message` |
| Tool Execution | `e2e/tool-execution.e2e.test.ts` | `tool_use → tool_result → message` |
| HITL Approval | `e2e/approval-flow.e2e.test.ts` | `approval_requested → [user decision] → approval_resolved` |
| Error Recovery | `e2e/error-handling.e2e.test.ts` | `error → complete(reason='error')` |
| Session Recovery | `e2e/session-persistence.e2e.test.ts` | Page refresh reconstruye toda la conversación |

### Eventos que DEBEN Manejarse

Del contrato, hay **17 tipos de eventos**. Estado actual:

| Evento | Manejado | Completo |
|--------|----------|----------|
| `session_start` | ✅ | ✅ |
| `thinking` | ✅ | ⚠️ Legacy |
| `thinking_chunk` | ✅ | ❌ Falta multi-block |
| `thinking_complete` | ✅ | ✅ |
| `message_partial` | ❌ | Legacy, ignorar |
| `message` | ✅ | ⚠️ No limpia acumulador |
| `message_chunk` | ✅ | ⚠️ No usa eventIndex |
| `tool_use` | ✅ | ✅ |
| `tool_result` | ✅ | ✅ |
| `error` | ✅ | ✅ |
| `session_end` | ✅ | ✅ |
| `complete` | ✅ | ⚠️ No ignora chunks tardíos |
| `approval_requested` | ✅ | ✅ |
| `approval_resolved` | ✅ | ✅ |
| `user_message_confirmed` | ✅ | ❌ ID mismatch |
| `turn_paused` | ✅ | ❌ No muestra UI |
| `content_refused` | ✅ | ✅ |

---

## Próximos Pasos

1. **Inmediato (P0)**: Corregir gaps críticos que causan bugs
   - Gap 4: ID Mismatch
   - Gap 6: Streaming entre turns
   - Gap 10: Acumuladores

2. **Corto plazo (P1)**: Mejorar robustez
   - Gap 1: eventIndex ordering
   - Gap 5: Multi-block thinking

3. **Mediano plazo (P2)**: Mejorar UX
   - Gap 2: persistenceState UI
   - Gap 7: turn_paused UI
   - Gap 9: Paginación
   - Gap 11: session:ready

4. **Largo plazo (P3)**: Mejoras de código
   - Gap 8: Refactorizar sorting
   - Gap 3: correlationId para debugging
   - Gap 12: Alinear tipos

---

*Última actualización: 2025-12-25*
