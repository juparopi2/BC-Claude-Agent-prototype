# Integración con Paquete Compartido (@bc-agent/shared)

**Fecha**: 2026-01-14
**Estado**: Implementado
**Versión**: 2.1

---

## Ubicación y Propósito

```
packages/shared/
├── src/
│   ├── types/
│   │   ├── agent.types.ts            # 13 tipos de eventos del agente (sync)
│   │   ├── message.types.ts          # Contrato API (single source of truth)
│   │   ├── websocket.types.ts        # Eventos WebSocket type-safe
│   │   ├── approval.types.ts         # Sistema Human-in-the-Loop
│   │   ├── file.types.ts             # Gestión de archivos + D25 retry/readiness types
│   │   ├── source.types.ts           # Sistema multi-origen (Blob, SharePoint, etc.)
│   │   ├── error.types.ts            # Respuestas de error estandarizadas
│   │   ├── normalized-events.types.ts # Eventos normalizados multi-provider
│   │   └── index.ts                  # Barrel export
│   ├── schemas/
│   │   └── index.ts                  # 11 esquemas Zod de validación (+ retryProcessingRequestSchema)
│   ├── constants/
│   │   ├── errors.ts                 # 42 códigos de error + mensajes
│   │   ├── file-processing.ts        # PROCESSING_STATUS, EMBEDDING_STATUS, FILE_READINESS_STATE
│   │   ├── websocket-events.ts       # FILE_WS_CHANNELS, FILE_WS_EVENTS
│   │   └── index.ts
│   └── index.ts                      # Root barrel export
└── package.json
```

**El paquete `@bc-agent/shared` es el SINGLE SOURCE OF TRUTH para tipos compartidos.**

---

## Tipos Implementados

### 1. agent.types.ts (Eventos del Agente)

| Tipo | Descripción |
|------|-------------|
| `AgentEventType` | Union de 13 tipos de eventos (sync architecture) |
| `BaseAgentEvent` | Base con eventId, sequenceNumber, persistenceState |
| `SessionStartEvent` | Inicio de sesión |
| `ThinkingEvent` | Contenido de razonamiento extendido |
| `ThinkingCompleteEvent` | Señal de fin de thinking |
| `MessageEvent` | Mensaje completo con tokenUsage |
| `ToolUseEvent` | Invocación de herramienta |
| `ToolResultEvent` | Resultado de herramienta |
| `CompleteEvent` | Terminal con citedFiles |
| `ErrorEvent` | Evento de error |
| `ApprovalRequestedEvent` | Human-in-the-loop request |
| `ApprovalResolvedEvent` | Respuesta a aprobación |
| `UserMessageConfirmedEvent` | Mensaje de usuario persistido |
| `TurnPausedEvent` | Turn pausado (SDK 0.71+) |
| `ContentRefusedEvent` | Contenido rechazado por policy |
| `PersistenceState` | pending, queued, persisted, failed, transient |
| `StopReason` | end_turn, tool_use, max_tokens, etc. |
| `CitedFile` | Archivo citado con sourceType y fetchStrategy |

**Nota**: Los tipos de streaming (`thinking_chunk`, `message_chunk`, `message_partial`) fueron eliminados en la arquitectura síncrona v2.0.

---

### 2. normalized-events.types.ts (Multi-Provider)

Sistema de eventos normalizados independiente del proveedor (Anthropic, OpenAI, Google).

| Tipo | Descripción |
|------|-------------|
| `NormalizedProvider` | 'anthropic', 'openai', 'azure-openai', 'google' |
| `NormalizedAgentEventType` | 8 tipos: session_start, user_message, thinking, tool_request, tool_response, assistant_message, error, complete |
| `NormalizedPersistenceStrategy` | transient, sync_required, async_allowed |
| `NormalizedStopReason` | end_turn, tool_use, max_tokens, error, cancelled |
| `NormalizedTokenUsage` | inputTokens, outputTokens, thinkingTokens, cachedTokens |
| `BaseNormalizedEvent` | Base con originalIndex, persistenceStrategy, preAllocatedSequenceNumber |
| `NormalizedAgentEvent` | Discriminated union de todos los eventos normalizados |

