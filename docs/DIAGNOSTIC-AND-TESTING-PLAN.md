# BC Claude Agent - Diagnóstico Exhaustivo y Plan de Testing E2E

**Fecha de Diagnóstico**: 2025-11-24
**Versión del Sistema**: Phase 2→3 Transition
**Autor**: Claude (Diagnóstico Automatizado)

---

## TABLA DE CONTENIDOS

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Diagnóstico del Estado Actual](#2-diagnóstico-del-estado-actual)
3. [Análisis de Capacidades: Actual vs Requerido](#3-análisis-de-capacidades-actual-vs-requerido)
4. [Gaps Identificados por Área](#4-gaps-identificados-por-área)
5. [Plan de Testing E2E Detallado](#5-plan-de-testing-e2e-detallado)
6. [Contrato Backend-Frontend](#6-contrato-backend-frontend)
7. [Lista de Tareas por Fases](#7-lista-de-tareas-por-fases)
8. [Criterios de Éxito](#8-criterios-de-éxito)

---

## 1. RESUMEN EJECUTIVO

### Estado General del Sistema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BC CLAUDE AGENT - ESTADO ACTUAL                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ARQUITECTURA BASE                                                          │
│  ├── Backend Express + Socket.IO          ✅ IMPLEMENTADO (100%)            │
│  ├── DirectAgentService (Anthropic SDK)   ✅ IMPLEMENTADO (100%)            │
│  ├── Event Sourcing (EventStore)          ✅ IMPLEMENTADO (100%)            │
│  ├── Message Queue (BullMQ)               ✅ IMPLEMENTADO (100%)            │
│  └── MCP Tools Vendored (52 entities)     ✅ IMPLEMENTADO (100%)            │
│                                                                             │
│  AUTENTICACIÓN                                                              │
│  ├── Microsoft OAuth 2.0                  ✅ IMPLEMENTADO (100%)            │
│  ├── Session Management (Redis)           ✅ IMPLEMENTADO (100%)            │
│  ├── BC Token Encryption (AES-256)        ✅ IMPLEMENTADO (100%)            │
│  └── Multi-tenant Isolation               ✅ IMPLEMENTADO (90%)             │
│                                                                             │
│  STREAMING & WEBSOCKET                                                      │
│  ├── Socket.IO Events                     ✅ IMPLEMENTADO (100%)            │
│  ├── agent:event Unified Contract         ✅ IMPLEMENTADO (100%)            │
│  ├── Extended Thinking Support            ✅ IMPLEMENTADO (100%)            │
│  └── Sequence Numbers (Redis INCR)        ✅ IMPLEMENTADO (100%)            │
│                                                                             │
│  HUMAN-IN-THE-LOOP                                                          │
│  ├── ApprovalManager (Promise-based)      ✅ IMPLEMENTADO (100%)            │
│  ├── Approval Events (WebSocket)          ✅ IMPLEMENTADO (100%) - F4-002   │
│  ├── Approval Persistence (DB)            ✅ IMPLEMENTADO (100%)            │
│  └── Session Ownership Validation         ✅ IMPLEMENTADO (100%) - F4-003   │
│                                                                             │
│  ARCHIVOS E IMÁGENES                                                        │
│  ├── session_files Table (Schema)         ✅ EXISTE (Schema only)           │
│  ├── Azure Blob Storage (Config)          ✅ CONFIGURADO (Sin usar)         │
│  ├── File Upload Service                  ❌ NO IMPLEMENTADO                │
│  ├── Image Processing                     ❌ NO IMPLEMENTADO                │
│  └── Multi-tenant Folder System           ❌ NO IMPLEMENTADO                │
│                                                                             │
│  SISTEMA DE TODOS (PLANIFICACIÓN)                                           │
│  ├── TodoManager Service                  ✅ IMPLEMENTADO (100%)            │
│  ├── Tabla 'todos' en BD                  ✅ EXISTE (Schema completo)       │
│  ├── Endpoint GET /api/todos              ✅ IMPLEMENTADO (solo lectura)    │
│  ├── Integración en Agent Loop            ❌ NO CONECTADO (código muerto)   │
│  ├── Tool TodoWrite para Claude           ❌ NO EXISTE                      │
│  ├── WebSocket events (todo:*)            ❌ NO IMPLEMENTADO                │
│  └── Frontend UI de progreso              ❌ NO IMPLEMENTADO                │
│                                                                             │
│  TESTING                                                                    │
│  ├── Unit Tests (Vitest)                  ✅ 27 archivos (~14% coverage)    │
│  ├── Integration Tests                    ✅ 7 archivos                      │
│  ├── E2E Tests (Playwright)               ⚠️  SKELETON (1 ejemplo)          │
│  └── Coverage Target                      ❌ 14% actual vs 70% objetivo     │
│                                                                             │
│  INFRAESTRUCTURA AZURE                                                      │
│  ├── Key Vault + Secrets                  ✅ IMPLEMENTADO (100%)            │
│  ├── Azure SQL Database                   ✅ IMPLEMENTADO (100%)            │
│  ├── Azure Redis Cache                    ✅ IMPLEMENTADO (100%)            │
│  ├── Container Apps (Backend/Frontend)    ✅ IMPLEMENTADO (100%)            │
│  └── Azure Blob Storage                   ⚠️  Configurado pero sin servicio │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Porcentaje de Completitud por Módulo

| Módulo | Completitud | Prioridad para Testing |
|--------|-------------|------------------------|
| Autenticación OAuth | 95% | ALTA |
| Agent Execution | 100% | CRÍTICA |
| WebSocket Streaming | 100% | CRÍTICA |
| Sessions & Messages | 95% | ALTA |
| Human-in-the-Loop | 100% | MEDIA |
| **Sistema de ToDos** | **15%** | **CRÍTICA (Feature UX)** |
| File Management | 10% | BAJA (futuro) |
| Testing Infrastructure | 40% | CRÍTICA |

> **NOTA IMPORTANTE**: El Sistema de ToDos tiene el servicio implementado (100%) pero NO está conectado al Agent Loop.
> El 15% refleja: servicio (100%) + BD (100%) + endpoint lectura (100%) pero integración (0%) + tool (0%) + websocket (0%) + frontend (0%).

---

## 2. DIAGNÓSTICO DEL ESTADO ACTUAL

### 2.1 Arquitectura del Backend

#### Servicios Implementados (14 servicios)

```
backend/src/services/
├── agent/
│   ├── DirectAgentService.ts      ← Core: Orquesta Claude API + streaming
│   ├── AnthropicClient.ts         ← Wrapper del SDK de Anthropic
│   ├── FakeAnthropicClient.ts     ← Mock para testing
│   ├── tool-definitions.ts        ← 7 herramientas MCP de metadata
│   └── tool-schemas.ts            ← Schemas Zod para validación
├── approval/
│   └── ApprovalManager.ts         ← Human-in-the-loop con Promise pattern
├── auth/
│   ├── MicrosoftOAuthService.ts   ← OAuth 2.0 + MSAL
│   └── BCTokenManager.ts          ← Encriptación AES-256-GCM
├── bc/
│   ├── BCClient.ts                ← Cliente OData para BC API
│   └── BCValidator.ts             ← Validación de entidades
├── cache/
│   └── ToolUseTracker.ts          ← Cache de herramientas usadas
├── events/
│   └── EventStore.ts              ← Event sourcing + Redis INCR
├── mcp/
│   ├── MCPService.ts              ← Carga de tools vendored
│   └── testMCPConnection.ts       ← Health check utilities
├── messages/
│   └── MessageService.ts          ← CRUD de mensajes + Event Store
├── queue/
│   └── MessageQueue.ts            ← BullMQ con 3 colas
├── sessions/
│   └── SessionTitleGenerator.ts   ← Genera títulos con Claude
├── todo/
│   └── TodoManager.ts             ← Gestión de tareas jerárquicas
├── token-usage/
│   └── TokenUsageService.ts       ← Tracking para billing
└── websocket/
    └── ChatMessageHandler.ts      ← Maneja eventos Socket.IO
```

#### Flujo de Datos Principal

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         FLUJO DE UN MENSAJE                              │
└──────────────────────────────────────────────────────────────────────────┘

[Cliente]                                                        [Backend]
    │                                                                │
    │──── socket.emit('chat:message', {                              │
    │       message, sessionId, userId, thinking?                    │
    │     }) ─────────────────────────────────────────────────────►  │
    │                                                                │
    │                              ┌─────────────────────────────────┤
    │                              │ ChatMessageHandler.handle()     │
    │                              │   1. Validar sesión/userId      │
    │                              │   2. saveUserMessage()          │
    │                              │      → EventStore.appendEvent() │
    │                              │      → MessageQueue.add()       │
    │                              └─────────────────────────────────┤
    │                                                                │
    │  ◄──── emit('agent:event', {                                   │
    │          type: 'user_message_confirmed',                       │
    │          sequenceNumber, eventId                               │
    │        }) ─────────────────────────────────────────────────────┤
    │                                                                │
    │                              ┌─────────────────────────────────┤
    │                              │ DirectAgentService              │
    │                              │   .executeQueryStreaming()      │
    │                              │                                 │
    │                              │   Loop de streaming:            │
    │                              └─────────────────────────────────┤
    │                                                                │
    │  ◄──── emit('agent:event', { type: 'thinking', ... })          │
    │  ◄──── emit('agent:event', { type: 'message_chunk', ... })     │
    │  ◄──── emit('agent:event', { type: 'tool_use', ... })          │
    │  ◄──── emit('agent:event', { type: 'tool_result', ... })       │
    │  ...                                                           │
    │                                                                │
    │                              ┌─────────────────────────────────┤
    │                              │ Si stop_reason === 'tool_use':  │
    │                              │   - Ejecutar herramientas       │
    │                              │   - Continuar loop              │
    │                              │ Si stop_reason === 'end_turn':  │
    │                              │   - Finalizar                   │
    │                              └─────────────────────────────────┤
    │                                                                │
    │  ◄──── emit('agent:event', {                                   │
    │          type: 'message',                                      │
    │          messageId, content, stopReason,                       │
    │          tokenUsage: { inputTokens, outputTokens },            │
    │          model                                                 │
    │        }) ─────────────────────────────────────────────────────┤
    │                                                                │
    │  ◄──── emit('agent:event', { type: 'complete', reason })       │
    │                                                                │
```

### 2.2 Base de Datos

#### Tablas Implementadas (13 tablas)

| Tabla | Estado | Propósito |
|-------|--------|-----------|
| `users` | ✅ Activa | Usuarios + OAuth + BC tokens encriptados |
| `sessions` | ✅ Activa | Sesiones de chat |
| `message_events` | ✅ Activa | Event sourcing (append-only) |
| `messages` | ✅ Activa | Mensajes materializados |
| `approvals` | ✅ Activa | Human-in-the-loop requests |
| `checkpoints` | ✅ Activa | Snapshots de sesión |
| `todos` | ✅ Activa | Tareas jerárquicas |
| `agent_executions` | ✅ Activa | Métricas de ejecución |
| `tool_permissions` | ✅ Activa | Permisos por usuario |
| `permission_presets` | ✅ Activa | Plantillas de permisos |
| `audit_log` | ✅ Activa | Auditoría del sistema |
| `performance_metrics` | ✅ Activa | Métricas de rendimiento |
| `session_files` | ⚠️ Schema only | Archivos (no implementado) |
| `token_usage` | ✅ Activa | Tracking de tokens |

#### Migraciones Aplicadas

1. `001-add-token-tracking.sql` - Columnas model, input_tokens, output_tokens
2. `002-use-anthropic-message-ids.sql` - messages.id → NVARCHAR(255)
3. `003-create-token-usage-table.sql` - Tabla + vistas de billing

### 2.3 Sistema de Testing Actual

#### Configuración de Tests

```typescript
// vitest.config.ts
{
  coverage: {
    thresholds: {
      global: { lines: 10 }  // Temporalmente bajo (objetivo: 70%)
    }
  }
}

// vitest.integration.config.ts
{
  include: ['**/*.integration.test.ts'],
  testTimeout: 30000,  // 30s para operaciones de BD
  pool: 'forks',
  poolOptions: { forks: { singleFork: true } }  // Tests seriales
}
```

#### Cobertura por Servicio

| Servicio | Archivos Test | Cobertura Est. |
|----------|---------------|----------------|
| DirectAgentService | 1 integration | ~60% |
| ApprovalManager | 1 unit | ~66% |
| EventStore | 1 unit | ~80% |
| MessageService | 1 unit | ~70% |
| BCTokenManager | 1 unit | ~80% |
| BCClient | 1 unit | ~75% |
| MCPService | 1 unit | ~70% |
| ChatMessageHandler | 1 unit | ~80% |
| TokenUsageService | 1 unit | ~70% |
| MicrosoftOAuthService | 1 unit | ~60% |
| SessionTitleGenerator | 1 unit | ~50% |
| TodoManager | 0 | 0% |
| AnthropicClient | 0 | 0% |
| Routes (5 files) | 1 integration | ~30% |

#### Fixtures Disponibles

```typescript
// AnthropicResponseFactory - Crea respuestas mock de Claude
AnthropicResponseFactory.Presets.simpleText()
AnthropicResponseFactory.Presets.toolUseResponse()
AnthropicResponseFactory.Presets.maxTokens()

// ApprovalFixture - Crea requests de aprobación
ApprovalFixture.Presets.customerCreate()
ApprovalFixture.Presets.salesOrderCreate()
ApprovalFixture.Presets.deleteOperation()

// BCEntityFixture - Crea entidades de Business Central
BCEntityFixture.Presets.customer()
BCEntityFixture.Presets.salesOrder()
```

---

## 3. ANÁLISIS DE CAPACIDADES: ACTUAL VS REQUERIDO

### 3.1 Autenticación y Login

| Capacidad Requerida | Estado | Notas |
|---------------------|--------|-------|
| Login con Microsoft | ✅ Funciona | OAuth 2.0 completo |
| Sesión persistente (24h) | ✅ Funciona | Redis store + cookie |
| Logout | ✅ Funciona | Limpia sesión |
| Ver perfil de usuario | ✅ Funciona | GET /api/auth/me |
| Ver estado de BC token | ✅ Funciona | GET /api/auth/bc-status |
| Otorgar consentimiento BC | ✅ Funciona | POST /api/auth/bc-consent |
| Auto-refresh de tokens | ✅ Funciona | En middleware |
| **Cambiar ambiente BC** | ❌ No existe | Falta implementar |
| **Cambiar compañía BC** | ❌ No existe | Falta implementar |
| **Preferencias de usuario** | ❌ No existe | Falta tabla/endpoints |

### 3.2 Chat y Sesiones

| Capacidad Requerida | Estado | Notas |
|---------------------|--------|-------|
| Crear nueva sesión | ✅ Funciona | POST /api/chat/sessions |
| Listar sesiones del usuario | ✅ Funciona | GET /api/chat/sessions |
| Obtener historial de mensajes | ✅ Funciona | GET .../messages |
| Enviar mensaje via WebSocket | ✅ Funciona | chat:message event |
| Streaming de respuestas | ✅ Funciona | message_chunk events |
| Ver pensamiento (thinking) | ✅ Funciona | thinking events |
| Ver uso de herramientas | ✅ Funciona | tool_use/tool_result |
| **Generar título automático** | ✅ Funciona | SessionTitleGenerator |
| **Actualizar título** | ✅ Funciona | PATCH /sessions/:id |
| Eliminar sesión | ✅ Funciona | DELETE (cascade) |
| **Reconstruir UI al refrescar** | ⚠️ Parcial | Ver Gap #1 |
| Orden garantizado de mensajes | ✅ Funciona | sequence_number |

### 3.3 Extended Thinking

| Capacidad Requerida | Estado | Notas |
|---------------------|--------|-------|
| Habilitar/deshabilitar thinking | ✅ Funciona | Per-request config |
| Configurar budget de tokens | ✅ Funciona | 1024-100000 tokens |
| Streaming de thinking | ✅ Funciona | thinking_chunk events |
| Persistir thinking | ✅ Funciona | message_type='thinking' |
| **UI para toggle thinking** | ⏳ Frontend | Depende de frontend |

### 3.4 Human-in-the-Loop (Approvals)

| Capacidad Requerida | Estado | Notas |
|---------------------|--------|-------|
| Detectar operaciones write | ✅ Funciona | isWriteOperation() |
| Crear solicitud de aprobación | ✅ Funciona | ApprovalManager.request() |
| Emitir evento al frontend | ✅ Funciona | approval:requested |
| Esperar respuesta (Promise) | ✅ Funciona | pendingApprovals Map |
| Timeout automático (5 min) | ✅ Funciona | setTimeout + expireApproval |
| Persistir decisión | ✅ Funciona | UPDATE approvals |
| **Validar ownership de sesión** | ❌ Falta | Gap de seguridad |
| **Integrar en agent:event** | ⚠️ Parcial | Eventos separados |
| **Persistir en message_events** | ❌ Falta | No hay event sourcing |

### 3.5 Archivos e Imágenes

| Capacidad Requerida | Estado | Notas |
|---------------------|--------|-------|
| Subir archivo al chat | ❌ No existe | Falta servicio completo |
| Arrastrar imagen al input | ❌ No existe | Falta procesamiento |
| Persistir imagen en storage | ❌ No existe | Blob Storage sin usar |
| Ver imagen en historial | ❌ No existe | Falta implementación |
| **Sistema de carpetas** | ❌ No existe | Estructura multi-tenant |
| **Sidebar de archivos** | ❌ No existe | Falta diseño completo |
| **Conexiones externas** | ❌ No existe | SharePoint, OneDrive |

### 3.6 Configuración de Usuario

| Capacidad Requerida | Estado | Notas |
|---------------------|--------|-------|
| Preferencia tema (oscuro/claro) | ❌ No existe | Falta tabla/columna |
| Ver consumo de tokens | ⚠️ Parcial | Datos existen, falta UI |
| Gestión de suscripción | ❌ No existe | Stripe para futuro |
| Memories (futuro) | ❌ No existe | Para futuro |

---

## 4. GAPS IDENTIFICADOS POR ÁREA

### GAP #1: Reconstrucción de UI al Refrescar (CRÍTICO)

**Problema**: Cuando el usuario refresca la página, debe poder ver exactamente la misma UI que tenía, incluyendo:
- Mensajes del usuario
- Respuestas del asistente
- Bloques de thinking (colapsables)
- Tool uses con inputs/outputs
- Estado de aprobaciones pendientes

**Estado Actual**:
- ✅ Mensajes se recuperan ordenados por sequence_number
- ✅ Metadata de thinking está en JSON
- ✅ Tool use/result tiene tool_use_id para correlación
- ⚠️ Falta: Documentación clara de cómo el frontend debe parsear metadata
- ⚠️ Falta: Formato estandarizado para tool inputs/outputs

**Diagnóstico SQL**:
```sql
-- Query para recuperar historial completo con todos los tipos
SELECT
  id, role, message_type, content, metadata,
  stop_reason, sequence_number, tool_use_id,
  model, input_tokens, output_tokens
FROM messages
WHERE session_id = @sessionId
ORDER BY
  CASE WHEN sequence_number IS NULL THEN 999999999 ELSE sequence_number END ASC,
  created_at ASC
```

**Success Criteria**:
- [ ] Frontend puede renderizar todos los tipos de mensaje
- [ ] Thinking blocks se muestran colapsados con opción de expandir
- [ ] Tool uses muestran nombre, args, resultado
- [ ] Test E2E: Enviar mensaje → Refresh → Ver mismo UI

---

### GAP #2: Validación de Ownership en Approvals (SEGURIDAD) - ✅ RESUELTO

> **Estado**: ✅ **RESUELTO** (2025-11-25)
>
> **Implementación**: Se agregó el método `validateApprovalOwnership()` en `ApprovalManager.ts` que valida ownership antes de permitir respuestas a approvals. El endpoint `POST /api/approvals/:id/respond` ahora retorna HTTP 403 si el usuario no es dueño de la sesión.

**Problema Original**: Un usuario podría aprobar solicitudes de otro usuario porque no se validaba que el userId sea dueño del sessionId.

**Ubicación del Fix**:
- `backend/src/services/approval/ApprovalManager.ts:310-408` (nuevo método `validateApprovalOwnership`)
- `backend/src/server.ts:579-604` (validación en endpoint)
- `backend/src/types/approval.types.ts:93-111` (nuevos tipos)

**Código Implementado**:
```typescript
// ApprovalManager.validateApprovalOwnership()
const ownershipResult = await approvalManager.validateApprovalOwnership(approvalId, userId);

if (!ownershipResult.isOwner) {
  // Log unauthorized access attempt for security audit
  console.warn(`Unauthorized approval access: User ${userId} attempted to respond...`);

  if (ownershipResult.error === 'APPROVAL_NOT_FOUND') {
    res.status(404).json({ error: 'Not Found', message: 'Approval request not found' });
    return;
  }

  res.status(403).json({ error: 'Forbidden', message: 'You do not have permission...' });
  return;
}
```

**Success Criteria**: ✅ TODOS CUMPLIDOS
- [x] Test: Usuario A no puede aprobar solicitudes de Usuario B (5 tests unitarios)
- [x] HTTP 403 si intenta aprobar sesión ajena
- [x] Audit log registra intentos fallidos (console.warn con detalles)

---

### GAP #2.1: Audit Multi-Tenant (F4-003) - ✅ RESUELTO

> **Estado**: ✅ **RESUELTO** (2025-11-25)
>
> **QA Report**: Ver `docs/qa-reports/QA-REPORT-F4-003.md`
>
> **Implementación**: Se creó un módulo de utilidades `session-ownership.ts` con validación centralizada de ownership multi-tenant. Se corrigieron **9 vulnerabilidades** (1 crítica, 6 altas) en endpoints REST y WebSocket.

**Vulnerabilidades Corregidas**:

| Componente | Vulnerabilidad | Severidad | Corrección |
|------------|----------------|-----------|------------|
| Token Usage Routes | Sin autenticación | ALTA | `authenticateMicrosoft` + validación ownership |
| ChatMessageHandler | userId del payload | ALTA | Usa `authSocket.userId` (verificado) |
| Approvals Endpoint | Sin validación ownership | ALTA | Validación antes de retornar datos |
| Todos Endpoint | Sin validación ownership | ALTA | Validación antes de retornar datos |
| WebSocket approval:response | userId del payload + sin atomicidad | **CRÍTICA** | `authSocket.userId` + `respondToApprovalAtomic()` |
| WebSocket session:join | Sin validación ownership | ALTA | `validateSessionOwnership()` antes de join |
| /api/bc/customers | Sin autenticación | ALTA | `authenticateMicrosoft` |

**Archivos Nuevos**:
- `backend/src/utils/session-ownership.ts` - Módulo de validación centralizada
- `backend/src/__tests__/unit/session-ownership.test.ts` - 24 tests unitarios
- `backend/src/__tests__/unit/security/websocket-multi-tenant.test.ts` - 27 tests de seguridad WebSocket

**Archivos Modificados**:
- `backend/src/routes/token-usage.ts` - Auth + ownership en todos los endpoints
- `backend/src/services/websocket/ChatMessageHandler.ts` - Validación real de ownership
- `backend/src/server.ts` - Validación ownership en approvals/todos, correcciones WebSocket, auth en BC endpoint

**Success Criteria**: ✅ TODOS CUMPLIDOS
- [x] Usuario A no puede acceder a sesiones de Usuario B
- [x] Usuario A no puede acceder a token usage de Usuario B
- [x] Usuario A no puede ver approvals de sesiones de Usuario B
- [x] Usuario A no puede ver todos de sesiones de Usuario B
- [x] Impersonación via WebSocket `chat:message` bloqueada
- [x] Impersonación via WebSocket `approval:response` bloqueada
- [x] Acceso no autorizado via WebSocket `session:join` bloqueado
- [x] Endpoint `/api/bc/customers` requiere autenticación
- [x] 512 tests unitarios pasan (incluidos 24 ownership + 27 WebSocket security)

---

### GAP #3: Eventos de Approval No Unificados (F4-002) - ✅ COMPLETED

> **Estado**: ✅ **COMPLETED** (2025-11-25) - QA Master Review Fixes Applied
>
> **QA Report**: Ver `docs/qa-reports/QA-REPORT-F4-002.md`

**Problema Original**: Los eventos `approval:requested` y `approval:resolved` se emitían como eventos separados, no como parte del flujo unificado `agent:event`.

**Solución Implementada**:
- ApprovalManager ahora integra EventStore
- Eventos persisten en `message_events` con `sequenceNumber`
- Emite via `agent:event` (no `approval:*`)
- Tipos legacy marcados como @deprecated

**QA Master Review Fixes Aplicados** (2025-11-25):
- FIX-001: EventStore failure en request() → degraded mode con fallback
- FIX-002: Promise SIEMPRE se resuelve en respondToApproval() (try/finally)
- FIX-003: EventStore failure post-commit → handled gracefully
- FIX-004: Expiración emite evento al frontend con `expireApprovalWithEvent()`
- 7 nuevos tests para edge cases de EventStore y expiración

**Archivos Modificados**:
- `backend/src/services/approval/ApprovalManager.ts` - Integra EventStore, resilience fixes
- `backend/src/types/websocket.types.ts` - Marca eventos legacy como deprecated
- `backend/src/types/approval.types.ts` - Marca tipos legacy como deprecated
- `backend/src/server.ts` - Elimina emisión redundante
- `backend/src/__tests__/unit/ApprovalManager.test.ts` - 34 tests incluyendo edge cases
- `backend/src/__tests__/unit/security/websocket-multi-tenant.test.ts` - Assertions actualizadas

**Success Criteria**: ✅ TODOS CUMPLIDOS
- [x] Approval events tienen sequenceNumber (cuando disponible)
- [x] Approval events se persisten en message_events
- [x] Frontend recibe via agent:event únicamente
- [x] EventStore failures manejados con degraded mode
- [x] Promises siempre se resuelven (no bloquean agente)
- [x] Expiración emite evento al frontend
- [x] 519 tests pasan (7 nuevos tests de resiliencia)
- [x] Build compila sin errores
- [x] Lint: 0 errores (15 warnings preexistentes)

---

### GAP #4: Sistema de Archivos No Implementado

**Problema**: La tabla `session_files` existe pero no hay servicio, endpoints, ni integración con Azure Blob Storage.

**Lo que falta implementar**:

1. **Backend Service** (`FileStorageService.ts`):
   - Upload a Azure Blob Storage
   - Download con SAS tokens
   - Validación de MIME types
   - Deduplicación por SHA-256

2. **Endpoints REST**:
   - `POST /api/sessions/:id/files` - Upload
   - `GET /api/sessions/:id/files` - List
   - `GET /api/sessions/:id/files/:fileId` - Download
   - `DELETE /api/sessions/:id/files/:fileId` - Delete

3. **Integración con Agent**:
   - Procesar imágenes como `ImageBlockParam` en Claude API
   - Convertir a base64 para enviar a Anthropic
   - Guardar referencia en metadata del mensaje

4. **Multi-tenant Folder Structure**:
   ```
   Azure Blob Container: agent-files/
   └── users/
       └── {userId}/
           └── sessions/
               └── {sessionId}/
                   ├── {fileId}_documento.pdf
                   └── {fileId}_imagen.png
   ```

**Dependencies a Agregar**:
```json
{
  "@azure/storage-blob": "^12.x.x",
  "multer": "^1.4.5-lts.1",
  "sharp": "^0.33.x"
}
```

**Success Criteria**:
- [ ] Usuario puede subir archivo desde UI
- [ ] Archivo se guarda en Azure Blob Storage
- [ ] Metadata se guarda en session_files
- [ ] Archivo aparece en historial al refrescar
- [ ] Test E2E: Upload → Refresh → Ver archivo

---

### GAP #5: Configuración de Ambiente/Compañía BC

**Problema**: El usuario no puede seleccionar qué ambiente (sandbox/production) ni qué compañía de Business Central usar.

**Análisis**:
- Los tokens de BC se guardan por usuario (`bc_access_token_encrypted`)
- NO hay campo para especificar `environment` o `company`
- Las herramientas MCP asumen un ambiente hardcodeado

**Cambios Necesarios**:

1. **Nueva tabla o columnas en users**:
   ```sql
   ALTER TABLE users ADD
     bc_environment NVARCHAR(100) NULL,    -- 'sandbox' o 'production'
     bc_company_id UNIQUEIDENTIFIER NULL;  -- ID de la compañía
   ```

2. **Nuevo endpoint**:
   ```typescript
   GET /api/bc/environments   // Lista ambientes disponibles
   GET /api/bc/companies      // Lista compañías del ambiente
   PATCH /api/users/me/bc-config  // Actualizar ambiente/compañía
   ```

3. **Modificar BCClient**:
   - Usar ambiente/compañía del usuario en las llamadas OData

**Success Criteria**:
- [ ] Usuario puede ver lista de ambientes
- [ ] Usuario puede seleccionar compañía
- [ ] Herramientas BC usan ambiente/compañía correcta
- [ ] Persistencia de preferencia

---

### GAP #6: Preferencias de Usuario

**Problema**: No existe sistema de preferencias de usuario (tema, configuración de chat, etc.)

**Cambios Necesarios**:

1. **Nueva tabla**:
   ```sql
   CREATE TABLE user_preferences (
     user_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES users(id),
     theme NVARCHAR(20) DEFAULT 'light',  -- 'light', 'dark', 'system'
     thinking_default_enabled BIT DEFAULT 0,
     thinking_default_budget INT DEFAULT 10000,
     show_token_usage BIT DEFAULT 1,
     language NVARCHAR(10) DEFAULT 'en',
     created_at DATETIME2 DEFAULT GETDATE(),
     updated_at DATETIME2 DEFAULT GETDATE()
   );
   ```

2. **Endpoints**:
   ```typescript
   GET /api/users/me/preferences
   PATCH /api/users/me/preferences
   ```

**Success Criteria**:
- [ ] Preferencias se persisten en BD
- [ ] Frontend puede leer/escribir preferencias
- [ ] Tema se aplica al cargar la app

---

### GAP #7: Cobertura de Tests Insuficiente

**Problema**: Cobertura actual ~14%, objetivo 70%

**Servicios Sin Tests**:
- `TodoManager` (0%) - **⚠️ CÓDIGO MUERTO - Ver GAP #8**
- `AnthropicClient` (0%)
- `tool-definitions.ts` (0%)
- `BCValidator` (0%)
- `ToolUseTracker` (0%)
- Middleware (0%)
- La mayoría de routes (parcial)

**E2E Tests Inexistentes**:
- Solo existe `example.spec.ts` (navega a playwright.dev)
- No hay tests de flujos reales

**Success Criteria**:
- [ ] 70% cobertura de líneas
- [ ] Tests E2E para flujos críticos
- [ ] Tests de integración para todas las rutas

---

### GAP #8: Sistema de ToDos NO Integrado en Agent Loop (CRÍTICO - CÓDIGO MUERTO)

> **Estado**: ❌ **NO IMPLEMENTADO** - Código existe pero no está conectado
>
> **Fecha de Diagnóstico**: 2025-11-25
>
> **Severidad**: ALTA - Feature crítico para UX no funcional

#### Descripción del Problema

El sistema de ToDos (planificación de tareas del agente) está **completamente implementado como servicio** pero **nunca se ejecuta** durante el flujo normal del agente. Es código muerto que no aporta funcionalidad al usuario.

**Lo que el usuario espera**:
1. Enviar un mensaje al agente
2. El agente analiza el problema y crea un plan de tareas
3. El frontend muestra una lista de ToDos con progreso
4. Cada tarea se marca como "en progreso" → "completada"
5. El usuario ve el porcentaje de completitud en tiempo real
6. La respuesta final asegura que todos los ToDos fueron completados

**Lo que realmente sucede**:
1. Usuario envía mensaje
2. Agente responde directamente sin planificación
3. No hay ToDos visibles
4. No hay tracking de progreso
5. El usuario no sabe qué está haciendo el agente

#### Análisis Técnico Detallado

##### 1. DirectAgentService - TodoManager Ignorado

**Archivo**: `backend/src/services/agent/DirectAgentService.ts`

```typescript
// Líneas 146-164: El constructor acepta todoManager pero lo IGNORA
constructor(
  approvalManager?: ApprovalManager,
  _todoManager?: TodoManager,  // ← UNDERSCORE = PARÁMETRO NO USADO
  client?: IAnthropicClient
) {
  this.client = client || new AnthropicClient({...});
  this.approvalManager = approvalManager;

  // ❌ FALTA: this.todoManager = _todoManager;
  // El parámetro se recibe pero NUNCA se almacena
}
```

**Resultado**: TodoManager es pasado desde `server.ts` pero DirectAgentService lo descarta.

##### 2. MCP_TOOLS - No hay TodoWrite Tool

**Archivo**: `backend/src/services/agent/tool-definitions.ts`

```typescript
// Las 7 herramientas actuales (líneas 18-177):
export const MCP_TOOLS = [
  { name: 'list_all_entities', ... },
  { name: 'search_entity_operations', ... },
  { name: 'get_entity_details', ... },
  { name: 'get_entity_relationships', ... },
  { name: 'validate_workflow_structure', ... },
  { name: 'build_knowledge_base_workflow', ... },
  { name: 'get_endpoint_documentation', ... },
];

// ❌ NO EXISTE: { name: 'TodoWrite', ... }
```

**Resultado**: Claude no puede crear/actualizar ToDos porque la herramienta no existe.

##### 3. ChatMessageHandler - Solo Logging

**Archivo**: `backend/src/services/websocket/ChatMessageHandler.ts`

```typescript
// Líneas 522-528: Solo detecta y loguea, NO sincroniza
if (event.toolName === TOOL_NAMES.TODO_WRITE && event.args?.todos) {
  this.logger.debug('TodoWrite tool detected', {
    sessionId,
    userId,
    todoCount: Array.isArray(event.args.todos) ? event.args.todos.length : 0,
  });
  // ❌ FALTA: await this.todoManager.syncTodosFromSDK(sessionId, event.args.todos);
}
```

**Resultado**: Incluso si Claude usara TodoWrite, los ToDos no se guardarían.

##### 4. TodoManager - Implementación Completa pero Sin Usar

**Archivo**: `backend/src/services/todo/TodoManager.ts`

El servicio está **100% implementado** y funcional:

| Método | Implementado | Llamado desde Agent Loop |
|--------|--------------|--------------------------|
| `syncTodosFromSDK()` | ✅ Sí | ❌ Nunca |
| `createManualTodo()` | ✅ Sí | ❌ Nunca |
| `markInProgress()` | ✅ Sí | ❌ Nunca |
| `markCompleted()` | ✅ Sí | ❌ Nunca |
| `getTodosBySession()` | ✅ Sí | ✅ Solo lectura (endpoint) |

##### 5. Endpoint REST - Solo Lectura

**Archivo**: `backend/src/server.ts` (líneas 456-480)

```typescript
// El único endpoint de ToDos es GET (lectura)
app.get('/api/todos/session/:sessionId', authenticateMicrosoft, async (req, res) => {
  const todos = await todoManager.getTodosBySession(sessionId);
  res.json({ todos });
});

// ❌ NO EXISTEN:
// - POST /api/todos (crear)
// - PATCH /api/todos/:id (actualizar estado)
// - WebSocket events para actualizar progreso en tiempo real
```

#### Diagrama: Flujo Actual vs Flujo Esperado

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                           FLUJO ACTUAL (INCOMPLETO)                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  [Usuario]                                            [Backend]              ║
║      │                                                    │                  ║
║      │─── "Crea un cliente y una orden de venta" ───────► │                  ║
║      │                                                    │                  ║
║      │                                    DirectAgentService                 ║
║      │                                    executeQueryStreaming()            ║
║      │                                           │                           ║
║      │                                           ▼                           ║
║      │                               ┌─────────────────────┐                 ║
║      │                               │ Claude responde     │                 ║
║      │                               │ directamente SIN    │                 ║
║      │                               │ planificación       │                 ║
║      │                               └─────────────────────┘                 ║
║      │                                           │                           ║
║      │◄─── Respuesta completa sin progreso ──────┘                           ║
║      │                                                                       ║
║      │     ❌ Usuario NO VE:                                                 ║
║      │        - Lista de tareas                                              ║
║      │        - Progreso de cada tarea                                       ║
║      │        - Porcentaje de completitud                                    ║
║      │                                                                       ║
╚══════════════════════════════════════════════════════════════════════════════╝


╔══════════════════════════════════════════════════════════════════════════════╗
║                           FLUJO ESPERADO (A IMPLEMENTAR)                      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  [Usuario]                        [Frontend]                 [Backend]       ║
║      │                                │                          │           ║
║      │─── "Crea un cliente y        ──┼─────────────────────────►│           ║
║      │     una orden de venta"        │                          │           ║
║      │                                │                          │           ║
║      │                                │           DirectAgentService         ║
║      │                                │                  │                   ║
║      │                                │                  ▼                   ║
║      │                                │        ┌─────────────────┐           ║
║      │                                │        │ FASE 1: PLANIF. │           ║
║      │                                │        │ Claude analiza  │           ║
║      │                                │        │ y crea plan     │           ║
║      │                                │        └────────┬────────┘           ║
║      │                                │                 │                    ║
║      │                                │◄── todo:created ┘                    ║
║      │                                │    [                                 ║
║      │  ┌─────────────────────┐       │      { "Crear cliente", pending },   ║
║      │  │ Panel de Progreso   │◄──────│      { "Crear orden", pending }      ║
║      │  │                     │       │    ]                                 ║
║      │  │ ☐ Crear cliente     │       │                                      ║
║      │  │ ☐ Crear orden venta │       │                                      ║
║      │  │ ─────────────────── │       │                                      ║
║      │  │ Progreso: 0%        │       │                                      ║
║      │  └─────────────────────┘       │                                      ║
║      │                                │                  │                   ║
║      │                                │                  ▼                   ║
║      │                                │        ┌─────────────────┐           ║
║      │                                │        │ FASE 2: EJECUC. │           ║
║      │                                │        │ Ejecutar tarea 1│           ║
║      │                                │        └────────┬────────┘           ║
║      │                                │                 │                    ║
║      │                                │◄── todo:updated ┘                    ║
║      │  ┌─────────────────────┐       │    { todoId, status: 'in_progress' } ║
║      │  │ Panel de Progreso   │◄──────│                                      ║
║      │  │                     │       │                                      ║
║      │  │ 🔄 Crear cliente    │       │                                      ║
║      │  │ ☐ Crear orden venta │       │                                      ║
║      │  │ ─────────────────── │       │                                      ║
║      │  │ Progreso: 0%        │       │                                      ║
║      │  └─────────────────────┘       │                                      ║
║      │                                │                  │                   ║
║      │                                │                  ▼                   ║
║      │                                │        ┌─────────────────┐           ║
║      │                                │        │ Tarea 1 completa│           ║
║      │                                │        └────────┬────────┘           ║
║      │                                │                 │                    ║
║      │                                │◄── todo:completed                    ║
║      │  ┌─────────────────────┐       │    { todoId, status: 'completed' }   ║
║      │  │ Panel de Progreso   │◄──────│                                      ║
║      │  │                     │       │                                      ║
║      │  │ ✅ Crear cliente    │       │                                      ║
║      │  │ 🔄 Crear orden venta│       │                                      ║
║      │  │ ─────────────────── │       │                                      ║
║      │  │ Progreso: 50%       │       │                                      ║
║      │  └─────────────────────┘       │                                      ║
║      │                                │                  │                   ║
║      │            ... continúa hasta completar todas las tareas ...          ║
║      │                                │                  │                   ║
║      │  ┌─────────────────────┐       │                  │                   ║
║      │  │ Panel de Progreso   │◄──────│◄── todo:completed (última)           ║
║      │  │                     │       │                                      ║
║      │  │ ✅ Crear cliente    │       │                                      ║
║      │  │ ✅ Crear orden venta│       │                                      ║
║      │  │ ─────────────────── │       │                                      ║
║      │  │ Progreso: 100% ✓    │       │                                      ║
║      │  └─────────────────────┘       │                                      ║
║      │                                │                  │                   ║
║      │◄─── Respuesta final con resumen de lo completado ─┘                   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

#### Plan de Implementación Detallado

##### FASE 1: Backend - Integración del Agent Loop (Prioridad: CRÍTICA)

| Paso | Archivo | Cambios Requeridos |
|------|---------|-------------------|
| 1.1 | `DirectAgentService.ts` | Almacenar `todoManager` como propiedad de clase |
| 1.2 | `DirectAgentService.ts` | Agregar fase de planificación antes de ejecución |
| 1.3 | `DirectAgentService.ts` | Llamar `markInProgress()` al iniciar cada tarea |
| 1.4 | `DirectAgentService.ts` | Llamar `markCompleted()` al terminar cada tarea |
| 1.5 | `tool-definitions.ts` | Agregar herramienta `TodoWrite` con schema |
| 1.6 | `ChatMessageHandler.ts` | Sincronizar ToDos cuando Claude usa TodoWrite |

**Código de ejemplo para DirectAgentService:**

```typescript
// 1.1 - Almacenar todoManager
private todoManager: TodoManager | undefined;

constructor(
  approvalManager?: ApprovalManager,
  todoManager?: TodoManager,  // Sin underscore
  client?: IAnthropicClient
) {
  this.todoManager = todoManager;  // ← NUEVO
  // ...
}

// 1.2 - Fase de planificación
async executeQueryStreaming(options: ExecuteOptions): Promise<AgentResult> {
  const { sessionId, userId, message } = options;

  // FASE 1: Planificación (nuevo)
  if (this.todoManager && this.shouldPlan(message)) {
    const plan = await this.createPlan(sessionId, message);
    await this.todoManager.syncTodosFromSDK(sessionId, plan.todos);
    // Emitir evento de plan creado
  }

  // FASE 2: Ejecución (existente + tracking)
  // ...
}

// 1.3 y 1.4 - Tracking de progreso
private async executeWithTracking(
  sessionId: string,
  todoId: string,
  task: () => Promise<unknown>
): Promise<unknown> {
  await this.todoManager?.markInProgress(sessionId, todoId);
  try {
    const result = await task();
    await this.todoManager?.markCompleted(sessionId, todoId, true);
    return result;
  } catch (error) {
    await this.todoManager?.markCompleted(sessionId, todoId, false);
    throw error;
  }
}
```

##### FASE 2: Backend - Nuevos Endpoints y WebSocket Events

| Endpoint/Event | Tipo | Descripción |
|----------------|------|-------------|
| `POST /api/sessions/:id/todos` | REST | Crear ToDo manual |
| `PATCH /api/todos/:id` | REST | Actualizar estado de ToDo |
| `todo:created` | WebSocket | Notificar nuevos ToDos |
| `todo:updated` | WebSocket | Notificar cambio de estado |
| `todo:completed` | WebSocket | Notificar tarea completada |
| `todo:progress` | WebSocket | Notificar porcentaje global |

**Contratos WebSocket:**

```typescript
// Evento: todo:created
interface TodoCreatedEvent {
  type: 'todo:created';
  sessionId: string;
  todos: Array<{
    id: string;
    content: string;       // "Crear cliente"
    activeForm: string;    // "Creando cliente"
    status: 'pending';
    order: number;
  }>;
  totalCount: number;
}

// Evento: todo:updated
interface TodoUpdatedEvent {
  type: 'todo:updated';
  sessionId: string;
  todoId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: {
    completed: number;     // 1
    total: number;         // 3
    percentage: number;    // 33.33
  };
}

// Evento: todo:progress (resumen)
interface TodoProgressEvent {
  type: 'todo:progress';
  sessionId: string;
  progress: {
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    total: number;
    percentage: number;
  };
}
```

##### FASE 3: Frontend - Componentes de UI

| Componente | Ubicación | Funcionalidad |
|------------|-----------|---------------|
| `<TodoPanel>` | Sidebar o panel flotante | Lista de tareas con estados |
| `<TodoItem>` | Dentro de TodoPanel | Tarea individual con icono de estado |
| `<ProgressBar>` | Header o footer del chat | Barra de progreso global |
| `<TodoSkeleton>` | Loading state | Placeholder mientras se crea plan |

**Mockup de UI:**

```
┌─────────────────────────────────────────────────────────────┐
│  BC Claude Agent                              [User] [⚙️]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐  ┌───────────────────────────────┐ │
│  │ Sessions            │  │ Chat                          │ │
│  │ ─────────────────── │  │                               │ │
│  │ > Sales Report      │  │ [User]: Crea un cliente y     │ │
│  │   Customer Query    │  │         una orden de venta    │ │
│  │   Inventory Check   │  │                               │ │
│  │                     │  │ [Agent]: Entendido, voy a     │ │
│  │                     │  │ ejecutar las siguientes       │ │
│  │                     │  │ tareas:                       │ │
│  │                     │  │                               │ │
│  ├─────────────────────┤  │ ┌───────────────────────────┐ │ │
│  │ 📋 Tareas Actuales  │  │ │ 📋 Plan de Ejecución      │ │ │
│  │ ─────────────────── │  │ │                           │ │ │
│  │ ✅ Crear cliente    │  │ │ ✅ Crear cliente          │ │ │
│  │    "Acme Corp"      │  │ │    Cliente ID: C-00123    │ │ │
│  │                     │  │ │                           │ │ │
│  │ 🔄 Crear orden      │  │ │ 🔄 Crear orden de venta   │ │ │
│  │    (en progreso...) │  │ │    Procesando...          │ │ │
│  │                     │  │ │                           │ │ │
│  │ ─────────────────── │  │ │ ────────────────────────  │ │ │
│  │ Progreso: 50%       │  │ │ Progreso: ████████░░ 50%  │ │ │
│  │ ████████░░░░░░░░░░░ │  │ └───────────────────────────┘ │ │
│  │                     │  │                               │ │
│  └─────────────────────┘  │ [Escribir mensaje...]    [📎] │ │
│                           └───────────────────────────────┘ │
│                                                             │
│  ────────────────── Progreso Global: 50% ─────────────────  │
└─────────────────────────────────────────────────────────────┘
```

##### FASE 4: Testing

| Test | Tipo | Descripción |
|------|------|-------------|
| `TodoManager.integration.test.ts` | Integration | Flujo completo con DB real |
| `todo-progress.e2e.spec.ts` | E2E | Usuario ve progreso en UI |
| `todo-websocket.test.ts` | Unit | Eventos WebSocket correctos |

#### Dependencias y Cambios de BD

**No se requieren cambios de BD** - la tabla `todos` ya existe con el schema correcto:

```sql
-- Tabla existente (ya implementada)
CREATE TABLE todos (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  content NVARCHAR(MAX),
  activeForm NVARCHAR(MAX),
  status NVARCHAR(20),  -- 'pending' | 'in_progress' | 'completed' | 'failed'
  [order] INT,
  created_at DATETIME2,
  started_at DATETIME2 NULL,
  completed_at DATETIME2 NULL
);
```

#### Estimación de Esfuerzo

| Fase | Complejidad | Archivos a Modificar |
|------|-------------|----------------------|
| FASE 1: Backend Integration | ALTA | 4 archivos |
| FASE 2: Endpoints + WebSocket | MEDIA | 2 archivos |
| FASE 3: Frontend UI | ALTA | 4+ componentes nuevos |
| FASE 4: Testing | MEDIA | 3 archivos de test |

**Total estimado**: Feature completo de mediana-alta complejidad.

#### Success Criteria

- [ ] Usuario envía mensaje y ve plan de tareas
- [ ] Cada tarea se marca como "en progreso" cuando inicia
- [ ] Cada tarea se marca como "completada" o "fallida"
- [ ] Frontend muestra progreso en tiempo real (WebSocket)
- [ ] Porcentaje de completitud se actualiza automáticamente
- [ ] Al refrescar página, se recupera estado de ToDos
- [ ] Tests de integración y E2E pasan
- [ ] Documentación de contrato frontend actualizada

#### Prioridad y Recomendación

**Prioridad**: ALTA - Esta es una funcionalidad core de UX que diferencia un "chatbot simple" de un "agente inteligente".

**Recomendación**: Implementar ANTES de tests de TodoManager. Los tests actuales serían para código muerto. Primero integrar, luego testear.

---

## 5. PLAN DE TESTING E2E DETALLADO

### 5.1 Tipos de Tests y Cuándo Usarlos

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PIRÁMIDE DE TESTING                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                         ┌───────────┐                                   │
│                         │   E2E     │  ← Flujos completos usuario       │
│                         │  Tests    │    (Playwright + Backend real)    │
│                         └─────┬─────┘                                   │
│                    ┌──────────┴──────────┐                              │
│                    │   Integration       │  ← Servicios + DB/Redis      │
│                    │      Tests          │    (Vitest + servicios reales)│
│                    └──────────┬──────────┘                              │
│         ┌────────────────────┴────────────────────┐                     │
│         │              Unit Tests                  │  ← Lógica aislada  │
│         │         (Vitest + Mocks)                 │    (MSW, mocks)    │
│         └──────────────────────────────────────────┘                    │
│                                                                         │
│  REGLA: 70% Unit | 20% Integration | 10% E2E                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Tests E2E Críticos a Implementar

#### E2E-001: Flujo de Login Completo

**Archivo**: `e2e/auth/login.spec.ts`

```typescript
test.describe('Authentication Flow', () => {
  test('should redirect to Microsoft login', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="login-button"]');
    await expect(page).toHaveURL(/login.microsoftonline.com/);
  });

  test('should handle OAuth callback and create session', async ({ page }) => {
    // Mock OAuth callback con código válido
    await page.goto('/api/auth/callback?code=mock-code&state=mock-state');
    await expect(page).toHaveURL('/chat');

    // Verificar sesión creada
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'connect.sid');
    expect(sessionCookie).toBeDefined();
  });

  test('should show user info after login', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/settings');
    await expect(page.locator('[data-testid="user-email"]')).toBeVisible();
  });
});
```

**Success Criteria**:
- [ ] Redirect a Microsoft funciona
- [ ] Callback crea sesión en Redis
- [ ] Usuario puede ver su perfil

---

#### E2E-002: Crear Sesión y Enviar Mensaje

**Archivo**: `e2e/chat/new-session.spec.ts`

```typescript
test.describe('New Chat Session', () => {
  test('should create session and send first message', async ({ page }) => {
    await loginAsTestUser(page);

    // Ir a nueva sesión
    await page.goto('/chat/new');

    // Verificar input disponible
    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible();

    // Enviar mensaje
    await input.fill('Show me all customers from Spain');
    await page.click('[data-testid="send-button"]');

    // Verificar mensaje del usuario aparece
    await expect(page.locator('[data-testid="user-message"]')).toContainText('customers from Spain');

    // Esperar respuesta (con timeout generoso para Claude)
    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({ timeout: 60000 });

    // Verificar título generado
    await expect(page.locator('[data-testid="session-title"]')).not.toContainText('New Chat');
  });

  test('should show thinking process', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/chat/new');

    // Habilitar thinking
    await page.click('[data-testid="toggle-thinking"]');

    // Enviar mensaje
    await sendMessage(page, 'Analyze the sales trends');

    // Verificar thinking block aparece
    await expect(page.locator('[data-testid="thinking-block"]')).toBeVisible({ timeout: 30000 });

    // Verificar se puede expandir/colapsar
    await page.click('[data-testid="thinking-toggle"]');
    await expect(page.locator('[data-testid="thinking-content"]')).toBeVisible();
  });

  test('should show tool usage', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/chat/new');

    // Mensaje que triggerea herramienta
    await sendMessage(page, 'List all BC entities available');

    // Verificar tool_use aparece
    await expect(page.locator('[data-testid="tool-use"]')).toBeVisible({ timeout: 60000 });

    // Verificar tiene nombre de herramienta
    await expect(page.locator('[data-testid="tool-name"]')).toContainText('list_all_entities');

    // Verificar resultado aparece
    await expect(page.locator('[data-testid="tool-result"]')).toBeVisible();
  });
});
```

**Success Criteria**:
- [ ] Sesión se crea en BD
- [ ] Mensaje se envía via WebSocket
- [ ] Respuesta aparece en streaming
- [ ] Thinking se muestra si está habilitado
- [ ] Tools se muestran con inputs/outputs
- [ ] Título se genera automáticamente

---

#### E2E-003: Reconstruir UI al Refrescar

**Archivo**: `e2e/chat/persistence.spec.ts`

```typescript
test.describe('Session Persistence', () => {
  test('should restore full UI after page refresh', async ({ page }) => {
    await loginAsTestUser(page);

    // Crear sesión con conversación
    const sessionId = await createSessionWithMessages(page, [
      'Hello, what can you do?',
      'Show me available entities',
    ]);

    // Esperar respuestas
    await waitForResponses(page, 2);

    // Capturar estado antes de refresh
    const messagesBefore = await page.locator('[data-testid="message"]').count();
    const thinkingBefore = await page.locator('[data-testid="thinking-block"]').count();
    const toolsBefore = await page.locator('[data-testid="tool-use"]').count();

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verificar mismo número de elementos
    await expect(page.locator('[data-testid="message"]')).toHaveCount(messagesBefore);
    await expect(page.locator('[data-testid="thinking-block"]')).toHaveCount(thinkingBefore);
    await expect(page.locator('[data-testid="tool-use"]')).toHaveCount(toolsBefore);

    // Verificar orden correcto
    const messages = await page.locator('[data-testid="message"]').allTextContents();
    expect(messages[0]).toContain('Hello');  // Primer mensaje
  });

  test('should restore tool inputs and outputs', async ({ page }) => {
    await loginAsTestUser(page);

    // Crear sesión con tool use
    await page.goto('/chat/new');
    await sendMessage(page, 'Get details about customer entity');
    await waitForToolResult(page);

    // Expandir tool details
    await page.click('[data-testid="tool-toggle"]');
    const inputBefore = await page.locator('[data-testid="tool-input"]').textContent();

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Expandir de nuevo y verificar
    await page.click('[data-testid="tool-toggle"]');
    const inputAfter = await page.locator('[data-testid="tool-input"]').textContent();
    expect(inputAfter).toBe(inputBefore);
  });
});
```

**Success Criteria**:
- [ ] Misma cantidad de mensajes después de refresh
- [ ] Mismo contenido de mensajes
- [ ] Thinking blocks visibles
- [ ] Tool inputs/outputs recuperables
- [ ] Orden correcto (sequence_number)

---

#### E2E-004: Human-in-the-Loop Approval

**Archivo**: `e2e/chat/approvals.spec.ts`

```typescript
test.describe('Approval Flow', () => {
  test('should request approval for write operations', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/chat/new');

    // Solicitar operación de escritura
    await sendMessage(page, 'Create a new customer named "Test Corp" with email test@example.com');

    // Esperar modal de aprobación
    await expect(page.locator('[data-testid="approval-modal"]')).toBeVisible({ timeout: 60000 });

    // Verificar contiene detalles
    await expect(page.locator('[data-testid="approval-title"]')).toContainText('Create');
    await expect(page.locator('[data-testid="approval-changes"]')).toContainText('Test Corp');
  });

  test('should proceed after approval', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/chat/new');

    await sendMessage(page, 'Create a customer named "Approved Corp"');
    await page.waitForSelector('[data-testid="approval-modal"]');

    // Aprobar
    await page.click('[data-testid="approve-button"]');

    // Verificar modal cierra
    await expect(page.locator('[data-testid="approval-modal"]')).not.toBeVisible();

    // Verificar tool result de éxito
    await expect(page.locator('[data-testid="tool-result"]')).toContainText('success', { timeout: 30000 });
  });

  test('should cancel on rejection', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/chat/new');

    await sendMessage(page, 'Delete customer with ID 123');
    await page.waitForSelector('[data-testid="approval-modal"]');

    // Rechazar
    await page.click('[data-testid="reject-button"]');

    // Verificar tool result de error
    await expect(page.locator('[data-testid="tool-result"]')).toContainText('cancelled', { timeout: 10000 });
  });

  test('should timeout approval after 5 minutes', async ({ page }) => {
    // Este test usaría un timeout mock más corto
    test.slow();  // Marcar como test lento

    await loginAsTestUser(page);
    await page.goto('/chat/new');

    await sendMessage(page, 'Update item prices');
    await page.waitForSelector('[data-testid="approval-modal"]');

    // Esperar timeout (mockeado a 10 segundos para test)
    await page.waitForTimeout(11000);

    // Verificar modal cierra con mensaje de timeout
    await expect(page.locator('[data-testid="approval-modal"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="tool-result"]')).toContainText('expired');
  });
});
```

**Success Criteria**:
- [ ] Modal de aprobación aparece para operaciones write
- [ ] Muestra detalles de la operación
- [ ] Aprobar continúa la operación
- [ ] Rechazar cancela la operación
- [ ] Timeout funciona correctamente

---

#### E2E-005: WebSocket Reconnection

**Archivo**: `e2e/chat/websocket.spec.ts`

```typescript
test.describe('WebSocket Resilience', () => {
  test('should reconnect after disconnect', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/chat/new');

    // Enviar mensaje para verificar conexión
    await sendMessage(page, 'Hello');
    await waitForResponse(page);

    // Simular desconexión
    await page.evaluate(() => {
      (window as any).socket.disconnect();
    });

    // Verificar indicador de desconexión
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Disconnected');

    // Esperar reconexión automática
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected', { timeout: 10000 });

    // Verificar puede enviar mensajes de nuevo
    await sendMessage(page, 'Are you still there?');
    await expect(page.locator('[data-testid="assistant-message"]').last()).toBeVisible({ timeout: 30000 });
  });

  test('should recover session after reconnect', async ({ page }) => {
    await loginAsTestUser(page);
    const sessionId = await createSession(page);

    // Enviar mensajes
    await sendMessage(page, 'Message 1');
    await waitForResponse(page);

    // Desconectar
    await page.evaluate(() => (window as any).socket.disconnect());

    // Reconectar
    await page.evaluate(() => (window as any).socket.connect());
    await page.waitForTimeout(2000);

    // Verificar puede ver mensajes anteriores
    await expect(page.locator('[data-testid="user-message"]')).toContainText('Message 1');
  });
});
```

**Success Criteria**:
- [ ] Reconexión automática funciona
- [ ] Indicador visual de estado de conexión
- [ ] Mensajes previos se mantienen
- [ ] Puede enviar nuevos mensajes después de reconexión

---

### 5.3 Tests de Integración Críticos

#### INT-001: EventStore + MessageService

```typescript
describe('Event Sourcing Integration', () => {
  it('should maintain message order across async operations', async () => {
    const sessionId = generateTestSessionId();
    const messageService = getMessageService();

    // Simular múltiples mensajes concurrentes
    const promises = [
      messageService.saveUserMessage(sessionId, userId, 'Message 1'),
      messageService.saveUserMessage(sessionId, userId, 'Message 2'),
      messageService.saveUserMessage(sessionId, userId, 'Message 3'),
    ];

    await Promise.all(promises);

    // Recuperar y verificar orden
    const messages = await messageService.getMessages(sessionId);
    expect(messages[0].content).toBe('Message 1');
    expect(messages[1].content).toBe('Message 2');
    expect(messages[2].content).toBe('Message 3');

    // Verificar sequence_numbers son consecutivos
    expect(messages[0].sequence_number).toBe(0);
    expect(messages[1].sequence_number).toBe(1);
    expect(messages[2].sequence_number).toBe(2);
  });
});
```

#### INT-002: ApprovalManager + DirectAgentService

```typescript
describe('Approval Integration', () => {
  it('should pause agent execution until approval', async () => {
    const approvalManager = getApprovalManager(mockIO);
    const agentService = new DirectAgentService(approvalManager);

    const startTime = Date.now();

    // Ejecutar en paralelo: agente + aprobación después de 1s
    const [result] = await Promise.all([
      agentService.executeQueryStreaming({
        sessionId,
        userId,
        message: 'Create customer Test',
        conversationHistory: [],
      }),
      (async () => {
        await sleep(1000);
        // Simular aprobación del usuario
        const pendingApprovals = await approvalManager.getPendingApprovals(sessionId);
        if (pendingApprovals.length > 0) {
          await approvalManager.respondToApproval(pendingApprovals[0].id, 'approved', userId);
        }
      })(),
    ]);

    const duration = Date.now() - startTime;
    expect(duration).toBeGreaterThan(1000);  // Verificar que esperó
  });
});
```

---

## 6. CONTRATO BACKEND-FRONTEND

### 6.1 Eventos WebSocket

#### Evento: `agent:event` (Unificado)

```typescript
interface AgentEvent {
  // Campos base (todos los eventos)
  type: AgentEventType;
  sessionId: string;
  timestamp: string;          // ISO 8601
  eventId: string;            // UUID
  sequenceNumber: number;     // Orden garantizado
  persistenceState: 'queued' | 'persisted' | 'failed' | 'transient';

