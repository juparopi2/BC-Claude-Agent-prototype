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
│  ├── ApprovalManager (Promise-based)      ✅ IMPLEMENTADO (80%)             │
│  ├── Approval Events (WebSocket)          ⚠️  PARCIAL (No unificado)        │
│  ├── Approval Persistence (DB)            ✅ IMPLEMENTADO (100%)            │
│  └── Session Ownership Validation         ❌ FALTA                          │
│                                                                             │
│  ARCHIVOS E IMÁGENES                                                        │
│  ├── session_files Table (Schema)         ✅ EXISTE (Schema only)           │
│  ├── Azure Blob Storage (Config)          ✅ CONFIGURADO (Sin usar)         │
│  ├── File Upload Service                  ❌ NO IMPLEMENTADO                │
│  ├── Image Processing                     ❌ NO IMPLEMENTADO                │
│  └── Multi-tenant Folder System           ❌ NO IMPLEMENTADO                │
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
| Human-in-the-Loop | 80% | MEDIA |
| File Management | 10% | BAJA (futuro) |
| Testing Infrastructure | 40% | CRÍTICA |

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

### GAP #2: Validación de Ownership en Approvals (SEGURIDAD)

**Problema**: Un usuario podría aprobar solicitudes de otro usuario porque no se valida que el userId sea dueño del sessionId.

**Ubicación del Bug**: `server.ts:577-578`

**Código Actual (Vulnerable)**:
```typescript
await approvalManager.respondToApproval(approvalId, decisionVerified, userIdVerified);
// ❌ No verifica que userId es dueño de la sesión del approval
```

**Código Corregido**:
```typescript
// 1. Obtener sessionId del approval
const approval = await getApprovalById(approvalId);
if (!approval) throw new Error('Approval not found');

// 2. Verificar ownership
const session = await getSessionById(approval.session_id);
if (session.user_id !== userId) {
  throw new Error('Unauthorized: You do not own this session');
}

// 3. Proceder con aprobación
await approvalManager.respondToApproval(approvalId, decision, userId);
```

**Success Criteria**:
- [ ] Test: Usuario A no puede aprobar solicitudes de Usuario B
- [ ] HTTP 403 si intenta aprobar sesión ajena
- [ ] Audit log registra intentos fallidos

---

### GAP #3: Eventos de Approval No Unificados

**Problema**: Los eventos `approval:requested` y `approval:resolved` se emiten como eventos separados, no como parte del flujo unificado `agent:event`.

**Impacto**:
- No tienen `sequenceNumber` global
- Frontend necesita manejar dos tipos de eventos diferentes
- No se persisten en `message_events` (no hay trazabilidad)

**Estado Actual**:
```typescript
// ApprovalManager.ts
this.io.to(sessionId).emit('approval:requested', requestEvent);  // ← Evento separado
```

**Estado Deseado**:
```typescript
// Primero persistir en EventStore
const event = await eventStore.appendEvent(sessionId, 'approval_requested', {
  approvalId, toolName, toolArgs, changeSummary, priority
});

// Luego emitir como agent:event
this.io.to(sessionId).emit('agent:event', {
  type: 'approval_requested',
  ...eventData,
  sequenceNumber: event.sequence_number,
  eventId: event.id,
  persistenceState: 'persisted'
});
```

**Success Criteria**:
- [ ] Approval events tienen sequenceNumber
- [ ] Approval events se persisten en message_events
- [ ] Frontend recibe via agent:event únicamente

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
- `TodoManager` (0%)
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

| ID | Tarea | Descripción | Success Criteria |
|----|-------|-------------|------------------|
| F4-001 | Fix: Ownership validation | GAP #2 | Tests de seguridad pasan |
| F4-002 | Fix: Approval events unificados | GAP #3 | Eventos tienen sequenceNumber |
| F4-003 | Audit: Multi-tenant | Verificar aislamiento | Un usuario no ve datos de otro |

### FASE 5: Funcionalidades Nuevas (Prioridad: BAJA - Futuro)

| ID | Tarea | Descripción | Success Criteria |
|----|-------|-------------|------------------|
| F5-001 | Implementar FileStorageService | GAP #4 | Upload/download funciona |
| F5-002 | Implementar selector de ambiente BC | GAP #5 | Usuario puede cambiar ambiente |
| F5-003 | Implementar preferencias de usuario | GAP #6 | Preferencias se persisten |
| F5-004 | Implementar sistema de carpetas | Multi-tenant folders | Carpetas por usuario/sesión |

### FASE 6: Cobertura de Tests (Prioridad: MEDIA)

| ID | Tarea | Descripción | Success Criteria |
|----|-------|-------------|------------------|
| F6-001 | Tests: TodoManager | Unit tests | 70% cobertura |
| F6-002 | Tests: AnthropicClient | Unit tests | 70% cobertura |
| F6-003 | Tests: tool-definitions | Unit tests | 70% cobertura |
| F6-004 | Tests: Middleware | Unit tests | 70% cobertura |
| F6-005 | Tests: Routes | Integration tests | Todos los endpoints |
| F6-006 | Alcanzar 70% global | Completar gaps | npm run test:coverage ≥ 70% |

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
*Última actualización: 2025-11-25 (F1-003 implementado)*
*Versión: 1.1*