**Type Guards disponibles**:
- `requiresSyncPersistence(event)` - Requiere persistencia síncrona
- `isTransientNormalizedEvent(event)` - Es evento transient
- `allowsAsyncPersistence(event)` - Permite persistencia async
- `isNormalizedThinkingEvent(event)` - Es evento de thinking
- `isNormalizedToolRequestEvent(event)` - Es tool_request
- `isNormalizedToolResponseEvent(event)` - Es tool_response
- `isNormalizedAssistantMessageEvent(event)` - Es assistant_message
- `isNormalizedCompleteEvent(event)` - Es evento complete

---

### 3. source.types.ts (Sistema Multi-Origen)

| Tipo | Descripción |
|------|-------------|
| `SourceType` | 'blob_storage', 'sharepoint', 'onedrive', 'email', 'web' |
| `FetchStrategy` | 'internal_api', 'oauth_proxy', 'external' |
| `SourceExcerpt` | Fragmento de documento con score y chunkIndex |
| `DEFAULT_SOURCE_TYPE` | 'blob_storage' |
| `DEFAULT_FETCH_STRATEGY` | 'internal_api' |

**Función helper**:
```typescript
getFetchStrategy(sourceType: SourceType): FetchStrategy
// blob_storage → internal_api
// sharepoint/onedrive/email → oauth_proxy
// web → external
```

---

### 4. error.types.ts (Respuestas de Error)

| Tipo | Descripción |
|------|-------------|
| `ApiErrorResponse` | Estructura estándar: error, message, code, details?, requestId? |
| `ErrorResponseWithStatus` | Respuesta con statusCode + body |
| `ValidationErrorDetail` | field, message, expected?, received? |
| `RangeErrorDetail` | field, min, max, received |

**Type Guards**:
- `isApiErrorResponse(obj)` - Valida estructura de error
- `isValidErrorCode(code)` - Valida código de error

---

### 5. message.types.ts (Contrato API)

| Tipo | Descripción |
|------|-------------|
| `Message` | Discriminated union de mensajes |
| `TokenUsage` | { input_tokens, output_tokens } |

---

### 6. websocket.types.ts (Eventos WebSocket)

| Tipo | Descripción |
|------|-------------|
| `ChatMessageData` | Input del WebSocket |
| Otros eventos WebSocket type-safe |

---

### 7. approval.types.ts (Human-in-the-Loop)

| Tipo | Descripción |
|------|-------------|
| `ApprovalRequest` | Solicitud de aprobación |
| `ApprovalResponse` | Respuesta (approved/rejected) |

---

### 8. file.types.ts (Gestión de Archivos + D25)

| Tipo | Descripción |
|------|-------------|
| `ParsedFile` | Archivo parseado con todos los campos incluido `readinessState` |
| `FileReadinessState` | `'uploading' \| 'processing' \| 'ready' \| 'failed'` |
| `ProcessingStatus` | `'pending' \| 'processing' \| 'completed' \| 'failed'` |
| `EmbeddingStatus` | `'pending' \| 'queued' \| 'processing' \| 'completed' \| 'failed'` |

**Tipos de Retry (D25)**:
| Tipo | Descripción |
|------|-------------|
| `RetryPhase` | `'processing' \| 'embedding'` |
| `RetryScope` | `'full' \| 'embedding_only'` |
| `RetryDecisionReason` | `'within_limit' \| 'max_retries_exceeded' \| 'not_failed'` |
| `RetryDecisionResult` | Resultado de decisión de retry con `shouldRetry`, `backoffDelayMs`, etc. |
| `ManualRetryResult` | Resultado de retry manual con `file`, `jobId`, `error` |
| `CleanupResult` | Estadísticas de cleanup: `chunksDeleted`, `searchDocumentsDeleted` |
| `BatchCleanupResult` | Estadísticas de cleanup en batch con `failures` array |

