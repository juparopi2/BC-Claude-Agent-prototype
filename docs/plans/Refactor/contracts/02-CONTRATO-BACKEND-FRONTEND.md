# Contrato Backend-Frontend: WebSocket Events

**Fecha**: 2025-12-23
**Estado**: Aprobado

---

## Propósito

Este documento define el **contrato WebSocket** entre el backend y el frontend del BC Claude Agent. Es la única fuente de verdad para la integración en tiempo real mediante Socket.IO.

**Principio fundamental**: El backend emite **un solo tipo de evento** (`agent:event`) con discriminación por tipo. El frontend usa TypeScript type narrowing para manejar cada tipo específico.

---

## Arquitectura de Conexión

### Configuración del Servidor

```typescript
// Servidor Socket.IO
URL: http://localhost:3002

// Autenticación
Método: Express Session con cookie connect.sid
Cookie: httpOnly=true, secure=true (en producción)
Duración: 24 horas (session Redis)

// Transports
Soportados: ['websocket', 'polling']
Recomendado: websocket (fallback a polling automático)
```

### Flujo de Conexión

1. **Cliente se conecta** a `http://localhost:3002`
2. **Backend valida** cookie `connect.sid` (express-session wrapper)
3. **Cliente emite** `session:join` con `{ sessionId }`
4. **Backend responde** `session:ready` con `{ sessionId, timestamp }`
5. **Cliente puede enviar** mensajes vía `chat:message`

### Multi-Tenancy

- Todas las operaciones requieren `userId` + `sessionId`
- Validación automática de sesión por middleware Socket.IO
- Rooms: cada sesión tiene su propio room (`sessionId`)
- Seguridad: usuarios solo reciben eventos de sus propias sesiones

---

## Tipos de Eventos (17 Total)

```typescript
type AgentEventType =
  | 'session_start'           // Sesión iniciada
  | 'thinking'                // Pensamiento completo (legacy)
  | 'thinking_chunk'          // Chunk de pensamiento (streaming)
  | 'thinking_complete'       // Pensamiento finalizado
  | 'message_partial'         // Mensaje parcial (legacy)
  | 'message'                 // Mensaje completo (persisted)
  | 'message_chunk'           // Chunk de mensaje (streaming)
  | 'tool_use'                // Claude solicita usar herramienta
  | 'tool_result'             // Resultado de herramienta
  | 'error'                   // Error durante ejecución
  | 'session_end'             // Sesión terminada
  | 'complete'                // Ejecución completada (terminal)
  | 'approval_requested'      // Aprobación humana requerida
  | 'approval_resolved'       // Usuario respondió aprobación
  | 'user_message_confirmed'  // Mensaje de usuario persistido
  | 'turn_paused'             // Claude pausó turno largo
  | 'content_refused';        // Contenido rechazado por política
```

---

## Estructura Base de Eventos

### BaseAgentEvent

Todos los eventos extienden esta interfaz base:

```typescript
interface BaseAgentEvent {
  // Discriminador de tipo
  type: AgentEventType;

  // Identificación
  sessionId?: string;
  eventId: string;          // UUID único para tracing
  timestamp: string;        // ISO 8601

  // Ordenamiento y Persistencia
  sequenceNumber?: number;  // Redis INCR (eventos persistidos)
  eventIndex?: number;      // Contador local (eventos transient)
  persistenceState: PersistenceState;

  // Relaciones entre eventos
  correlationId?: string;   // Vincula eventos relacionados
  parentEventId?: string;   // Jerarquía de eventos
}
```

### Estados de Persistencia

```typescript
type PersistenceState =
  | 'pending'    // Emitido durante streaming, no persistido
  | 'queued'     // En cola para persistencia asíncrona
  | 'persisted'  // Exitosamente escrito en DB con sequenceNumber
  | 'failed'     // Falló la persistencia
  | 'transient'; // No destinado a persistencia (ej: message_chunk)
```

**Uso en Frontend**:
- `sequenceNumber` presente → usar para ordenamiento (eventos persistidos)
- `sequenceNumber` ausente → usar `eventIndex` (eventos transient)
- Mostrar indicador de persistencia según `persistenceState`

---

## Eventos Específicos

### 1. user_message_confirmed