  // Campos opcionales para correlación
  correlationId?: string;     // Link eventos relacionados
  parentEventId?: string;     // Jerarquía
}

type AgentEventType =
  | 'session_start'
  | 'thinking'
  | 'thinking_chunk'
  | 'message_partial'
  | 'message_chunk'
  | 'message'
  | 'tool_use'
  | 'tool_result'
  | 'approval_requested'
  | 'approval_resolved'
  | 'user_message_confirmed'
  | 'complete'
  | 'error'
  | 'turn_paused'
  | 'content_refused';
```

#### Cómo Manejar Cada Tipo

**`user_message_confirmed`**: Mensaje del usuario guardado
```typescript
// Frontend debe actualizar el mensaje local con datos del servidor
interface UserMessageConfirmedEvent extends AgentEvent {
  type: 'user_message_confirmed';
  messageId: string;         // ID del mensaje en BD
  content: string;
  sequenceNumber: number;    // Usar para ordenar
}

// Lógica frontend:
socket.on('agent:event', (event) => {
  if (event.type === 'user_message_confirmed') {
    updateMessage(event.messageId, {
      id: event.messageId,
      sequenceNumber: event.sequenceNumber,
      status: 'confirmed'
    });
  }
});
```

**`thinking_chunk`**: Streaming del pensamiento
```typescript
interface ThinkingChunkEvent extends AgentEvent {
  type: 'thinking_chunk';
  content: string;           // Fragmento de texto
  blockIndex?: number;       // Si hay múltiples bloques
}