**Tipos de API (D25)**:
| Tipo | Descripción |
|------|-------------|
| `RetryProcessingRequest` | Request body para `POST /api/files/:id/retry-processing` |
| `RetryProcessingResponse` | Response con `file`, `jobId`, `message` |

**Tipos de WebSocket Events (D25)**:
| Tipo | Descripción |
|------|-------------|
| `BaseFileWebSocketEvent` | Base con `fileId`, `timestamp` |
| `FileReadinessChangedEvent` | Cambio de readiness: `previousState`, `newState`, statuses |
| `FilePermanentlyFailedEvent` | Fallo permanente: `error`, retry counts, `canRetryManually` |
| `FileProcessingProgressEvent` | Progreso: `progress`, `stage`, `attemptNumber`, `maxAttempts` |
| `FileProcessingCompletedEvent` | Completado: `stats` (`textLength`, `pageCount`, `ocrUsed`) |
| `FileProcessingFailedEvent` | Error con `error` message |
| `FileWebSocketEvent` | Union type de todos los eventos WebSocket de archivos |

**Ejemplo de uso**:
```typescript
import {
  FileReadinessState,
  RetryDecisionResult,
  FileWebSocketEvent,
  FileReadinessChangedEvent
} from '@bc-agent/shared';

function handleFileEvent(event: FileWebSocketEvent) {
  if (event.type === 'file:readiness_changed') {
    const e = event as FileReadinessChangedEvent;
    console.log(`File ${e.fileId}: ${e.previousState} → ${e.newState}`);
  }
}
```

---

### 9. Constants: file-processing.ts (D25)

Constantes centralizadas para estados de procesamiento de archivos.

```typescript
import {
  PROCESSING_STATUS,
  EMBEDDING_STATUS,
  FILE_READINESS_STATE
} from '@bc-agent/shared';
```

| Constante | Valores |
|-----------|---------|
| `PROCESSING_STATUS` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `EMBEDDING_STATUS` | `PENDING`, `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `FILE_READINESS_STATE` | `UPLOADING`, `PROCESSING`, `READY`, `FAILED` |

**Tipos derivados** (para type safety):
```typescript
type ProcessingStatusValue = typeof PROCESSING_STATUS[keyof typeof PROCESSING_STATUS];
// → 'pending' | 'processing' | 'completed' | 'failed'

type EmbeddingStatusValue = typeof EMBEDDING_STATUS[keyof typeof EMBEDDING_STATUS];
// → 'pending' | 'queued' | 'processing' | 'completed' | 'failed'

type FileReadinessStateValue = typeof FILE_READINESS_STATE[keyof typeof FILE_READINESS_STATE];
// → 'uploading' | 'processing' | 'ready' | 'failed'
```

**Uso correcto (evita magic strings)**:
```typescript
// ❌ INCORRECTO - Magic strings
if (file.processingStatus === 'completed') { ... }

// ✅ CORRECTO - Constantes centralizadas
import { PROCESSING_STATUS } from '@bc-agent/shared';
if (file.processingStatus === PROCESSING_STATUS.COMPLETED) { ... }
```

---

### 10. Constants: websocket-events.ts (D25)

Constantes centralizadas para canales y eventos WebSocket de archivos.

```typescript
import {
  FILE_WS_CHANNELS,
  FILE_WS_EVENTS
} from '@bc-agent/shared';
```

**Canales**:
| Constante | Valor | Uso |
|-----------|-------|-----|
| `FILE_WS_CHANNELS.STATUS` | `'file:status'` | Cambios de estado de readiness |
| `FILE_WS_CHANNELS.PROCESSING` | `'file:processing'` | Progreso, completado, errores |

**Eventos**:
| Constante | Valor |
|-----------|-------|
| `FILE_WS_EVENTS.READINESS_CHANGED` | `'file:readiness_changed'` |
| `FILE_WS_EVENTS.PERMANENTLY_FAILED` | `'file:permanently_failed'` |
| `FILE_WS_EVENTS.PROCESSING_PROGRESS` | `'file:processing_progress'` |
| `FILE_WS_EVENTS.PROCESSING_COMPLETED` | `'file:processing_completed'` |
| `FILE_WS_EVENTS.PROCESSING_FAILED` | `'file:processing_failed'` |

**Tipos derivados**:
```typescript
type FileWsChannel = typeof FILE_WS_CHANNELS[keyof typeof FILE_WS_CHANNELS];
// → 'file:status' | 'file:processing'