**Cuándo**: Después de que el mensaje del usuario se persiste exitosamente.

**Propósito**: Actualizar UI optimista con `sequenceNumber` real.

```typescript
interface UserMessageConfirmedEvent extends BaseAgentEvent {
  type: 'user_message_confirmed';
  messageId: string;         // UUID del mensaje en DB
  userId: string;            // ID del usuario
  content: string;           // Contenido del mensaje
  sequenceNumber: number;    // Siempre > 0 (Redis INCR)
}
```

**Responsabilidad Frontend**:
```typescript
// Reemplazar mensaje optimista con datos confirmados
function handleUserMessageConfirmed(event: UserMessageConfirmedEvent) {
  updateMessage(event.messageId, {
    sequenceNumber: event.sequenceNumber,
    persistenceState: 'persisted'
  });
}
```

---

### 2. message_chunk (Transient)

**Cuándo**: Durante streaming, por cada delta de texto de Claude.

**Propósito**: Efecto de "typing" en tiempo real.

```typescript
interface MessageChunkEvent extends BaseAgentEvent {
  type: 'message_chunk';
  content: string;           // Delta de texto
  messageId?: string;        // Para vincular con mensaje final
  citations?: Citation[];    // Citas RAG (opcional)
  persistenceState: 'transient'; // NUNCA se persiste
}
```

**Responsabilidad Frontend**:
```typescript
// Acumular chunks hasta recibir evento 'message' final
const accumulator: Record<string, string> = {};

function handleMessageChunk(event: MessageChunkEvent) {
  const key = event.messageId || 'default';
  accumulator[key] = (accumulator[key] || '') + event.content;

  // Actualizar UI con efecto typing
  renderStreamingMessage(accumulator[key]);
}
```

---

### 3. message (Persisted)

**Cuándo**: Al finalizar un mensaje completo de Claude.

**Propósito**: Mensaje final persistido con metadata completa.

```typescript
interface MessageEvent extends BaseAgentEvent {
  type: 'message';
  content: string;              // Mensaje completo
  messageId: string;            // msg_01QR8X3Z... (formato Anthropic)
  role: 'user' | 'assistant';
  stopReason?: StopReason | null;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
  };
  model?: string;               // claude-sonnet-4-5-20250929
}
```

**Stop Reasons**:
```typescript
type StopReason =
  | 'end_turn'      // Completado naturalmente
  | 'tool_use'      // Claude quiere usar herramienta
  | 'max_tokens'    // Truncado por límite de tokens
  | 'stop_sequence' // Alcanzó secuencia de parada
  | 'pause_turn'    // Turno largo pausado
  | 'refusal';      // Violación de política
```

**Responsabilidad Frontend**:
```typescript
function handleMessage(event: MessageEvent) {
  // 1. Guardar mensaje completo
  addMessage({
    id: event.messageId,
    content: event.content,
    role: event.role,
    sequenceNumber: event.sequenceNumber,
    persistenceState: event.persistenceState
  });

  // 2. Limpiar acumulador de chunks
  delete accumulator[event.messageId];

  // 3. Mostrar tokens si disponible (para admin/billing)
  if (event.tokenUsage) {
    displayTokenUsage(event.tokenUsage);
  }

  // 4. Verificar si hay continuación (tool_use)
  if (event.stopReason === 'tool_use') {
    showToolExecutionIndicator();
  }
}
```

---

### 4. thinking_chunk

**Cuándo**: Durante Extended Thinking, por cada delta de razonamiento.

**Propósito**: Mostrar razonamiento de Claude en tiempo real.

```typescript
interface ThinkingChunkEvent extends BaseAgentEvent {
  type: 'thinking_chunk';
  content: string;           // Delta de pensamiento
  blockIndex?: number;       // Índice de bloque (multi-block)
  messageId?: string;        // Vincula con mensaje
  persistenceState: 'transient';
}
```

**Responsabilidad Frontend**:
```typescript
// Similar a message_chunk, acumular hasta thinking_complete
const thinkingAccumulator: Record<number, string> = {};

function handleThinkingChunk(event: ThinkingChunkEvent) {
  const index = event.blockIndex || 0;
  thinkingAccumulator[index] = (thinkingAccumulator[index] || '') + event.content;

  // Mostrar en UI colapsable
  renderThinkingStream(index, thinkingAccumulator[index]);
}
```