// Lógica frontend:
let thinkingContent = '';
socket.on('agent:event', (event) => {
  if (event.type === 'thinking_chunk') {
    thinkingContent += event.content;
    updateThinkingUI(thinkingContent);
  }
});
```

**`message_chunk`**: Streaming de la respuesta
```typescript
interface MessageChunkEvent extends AgentEvent {
  type: 'message_chunk';
  content: string;           // Fragmento de texto
  persistenceState: 'transient';  // Nunca se persiste
}

// Lógica frontend:
let responseContent = '';
socket.on('agent:event', (event) => {
  if (event.type === 'message_chunk') {
    responseContent += event.content;
    updateResponseUI(responseContent);
  }
});
```

**`message`**: Mensaje completo (final)
```typescript
interface MessageEvent extends AgentEvent {
  type: 'message';
  messageId: string;         // msg_01ABC... (ID de Anthropic)
  content: string;           // Contenido completo
  role: 'assistant';
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'pause_turn' | 'refusal';
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
  };
  model: string;             // e.g., "claude-sonnet-4-5-20250929"
}

// Lógica frontend:
socket.on('agent:event', (event) => {
  if (event.type === 'message') {
    // Reemplazar contenido streaming con contenido final
    finalizeMessage(event.messageId, {
      content: event.content,
      tokenUsage: event.tokenUsage,
      model: event.model
    });
  }
});
```

**`tool_use`**: Claude quiere usar herramienta
```typescript
interface ToolUseEvent extends AgentEvent {
  type: 'tool_use';
  toolName: string;
  toolUseId: string;         // toolu_01ABC... (para correlación)
  args: Record<string, unknown>;
}