type FileWsEventType = typeof FILE_WS_EVENTS[keyof typeof FILE_WS_EVENTS];
// → 'file:readiness_changed' | 'file:permanently_failed' | ...
```

**Uso en backend (emisión)**:
```typescript
import { FILE_WS_CHANNELS, FILE_WS_EVENTS } from '@bc-agent/shared';

io.to(sessionId).emit(FILE_WS_CHANNELS.STATUS, {
  type: FILE_WS_EVENTS.READINESS_CHANGED,
  fileId,
  previousState: 'processing',
  newState: 'ready'
});
```

**Uso en frontend (escucha)**:
```typescript
import { FILE_WS_CHANNELS, FILE_WS_EVENTS, FileWebSocketEvent } from '@bc-agent/shared';

socket.on(FILE_WS_CHANNELS.STATUS, (event: FileWebSocketEvent) => {
  if (event.type === FILE_WS_EVENTS.READINESS_CHANGED) {
    // Handle readiness change
  }
});
```

---

## Esquemas Zod (10 Schemas)

```typescript
import {
  chatMessageSchema,
  agentQuerySchema,
  approvalResponseSchema,
  sessionJoinSchema,
  sessionLeaveSchema,
  todoCreateSchema,
  bcQuerySchema,
  extendedThinkingConfigSchema,
  fullChatMessageSchema,
  stopAgentSchema,
  validateOrThrow,
  validateSafe,
  z  // Re-export de Zod
} from '@bc-agent/shared';
```

| Schema | Validación |
|--------|------------|
| `chatMessageSchema` | message (1-10000 chars), sessionId (UUID), userId (UUID) |
| `agentQuerySchema` | prompt, sessionId?, userId, streaming, maxTurns (1-50) |
| `approvalResponseSchema` | approvalId, decision (approved/rejected), userId, reason? |
| `sessionJoinSchema` | sessionId, userId |
| `sessionLeaveSchema` | sessionId |
| `todoCreateSchema` | sessionId, content, activeForm, order? |
| `bcQuerySchema` | entity (enum), filter?, select?, expand?, orderBy?, top?, skip?, count? |
| `extendedThinkingConfigSchema` | enableThinking?, thinkingBudget? (min 1024) |
| `fullChatMessageSchema` | chatMessage + thinking config |
| `stopAgentSchema` | sessionId, userId |

**Helpers de validación**:
```typescript
// Throws ZodError on failure
const data = validateOrThrow(chatMessageSchema, req.body);

// Returns Result type
const result = validateSafe(chatMessageSchema, req.body);
if (result.success) {
  console.log(result.data.message);
} else {
  console.log(result.error.errors);
}
```

---

## Códigos de Error (42 Códigos)

```typescript
import { ErrorCode, ERROR_MESSAGES, ERROR_STATUS_CODES } from '@bc-agent/shared';
```

### Categorías de Error

| Categoría | HTTP | Ejemplos |
|-----------|------|----------|
| **Bad Request** | 400 | `VALIDATION_ERROR`, `INVALID_PARAMETER`, `MISSING_REQUIRED_FIELD`, `PARAMETER_OUT_OF_RANGE` |
| **Unauthorized** | 401 | `UNAUTHORIZED`, `SESSION_EXPIRED`, `INVALID_TOKEN`, `USER_ID_NOT_IN_SESSION` |
| **Forbidden** | 403 | `FORBIDDEN`, `ACCESS_DENIED`, `SESSION_ACCESS_DENIED`, `APPROVAL_ACCESS_DENIED` |
| **Not Found** | 404 | `NOT_FOUND`, `SESSION_NOT_FOUND`, `USER_NOT_FOUND`, `APPROVAL_NOT_FOUND`, `TOOL_NOT_FOUND` |
| **Conflict** | 409 | `CONFLICT`, `ALREADY_EXISTS`, `ALREADY_RESOLVED`, `STATE_CONFLICT` |
| **Gone** | 410 | `EXPIRED`, `APPROVAL_EXPIRED` |
| **Rate Limit** | 429 | `RATE_LIMIT_EXCEEDED`, `SESSION_RATE_LIMIT_EXCEEDED` |
| **Internal** | 500 | `INTERNAL_ERROR`, `DATABASE_ERROR`, `SERVICE_ERROR`, `SESSION_CREATE_ERROR` |
| **Unavailable** | 503 | `SERVICE_UNAVAILABLE`, `AGENT_BUSY`, `BC_UNAVAILABLE`, `MCP_UNAVAILABLE` |

**Funciones helper**:
```typescript
getHttpStatusName(statusCode: number): string
getErrorMessage(code: ErrorCode): string
getErrorStatusCode(code: ErrorCode): number
validateErrorConstants(): void  // Para startup validation
```

---

## Regla de Herencia: Backend EXTIENDE Shared

### PATRÓN OBLIGATORIO

```typescript
// ❌ INCORRECTO - No crear tipos duplicados
interface BackendMessage {
  id: string;
  content: string;
  // ... duplicando campos de shared
}