---

### 5. thinking_complete

**Cuándo**: Al finalizar bloque de Extended Thinking.

**Propósito**: Señalar al frontend que colapse/finalice el bloque de pensamiento.

```typescript
interface ThinkingCompleteEvent extends BaseAgentEvent {
  type: 'thinking_complete';
  content: string;           // Pensamiento completo
  blockIndex?: number;
  messageId?: string;
}
```

**Responsabilidad Frontend**:
```typescript
function handleThinkingComplete(event: ThinkingCompleteEvent) {
  const index = event.blockIndex || 0;

  // Finalizar bloque de pensamiento
  finalizeThinkingBlock(index, event.content);

  // Limpiar acumulador
  delete thinkingAccumulator[index];

  // Asegurar que aparezca ANTES del mensaje de texto
  moveThinkingBlockToTop(index);
}
```

---

### 6. tool_use

**Cuándo**: Claude solicita ejecutar una herramienta.

**Propósito**: Mostrar qué herramienta se está ejecutando.

```typescript
interface ToolUseEvent extends BaseAgentEvent {
  type: 'tool_use';
  toolName: string;              // Nombre de la herramienta
  args: Record<string, unknown>; // Argumentos
  toolUseId?: string;            // Para correlación con tool_result
}
```

**Responsabilidad Frontend**:
```typescript
function handleToolUse(event: ToolUseEvent) {
  // Mostrar indicador de ejecución de herramienta
  addToolExecutionCard({
    toolUseId: event.toolUseId!,
    toolName: event.toolName,
    args: event.args,
    status: 'executing'  // Cambiará con tool_result
  });
}
```

---

### 7. tool_result

**Cuándo**: Al completar ejecución de herramienta.

**Propósito**: Actualizar UI con resultado (éxito/error).

```typescript
interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  toolName: string;
  args?: Record<string, unknown>;
  result: unknown;               // Resultado de la herramienta
  success: boolean;
  error?: string;                // Si success=false
  toolUseId?: string;            // Correlación con tool_use
  durationMs?: number;
}
```

**Responsabilidad Frontend**:
```typescript
function handleToolResult(event: ToolResultEvent) {
  // Actualizar tarjeta de herramienta existente
  updateToolExecutionCard(event.toolUseId!, {
    status: event.success ? 'success' : 'error',
    result: event.result,
    error: event.error,
    duration: event.durationMs
  });

  // Correlación: vincular con tool_use por toolUseId
  correlateWithToolUse(event.toolUseId!, event.correlationId);
}
```

---

### 8. approval_requested

**Cuándo**: Herramienta requiere aprobación humana (HITL).

**Propósito**: Solicitar decisión del usuario antes de ejecutar acción.

```typescript
interface ApprovalRequestedEvent extends BaseAgentEvent {
  type: 'approval_requested';
  approvalId: string;            // UUID único
  toolName: string;
  args: Record<string, unknown>;
  changeSummary: string;         // Descripción legible del cambio
  priority: 'low' | 'medium' | 'high';
  expiresAt?: string;            // ISO 8601
}
```

**Responsabilidad Frontend**:
```typescript
function handleApprovalRequested(event: ApprovalRequestedEvent) {
  // Mostrar modal de aprobación
  showApprovalModal({
    approvalId: event.approvalId,
    toolName: event.toolName,
    summary: event.changeSummary,
    args: event.args,
    priority: event.priority,
    expiresAt: event.expiresAt,
    onApprove: () => respondToApproval(event.approvalId, 'approved'),
    onReject: () => respondToApproval(event.approvalId, 'rejected')
  });
}

function respondToApproval(approvalId: string, decision: 'approved' | 'rejected') {
  socket.emit('approval:response', {
    approvalId,
    decision,
    userId: currentUserId,
    reason: getApprovalReason() // Opcional
  });
}
```

---

### 9. approval_resolved

**Cuándo**: Usuario respondió a solicitud de aprobación.

**Propósito**: Confirmación de que la decisión fue procesada.

```typescript
interface ApprovalResolvedEvent extends BaseAgentEvent {
  type: 'approval_resolved';
  approvalId: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}
```