// Lógica frontend:
socket.on('agent:event', (event) => {
  if (event.type === 'tool_use') {
    addToolUseBlock({
      id: event.toolUseId,
      name: event.toolName,
      args: event.args,
      status: 'running'
    });
  }
});
```

**`tool_result`**: Resultado de herramienta
```typescript
interface ToolResultEvent extends AgentEvent {
  type: 'tool_result';
  toolName: string;
  toolUseId: string;         // Mismo ID que tool_use
  result: unknown;           // Puede ser string o JSON
  success: boolean;
  error?: string;
  durationMs?: number;
}

// Lógica frontend:
socket.on('agent:event', (event) => {
  if (event.type === 'tool_result') {
    updateToolUseBlock(event.toolUseId, {
      result: event.result,
      success: event.success,
      error: event.error,
      status: event.success ? 'success' : 'error'
    });
  }
});
```

**`approval_requested`**: Requiere aprobación del usuario
```typescript
interface ApprovalRequestedEvent extends AgentEvent {
  type: 'approval_requested';
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  changeSummary: {
    title: string;
    description: string;
    changes: Record<string, unknown>;
    impact: 'high' | 'medium' | 'low';
  };
  priority: 'high' | 'medium' | 'low';
  expiresAt: string;         // ISO 8601
}