// ✅ CORRECTO - Extender desde shared
import { BaseAgentEvent, Message } from '@bc-agent/shared';

// Backend extiende con campos internos
interface BackendAgentEvent extends BaseAgentEvent {
  // Campos solo para backend (auditoría, trazabilidad)
  internalEventId?: string;
  dbSequenceNumber?: number;
  processingLatencyMs?: number;
}

// Backend puede agregar metadatos internos
interface BackendMessageContext {
  message: Message;                    // Del shared
  auditTrail: AuditEntry[];           // Solo backend
  encryptedTokens?: string;           // Solo backend
}
```

---

## Separación de Campos: Frontend vs Backend

| Campo | Frontend | Backend | Razón |
|-------|----------|---------|-------|
| `id`, `session_id`, `content` | ✅ | ✅ | Necesario en ambos |
| `sequence_number` | ✅ | ✅ | Ordering |
| `token_usage` | ✅ | ✅ | Mostrar al usuario |
| `citedFiles` | ✅ | ✅ | Citas clickeables |
| `preAllocatedSequenceNumber` | ❌ | ✅ | Pre-allocation interna |
| `originalIndex` | ❌ | ✅ | Ordenamiento normalización |
| `persistenceStrategy` | ❌ | ✅ | Lógica de persistencia |
| `processingLatencyMs` | ❌ | ✅ | Monitoreo interno |
| `encryptedBCToken` | ❌ | ✅ | Seguridad |
| `dbRowVersion` | ❌ | ✅ | Concurrencia optimista |
| `auditUserId` | ❌ | ✅ | Auditoría GDPR |

---

## Cómo las Clases del Backend Usan Shared

### Ejemplo: PersistenceCoordinator

```typescript
// PersistenceCoordinator.ts
import {
  BaseAgentEvent,
  PersistenceState,
  NormalizedAgentEvent,
  requiresSyncPersistence,
  allowsAsyncPersistence
} from '@bc-agent/shared';

interface PersistedEvent {
  // Campos del shared
  eventId: string;
  sequenceNumber: number;
  timestamp: string;
  persistenceState: PersistenceState;

  // Campos solo backend
  dbRowId?: number;
  processingTimeMs?: number;
}

// Uso de type guards
async processBatch(events: NormalizedAgentEvent[]) {
  for (const event of events) {
    if (requiresSyncPersistence(event)) {
      await this.persistSync(event);
    } else if (allowsAsyncPersistence(event)) {
      this.queueAsync(event);
    }
  }
}
```

### Ejemplo: AgentOrchestrator

```typescript
// AgentOrchestrator.ts
import {
  AgentEvent,
  NormalizedAgentEvent,
  isNormalizedAssistantMessageEvent,
  isNormalizedToolRequestEvent
} from '@bc-agent/shared';