**Responsabilidad Frontend**:
```typescript
function handleApprovalResolved(event: ApprovalResolvedEvent) {
  // Cerrar modal de aprobación
  closeApprovalModal(event.approvalId);

  // Mostrar resultado
  showApprovalResult({
    decision: event.decision,
    reason: event.reason
  });
}
```

---

### 10. complete (Terminal)

**Cuándo**: Al finalizar ejecución del agente.

**Propósito**: Señal terminal para detener escucha de eventos.

```typescript
interface CompleteEvent extends BaseAgentEvent {
  type: 'complete';
  reason: 'success' | 'error' | 'max_turns' | 'user_cancelled';
  citedFiles?: CitedFile[];  // Archivos usados durante ejecución
}

interface CitedFile {
  fileName: string;
  fileId: string;
}
```

**Responsabilidad Frontend**:
```typescript
function handleComplete(event: CompleteEvent) {
  // 1. Detener indicadores de carga
  hideLoadingIndicator();

  // 2. Habilitar input de usuario
  enableMessageInput();

  // 3. Procesar archivos citados (si existen)
  if (event.citedFiles && event.citedFiles.length > 0) {
    enableClickableCitations(event.citedFiles);
  }

  // 4. Mostrar razón de completitud
  switch (event.reason) {
    case 'success':
      showSuccessIndicator();
      break;
    case 'error':
      showErrorIndicator();
      break;
    case 'max_turns':
      showMaxTurnsWarning();
      break;
    case 'user_cancelled':
      showCancelledMessage();
      break;
  }
}
```

---

### 11. error

**Cuándo**: Error durante ejecución del agente.

**Propósito**: Mostrar error al usuario.

```typescript
interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  error: string;         // Mensaje de error (user-friendly)
  code?: string;         // Código de error (opcional)
  stack?: string;        // Stack trace (solo development)
}
```

**Responsabilidad Frontend**:
```typescript
function handleError(event: ErrorEvent) {
  showErrorNotification({
    message: event.error,
    code: event.code,
    timestamp: event.timestamp
  });

  // Detener indicadores de carga
  hideLoadingIndicator();
  enableMessageInput();
}
```

---

### 12. session_start

**Cuándo**: Al iniciar sesión del agente.

**Propósito**: Confirmación de inicio.

```typescript
interface SessionStartEvent extends BaseAgentEvent {
  type: 'session_start';
  sessionId: string;
  userId: string;
}
```

---

### 13. turn_paused

**Cuándo**: Claude pausa un turno largo (SDK 0.71+).

**Propósito**: Informar al usuario que el procesamiento está pausado.

```typescript
interface TurnPausedEvent extends BaseAgentEvent {
  type: 'turn_paused';
  content?: string;      // Contenido parcial antes de pausa
  messageId: string;
  reason?: string;
}
```

---

### 14. content_refused

**Cuándo**: Claude rechaza generar contenido por violación de política.

**Propósito**: Mostrar mensaje apropiado al usuario.

```typescript
interface ContentRefusedEvent extends BaseAgentEvent {
  type: 'content_refused';
  messageId: string;
  reason?: string;       // Explicación de rechazo
  content?: string;      // Contenido parcial antes de rechazo
}
```

---

## Flujos de Eventos Comunes

### Flujo 1: Mensaje Simple

```
1. user_message_confirmed
   ↓
2. message_chunk (repetido, transient)
   ↓
3. message (persisted)
   ↓
4. complete (terminal)
```

**Frontend**:
- Acumular chunks durante streaming
- Al recibir `message`, reemplazar acumulador con mensaje final
- Al recibir `complete`, habilitar input

---

### Flujo 2: Con Ejecución de Herramienta

```
1. user_message_confirmed
   ↓
2. message_chunk (texto previo)
   ↓
3. tool_use
   ↓
4. tool_result
   ↓
5. message_chunk (continuación)
   ↓
6. message (persisted)
   ↓
7. complete (terminal)
```

**Frontend**:
- Mostrar tarjeta de herramienta al recibir `tool_use`
- Actualizar tarjeta al recibir `tool_result`
- Continuar acumulando chunks de mensaje

---

### Flujo 3: Con Extended Thinking