// Lógica frontend:
socket.on('agent:event', (event) => {
  if (event.type === 'approval_requested') {
    showApprovalModal({
      id: event.approvalId,
      title: event.changeSummary.title,
      description: event.changeSummary.description,
      changes: event.changeSummary.changes,
      expiresAt: new Date(event.expiresAt),
      onApprove: () => respondToApproval(event.approvalId, 'approved'),
      onReject: () => respondToApproval(event.approvalId, 'rejected')
    });
  }
});

// Enviar respuesta
function respondToApproval(approvalId: string, decision: 'approved' | 'rejected') {
  socket.emit('approval:response', {
    approvalId,
    decision,
    userId: currentUser.id
  });
}
```

**`complete`**: Agente terminó
```typescript
interface CompleteEvent extends AgentEvent {
  type: 'complete';
  reason: 'success' | 'error' | 'max_turns' | 'user_cancelled';
}

// Lógica frontend:
socket.on('agent:event', (event) => {
  if (event.type === 'complete') {
    setProcessingState(false);
    enableInput();
    if (event.reason === 'error') {
      showErrorToast('Something went wrong');
    }
  }
});
```

### 6.2 Recuperación de Historial (REST)

#### GET /api/chat/sessions/:sessionId/messages

**Request**:
```http
GET /api/chat/sessions/550e8400-e29b-41d4-a716-446655440000/messages?limit=50&offset=0
Authorization: Cookie (connect.sid)
```

**Response**:
```typescript
interface MessagesResponse {
  messages: Array<{
    // Identificadores
    id: string;              // msg_01ABC... o UUID
    session_id: string;

    // Contenido
    role: 'user' | 'assistant';
    message_type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
    content: string;

    // Orden (CRÍTICO para renderizado)
    sequence_number: number | null;

    // Metadata parseada según tipo
    metadata?: {
      // Para thinking:
      duration_ms?: number;

      // Para tool_use:
      tool_name?: string;
      tool_args?: Record<string, unknown>;

      // Para tool_result:
      tool_result?: unknown;
      status?: 'pending' | 'success' | 'error';
      error_message?: string;

      // Para standard messages:
      is_thinking?: boolean;
      citations?: TextCitation[];
      citations_count?: number;
    };

    // Tracking de tokens
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;

    // Correlación
    tool_use_id: string | null;  // Para vincular tool_use con tool_result
    stop_reason: StopReason | null;

    // Timestamps
    created_at: string;        // ISO 8601
  }>;
}
```

#### Lógica de Renderizado Frontend

```typescript
function renderMessages(messages: Message[]) {
  // 1. Ordenar por sequence_number (ya viene ordenado del backend, pero verificar)
  const sorted = [...messages].sort((a, b) => {
    if (a.sequence_number === null) return 1;
    if (b.sequence_number === null) return -1;
    return a.sequence_number - b.sequence_number;
  });

  // 2. Agrupar por tipo para renderizado especial
  const rendered = sorted.map((msg) => {
    switch (msg.message_type) {
      case 'thinking':
        return <ThinkingBlock key={msg.id} content={msg.content} duration={msg.metadata?.duration_ms} />;

      case 'tool_use':
        return <ToolUseBlock
          key={msg.id}
          name={msg.metadata?.tool_name}
          args={msg.metadata?.tool_args}
          toolUseId={msg.tool_use_id}
        />;

      case 'tool_result':
        // Buscar el tool_use correspondiente para mostrar juntos
        const toolUse = sorted.find(m => m.tool_use_id === msg.tool_use_id && m.message_type === 'tool_use');
        return <ToolResultBlock
          key={msg.id}
          toolName={toolUse?.metadata?.tool_name}
          result={msg.metadata?.tool_result}
          success={msg.metadata?.status === 'success'}
        />;

      case 'text':
      default:
        return <MessageBubble
          key={msg.id}
          role={msg.role}
          content={msg.content}
          tokens={msg.input_tokens + msg.output_tokens}
          model={msg.model}
        />;
    }
  });

  return rendered;
}
```

### 6.3 Manejo de Race Conditions

**Problema**: Durante streaming, pueden llegar eventos fuera de orden.

**Solución**: Usar `sequenceNumber` para reordenar.

```typescript
class MessageBuffer {
  private buffer: Map<number, AgentEvent> = new Map();
  private lastProcessed: number = -1;