// Normalización y emisión
processNormalizedEvent(event: NormalizedAgentEvent): AgentEvent {
  if (isNormalizedAssistantMessageEvent(event)) {
    return {
      type: 'message',
      content: event.content,
      messageId: event.messageId,
      // ... mapeo completo
    };
  }
  // ... otros tipos
}
```

### Ejemplo: BatchResultNormalizer

```typescript
// BatchResultNormalizer.ts
import {
  NormalizedAgentEvent,
  NormalizedAssistantMessageEvent,
  NormalizedToolRequestEvent,
  NormalizedTokenUsage
} from '@bc-agent/shared';

// Normaliza AgentState de LangGraph a eventos estándar
normalize(result: AgentState): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  // ... lógica de normalización
  return events;
}
```

---

## Reglas de Oro

### ✅ DO

1. **Siempre importar tipos de shared cuando existan**
   ```typescript
   import { Message, TokenUsage, ErrorCode } from '@bc-agent/shared';
   ```

2. **Usar type guards para narrowing**
   ```typescript
   import { NormalizedAgentEvent, isNormalizedThinkingEvent } from '@bc-agent/shared';

   function handleEvent(event: NormalizedAgentEvent) {
     if (isNormalizedThinkingEvent(event)) {
       console.log(event.content); // TypeScript sabe los campos
     }
   }
   ```

3. **Usar schemas Zod para validación**
   ```typescript
   import { chatMessageSchema, validateSafe } from '@bc-agent/shared';

   const result = validateSafe(chatMessageSchema, req.body);
   if (!result.success) {
     return res.status(400).json({ errors: result.error.errors });
   }
   ```

4. **Usar ErrorCode para respuestas de error**
   ```typescript
   import { ErrorCode, getErrorMessage, getErrorStatusCode } from '@bc-agent/shared';

   return res.status(getErrorStatusCode(ErrorCode.SESSION_NOT_FOUND)).json({
     error: 'Not Found',
     message: getErrorMessage(ErrorCode.SESSION_NOT_FOUND),
     code: ErrorCode.SESSION_NOT_FOUND
   });
   ```

### ❌ DON'T

1. **No duplicar tipos que ya existen en shared**
   ```typescript
   // ❌ INCORRECTO
   interface Message {
     id: string;
     content: string;
   }
   ```

2. **No hardcodear códigos de error**
   ```typescript
   // ❌ INCORRECTO
   return res.status(404).json({ message: 'Session not found' });

   // ✅ CORRECTO
   import { ErrorCode } from '@bc-agent/shared';
   return sendError(res, ErrorCode.SESSION_NOT_FOUND);
   ```

3. **No usar `any` para evitar importar de shared**
   ```typescript
   // ❌ INCORRECTO
   function handleEvent(event: any) { ... }

   // ✅ CORRECTO
   import { AgentEvent } from '@bc-agent/shared';
   function handleEvent(event: AgentEvent) { ... }
   ```

---

## Workflow de Cambios en Shared

```mermaid
graph TD
    A[Identificar necesidad de tipo nuevo] --> B{¿Ya existe en shared?}
    B -->|Sí| C[Usar tipo existente]
    B -->|No| D[Crear en shared]
    D --> E[Rebuild shared package]
    E --> F[Importar en backend/frontend]
    F --> G[Usar tipo]
```

**Comandos**:
```bash
# Build shared
npm run build:shared

# Verify types across workspace
npm run verify:types
```

---

## Checklist de Integración

Al implementar cada nueva clase:

- [ ] Revisar tipos en `@bc-agent/shared` antes de crear tipos propios
- [ ] Importar tipos existentes del shared
- [ ] Usar type guards para narrowing de eventos
- [ ] Usar schemas Zod para validación de input
- [ ] Usar ErrorCode para respuestas de error
- [ ] Extender (no duplicar) tipos del shared para campos backend-only
- [ ] Documentar por qué se agregaron campos backend-only
- [ ] Verificar que tipos compartidos se usen en interfaces públicas
- [ ] Agregar nuevos tipos a shared si se necesitan en frontend y backend

---

*Última actualización: 2026-01-14*