```
1. user_message_confirmed
   ↓
2. thinking_chunk (repetido, transient)
   ↓
3. thinking_complete
   ↓
4. message_chunk (repetido, transient)
   ↓
5. message (persisted)
   ↓
6. complete (terminal)
```

**Frontend**:
- Acumular thinking chunks en bloque separado
- Al recibir `thinking_complete`, colapsar bloque de pensamiento
- Asegurar que pensamiento aparezca ANTES del mensaje
- Continuar con acumulación de mensaje

---

### Flujo 4: Con Aprobación Humana

```
1. user_message_confirmed
   ↓
2. message_chunk
   ↓
3. tool_use
   ↓
4. approval_requested
   [PAUSA - Esperando usuario]
   ↓
5. approval_resolved (usuario respondió)
   ↓
6. tool_result
   ↓
7. message_chunk (continuación)
   ↓
8. message (persisted)
   ↓
9. complete (terminal)
```

**Frontend**:
- Mostrar modal al recibir `approval_requested`
- Usuario decide: emitir `approval:response`
- Cerrar modal al recibir `approval_resolved`
- Continuar flujo normal

---

## Eventos Cliente → Servidor

### 1. chat:message

**Propósito**: Enviar mensaje del usuario al agente.

```typescript
interface ChatMessageData {
  message: string;                    // Contenido del mensaje
  sessionId: string;                  // UUID de sesión
  userId: string;                     // ID de usuario (OAuth)

  // Opciones de Extended Thinking (por request)
  thinking?: {
    enableThinking?: boolean;         // Default: server env
    thinkingBudget?: number;          // Default: 10000, min: 1024
  };

  // Adjuntos de archivos
  attachments?: string[];             // Array de file UUIDs

  // Búsqueda semántica automática
  enableAutoSemanticSearch?: boolean; // Default: false
}
```

**Ejemplo Frontend**:
```typescript
function sendMessage(message: string) {
  socket.emit('chat:message', {
    message,
    sessionId: currentSessionId,
    userId: currentUserId,
    thinking: {
      enableThinking: true,
      thinkingBudget: 5000
    },
    attachments: selectedFileIds,
    enableAutoSemanticSearch: true
  });
}
```

---

### 2. chat:stop

**Propósito**: Detener ejecución en curso.

```typescript
interface StopAgentData {
  sessionId: string;
  userId: string;
}
```

**Ejemplo Frontend**:
```typescript
function stopAgent() {
  socket.emit('chat:stop', {
    sessionId: currentSessionId,
    userId: currentUserId
  });
}
```

---

### 3. approval:response

**Propósito**: Responder a solicitud de aprobación.

```typescript
interface ApprovalResponseData {
  approvalId: string;
  decision: 'approved' | 'rejected';
  userId: string;
  reason?: string;
}
```

**Ejemplo Frontend**:
```typescript
function respondToApproval(
  approvalId: string,
  decision: 'approved' | 'rejected',
  reason?: string
) {
  socket.emit('approval:response', {
    approvalId,
    decision,
    userId: currentUserId,
    reason
  });
}
```

---

### 4. session:join

**Propósito**: Unirse a un room de sesión.

```typescript
interface SessionJoinData {
  sessionId: string;
}
```

**Ejemplo Frontend**:
```typescript
function joinSession(sessionId: string) {
  socket.emit('session:join', { sessionId });

  // Esperar confirmación antes de enviar mensajes
  socket.once('session:ready', () => {
    console.log('Session ready');
    enableMessageInput();
  });
}
```

---

### 5. session:leave

**Propósito**: Salir de un room de sesión.

```typescript
interface SessionLeaveData {
  sessionId: string;
}
```

**Ejemplo Frontend**:
```typescript
function leaveSession(sessionId: string) {
  socket.emit('session:leave', { sessionId });
}
```

---

## Ordenamiento de Eventos

### Regla de Oro

```typescript
// Para eventos PERSISTIDOS (sequenceNumber presente)
events.sort((a, b) =>
  (a.sequenceNumber || 0) - (b.sequenceNumber || 0)
);

// Para eventos TRANSIENT (sequenceNumber ausente)
events.sort((a, b) =>
  (a.eventIndex || 0) - (b.eventIndex || 0)
);
```

### Ejemplo de Implementación