  add(event: AgentEvent) {
    if (event.sequenceNumber !== undefined) {
      this.buffer.set(event.sequenceNumber, event);
      this.flush();
    } else {
      // Eventos sin sequence (transient) se procesan inmediatamente
      this.process(event);
    }
  }

  private flush() {
    // Procesar en orden
    let next = this.lastProcessed + 1;
    while (this.buffer.has(next)) {
      this.process(this.buffer.get(next)!);
      this.buffer.delete(next);
      this.lastProcessed = next;
      next++;
    }
  }

  private process(event: AgentEvent) {
    // Emitir a los componentes React/Vue/etc
    eventEmitter.emit('processedEvent', event);
  }
}
```

---

## 7. LISTA DE TAREAS POR FASES

### FASE 1: Fundamentos de Testing (Prioridad: CRÍTICA)

| ID | Tarea | Descripción | Estado | Success Criteria |
|----|-------|-------------|--------|------------------|
| F1-001 | Configurar Playwright correctamente | Setup con auth persistente | PENDIENTE | Tests pueden login una vez y reutilizar sesión |
| F1-002 | Crear helpers de test E2E | `loginAsTestUser()`, `sendMessage()`, etc. | PENDIENTE | Helpers disponibles y documentados |
| F1-003 | Crear fixtures de BD para tests | Usuario de prueba, sesión de prueba | **EN TESTING** | Tests usan datos consistentes |
| F1-004 | Configurar CI para E2E | GitHub Actions con Playwright | PENDIENTE | E2E corre en cada PR |
| F1-005 | Documentar proceso de testing | README en `/e2e/` | **EN TESTING** | Desarrolladores saben cómo ejecutar tests |

### FASE 2: Tests E2E Core (Prioridad: ALTA)

| ID | Tarea | Descripción | Success Criteria |
|----|-------|-------------|------------------|
| F2-001 | Test: Login Flow | E2E-001 completo | OAuth funciona en test |
| F2-002 | Test: Nueva sesión | E2E-002 completo | Sesión se crea y persiste |
| F2-003 | Test: Streaming | Verificar message_chunk | Streaming funciona |
| F2-004 | Test: Thinking | Toggle y visualización | Thinking se muestra |
| F2-005 | Test: Tool Use | Inputs/outputs visibles | Tools funcionan |
| F2-006 | Test: Persistence | E2E-003 completo | UI se reconstruye al refresh |

### FASE 3: Tests E2E Avanzados (Prioridad: MEDIA)

| ID | Tarea | Descripción | Success Criteria |
|----|-------|-------------|------------------|
| F3-001 | Test: Approvals | E2E-004 completo | Approval flow funciona |
| F3-002 | Test: WebSocket Reconnect | E2E-005 completo | Reconexión funciona |
| F3-003 | Test: Multiple Sessions | Cambiar entre sesiones | Sin pérdida de datos |
| F3-004 | Test: Error Handling | Errores de red, API | UI muestra errores apropiadamente |
| F3-005 | Test: Token Tracking | Visualizar tokens usados | Datos correctos |

### FASE 4: Fixes de Seguridad (Prioridad: ALTA)

| ID | Tarea | Descripción | Estado | Success Criteria |
|----|-------|-------------|--------|------------------|
| F4-001 | Fix: Ownership validation | GAP #2 | ✅ **COMPLETADO** (2025-11-25) | Tests de seguridad pasan |
| F4-002 | Fix: Approval events unificados | GAP #3 | ✅ **COMPLETED** (2025-11-25) | Eventos con sequenceNumber + resilience fixes |
| F4-003 | Audit: Multi-tenant | Verificar aislamiento | ✅ **COMPLETADO** (2025-11-25) | Un usuario no ve datos de otro |

### FASE 5: Funcionalidades Nuevas (Prioridad: VARIABLE)

| ID | Tarea | Descripción | Prioridad | Success Criteria |
|----|-------|-------------|-----------|------------------|
| **F5-005** | **Integrar Sistema de ToDos en Agent Loop** | **GAP #8** | **CRÍTICA** | **Progreso visible en UI** |
| F5-001 | Implementar FileStorageService | GAP #4 | BAJA | Upload/download funciona |
| F5-002 | Implementar selector de ambiente BC | GAP #5 | BAJA | Usuario puede cambiar ambiente |
| F5-003 | Implementar preferencias de usuario | GAP #6 | BAJA | Preferencias se persisten |
| F5-004 | Implementar sistema de carpetas | Multi-tenant folders | BAJA | Carpetas por usuario/sesión |

#### F5-005: Desglose de Sub-tareas (GAP #8)

| Sub-ID | Tarea | Componente | Estado |
|--------|-------|------------|--------|
| F5-005.1 | Almacenar todoManager en DirectAgentService | Backend | ❌ Pendiente |
| F5-005.2 | Agregar herramienta TodoWrite a MCP_TOOLS | Backend | ❌ Pendiente |
| F5-005.3 | Implementar fase de planificación en agent loop | Backend | ❌ Pendiente |
| F5-005.4 | Llamar markInProgress/markCompleted durante ejecución | Backend | ❌ Pendiente |
| F5-005.5 | Sincronizar ToDos en ChatMessageHandler | Backend | ❌ Pendiente |
| F5-005.6 | Agregar WebSocket events (todo:created, todo:updated) | Backend | ❌ Pendiente |
| F5-005.7 | Agregar endpoints POST/PATCH para ToDos | Backend | ❌ Pendiente |
| F5-005.8 | Componente `<TodoPanel>` | Frontend | ❌ Pendiente |
| F5-005.9 | Componente `<ProgressBar>` | Frontend | ❌ Pendiente |
| F5-005.10 | Integrar panel en layout principal | Frontend | ❌ Pendiente |
| F5-005.11 | Tests de integración | Testing | ❌ Pendiente |
| F5-005.12 | Tests E2E de progreso | Testing | ❌ Pendiente |

### FASE 6: Cobertura de Tests (Prioridad: MEDIA)

| ID | Tarea | Descripción | Estado | Success Criteria |
|----|-------|-------------|--------|------------------|
| F6-001 | Tests: TodoManager | Unit tests | ⚠️ BLOQUEADO (código muerto - GAP #8) | 70% cobertura |
| **F6-002** | **Tests: AnthropicClient** | **Unit tests** | **✅ COMPLETED** | **52 tests, 100% cobertura + QA Master Review** |
| **F6-003** | **Tests: tool-definitions + Security Fixes** | **Unit tests + Sanitization** | **✅ COMPLETED** | **100% cobertura + Security** |
| **F6-004** | **Tests: Middleware (auth-oauth + logging)** | **Unit tests** | **✅ COMPLETED** | **96 tests, 100% cobertura + QA Master Review** |
| **F6-005** | **Tests: Routes + Performance** | **Unit tests + Performance suite** | **✅ COMPLETED** | **1164 tests total, 5 phases + QA Master Audit** |
| F6-006 | Alcanzar 70% global | Completar gaps | PENDIENTE | npm run test:coverage ≥ 70% |

#### F6-003: Detalle de Implementación (COMPLETED)

> **Estado**: ✅ **COMPLETED** (2025-11-25)
>
> **QA Report**: Ver `docs/qa-reports/QA-REPORT-F6-003.md`

**Cambios Realizados (Fase 1 - Tests)**:

| Archivo | Acción | Justificación |
|---------|--------|---------------|
| `tool-schemas.ts` | **ELIMINADO** | Código muerto, desincronizado, nunca se importaba |
| `tool-definitions.test.ts` | **CREADO** | 44 tests unitarios, 100% cobertura |

**Cambios Realizados (Fase 2 - Security Fixes tras QA Master Review)**:

| Archivo | Acción | Justificación |
|---------|--------|---------------|
| `tool-definitions.ts` | **MODIFICADO** | Eliminado 'action' del enum (no existe en datos MCP) |
| `DirectAgentService.ts` | **MODIFICADO** | Agregadas 4 funciones de sanitización de inputs |
| `input-sanitization.test.ts` | **CREADO** | 58 tests para edge cases de seguridad |

**Funciones de Sanitización Agregadas**:
- `sanitizeEntityName()`: Case-insensitive, path traversal protection, character validation
- `sanitizeKeyword()`: Removes dangerous characters, length limits
- `isValidOperationType()`: Validates against allowed operations (list, get, create, update, delete)
- `sanitizeOperationId()`: Validates camelCase format

**Resultados Finales**:
- 102 tests totales para tool-definitions (44 estructura + 58 sanitización)
- 100% cobertura de `tool-definitions.ts` y funciones de sanitización
- 621 tests totales del proyecto pasan
- 0 errores de lint (15 warnings preexistentes)
- Build compila exitosamente

**Tests Implementados por Categoría**:
1. MCP_TOOLS Structure (7 tests)
2. Input Schema Validation (12 tests)
3. Synchronization with TOOL_NAMES (4 tests)
4. Helper Functions (12 tests)
5. Edge Cases and Type Safety (5 tests)
6. Anthropic SDK Compatibility (4 tests)
7. Entity Name Sanitization (20 tests)
8. Keyword Sanitization (12 tests)
9. Operation Type Validation (14 tests)
10. Operation ID Sanitization (12 tests)

**Hallazgos Adicionales (Documentados para futuro)**:
- MCP tools son solo metadata (no ejecutan operaciones BC)
- TOOL_NAMES incluye herramientas no implementadas (bc_query, bc_create, etc.)
- Workflow duplicate validation pendiente

#### F6-004: Detalle de Implementación (COMPLETED)

> **Estado**: ✅ **COMPLETED** (2025-11-25)
>
> **QA Report**: Ver `docs/qa-reports/QA-REPORT-F6-004.md`

**Archivos de Middleware Analizados y Modificados**:

| Archivo | Líneas | Funciones | Cambios |
|---------|--------|-----------|---------|
| `middleware/auth-oauth.ts` | 372 | 3 middlewares | Fix bc_token_expires_at null handling |
| `middleware/logging.ts` | 123 | 1 middleware | x-api-key redaction, PII docs, health endpoints |

**Tests Implementados (Post QA Master Review)**:

| Archivo de Test | Tests | Categorías Cubiertas |
|-----------------|-------|----------------------|
| `auth-oauth.test.ts` | 60 | Session validation, Token refresh, Multi-tenant, Error handling, Edge cases, Security |
| `logging.test.ts` | 36 | Request ID, Log levels, Serializers, Auto-logging, Security, PII compliance |
| **Total** | **96** | **100% cobertura de middleware + QA Master fixes** |

**QA Master Review - 14 Hallazgos Resueltos**:

| ID | Severidad | Hallazgo | Resolución |
|----|-----------|----------|------------|
| 1 | CRITICAL | Catch genérico sin test | Test con Object.defineProperty getter throw |
| 2 | MEDIUM | x-api-key no redactado | Agregado redaction en serializer |
| 3 | LOW | Health endpoints limitados | Agregados /ready, /live, /liveness, /readiness |
| 4 | HIGH | SQL injection test faltante | Test con payloads maliciosos |
| 5 | HIGH | Race condition token refresh | Documentado con recomendación Redis lock |
| 6 | LOW | Boundary test token expira | Test tokenExpiresAt = new Date() |
| 7 | LOW | displayName undefined | Test campos opcionales |
| 8 | HIGH | Email sin validación format | Documentado como mejora futura |
| 9 | LOW | req sin path/method | Test defensivo |
| 10 | CRITICAL | bc_token_expires_at null | Fix código + tests null/invalid |
| 11 | HIGH | Multi-tenant requireBCAccess | 3 tests aislamiento |
| 12 | HIGH | Session fixation | Test verify session.regenerate |
| 13 | MEDIUM | PII sin documentar | JSDoc con GDPR/CCPA guidance |
| 14 | LOW | req.log no verificado | Test middleware integration |

**Categorías de Tests auth-oauth.test.ts (60 tests)**:
1. authenticateMicrosoft - No Session (3 tests)
2. authenticateMicrosoft - Valid Session (4 tests)
3. authenticateMicrosoft - Token Refresh (6 tests) - incluye race condition docs
4. authenticateMicrosoft - Error Handling (4 tests) - incluye catch genérico
5. authenticateMicrosoftOptional (4 tests) - incluye edge cases
6. requireBCAccess - Basic (5 tests)
7. requireBCAccess - BC Token Edge Cases (8 tests) - null, invalid, SQL injection
8. Multi-Tenant Isolation Security (8 tests)
9. Session Security (6 tests) - fixation, boundary conditions
10. Edge Cases and Defensive (12 tests)

**Categorías de Tests logging.test.ts (36 tests)**:
1. Request ID Generation (4 tests)
2. Log Level Customization (5 tests)
3. Message Formatting (4 tests)
4. Serializers/Header Redaction (7 tests) - incluye x-api-key
5. Auto Logging Filter (6 tests) - incluye /ready, /live, etc.
6. Security (3 tests)
7. PII Compliance Documentation (4 tests)
8. Middleware Integration (3 tests) - incluye req.log

**Patrón de Testing Utilizado**:
```typescript
// Mock helpers para Express middleware
function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest
function createMockResponse(): MockResponse
function createValidSession(overrides: Partial<MicrosoftOAuthSession> = {}): MicrosoftOAuthSession

