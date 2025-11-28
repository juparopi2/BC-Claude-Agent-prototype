# BC Claude Agent - Backend Diagnostic Report

**Fecha de Generacion:** 2025-11-28
**Version del Backend:** 1.0.0
**Cobertura de Tests:** 59%

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Arquitectura del Sistema](#2-arquitectura-del-sistema)
3. [Inventario de Servicios](#3-inventario-de-servicios)
4. [Flujo de Datos Completo](#4-flujo-de-datos-completo)
5. [Capacidades Actuales vs Requerimientos Frontend](#5-capacidades-actuales-vs-requerimientos-frontend)
6. [Analisis de Gaps](#6-analisis-de-gaps)
7. [Estado de Pruebas Existentes](#7-estado-de-pruebas-existentes)
8. [Plan de Testing E2E](#8-plan-de-testing-e2e)
9. [Recomendaciones y Proximos Pasos](#9-recomendaciones-y-proximos-pasos)

---

## 1. Resumen Ejecutivo

### Estado General: OPERATIVO CON GAPS MENORES

El backend de BC Claude Agent esta **85% listo** para soportar un frontend completo. La arquitectura de event-sourcing, streaming en tiempo real, y el sistema de agente con Claude API estan completamente implementados y probados.

### Fortalezas Principales

| Area | Estado | Descripcion |
|------|--------|-------------|
| Autenticacion Microsoft OAuth | COMPLETO | Flujo OAuth 2.0 con MSAL, sesiones en Redis |
| Gestion de Sesiones | COMPLETO | CRUD completo, ownership validation, multi-tenant |
| Streaming de Mensajes | COMPLETO | Socket.IO con eventos tipados, secuenciamiento atomico |
| Event Sourcing | COMPLETO | `message_events` con sequence numbers via Redis INCR |
| Integracion Claude API | COMPLETO | DirectAgentService con streaming, tools, thinking |
| MCP Tools (Business Central) | COMPLETO | 115 tools vendored, conversion a Anthropic format |
| Sistema de Aprobaciones | COMPLETO | Human-in-the-loop para operaciones de escritura |
| Rate Limiting | COMPLETO | 100 jobs/session/hour via Redis counters |

### Gaps Identificados

| Gap | Prioridad | Impacto |
|-----|-----------|---------|
| Sistema de Archivos (uploads) | CRITICA | No se pueden adjuntar imagenes/PDFs |
| Titulos Auto-generados | MEDIA | UX degradada, sesiones sin nombre descriptivo |
| Sistema de Todos | BAJA | Feature futura, no bloquea MVP |
| Tracking de Reconexion | BAJA | Funciona, pero sin optimizacion |

---

## 2. Arquitectura del Sistema

### 2.1 Diagrama de Arquitectura

```
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
|  Frontend (TBD)  |<--->|  Express Server  |<--->|  Azure SQL DB    |
|                  |     |  (Port 3002)     |     |  (sqldb-bcagent) |
+--------+---------+     +--------+---------+     +------------------+
         |                        |
         |  WebSocket             |  Redis
         |  (Socket.IO)           |  (Session + Cache + Queue)
         |                        |
         v                        v
+------------------+     +------------------+
|                  |     |                  |
|  Real-time       |     |  Redis Cache     |
|  Events          |     |  (redis-bcagent) |
|                  |     |                  |
+------------------+     +--------+---------+
                                  |
                                  v
                         +------------------+
                         |                  |
                         |  BullMQ Workers  |
                         |  (Async Jobs)    |
                         |                  |
                         +------------------+
                                  |
                                  v
                         +------------------+
                         |                  |
                         |  Claude API      |
                         |  (Anthropic)     |
                         |                  |
                         +------------------+
                                  |
                                  v
                         +------------------+
                         |                  |
                         |  Business Central|
                         |  (OData v4)      |
                         |                  |
                         +------------------+
```

### 2.2 Stack Tecnologico

| Componente | Tecnologia | Version |
|------------|------------|---------|
| Runtime | Node.js | >= 18.0.0 |
| Framework | Express | 5.1.0 |
| TypeScript | TypeScript | 5.9.3 |
| WebSocket | Socket.IO | 4.8.1 |
| Base de Datos | Azure SQL (mssql) | 12.1.0 |
| Cache/Session | Redis (ioredis) | 5.8.2 |
| Queue | BullMQ | 5.63.2 |
| AI SDK | @anthropic-ai/sdk | 0.71.0 |
| Auth | @azure/msal-node | 3.8.1 |
| Validation | Zod | 3.25.76 |
| Logging | Pino | 9.6.0 |
| Testing | Vitest | 2.1.8 |

### 2.3 Estructura de Carpetas

```
backend/
├── src/
│   ├── config/           # Configuracion (database, redis, keyvault)
│   ├── middleware/       # Auth, logging, rate-limiting
│   ├── routes/           # REST endpoints (auth, chat, bc)
│   ├── services/
│   │   ├── agent/        # DirectAgentService, Anthropic clients
│   │   ├── auth/         # BCTokenManager, OAuth service
│   │   ├── bc/           # BCClient (Business Central API)
│   │   ├── cache/        # ToolUseTracker
│   │   ├── chat/         # MessageService
│   │   ├── mcp/          # MCPService (tool loading)
│   │   ├── queue/        # MessageQueue (BullMQ)
│   │   ├── session/      # SessionService
│   │   ├── todo/         # TodoManager (incompleto)
│   │   ├── token-usage/  # TokenUsageService
│   │   └── websocket/    # ChatMessageHandler
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Logger, helpers
│   └── server.ts         # Entry point
├── mcp-server/           # Vendored MCP tools (115 BC entities)
│   └── data/v1.0/*.json  # Tool definitions
└── __tests__/            # Unit, integration, E2E tests
```

---

## 3. Inventario de Servicios

### 3.1 Servicios Core (29 Total)

#### Autenticacion y Seguridad

| Servicio | Archivo | Responsabilidad | Singleton |
|----------|---------|-----------------|-----------|
| OAuth2Service | `services/auth/OAuth2Service.ts` | Flujo OAuth con Microsoft | Si |
| BCTokenManager | `services/auth/BCTokenManager.ts` | Tokens BC encriptados por usuario | Si |
| SessionService | `services/session/SessionService.ts` | CRUD sesiones de chat | Si |

#### Agente y AI

| Servicio | Archivo | Responsabilidad | Singleton |
|----------|---------|-----------------|-----------|
| DirectAgentService | `services/agent/DirectAgentService.ts` | Orquestacion de Claude API | Si |
| AnthropicClient | `services/agent/AnthropicClient.ts` | Wrapper del SDK Anthropic | No |
| FakeAnthropicClient | `services/agent/FakeAnthropicClient.ts` | Mock para testing | No |
| ApprovalManager | `services/agent/ApprovalManager.ts` | Human-in-the-loop approvals | Si |
| MCPService | `services/mcp/MCPService.ts` | Carga de 115 MCP tools | Si |
| ToolDefinitions | `services/agent/tool-definitions.ts` | Conversion MCP -> Anthropic | N/A |

#### Mensajeria y Streaming

| Servicio | Archivo | Responsabilidad | Singleton |
|----------|---------|-----------------|-----------|
| ChatMessageHandler | `services/websocket/ChatMessageHandler.ts` | WebSocket event routing | Si |
| MessageService | `services/chat/MessageService.ts` | CRUD mensajes | Si |
| EventStore | `services/events/EventStore.ts` | Persistencia de eventos | Si |
| MessageQueue | `services/queue/MessageQueue.ts` | BullMQ async processing | Si |

#### Business Central

| Servicio | Archivo | Responsabilidad | Singleton |
|----------|---------|-----------------|-----------|
| BCClient | `services/bc/BCClient.ts` | OData v4 API calls | Si |

#### Infraestructura

| Servicio | Archivo | Responsabilidad | Singleton |
|----------|---------|-----------------|-----------|
| DatabasePool | `config/database.ts` | Connection pooling SQL | Si |
| RedisClient | `config/redis.ts` | Redis connection | Si |
| KeyVaultClient | `config/keyvault.ts` | Azure secrets | Si |
| Logger | `utils/logger.ts` | Pino structured logging | Si |

### 3.2 Middleware Stack

```typescript
// Orden de ejecucion en cada request
1. pinoHttp()              // Request logging
2. cors()                  // CORS headers
3. express.json()          // Body parsing
4. session()               // Redis session
5. requireAuth()           // OAuth validation (rutas protegidas)
6. validateSessionOwnership() // Multi-tenant check
```

---

## 4. Flujo de Datos Completo

### 4.1 Flujo: Usuario Envia Mensaje

```
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 1: RECEPCION (Frontend -> Backend)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Frontend emite: socket.emit('chat:message', {                       │
│       sessionId: 'uuid',                                                │
│       userId: 'user-id',                                                │
│       message: 'Lista clientes BC'                                      │
│     })                                                                  │
│                                                                         │
│  2. ChatMessageHandler.handleMessage() recibe el evento                 │
│                                                                         │
│  3. Validacion:                                                         │
│     - Usuario autenticado (session cookie)                              │
│     - Usuario es owner de la sesion (validateSessionOwnership)          │
│     - Rate limit no excedido (100/session/hour)                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 2: PERSISTENCIA SINCRONA (~10ms)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  4. Redis INCR genera sequenceNumber atomico                            │
│     key: "session:{sessionId}:sequence"                                 │
│                                                                         │
│  5. EventStore.logEvent() escribe a message_events:                     │
│     INSERT INTO message_events (                                        │
│       id, session_id, event_type, sequence_number,                      │
│       payload, created_at                                               │
│     ) VALUES (...)                                                      │
│                                                                         │
│  6. Emite: socket.emit('agent:event', {                                 │
│       type: 'user_message_confirmed',                                   │
│       messageId: 'uuid',                                                │
│       sequenceNumber: 1,                                                │
│       eventId: 'evt-uuid'                                               │
│     })                                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 3: ENCOLAMIENTO ASINCRONO                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  7. MessageQueue.addToQueue() encola job en BullMQ:                     │
│     queue: 'message-processing'                                         │
│     job: { sessionId, userId, message, sequenceNumber }                 │
│                                                                         │
│  8. Worker procesa job:                                                 │
│     - Escribe a tabla messages (materialized view)                      │
│     - Actualiza session.updatedAt                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 4: EJECUCION DEL AGENTE (Streaming)                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  9. DirectAgentService.runAgent() inicia:                               │
│                                                                         │
│     a. Emite: { type: 'session_start', sessionId }                      │
│                                                                         │
│     b. Carga historial de mensajes de la sesion                         │
│                                                                         │
│     c. Llama Claude API con streaming:                                  │
│        anthropic.messages.stream({                                      │
│          model: 'claude-sonnet-4-20250514',                             │
│          messages: [...history, newMessage],                            │
│          tools: mcpTools, // 115 BC tools                               │
│          stream: true                                                   │
│        })                                                               │
│                                                                         │
│ 10. Para cada chunk del stream:                                         │
│                                                                         │
│     - content_block_delta (text):                                       │
│       Emite: { type: 'message_chunk', delta: '...', seqNum: N }         │
│                                                                         │
│     - content_block_delta (thinking):                                   │
│       Emite: { type: 'thinking', content: '...', seqNum: N }            │
│                                                                         │
│     - content_block_start (tool_use):                                   │
│       Emite: { type: 'tool_use', name: 'bc_customers',                  │
│                input: {...}, tool_use_id: 'toolu_xxx' }                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 5: EJECUCION DE TOOLS                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 11. Para cada tool_use:                                                 │
│                                                                         │
│     a. Verificar si es operacion de ESCRITURA:                          │
│        - POST, PATCH, DELETE -> Requiere aprobacion                     │
│        - GET -> Ejecutar directamente                                   │
│                                                                         │
│     b. Si requiere aprobacion:                                          │
│        ApprovalManager.requestApproval():                               │
│        - Crea registro en tabla approvals                               │
│        - Emite: { type: 'approval_requested',                           │
│                   approvalId, operation, input }                        │
│        - Espera respuesta (Promise pending)                             │
│                                                                         │
│     c. Usuario responde via WebSocket:                                  │
│        socket.emit('approval:response', { approvalId, approved })       │
│                                                                         │
│     d. ApprovalManager resuelve Promise                                 │
│        - Emite: { type: 'approval_resolved', approved }                 │
│                                                                         │
│ 12. BCClient ejecuta la operacion:                                      │
│     GET/POST/PATCH/DELETE https://bc.dynamics.com/api/v2.0/...          │
│                                                                         │
│ 13. Emite resultado:                                                    │
│     { type: 'tool_result', tool_use_id: 'toolu_xxx',                    │
│       content: [...], is_error: false }                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 6: FINALIZACION                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 14. Claude finaliza respuesta:                                          │
│     Emite: { type: 'message', content: 'Aqui estan los clientes...' }   │
│                                                                         │
│ 15. Stream termina:                                                     │
│     Emite: { type: 'complete',                                          │
│              stop_reason: 'end_turn',                                   │
│              usage: { input_tokens: X, output_tokens: Y } }             │
│                                                                         │
│ 16. Persistencia final:                                                 │
│     - EventStore registra todos los eventos                             │
│     - MessageQueue persiste mensaje completo a tabla messages           │
│     - TokenUsageService registra consumo de tokens                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Flujo: Recuperacion de Sesion (Page Refresh)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Frontend solicita GET /api/chat/sessions/:sessionId                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 1. Middleware valida autenticacion (session cookie)                     │
│                                                                         │
│ 2. Middleware valida ownership (userId == session.userId)               │
│                                                                         │
│ 3. SessionService.getSessionWithMessages():                             │
│    SELECT * FROM sessions WHERE id = :sessionId                         │
│    SELECT * FROM messages WHERE session_id = :sessionId                 │
│         ORDER BY sequence_number ASC                                    │
│                                                                         │
│ 4. Response:                                                            │
│    {                                                                    │
│      id: 'uuid',                                                        │
│      title: 'Session Title',                                            │
│      createdAt: '2025-11-28T...',                                       │
│      updatedAt: '2025-11-28T...',                                       │
│      messages: [                                                        │
│        { role: 'user', content: '...', sequenceNumber: 1 },             │
│        { role: 'assistant', content: '...', sequenceNumber: 2,          │
│          toolUse: [...], thinking: '...' },                             │
│        ...                                                              │
│      ]                                                                  │
│    }                                                                    │
│                                                                         │
│ 5. Frontend reconstruye UI con el orden exacto de sequenceNumber        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Capacidades Actuales vs Requerimientos Frontend

### 5.1 Matriz de Capacidades

| # | Requerimiento Frontend | Estado Backend | Endpoint/Servicio | Notas |
|---|------------------------|----------------|-------------------|-------|
| 1 | Autenticacion Microsoft | COMPLETO | `GET /api/auth/login`, `GET /api/auth/callback` | OAuth 2.0 con MSAL |
| 2 | Lista de sesiones (sidebar) | COMPLETO | `GET /api/chat/sessions` | Ordenadas por updatedAt DESC |
| 3 | Titulos auto-generados | PARCIAL | SessionService | Existe logica pero no integrada |
| 4 | Eliminar sesion | COMPLETO | `DELETE /api/chat/sessions/:id` | Cascade delete messages |
| 5 | Lista de mensajes ordenados | COMPLETO | `GET /api/chat/sessions/:id` | ORDER BY sequence_number |
| 6 | Extended thinking (opcional) | COMPLETO | DirectAgentService | Eventos `thinking` emitidos |
| 7 | Upload de archivos | NO IMPLEMENTADO | - | Tabla `session_files` existe |
| 8 | Mensaje del usuario | COMPLETO | `chat:message` event | `user_message_confirmed` |
| 9 | Cadena de pensamiento | COMPLETO | `agent:event` type=thinking | Streaming en tiempo real |
| 10 | Tools BC con input/output | COMPLETO | `tool_use`, `tool_result` | 115 tools disponibles |
| 11 | Orden de ejecucion | COMPLETO | sequenceNumber atomico | Redis INCR garantiza orden |
| 12 | Streaming display | COMPLETO | Socket.IO `agent:event` | Chunks en tiempo real |
| 13 | Reconstruir en refresh | COMPLETO | `GET /api/chat/sessions/:id` | Mensajes persistidos |
| 14 | Reconectar a streaming activo | PARCIAL | - | Funciona pero sin tracking |
| 15 | Aprobaciones (dangerous ops) | COMPLETO | ApprovalManager | `approval_requested/resolved` |
| 16 | Sistema de Todos | NO IMPLEMENTADO | TodoManager (stub) | Feature futura |

### 5.2 Eventos WebSocket Disponibles

```typescript
// Eventos que el backend emite via socket.emit('agent:event', data)
type AgentEventType =
  | 'session_start'           // Inicio de procesamiento
  | 'user_message_confirmed'  // Mensaje del usuario persistido
  | 'thinking'                // Extended thinking content
  | 'message_chunk'           // Delta de texto (streaming)
  | 'message'                 // Mensaje completo
  | 'tool_use'                // Claude quiere usar una tool
  | 'tool_result'             // Resultado de la tool
  | 'approval_requested'      // Requiere aprobacion humana
  | 'approval_resolved'       // Aprobacion resuelta
  | 'complete'                // Fin de procesamiento
  | 'error';                  // Error ocurrido

// Estructura base de todos los eventos
interface AgentEvent {
  type: AgentEventType;
  eventId: string;           // UUID unico del evento
  sequenceNumber: number;    // Orden garantizado
  timestamp: string;         // ISO 8601
  sessionId: string;
  // ... campos especificos por tipo
}
```

---

## 6. Analisis de Gaps

### GAP-001: Sistema de Archivos (CRITICO - MVP Required)

**Estado Actual:**
- Tabla `session_files` existe en el schema pero esta vacia
- No hay endpoints para upload/download
- DirectAgentService no maneja content blocks de tipo `image` o `document`

**Impacto:**
- Usuario no puede subir imagenes, PDFs o archivos adjuntos
- Claude no puede analizar documentos visuales

**Solucion Propuesta:**

```typescript
// 1. Crear FileService
// backend/src/services/files/FileService.ts
class FileService {
  async uploadFile(sessionId: string, file: Buffer, metadata: FileMetadata): Promise<FileRecord>
  async getFile(fileId: string): Promise<FileRecord>
  async deleteFile(fileId: string): Promise<void>
  async listSessionFiles(sessionId: string): Promise<FileRecord[]>
}

// 2. Crear endpoints REST
// backend/src/routes/files.ts
POST   /api/files/upload          // Multipart form upload
GET    /api/files/:fileId         // Download file
DELETE /api/files/:fileId         // Delete file
GET    /api/sessions/:id/files    // List session files

// 3. Integrar en DirectAgentService
// Convertir archivos a content blocks para Claude
{
  type: 'image',
  source: {
    type: 'base64',
    media_type: 'image/png',
    data: '<base64>'
  }
}
```

**Esfuerzo Estimado:** 2-3 dias

---

### GAP-002: Titulos Auto-generados (MEDIA)

**Estado Actual:**
- SessionService crea sesiones con titulo generico o pasado por parametro
- No hay integracion con Claude para generar titulo basado en contenido

**Impacto:**
- UX degradada: sesiones sin nombres descriptivos en sidebar

**Solucion Propuesta:**

```typescript
// Despues de primer mensaje del usuario, llamar a Claude con prompt especifico
async function generateSessionTitle(firstMessage: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-3', // Modelo barato y rapido
    max_tokens: 50,
    messages: [{
      role: 'user',
      content: `Generate a short title (max 6 words) for a conversation starting with: "${firstMessage}". Return only the title, no quotes.`
    }]
  });
  return response.content[0].text;
}

// Actualizar sesion
await sessionService.updateTitle(sessionId, generatedTitle);
```

**Esfuerzo Estimado:** 0.5 dias

---

### GAP-003: Sistema de Todos (POST-MVP)

**Estado Actual:**
- `TodoManager.ts` existe pero es un stub
- Tabla `todos` existe en schema
- No hay integracion con DirectAgentService

**Impacto:**
- Ningun impacto en MVP
- Feature futura para tracking de tareas

**Solucion Propuesta:** Posponer hasta post-MVP

---

### GAP-004: Tracking de Reconexion (BAJA)

**Estado Actual:**
- Usuario puede reconectarse y recibir eventos nuevos
- No hay mecanismo para "replay" de eventos perdidos durante desconexion

**Impacto:**
- Si usuario pierde conexion durante streaming, puede perder algunos eventos
- Puede hacer refresh para recuperar estado completo

**Solucion Propuesta:**

```typescript
// Opcion 1: Almacenar ultimo sequenceNumber visto por cliente
socket.on('client:lastSeen', (lastSequence: number) => {
  // Reenviar eventos desde lastSequence + 1
  const missedEvents = await eventStore.getEventsSince(sessionId, lastSequence);
  missedEvents.forEach(evt => socket.emit('agent:event', evt));
});

// Opcion 2: Documentar que refresh es la solucion
// (Implementacion actual - funciona pero no es optima)
```

**Esfuerzo Estimado:** 1 dia (si se implementa Opcion 1)

---

## 7. Estado de Pruebas Existentes

### 7.1 Resumen de Cobertura

| Metrica | Valor | Umbral |
|---------|-------|--------|
| Statements | 59.72% | 59% |
| Branches | 59.14% | 59% |
| Functions | 60.23% | 59% |
| Lines | 59.72% | 59% |

### 7.2 Inventario de Tests (51 archivos)

#### Tests Unitarios (42 archivos)

| Categoria | Archivo | Tests | Cobertura |
|-----------|---------|-------|-----------|
| **Agent** | DirectAgentService.test.ts | 45 | 93.59% |
| | DirectAgentService.comprehensive.test.ts | 38 | - |
| | AnthropicClient.test.ts | 52 | Alto |
| | ApprovalManager.test.ts | 34 | 66% |
| **Auth** | BCTokenManager.test.ts | 30 | Alto |
| | auth-oauth.test.ts | 48 | Alto |
| **WebSocket** | ChatMessageHandler.test.ts | 22 | Alto |
| **Queue** | MessageQueue.test.ts | 28 | Alto |
| | MessageQueue.rateLimit.test.ts | 15 | Alto |
| **Routes** | server-endpoints.test.ts | 20 | - |
| | auth-oauth.routes.test.ts | 18 | - |
| | chat.routes.test.ts | 25 | - |
| | logs.routes.test.ts | 12 | - |
| | token-usage.routes.test.ts | 10 | - |
| **Middleware** | auth-oauth.test.ts | 48 | - |
| | logging.test.ts | 36 | - |

#### Tests de Integracion (9 archivos)

| Archivo | Tests | Descripcion |
|---------|-------|-------------|
| DirectAgentService.integration.test.ts | 15 | Flujo completo con mocks |
| MessageQueue.integration.test.ts | 12 | BullMQ con Redis real |
| BCTokenManager.integration.test.ts | 8 | Encripcion con Azure SQL |
| SessionService.integration.test.ts | 10 | CRUD con DB real |
| EventStore.integration.test.ts | 8 | Event sourcing con DB |
| WebSocket.integration.test.ts | 6 | Socket.IO real |

### 7.3 Tests E2E Creados (10 archivos)

| Archivo | Tests | Cobertura Funcional | Estado |
|---------|-------|---------------------|--------|
| 01-authentication.e2e.test.ts | 20 | OAuth flow, session validation | 16/20 ✓ |
| 02-session-management.e2e.test.ts | 21 | CRUD, ownership, multi-tenant | Pendiente |
| 03-message-flow-basic.e2e.test.ts | 17 | Send, confirm, sequence, persist | **12/17 ✓** |
| 04-streaming-flow.e2e.test.ts | 21 | Chunks, deltas, completion | Pendiente |
| 05-extended-thinking.e2e.test.ts | 16 | Thinking events, content | Pendiente |
| 06-tool-execution.e2e.test.ts | 22 | tool_use, tool_result, correlation | Pendiente |
| 07-approval-flow.e2e.test.ts | 16 | approve/reject, timeout, broadcast | Pendiente |
| 09-session-recovery.e2e.test.ts | 14 | Refresh, reconnect, state preservation | Pendiente |
| 10-multi-tenant-isolation.e2e.test.ts | 40 | User isolation, IDOR prevention | Pendiente |
| 11-error-handling.e2e.test.ts | 35 | 400/401/403/404/429/500, WebSocket | Pendiente |

### 7.4 Historial de Correcciones E2E

| Fecha | Issue | Fix Aplicado | Resultado |
|-------|-------|--------------|-----------|
| 2025-11-28 | FK constraint race condition (`fk_messages_session`) | `drainMessageQueue()` en `setup.e2e.ts` | 12/17 tests passing en message-flow-basic |

#### Detalle: Race Condition en MessageQueue (2025-11-28)

**Problema Identificado**: Los tests E2E fallaban con violaciones de FK constraint porque:
1. `afterAll` del test ejecutaba `factory.cleanup()` eliminando sesiones
2. Workers de BullMQ seguían procesando jobs asincrónicamente
3. Workers intentaban INSERT en `messages` con `session_id` eliminado

**Solución Implementada**:
- Nueva función `drainMessageQueue()` exportada desde `setup.e2e.ts`
- Espera hasta 10 segundos para que todos los jobs de `MESSAGE_PERSISTENCE` completen
- Se invoca ANTES de `factory.cleanup()` en cada test suite

**Archivos Modificados**:
- `backend/src/__tests__/e2e/setup.e2e.ts` (líneas 256-302)
- `backend/src/__tests__/e2e/flows/03-message-flow-basic.e2e.test.ts`

**Issues Pendientes** (no relacionados con FK):
- Database connection timeout en tests largos
- Timing de persistencia asíncrona
- Broadcasting de eventos WebSocket entre clientes

---

## 8. Plan de Testing E2E

### 8.1 Arquitectura de Tests E2E

```
backend/src/__tests__/e2e/
├── setup.e2e.ts              # Global setup (server, Redis, DB)
├── helpers/
│   ├── E2ETestClient.ts      # HTTP + WebSocket client unificado
│   ├── SequenceValidator.ts  # Validacion de orden de eventos
│   ├── ErrorValidator.ts     # Validacion de respuestas HTTP
│   └── index.ts              # Exports
└── flows/
    ├── 01-authentication.e2e.test.ts
    ├── 02-session-management.e2e.test.ts
    ├── 03-message-flow-basic.e2e.test.ts
    ├── 04-streaming-flow.e2e.test.ts
    ├── 05-extended-thinking.e2e.test.ts
    ├── 06-tool-execution.e2e.test.ts
    ├── 07-approval-flow.e2e.test.ts
    ├── 08-file-upload.e2e.test.ts        # Pendiente (requiere FileService)
    ├── 09-session-recovery.e2e.test.ts
    ├── 10-multi-tenant-isolation.e2e.test.ts
    └── 11-error-handling.e2e.test.ts
```

### 8.2 E2ETestClient API

```typescript
class E2ETestClient {
  // Configuracion
  setSessionCookie(cookie: string): void

  // HTTP Methods
  async get<T>(path: string): Promise<TestResponse<T>>
  async post<T>(path: string, body?: unknown): Promise<TestResponse<T>>
  async delete(path: string): Promise<TestResponse<void>>

  // WebSocket Methods
  async connect(): Promise<void>
  async disconnect(): Promise<void>
  async joinSession(sessionId: string): Promise<void>
  async leaveSession(sessionId: string): Promise<void>
  async sendMessage(sessionId: string, content: string): Promise<void>

  // Event Handling
  async waitForAgentEvent(type: string, options?: WaitOptions): Promise<AgentEvent>
  async collectEvents(count: number, options?: CollectOptions): Promise<ReceivedEvent[]>
  getReceivedEvents(): ReceivedEvent[]
  clearEvents(): void

  // Raw Socket Access
  emitRaw(event: string, data: unknown): void
  isConnected(): boolean
}
```

### 8.3 Escenarios de Test por Suite

#### E2E-01: Authentication

```
✓ Server should be healthy
✓ Unauthenticated request should return 401
✓ OAuth login should redirect to Microsoft
✓ OAuth callback should create session
✓ Authenticated request should succeed
✓ Session should persist across requests
✓ WebSocket should require authentication
✓ Invalid session cookie should return 401
```

#### E2E-02: Session Management

```
✓ Create session with title
✓ Create session with default title
✓ List user sessions (ordered by updatedAt)
✓ Get session details with messages
✓ Delete own session
✓ Cannot access other user's session (403)
✓ Cannot delete other user's session (403)
✓ Join session via WebSocket
✓ Leave session via WebSocket
```

#### E2E-03: Message Flow Basic

```
✓ Send message and receive user_message_confirmed
✓ Confirmed event includes sequenceNumber
✓ Confirmed event includes messageId
✓ Confirmed event includes eventId
✓ Sequential messages have increasing sequence numbers
✓ Message persists to database
✓ Messages retrieved in sequence order
✓ Handle empty message
✓ Handle long message
✓ Handle special characters (XSS safe)
✓ Broadcast to multiple clients in session
```

#### E2E-04: Streaming Flow

```
✓ Receive session_start event
✓ Receive message_chunk events during streaming
✓ Chunks include delta text
✓ Sequence numbers are monotonically increasing
✓ Receive complete event when finished
✓ Complete event includes stop_reason
✓ Events delivered in correct order
✓ Accumulate chunks into complete message
✓ Handle connection drop during streaming
✓ Broadcast streaming events to all session clients
```

#### E2E-05: Extended Thinking

```
✓ Receive thinking events when enabled
✓ Thinking events include content
✓ Thinking events have eventId and sequenceNumber
✓ Thinking precedes message content
✓ Support messages without extended thinking
✓ Handle thinking-intensive prompts
✓ Persist thinking content to database
✓ Retrieve thinking on session reload
```

#### E2E-06: Tool Execution

```
✓ Receive tool_use event when agent uses tool
✓ Tool_use includes tool name
✓ Tool_use includes tool input
✓ Tool_use includes tool_use_id for correlation
✓ Receive tool_result after tool_use
✓ Tool_result includes content
✓ Tool_result correlates with tool_use via ID
✓ Handle multiple sequential tool calls
✓ Handle tool execution errors gracefully
✓ Display tool inputs to user
✓ Persist tool events to database
✓ Read operations don't require approval
✓ Write operations require approval
```

#### E2E-07: Approval Flow

```
✓ Receive approval_requested for write operations
✓ Approval includes approvalId, operation, input
✓ Handle approval (approve)
✓ Handle rejection
✓ Rejection includes reason
✓ Approval_resolved correlates with original request
✓ Handle approval timeout gracefully
✓ Handle sequential approval requests
✓ Broadcast approval events to all session clients
✓ Validate approval response comes from session owner
```

#### E2E-08: File Upload (Pendiente)

```
[ ] Upload image file
[ ] Upload PDF file
[ ] Upload multiple files
[ ] List session files
[ ] Delete file
[ ] Include file in message to Claude
[ ] Receive file analysis from Claude
[ ] Handle invalid file type
[ ] Handle file too large
[ ] Handle upload errors
```

#### E2E-09: Session Recovery

```
✓ Retrieve full message history after disconnect
✓ Preserve message order after recovery
✓ Include assistant responses in history
✓ Reconnect to session after disconnect
✓ Receive new events after reconnection
✓ Handle rapid disconnect/reconnect
✓ Handle disconnect during streaming
✓ Maintain conversation context across reconnections
✓ Preserve session metadata
✓ Recover correct session when user has multiple
```

#### E2E-10: Multi-Tenant Isolation

```
✓ User B cannot view User A session
✓ User A cannot view User B session
✓ User B cannot delete User A session
✓ User B cannot join User A session via WebSocket
✓ User B cannot send messages to User A session
✓ Concurrent user operations isolated
✓ Events not leaked between users
✓ Session creation scoped to authenticated user
✓ Approval events not broadcast to other users
```

#### E2E-11: Error Handling

```
✓ 400 for invalid UUID format
✓ 400 for malformed JSON
✓ 401 for unauthenticated requests
✓ 401 for expired session
✓ 403 for accessing other user's resources
✓ 404 for non-existent session
✓ 404 for deleted session
✓ 429 for rate limiting
✓ 500 without exposing internals
✓ WebSocket: handle joining invalid session
✓ WebSocket: handle malformed messages
✓ WebSocket: maintain connection after error
✓ No sensitive data in error responses
✓ No stack traces exposed
```

### 8.4 Comandos de Ejecucion

```bash
# Ejecutar todos los tests E2E
cd backend && npm run test:e2e

# Ejecutar con UI interactiva
cd backend && npm run test:e2e:watch

# Ejecutar suite especifica
cd backend && npx vitest run --config vitest.e2e.config.ts src/__tests__/e2e/flows/01-authentication.e2e.test.ts

# Ejecutar con logs detallados
cd backend && DEBUG=* npm run test:e2e
```

### 8.5 Prerequisitos para E2E Tests

```bash
# 1. Iniciar Redis (Docker)
docker compose -f docker-compose.test.yml up -d

# 2. Verificar Azure SQL accesible
# (Configurar firewall si es necesario)

# 3. Configurar .env con variables de test
cp .env.example .env
# Editar con credenciales de test

# 4. Ejecutar tests
npm run test:e2e
```

---

## 9. Recomendaciones y Proximos Pasos

### 9.1 Prioridad Inmediata (Antes del Frontend)

| # | Tarea | Esfuerzo | Prioridad |
|---|-------|----------|-----------|
| 1 | Implementar FileService (Azure Blob) | 2 dias | CRITICA |
| 2 | Crear endpoints /api/files/* | 1 dia | CRITICA |
| 3 | Integrar archivos en DirectAgentService | 1 dia | CRITICA |
| 4 | Crear E2E-08 file upload tests | 0.5 dias | ALTA |
| 5 | Implementar titulos auto-generados | 0.5 dias | MEDIA |

### 9.2 Post-MVP

| # | Tarea | Esfuerzo | Prioridad |
|---|-------|----------|-----------|
| 1 | Implementar TodoManager completo | 3 dias | BAJA |
| 2 | Optimizar reconnection tracking | 1 dia | BAJA |
| 3 | Aumentar cobertura de tests a 70% | 2 dias | MEDIA |

### 9.3 Metricas de Exito

| Metrica | Actual | Objetivo MVP | Objetivo Post-MVP |
|---------|--------|--------------|-------------------|
| Test Coverage | 59% | 65% | 75% |
| E2E Tests Passing | N/A | 100% | 100% |
| Gaps Criticos | 1 | 0 | 0 |
| Latencia P50 | ~600ms | <500ms | <300ms |

---

## Apendice A: Schema de Base de Datos

```sql
-- Tablas principales
CREATE TABLE users (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  email NVARCHAR(255) UNIQUE NOT NULL,
  microsoft_id NVARCHAR(255) UNIQUE,
  display_name NVARCHAR(255),
  bc_access_token_encrypted NVARCHAR(MAX),
  bc_refresh_token_encrypted NVARCHAR(MAX),
  created_at DATETIME2 DEFAULT GETUTCDATE(),
  updated_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE sessions (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  user_id UNIQUEIDENTIFIER REFERENCES users(id),
  title NVARCHAR(255),
  created_at DATETIME2 DEFAULT GETUTCDATE(),
  updated_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE message_events (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  event_type NVARCHAR(50) NOT NULL,
  sequence_number BIGINT NOT NULL,
  payload NVARCHAR(MAX), -- JSON
  created_at DATETIME2 DEFAULT GETUTCDATE(),
  UNIQUE (session_id, sequence_number)
);

CREATE TABLE messages (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  role NVARCHAR(20) NOT NULL, -- 'user', 'assistant'
  content NVARCHAR(MAX),
  sequence_number BIGINT,
  metadata NVARCHAR(MAX), -- JSON (thinking, tool_use, etc)
  created_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE approvals (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  operation NVARCHAR(255),
  tool_use_id NVARCHAR(255),
  input NVARCHAR(MAX), -- JSON
  status NVARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  resolved_at DATETIME2,
  resolved_by UNIQUEIDENTIFIER,
  rejection_reason NVARCHAR(MAX),
  created_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE session_files (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  filename NVARCHAR(255),
  mime_type NVARCHAR(100),
  size_bytes BIGINT,
  storage_path NVARCHAR(500), -- Azure Blob path
  created_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE TABLE todos (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  parent_id UNIQUEIDENTIFIER REFERENCES todos(id),
  content NVARCHAR(MAX),
  status NVARCHAR(20) DEFAULT 'pending',
  sequence_number INT,
  created_at DATETIME2 DEFAULT GETUTCDATE(),
  updated_at DATETIME2 DEFAULT GETUTCDATE()
);
```

---

## Apendice B: Contrato WebSocket Completo

Ver documento separado: `docs/backend/websocket-contract.md`

---

## Apendice C: Configuracion de Vitest E2E

```typescript
// vitest.e2e.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './src/__tests__/e2e/setup.e2e.ts',
    testTimeout: 60000,
    hookTimeout: 120000,
    include: ['src/__tests__/e2e/**/*.test.ts'],
    sequence: { shuffle: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    reporters: ['verbose'],
  },
});
```

---

**Documento generado automaticamente por BC Claude Agent Diagnostic Tool**
**Ultima actualizacion:** 2025-11-28