```typescript
interface EventWithOrder extends AgentEvent {
  sequenceNumber?: number;
  eventIndex?: number;
}

function sortEvents(events: EventWithOrder[]): EventWithOrder[] {
  return events.sort((a, b) => {
    // Prioridad 1: sequenceNumber (eventos persistidos)
    if (a.sequenceNumber !== undefined && b.sequenceNumber !== undefined) {
      return a.sequenceNumber - b.sequenceNumber;
    }

    // Prioridad 2: eventIndex (eventos transient)
    const aIndex = a.eventIndex || 0;
    const bIndex = b.eventIndex || 0;
    return aIndex - bIndex;
  });
}
```

---

## Responsabilidades del Frontend

### 1. Acumulación de Chunks

**message_chunk**:
```typescript
const messageAccumulators = new Map<string, string>();

function handleMessageChunk(event: MessageChunkEvent) {
  const key = event.messageId || 'default';
  const current = messageAccumulators.get(key) || '';
  messageAccumulators.set(key, current + event.content);

  renderStreamingText(messageAccumulators.get(key)!);
}

function handleMessage(event: MessageEvent) {
  // Limpiar acumulador
  messageAccumulators.delete(event.messageId);

  // Renderizar mensaje final
  renderFinalMessage(event);
}
```

**thinking_chunk**:
```typescript
const thinkingAccumulators = new Map<number, string>();

function handleThinkingChunk(event: ThinkingChunkEvent) {
  const index = event.blockIndex || 0;
  const current = thinkingAccumulators.get(index) || '';
  thinkingAccumulators.set(index, current + event.content);

  renderStreamingThinking(index, thinkingAccumulators.get(index)!);
}

function handleThinkingComplete(event: ThinkingCompleteEvent) {
  const index = event.blockIndex || 0;

  // Finalizar y limpiar
  finalizeThinkingBlock(index, event.content);
  thinkingAccumulators.delete(index);
}
```

---

### 2. Gestión de Estado de Persistencia

```typescript
function handleEvent(event: AgentEvent) {
  // Actualizar UI según persistenceState
  switch (event.persistenceState) {
    case 'pending':
      showPendingIndicator(event.eventId);
      break;
    case 'persisted':
      showPersistedIndicator(event.eventId);
      break;
    case 'failed':
      showFailedIndicator(event.eventId);
      break;
    case 'transient':
      // No mostrar indicador (eventos efímeros)
      break;
  }
}
```

---

### 3. Correlación de Eventos

**Tool Use → Tool Result**:
```typescript
const toolExecutions = new Map<string, ToolExecution>();

function handleToolUse(event: ToolUseEvent) {
  toolExecutions.set(event.toolUseId!, {
    id: event.toolUseId!,
    name: event.toolName,
    args: event.args,
    status: 'executing',
    startTime: Date.now()
  });

  renderToolCard(event.toolUseId!);
}

function handleToolResult(event: ToolResultEvent) {
  const execution = toolExecutions.get(event.toolUseId!);
  if (execution) {
    execution.status = event.success ? 'success' : 'error';
    execution.result = event.result;
    execution.error = event.error;
    execution.duration = event.durationMs;

    updateToolCard(event.toolUseId!, execution);
  }
}
```

---

### 4. Manejo de Eventos Terminales

```typescript
function handleComplete(event: CompleteEvent) {
  // Detener toda la UI de streaming
  stopAllAccumulators();
  hideLoadingIndicators();
  enableMessageInput();

  // Procesar archivos citados
  if (event.citedFiles) {
    enableCitationLinks(event.citedFiles);
  }

  // Mostrar razón de completitud
  displayCompletionReason(event.reason);
}

function handleError(event: ErrorEvent) {
  // Similar a complete, pero con UI de error
  stopAllAccumulators();
  hideLoadingIndicators();
  enableMessageInput();
  showErrorMessage(event.error);
}
```

---

## Ejemplo Completo de Implementación

### Socket Service (Frontend)