// Test para catch genérico (Object.defineProperty trick)
const throwingSession = { save: vi.fn() };
Object.defineProperty(throwingSession, 'microsoftOAuth', {
  get() { throw new Error('Unexpected session corruption'); },
});

// pino-http mock para capturar opciones de configuración
vi.mock('pino-http', () => ({
  default: vi.fn((options) => {
    (global as Record<string, unknown>).__pinoHttpOptions = options;
    return vi.fn();
  }),
}));
```

#### F6-005: Detalle de Implementación (COMPLETED)

> **Estado**: ✅ **COMPLETED** (2025-11-25)
>
> **QA Report**: Ver `docs/plans/QA-REPORT-F6-005-PHASE5.md`
> **Remediation Plan**: Ver `docs/plans/F6-005-REMEDIATION-PLAN.md`
> **QA Master Audit**: Ver `docs/plans/QA-MASTER-AUDIT-F6-005-PHASE5.md`

**Archivos de Routes Testeados**:

| Archivo | Endpoints | Tests | Descripción |
|---------|-----------|-------|-------------|
| `routes/auth-oauth.ts` | 6 | 29 | OAuth login/callback, logout, me, bc-status, bc-consent |
| `routes/token-usage.ts` | 6 | 35 | User/session token totals, monthly, top-sessions, cache-efficiency |
| `routes/logs.ts` | 1 | 25 | Client log ingestion |
| `routes/sessions.ts` | 6 | 18 (existente) | Session CRUD, messages |
| `server.ts` (inline) | 11 | 38 | MCP, BC, Agent, Approvals, Todos endpoints |
| **Total** | **30** | **145** | **4 archivos de routes + endpoints inline** |

**Archivos de Test Creados**:

| Archivo de Test | Tests | Categorías |
|-----------------|-------|------------|
| `auth-oauth.routes.test.ts` | 29 | Login, callback, logout, me, bc-status, bc-consent, security, multi-tenant |
| `token-usage.routes.test.ts` | 35 | User totals, session totals, monthly, top-sessions, cache-efficiency, multi-tenant |
| `logs.routes.test.ts` | 25 | Log ingestion, batch, validation, log levels, edge cases |
| `server-endpoints.test.ts` | 38 | MCP config/health, BC test/customers, Agent status/query, Approvals, Todos |

**Categorías de Tests auth-oauth.routes.test.ts (29 tests)**:
1. GET /login - OAuth redirect (3 tests)
2. GET /callback - Code exchange, state validation (6 tests)
3. POST /logout - Session destruction (1 test)
4. GET /me - Current user data (3 tests)
5. GET /bc-status - BC token status (4 tests)
6. POST /bc-consent - BC token acquisition (3 tests)
7. Security Edge Cases (3 tests) - Token leaks, SQL injection, CSRF state
8. Multi-Tenant Isolation (2 tests)
9. Token Expiration Edge Cases (4 tests) - null, boundary, invalid date

**Categorías de Tests token-usage.routes.test.ts (35 tests)**:
1. GET /user/:userId - User totals with multi-tenant validation (5 tests)
2. GET /session/:sessionId - Session ownership validation (4 tests)
3. GET /user/:userId/monthly - Month parameter validation (6 tests)
4. GET /user/:userId/top-sessions - Limit parameter validation (5 tests)
5. GET /user/:userId/cache-efficiency - Cache metrics (3 tests)
6. GET /me - Convenience endpoint (3 tests)
7. Multi-Tenant Security (3 tests) - Cross-user blocking
8. Edge Cases (6 tests) - Empty userId, long IDs, special chars, concurrent

**Categorías de Tests logs.routes.test.ts (25 tests)**:
1. POST /api/logs - Basic functionality (4 tests)
2. Log Level Handling (4 tests) - debug, info, warn, error
3. Validation Errors (5 tests) - Missing fields, invalid level, JSON
4. Optional Fields (3 tests) - Without context, userAgent, url
5. Edge Cases (6 tests) - Long messages, complex context, large batch, special chars
6. Security Considerations (3 tests) - No internal leaks, PII handling

**Categorías de Tests server-endpoints.test.ts (38 tests)**:
1. GET /api - Health check (1 test)
2. GET /api/mcp/config - MCP configuration (1 test)
3. GET /api/mcp/health - MCP health (2 tests)
4. GET /api/bc/test - BC test (1 test)
5. GET /api/bc/customers - Auth + DB (3 tests)
6. GET /api/agent/status - Agent status (1 test)
7. POST /api/agent/query - Agent execution (5 tests)
8. POST /api/approvals/:id/respond - Atomic approval (8 tests)
9. GET /api/approvals/pending - User approvals (3 tests)
10. GET /api/approvals/session/:sessionId - Session approvals (3 tests)
11. GET /api/todos/session/:sessionId - Session todos (4 tests)
12. Multi-Tenant Security (3 tests) - Cross-tenant blocking, TOCTOU prevention
13. Edge Cases (3 tests) - Special chars, UUID format, concurrent

**Técnicas de Testing Utilizadas**:
```typescript
// vi.hoisted para evitar problemas de orden de mocks
const { mockOAuthService, mockBCTokenManager } = vi.hoisted(() => ({
  mockOAuthService: { getAuthCodeUrl: vi.fn(), ... },
  mockBCTokenManager: { storeBCToken: vi.fn(), ... },
}));

// Supertest con Express app aislado
function createTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use('/api/route', router);
  return app;
}

// Header-based auth injection for tests
const response = await request(app)
  .get('/api/token-usage/user/user-123')
  .set('x-test-user-id', 'user-123');
```

**Resultados**:
- 884 tests totales del proyecto pasan (145 nuevos de routes)
- 0 errores de lint (15 warnings preexistentes)
- Build compila exitosamente
- Type-check sin errores

**Verificación de Seguridad Multi-Tenant**:
- ✅ User A no puede acceder a sesión de User B
- ✅ Token refresh aislado por usuario
- ✅ Headers sensibles redactados (Authorization, Cookie, x-api-key)
- ✅ Session IDs únicos por request
- ✅ bc_token_expires_at null/invalid manejado correctamente
- ✅ SQL injection defendido (parameterized queries)
- ✅ PII compliance documentado (GDPR/CCPA)

**Resultados Finales F6-005 (Post QA Master Final Validation)**:
- ✅ **1164 tests pasan** (superó objetivo de 1072 por 92 tests)
- ✅ Type-check exitoso
- ✅ Lint exitoso (0 errores, 15 warnings preexistentes)
- ✅ Build exitoso
- ✅ 5 fases internas completadas con QA Master Audit remediation
- ✅ Performance suite: P95/P99 percentiles, RSS monitoring, multi-tenant isolation
- ✅ Error standardization: ~95% adoption de sendError()

#### F6-002: Detalle de Implementación (COMPLETED)

> **Estado**: ✅ **COMPLETED** (2025-11-25)
>
> **QA Report**: Ver `docs/qa-reports/QA-REPORT-F6-002.md`
>
> **QA Master Review**: ✅ Aprobado (16/16 hallazgos resueltos)

**Archivo Bajo Test**:

| Archivo | Líneas | Métodos | Descripción |
|---------|--------|---------|-------------|
| `services/agent/AnthropicClient.ts` | 183 | 3 | Wrapper del SDK @anthropic-ai/sdk |

**Cambio de Código (C2 - Error Logging Consistency)**:

Se agregó error logging a `createChatCompletion` para mantener consistencia con streaming:
```typescript
} catch (error) {
  // Enhanced error logging for diagnostics (consistent with streaming)
  type NodeSystemError = Error & { code?: string; syscall?: string };
  const systemError = error as NodeSystemError;

  logger.error('❌ Anthropic API call failed', {
    error: error instanceof Error ? error.message : String(error),
    errorCode: systemError?.code,
    errorSyscall: systemError?.syscall,
    isECONNRESET: systemError?.code === 'ECONNRESET',
    stack: error instanceof Error ? error.stack : undefined,
  });
  // ...
}
```

**Tests Implementados por Categoría (52 tests - Post QA Master Review)**:

| Categoría | Tests | Nuevos (QA) |
|-----------|-------|-------------|
| Constructor | 3 | - |
| createChatCompletion - Success | 5 | - |
| createChatCompletion - Extended Thinking | 4 | +1 (C1: undefined vs omitido) |
| createChatCompletion - Error Handling | 5 | +1 (C2: logger.error) |
| createChatCompletionStream - Success | 6 | - |
| createChatCompletionStream - Extended Thinking | 4 | - |
| createChatCompletionStream - Error Handling | 5 | - |
| getUnderlyingClient | 3 | +1 (M5: post-error recovery) |
| Edge Cases | 6 | +2 (H2/H3: max_tokens/budget_tokens = 0) |
| Multi-Tenant Concurrency | 2 | +2 (H1: concurrent streams) |
| Security Tests | 2 | +2 (C3: API key sanitization) |
| Timeouts and Stalls | 2 | +2 (H5: AbortController) |
| Multi-Turn Conversations | 2 | +2 (H4: tool results) |
| **Total** | **52** | **+17** |

**QA Master Review - 16 Hallazgos Resueltos**:

| ID | Severidad | Hallazgo | Resolución |
|----|-----------|----------|------------|
| C1 | CRITICAL | thinking: undefined vs omitido | ✅ Test agregado |
| C2 | CRITICAL | Logging inconsistente | ✅ Código + test agregados |
| C3 | CRITICAL | API key sanitization | ✅ 2 tests seguridad |
| H1 | HIGH | Concurrencia multi-stream | ✅ 2 tests multi-tenant |
| H2 | HIGH | max_tokens: 0 | ✅ Test edge case |
| H3 | HIGH | budget_tokens: 0 | ✅ Test edge case |
| H4 | HIGH | Multi-turn con tool results | ✅ 2 tests conversación |
| H5 | HIGH | Stream stall/timeout | ✅ 2 tests AbortController |
| M1 | MEDIUM | Cache tokens en usage | ✅ Mock responses actualizados |
| M2 | MEDIUM | tool_choice testing | ✅ Documentado (interface ext.) |
| M3 | MEDIUM | Helper cleanup | ✅ TEST_MODEL constant |
| M4 | MEDIUM | FakeAnthropicClient consistency | ✅ Verificado |
| M5 | MEDIUM | getUnderlyingClient post-error | ✅ Test recovery |
| L1 | LOW | Language consistency | ✅ All English |
| L2 | LOW | TEST_MODEL constant | ✅ Agregado |
| L3 | LOW | Coverage report | ✅ Documentado |

**Resultados de Verificación Final**:
- ✅ 52/52 tests AnthropicClient pasan
- ✅ 757 tests totales del proyecto pasan
- ✅ Type-check exitoso (`npm run type-check`)
- ✅ Lint exitoso (0 errores, 15 warnings preexistentes)
- ✅ Build exitoso (`npm run build`)
- ✅ 16/16 hallazgos QA Master resueltos

**Cobertura del Archivo**:
- `AnthropicClient.ts`: ~100% (todos los paths cubiertos)

---

## 8. CRITERIOS DE ÉXITO

### Por Fase

**FASE 1 - Completada cuando**:
- [ ] `npm run test:e2e` ejecuta sin errores de configuración
- [ ] Existe `/e2e/README.md` con instrucciones claras
- [ ] GitHub Actions corre tests E2E en PRs

**FASE 2 - Completada cuando**:
- [ ] 6 tests E2E core pasan
- [ ] Tiempo de ejecución < 5 minutos
- [ ] Coverage de flujos críticos > 80%

**FASE 3 - Completada cuando**:
- [ ] 5 tests E2E avanzados pasan
- [ ] Tests de edge cases documentados
- [ ] No hay flaky tests

**FASE 4 - Completada cuando**:
- [ ] Test de seguridad: Usuario A no puede ver datos de Usuario B
- [ ] Approval events tienen sequenceNumber
- [ ] Audit log registra todos los accesos

**FASE 5 - Completada cuando**:
- [ ] Sistema de archivos funcional (upload/download/list)
- [ ] Selector de ambiente BC funcional
- [ ] Preferencias de usuario funcionales

**FASE 6 - Completada cuando**:
- [ ] `npm run test:coverage` muestra ≥ 70%
- [ ] No hay servicios con 0% cobertura
- [ ] Tests son estables (no flaky)

### Métricas Globales

| Métrica | Actual | Objetivo Fase 2 | Objetivo Final |
|---------|--------|-----------------|----------------|
| Cobertura de código | 14% | 40% | 70% |
| Tests E2E | 0 | 6 | 15+ |
| Tests Integration | 7 | 12 | 20+ |
| Tests Unit | 20 | 30 | 50+ |
| Tiempo CI (E2E) | N/A | < 5min | < 3min |
| Flaky tests | N/A | 0 | 0 |

---

## APÉNDICE A: Archivos Clave para Testing

```
backend/
├── src/__tests__/
│   ├── setup.ts                      ← Setup de MSW para unit tests
│   ├── setup.integration.ts          ← Setup de DB/Redis para integration
│   ├── fixtures/
│   │   ├── AnthropicResponseFactory.ts
│   │   ├── ApprovalFixture.ts
│   │   └── BCEntityFixture.ts
│   └── mocks/
│       ├── handlers.ts               ← MSW handlers
│       └── server.ts                 ← MSW server
├── vitest.config.ts                  ← Config unit tests
├── vitest.integration.config.ts      ← Config integration tests
└── package.json                      ← Scripts de test

e2e/                                  ← PARCIALMENTE IMPLEMENTADO (F1-003)
├── README.md                         ✅ CREADO - Documentación E2E
├── tsconfig.json                     ✅ CREADO - Config TypeScript E2E
├── fixtures/
│   ├── test-data.ts                  ✅ CREADO - Constantes de prueba (usuarios, sesiones, mensajes)
│   └── db-helpers.ts                 ✅ CREADO - Funciones seed/clean BD
├── scripts/
│   ├── seed-test-data.ts             ✅ CREADO - npm run e2e:seed
│   └── clean-test-data.ts            ✅ CREADO - npm run e2e:clean
├── support/                          ← PENDIENTE (F1-002)
│   ├── api-client.ts                 ← A crear
│   ├── ws-client.ts                  ← A crear
│   └── auth.helpers.ts               ← A crear
├── auth/                             ← PENDIENTE (F2-001)
│   └── login.spec.ts                 ← A crear
├── chat/                             ← PENDIENTE (F2-002 a F2-006)
│   ├── new-session.spec.ts           ← A crear
│   ├── persistence.spec.ts           ← A crear
│   ├── approvals.spec.ts             ← A crear
│   └── websocket.spec.ts             ← A crear
└── example.spec.ts                   ← Existía (placeholder)

playwright.config.ts                  ← Config E2E (ya existe)
package.json                          ← Scripts e2e:seed, e2e:clean agregados
```

---

## APÉNDICE B: Comandos de Testing

```bash
# Unit tests
cd backend && npm test

# Unit tests con UI
cd backend && npm run test:ui

# Unit tests con coverage
cd backend && npm run test:coverage

# Integration tests (requiere DB + Redis)
cd backend && npm run test:integration

# ═══════════════════════════════════════════════════
# E2E Test Data Management (F1-003 - IMPLEMENTADO)
# ═══════════════════════════════════════════════════

# Sembrar datos de prueba E2E en la BD
npm run e2e:seed

# Limpiar datos de prueba E2E de la BD
npm run e2e:clean

# Alias para e2e:seed
npm run e2e:setup

# ═══════════════════════════════════════════════════
# E2E Tests (Playwright)
# ═══════════════════════════════════════════════════

# E2E tests
npm run test:e2e

# E2E con browser visible
npm run test:e2e:headed

# E2E solo Chromium
npm run test:e2e:chromium

# E2E con debug
npm run test:e2e:debug
```

---

*Documento generado automáticamente por diagnóstico de Claude*
*Fecha de creación: 2025-11-24*
*Última actualización: 2025-11-25 (F6-005 COMPLETED - Routes + Performance, 1164 tests, QA Master Final Validation)*
*Versión: 1.9*

---

## CHANGELOG

| Versión | Fecha | Cambios |
|---------|-------|---------|
| 1.9 | 2025-11-25 | **F6-005 COMPLETED**: QA Master Final Validation passed. 5 fases internas (Gaps Críticos, Seguridad, Edge Cases, Error Standardization, Performance). 1164 tests totales. Performance suite con P95/P99, RSS monitoring, multi-tenant isolation. |
| 1.8 | 2025-11-25 | **F6-003 COMPLETED**: Security fixes tras QA Master Review. Eliminado 'action' del enum, agregadas 4 funciones de sanitización (path traversal, case sensitivity, special chars), 58 tests adicionales. 621 tests totales pasan. |
| 1.7 | 2025-11-25 | **F6-003 IN TESTING**: Tests para tool-definitions.ts. 44 tests unitarios, 100% cobertura. Eliminado `tool-schemas.ts` (código muerto desincronizado). |
| 1.6 | 2025-11-25 | Agregado GAP #8: Sistema de ToDos no integrado en Agent Loop (código muerto). Incluye análisis técnico completo, diagramas de flujo esperado, plan de implementación por fases, contratos WebSocket, mockups de UI, y desglose de 12 sub-tareas. |
| 1.5 | 2025-11-25 | F4-002 COMPLETED con QA Master Review Fixes |
| 1.4 | 2025-11-25 | F4-003 Multi-Tenant Audit completado |
| 1.3 | 2025-11-25 | F4-001 Ownership validation completado |
| 1.0 | 2025-11-24 | Documento inicial creado |