```typescript
import { io, Socket } from 'socket.io-client';
import type { AgentEvent, ChatMessageData } from '@bc-agent/shared';

class SocketService {
  private socket: Socket | null = null;
  private eventHandlers = new Map<string, (event: AgentEvent) => void>();

  connect(userId: string) {
    this.socket = io('http://localhost:3002', {
      withCredentials: true,  // Enviar cookie connect.sid
      transports: ['websocket', 'polling']
    });

    // Escuchar eventos del agente
    this.socket.on('agent:event', (event: AgentEvent) => {
      this.handleEvent(event);
    });

    // Escuchar errores
    this.socket.on('agent:error', (error) => {
      console.error('Agent error:', error);
    });
  }

  joinSession(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      this.socket?.emit('session:join', { sessionId });

      // Esperar confirmación
      this.socket?.once('session:ready', () => {
        resolve();
      });
    });
  }

  sendMessage(data: ChatMessageData) {
    this.socket?.emit('chat:message', data);
  }

  stopAgent(sessionId: string, userId: string) {
    this.socket?.emit('chat:stop', { sessionId, userId });
  }

  respondToApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
    userId: string,
    reason?: string
  ) {
    this.socket?.emit('approval:response', {
      approvalId,
      decision,
      userId,
      reason
    });
  }

  // Registrar handler para tipo específico de evento
  onEvent(type: string, handler: (event: AgentEvent) => void) {
    this.eventHandlers.set(type, handler);
  }

  private handleEvent(event: AgentEvent) {
    // Type narrowing con switch
    switch (event.type) {
      case 'user_message_confirmed':
        this.eventHandlers.get('user_message_confirmed')?.(event);
        break;
      case 'message_chunk':
        this.eventHandlers.get('message_chunk')?.(event);
        break;
      case 'message':
        this.eventHandlers.get('message')?.(event);
        break;
      case 'thinking_chunk':
        this.eventHandlers.get('thinking_chunk')?.(event);
        break;
      case 'thinking_complete':
        this.eventHandlers.get('thinking_complete')?.(event);
        break;
      case 'tool_use':
        this.eventHandlers.get('tool_use')?.(event);
        break;
      case 'tool_result':
        this.eventHandlers.get('tool_result')?.(event);
        break;
      case 'approval_requested':
        this.eventHandlers.get('approval_requested')?.(event);
        break;
      case 'approval_resolved':
        this.eventHandlers.get('approval_resolved')?.(event);
        break;
      case 'complete':
        this.eventHandlers.get('complete')?.(event);
        break;
      case 'error':
        this.eventHandlers.get('error')?.(event);
        break;
      // ... otros tipos
    }
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketService = new SocketService();
```

---

### Componente de Chat (Frontend)

```typescript
import { useEffect, useState } from 'react';
import { socketService } from './socket-service';
import type { MessageEvent, MessageChunkEvent, CompleteEvent } from '@bc-agent/shared';

function ChatComponent({ sessionId, userId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentChunk, setCurrentChunk] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Conectar y unirse a sesión
    socketService.connect(userId);
    socketService.joinSession(sessionId);

    // Registrar handlers
    socketService.onEvent('message_chunk', (event: AgentEvent) => {
      const chunk = event as MessageChunkEvent;
      setCurrentChunk((prev) => prev + chunk.content);
    });

    socketService.onEvent('message', (event: AgentEvent) => {
      const message = event as MessageEvent;
      setMessages((prev) => [...prev, {
        id: message.messageId,
        content: message.content,
        role: message.role,
        sequenceNumber: message.sequenceNumber!
      }]);
      setCurrentChunk(''); // Limpiar acumulador
    });

    socketService.onEvent('complete', (event: AgentEvent) => {
      const complete = event as CompleteEvent;
      setIsLoading(false);
      console.log('Agent completed:', complete.reason);
    });

    return () => {
      socketService.disconnect();
    };
  }, [sessionId, userId]);

  const sendMessage = (text: string) => {
    setIsLoading(true);
    socketService.sendMessage({
      message: text,
      sessionId,
      userId,
      thinking: {
        enableThinking: true,
        thinkingBudget: 5000
      }
    });
  };

  return (
    <div>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {currentChunk && (
        <StreamingBubble content={currentChunk} />
      )}
      <MessageInput
        onSend={sendMessage}
        disabled={isLoading}
      />
    </div>
  );
}
```

---

## Debugging y Tracing

### Event Tracing

Cada evento incluye `eventId` para debugging:

```typescript
function logEvent(event: AgentEvent) {
  console.log('[Event Trace]', {
    eventId: event.eventId,
    type: event.type,
    sequenceNumber: event.sequenceNumber,
    eventIndex: event.eventIndex,
    persistenceState: event.persistenceState,
    correlationId: event.correlationId,
    timestamp: event.timestamp
  });
}
```

---

### Verificación de Ordenamiento

```typescript
function verifyEventOrder(events: AgentEvent[]) {
  const persistedEvents = events.filter(e => e.sequenceNumber !== undefined);

  // Verificar que sequenceNumbers sean consecutivos
  for (let i = 1; i < persistedEvents.length; i++) {
    const prev = persistedEvents[i - 1].sequenceNumber!;
    const curr = persistedEvents[i].sequenceNumber!;

    if (curr !== prev + 1) {
      console.warn(`Gap in sequence numbers: ${prev} -> ${curr}`);
    }
  }
}
```

---

## Errores Comunes y Soluciones

### Error 1: Chunks Desordenados

**Síntoma**: Chunks de mensaje aparecen en orden incorrecto.

**Causa**: Usar timestamp para ordenar (impreciso).

**Solución**: Usar `eventIndex` para eventos transient:

```typescript
// ❌ INCORRECTO
chunks.sort((a, b) =>
  new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
);

// ✅ CORRECTO
chunks.sort((a, b) =>
  (a.eventIndex || 0) - (b.eventIndex || 0)
);
```

---

### Error 2: No Limpiar Acumuladores

**Síntoma**: Chunks de mensaje anterior aparecen en mensaje nuevo.

**Causa**: No limpiar acumulador al recibir `message` final.

**Solución**: Siempre limpiar después de `message` o `thinking_complete`:

```typescript
function handleMessage(event: MessageEvent) {
  // Guardar mensaje final
  addMessage(event);

  // ✅ LIMPIAR ACUMULADOR
  messageAccumulators.delete(event.messageId);
}
```

---

### Error 3: No Esperar session:ready

**Síntoma**: Mensajes enviados antes de unirse a sesión no llegan.

**Causa**: Emitir `chat:message` antes de recibir `session:ready`.

**Solución**: Esperar confirmación de sesión:

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

---

## Referencia Rápida

### Eventos Transient (No Persistidos)

- `message_chunk` → Acumular, ordenar por `eventIndex`
- `thinking_chunk` → Acumular, ordenar por `eventIndex`

### Eventos Persistidos (Con sequenceNumber)

- `user_message_confirmed` → Usar `sequenceNumber` para ordenar
- `message` → Usar `sequenceNumber` para ordenar
- `thinking_complete` → Usar `sequenceNumber` para ordenar
- `tool_use` → Usar `sequenceNumber` para ordenar
- `tool_result` → Usar `sequenceNumber` para ordenar

### Eventos Terminales (Detener Escucha)

- `complete` → Habilitar input, procesar citedFiles
- `error` → Mostrar error, habilitar input
- `session_end` → Limpiar estado de sesión

### Correlaciones Importantes

- `tool_use.toolUseId` ↔ `tool_result.toolUseId`
- `message_chunk.messageId` ↔ `message.messageId`
- `thinking_chunk.messageId` ↔ `thinking_complete.messageId`
- `approval_requested.approvalId` ↔ `approval_resolved.approvalId`

---

## Recursos Adicionales

### Tipos TypeScript

Todos los tipos están disponibles en el paquete compartido:

```typescript
import type {
  AgentEvent,
  MessageEvent,
  MessageChunkEvent,
  ThinkingChunkEvent,
  ThinkingCompleteEvent,
  ToolUseEvent,
  ToolResultEvent,
  CompleteEvent,
  ErrorEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  UserMessageConfirmedEvent,
  ChatMessageData,
  StopAgentData,
  ApprovalResponseData
} from '@bc-agent/shared';
```

### Archivos de Referencia

- `packages/shared/src/types/agent.types.ts` - Definiciones de eventos
- `packages/shared/src/types/websocket.types.ts` - Definiciones WebSocket
- `backend/src/services/websocket/ChatMessageHandler.ts` - Implementación backend
- `backend/src/domains/agent/emission/AgentEventEmitter.ts` - Emisor de eventos

---

*Última actualización: 2025-12-23*
