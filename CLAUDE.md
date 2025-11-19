# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🎯 ARCHIVO TODO.md - FUENTE DE VERDAD

**⚠️ IMPORTANTE**: El archivo `TODO.md` en la raíz del proyecto contiene **TODAS las tareas que hay que hacer** para este proyecto.

**Instrucciones obligatorias**:
1. **Lee el archivo `TODO.md` PRIMERO** antes de comenzar cualquier tarea
2. **Actualiza el TODO.md** cuando completes tareas (marca con `[x]`)
3. **Agrega nuevas tareas al TODO.md** cuando descubras trabajo adicional
4. **Todas las tareas deben estar en TODO.md** - es la única fuente de verdad del progreso del proyecto
5. El TODO.md está organizado en fases (Phase 1, 2, 3) y semanas - respeta esta estructura

**Estado actual**: Phase 2 - Week 7 (100% MVP Complete + UI/UX Polished)

---

## 📚 CÓMO USAR LA DOCUMENTACIÓN

**⚠️ ESTRUCTURA DE DOCUMENTACIÓN ACTUAL** (2025-11-19):

La documentación está organizada por roles (**backend**, **frontend**, **common**) con **101 archivos markdown** que cubren todos los aspectos del sistema.

### Índice Maestro

**`docs/README.md`** es el **índice maestro** de toda la documentación. **Lee este archivo PRIMERO** antes de trabajar en cualquier feature.

### Documentos Críticos (LEER ANTES DE IMPLEMENTAR)

Antes de hacer cambios significativos, **SIEMPRE lee estos documentos**:

1. **`docs/README.md`** - Índice completo de los 101 archivos de documentación
2. **`docs/backend/README.md`** - Backend quick start, arquitectura, deployment (16KB)
3. **`docs/backend/architecture-deep-dive.md`** - Event sourcing, BullMQ queues, DirectAgentService (14KB)
4. **`docs/backend/websocket-contract.md`** - Contrato completo de eventos WebSocket (17KB)
5. **`docs/common/03-database-schema.md`** - Schema completo (DDL + ER diagrams + queries)
6. **`docs/backend/authentication.md`** - Microsoft OAuth flow, token encryption (7KB)

### Cuándo Consultar Cada Sección

| Tarea | Documentos a Leer |
|-------|-------------------|
| **Implementar agent features** | `docs/backend/architecture-deep-dive.md` (DirectAgentService) |
| **Cambiar base de datos** | `docs/common/03-database-schema.md` |
| **Modificar autenticación** | `docs/backend/authentication.md` |
| **Agregar endpoints REST** | `docs/backend/api-reference.md` |
| **Agregar eventos WebSocket** | `docs/backend/websocket-contract.md` |
| **Entender SDK messages** | `docs/backend/06-sdk-message-structures.md` (stop_reason pattern) |
| **Implementar error handling** | `docs/backend/error-handling.md` |
| **TypeScript types** | `docs/backend/types-reference.md` |

### Protocolo de Actualización de Documentación

**CADA VEZ QUE HAGAS UN CAMBIO SIGNIFICATIVO**:

1. ✅ **Actualiza el documento relevante** en `docs/backend/`, `docs/frontend/`, o `docs/common/`
2. ✅ **Actualiza `docs/README.md`** si cambia la estructura de carpetas
3. ✅ **Actualiza `TODO.md`** para reflejar progreso
4. ✅ **Actualiza `CLAUDE.md`** si cambian las instrucciones generales para Claude Code
5. ✅ **Documenta breaking changes** en el archivo correspondiente (ej: websocket-contract.md si cambias eventos)

**Regla de Oro**: "Si hiciste un breaking change y NO actualizaste la documentación correspondiente, NO has terminado."

### Estructura de Carpetas docs/ (Organizada por Roles)

```
docs/
├── README.md                           ⭐ ÍNDICE MAESTRO - LEE PRIMERO
├── backend/                            🔧 Backend API documentation (8 archivos)
│   ├── README.md                       ⭐ Quick start, setup, deployment
│   ├── architecture-deep-dive.md       ⭐ Event sourcing, BullMQ, DirectAgentService
│   ├── websocket-contract.md           ⭐ Contrato completo de eventos WebSocket
│   ├── api-reference.md                REST API endpoints
│   ├── authentication.md               Microsoft OAuth flow, token encryption
│   ├── error-handling.md               Error codes y estrategias
│   ├── types-reference.md              TypeScript types reference
│   ├── 06-sdk-message-structures.md    SDK message types, stop_reason pattern
│   └── deprecated/                     (vacío, para futura referencia)
├── frontend/                           🎨 Frontend documentation (1 archivo)
│   └── README.md                       Frontend setup y arquitectura
├── common/                             📚 Shared documentation (2 archivos)
│   ├── 03-database-schema.md           ⭐ Complete DB schema (11/15 tables)
│   └── 05-AZURE_NAMING_CONVENTIONS.md  Azure resource naming standards
└── future-developments/                📅 Phase 3 planning (11 archivos)
    ├── README.md                       Roadmap de features futuras
    ├── rate-limiting/                  5 PRDs para rate limiting, caching
    └── testing/                        6 documentos de testing strategy
```

**Total**: **101 archivos markdown** organizados por rol

**⭐ = Alta prioridad, leer frecuentemente**

---

## 📂 Estructura del Proyecto

### Backend
**Ubicación**: `backend/`

**Estado**: En construcción (ver TODO.md sección 1.2)

El backend será un servidor Express con TypeScript que incluye:
- **Claude Agent SDK** (@anthropic-ai/claude-agent-sdk) - Framework oficial de agentes
- Specialized agents via system prompts (BCQuery, BCWrite, Validation)
- Integración con MCP server pre-existente (via SDK)
- WebSocket server (Socket.IO) para streaming
- **Microsoft Entra ID OAuth 2.0** - Single Sign-On con delegated permissions para Business Central
- Conexiones a Azure SQL y Redis

### Frontend
**Ubicación**: `frontend/`

**Estado**: Inicializado (Next.js 16.0.1 + React 19.2.0 + Tailwind CSS 4.1.17)

Frontend Next.js con App Router que incluye:
- Chat interface tipo Claude Code
- Panel de aprobaciones (Human-in-the-Loop)
- Panel de To-Do Lists
- Source panel
- WebSocket client (Socket.IO 4.8.1)

### Infraestructura
**Ubicación**: `infrastructure/`

**Estado**: Script creado, pendiente de ejecutar (ver TODO.md sección 1.1)

Contiene scripts de deployment para Azure:
- `deploy-azure-resources.sh` - Script de deployment de todos los recursos Azure
- Resource Groups, Key Vault, Azure SQL, Redis, Container Apps

**⚠️ IMPORTANTE - Convenciones de Nombrado de Azure**:
- **SIEMPRE consulta `docs/02-core-concepts/05-AZURE_NAMING_CONVENTIONS.md`** antes de crear cualquier recurso en Azure
- **USA el comando `az`** (Azure CLI) para crear recursos, NO el portal web
- Sigue las convenciones de nombrado definidas (ejemplo: `sqlsrv-bcagent-dev`, `rg-BCAgentPrototype-app-dev`)
- Todos los recursos deben usar las abreviaciones estándar y la estructura: `<tipo>-<workload>-<ambiente>`

---

## 📚 Documentación

**⚠️ ESTRUCTURA ACTUALIZADA (2025-11-19)**:

- **`docs/`** - Documentación organizada por roles (backend/, frontend/, common/)
- **101 archivos markdown** cubriendo arquitectura, API, WebSocket, testing, y Phase 3 planning

**SIEMPRE lee `docs/README.md` PRIMERO** - Es el índice maestro con navegación completa.

### Documentos Más Importantes

**Lee estos ANTES de implementar cualquier feature**:

1. **`docs/README.md`** ⭐ - Índice completo de los 101 archivos
2. **`docs/backend/README.md`** ⭐ - Backend quick start, setup, deployment (16KB)
3. **`docs/backend/architecture-deep-dive.md`** ⭐ - Event sourcing, BullMQ, DirectAgentService (14KB)
4. **`docs/backend/websocket-contract.md`** ⭐ - Contrato completo de eventos WebSocket (17KB)
5. **`docs/common/03-database-schema.md`** ⭐ - Schema completo (DDL + ER + queries)
6. **`docs/backend/authentication.md`** ⭐ - Microsoft OAuth flow, token encryption (7KB)

### Documentos Backend (8 archivos principales)

- **`README.md`** ⭐ - Quick start, arquitectura general, deployment
- **`architecture-deep-dive.md`** ⭐ - Event sourcing, BullMQ queues, DirectAgentService, stop_reason pattern
- **`websocket-contract.md`** ⭐ - Contrato completo de eventos, discriminated unions
- **`api-reference.md`** - REST API endpoints (sessions, messages, approvals)
- **`authentication.md`** - Microsoft OAuth 2.0, token encryption, session management
- **`error-handling.md`** - Error codes, estrategias de retry, logging
- **`types-reference.md`** - TypeScript types reference
- **`06-sdk-message-structures.md`** - SDK message types, stop_reason pattern (NEW)

### Documentos Common (2 archivos)

- **`03-database-schema.md`** ⭐ - Complete DB schema (11/15 tables functional)
- **`05-AZURE_NAMING_CONVENTIONS.md`** - Azure resource naming standards

### Future Developments (11 archivos)

- **`future-developments/testing/`** - 6 documentos de testing strategy (Phase 3)
- **`future-developments/rate-limiting/`** - 5 PRDs para rate limiting, caching, analytics

**⭐ = Alta prioridad, leer frecuentemente**

---

## 🛠️ Comandos de Desarrollo

### Frontend (Next.js 15)
```bash
cd frontend
npm install          # Instalar dependencias
npm run dev         # Dev server (puerto 3000)
npm run build       # Build de producción
npm run lint        # Linter
```

### Backend (Express + TypeScript)
```bash
cd backend
npm install         # Instalar dependencias
npm run dev         # Dev server (puerto 3002)
npm run migrate     # Migrations de BD (no implementado aún)
npm run seed        # Seed de datos demo (no implementado aún)
```

### Infraestructura (Azure)
```bash
cd infrastructure
./deploy-azure-resources.sh  # Deploy todos los recursos Azure
```

---

## 🔑 Configuración

### Variables de Entorno

**Frontend** (`.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:3002
NEXT_PUBLIC_WS_URL=ws://localhost:3002
```

**Backend** (`.env`):
```
PORT=3002
DATABASE_URL=<from Azure Key Vault>
REDIS_URL=<from Azure Key Vault>
ANTHROPIC_API_KEY=<from Azure Key Vault>

# Microsoft OAuth (NEW)
MICROSOFT_CLIENT_ID=<from Azure Key Vault>
MICROSOFT_CLIENT_SECRET=<from Azure Key Vault>
MICROSOFT_TENANT_ID=common  # or specific tenant
MICROSOFT_REDIRECT_URI=http://localhost:3002/api/auth/callback
MICROSOFT_SCOPES="openid profile email offline_access User.Read https://api.businesscentral.dynamics.com/Financials.ReadWrite.All"

# Encryption for BC tokens (NEW)
ENCRYPTION_KEY=<from Azure Key Vault>  # 32-byte key for AES-256

# Session management (NEW)
SESSION_SECRET=<generate with: openssl rand -base64 32>
SESSION_MAX_AGE=86400000  # 24 hours

# Business Central API
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0
# NOTE: BC credentials are now per-user (stored encrypted in DB), not global env vars

# MCP Server
MCP_SERVER_URL=https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp
```

**Nota**: Los secrets de infraestructura (Microsoft OAuth, encryption key, etc.) se almacenan en Azure Key Vault. **Los credentials de Business Central ahora son por usuario** (almacenados cifrados en la BD), no credenciales globales. Ver `infrastructure/deploy-azure-resources.sh` y TODO.md sección 2.5.

---

## 🏗️ Arquitectura Resumida

**Sistema basado en DirectAgentService + Event Sourcing**:

1. **Frontend**: Next.js 16.0.1 con chat interface + WebSocket client (Socket.IO)
2. **API Layer**: Express 5.1.0 + Socket.IO 4.8.1 para streaming en tiempo real
3. **Agent Layer**: DirectAgentService con @anthropic-ai/sdk@0.68.0
   - Manual agentic loop (Think → Act → Verify → Repeat)
   - Tool calling con 7 tools vendoreados de MCP
   - Approval hooks para write operations
4. **Event Sourcing**: Append-only event log en `message_events`
   - Atomic sequence numbers vía Redis INCR
   - BullMQ 5.63.2 para async processing (3 queues)
   - Rate limiting: 100 jobs/session/hour
5. **Integration Layer**: Vendored MCP tools → Business Central API
6. **Persistence**: Azure SQL (11/15 tables) + Redis para sessions/sequences

**Flujo típico de escritura**:
```
Usuario → Chat → WebSocket → DirectAgentService.processMessage() →
Agentic Loop: SDK detecta tool_use → canUseTool() hook →
Approval Request almacenado en BD → Usuario Aprueba →
Tool ejecutado manualmente → Resultado → Event Store →
BullMQ queue → Persistence → WebSocket → Usuario
```

**Stop Reason Pattern** (migration 008):
- `stop_reason='tool_use'` → Mensaje intermedio, continúa el loop
- `stop_reason='end_turn'` → Respuesta final, termina el loop

**Documentos de arquitectura detallada**:
- [Backend Quick Start](docs/backend/README.md) - Setup, deployment, troubleshooting
- [Architecture Deep Dive](docs/backend/architecture-deep-dive.md) - Event sourcing, BullMQ, DirectAgentService
- [WebSocket Contract](docs/backend/websocket-contract.md) - Contrato completo de eventos
- [SDK Message Structures](docs/backend/06-sdk-message-structures.md) - Stop reason pattern

---

## 🎓 Contexto del Proyecto

**Objetivo**: Crear un sistema de agentes AI (inspirado en Claude Code) que permite interactuar con Microsoft Business Central mediante lenguaje natural, con aprobaciones humanas para operaciones críticas, to-do lists automáticos, y streaming en tiempo real.

**Tecnologías principales**:
- **LLM**: **Anthropic SDK** (@anthropic-ai/sdk@0.68.0) - Direct API access con manual agentic loop
- **Agent System**: DirectAgentService con tool calling y streaming
- **Integration**: Vendored MCP tools (7 tools de Business Central)
- **Frontend**: Next.js 16.0.1 + React 19.2.0 + Tailwind CSS 4.1.17 + shadcn/ui
- **Backend**: Express 5.1.0 + TypeScript + Socket.IO 4.8.1
- **Async Processing**: BullMQ 5.63.2 (3 queues: persistence, tools, events)
- **Database**: Azure SQL (11/15 tables) + Redis (sessions, sequences, queues)
- **Cloud**: Azure (Container Apps, Key Vault, SQL, Redis)

**Timeline MVP**: 6-9 semanas divididas en 3 fases (ver TODO.md)

**Estado actual**: Phase 2 - Week 7 (100% MVP Complete + UI/UX Polished)

---

## 📌 Recordatorios Importantes

1. **TODO.md es la fuente de verdad** - Consúltalo y actualízalo constantemente
2. **docs/README.md es el índice maestro** - Lee PRIMERO antes de cualquier feature (101 archivos de docs)
3. **Actualiza la documentación SIEMPRE** - Breaking change → actualizar el doc correspondiente (websocket-contract.md, api-reference.md, etc.)
4. **DirectAgentService es la implementación actual** - Manual agentic loop con @anthropic-ai/sdk@0.68.0 (ver `docs/backend/architecture-deep-dive.md`)
5. **Event Sourcing Pattern** - Append-only log en `message_events`, atomic sequences vía Redis INCR
6. **Stop Reason Pattern** - `stop_reason='tool_use'` = intermedio, `stop_reason='end_turn'` = final (ver `docs/backend/06-sdk-message-structures.md`)
7. **MCP Tools vendoreados** - 7 tools en `backend/src/services/tools/tool-definitions.ts`, NO git submodule
8. **Business Central** - Per-user tokens (delegated), almacenados cifrados en BD con AES-256
9. **Authentication** - Microsoft OAuth 2.0 con refresh tokens (ver `docs/backend/authentication.md`)
10. **Azure Secrets** - Todos los secrets en Key Vault, nunca en código
11. **Database Schema** - Consulta `docs/common/03-database-schema.md` ANTES de modificar BD (11/15 tables funcionales)
12. **Tests** - Testing strategy documentada en `future-developments/testing/`, implementación en Phase 3
13. **Dependencias NPM** - **SIEMPRE usa versiones exactas** (sin `^` ni `~`) en package.json
14. **BullMQ Queues** - 3 queues (persistence, tools, events), rate limit 100 jobs/session/hour
15. **Port Configuration** - Frontend: 3000, Backend: 3002 (configurable vía .env)

---

## 🔥 Filosofía de Arquitectura - DirectAgentService

**⚠️ REGLA DE ORO**: Usamos el Anthropic SDK directo (@anthropic-ai/sdk) con **manual agentic loop** en lugar del Claude Agent SDK. Esta decisión está justificada y documentada.

### Principio Fundamental

> "Implementamos un agentic loop manual porque nos da control total sobre tool calling, streaming, y event sourcing. El trade-off es aceptable dado los requerimientos de Business Central y human-in-the-loop."

### Qué Proporciona DirectAgentService

DirectAgentService implementa estas capacidades **manualmente**:

1. **Manual Agentic Loop** (Think → Act → Verify → Repeat)
   - Loop `while (shouldContinue)` controlado por `stop_reason`
   - `stop_reason='tool_use'` → continúa el loop (mensaje intermedio)
   - `stop_reason='end_turn'` → termina el loop (respuesta final)
   - Max 20 turns como safety limit

2. **Tool Calling con Aprobaciones**
   - 7 tools vendoreados de MCP en `tool-definitions.ts`
   - Write operations requieren aprobación humana
   - `canUseTool()` hook intercepta tools antes de ejecución
   - Aprobaciones almacenadas en BD (`approval_requests` table)

3. **Context Management Manual**
   - Session persistence vía `conversation_history` table
   - System prompt regenerado cada turn
   - Context window management (100K tokens max)
   - History management con partial messages

4. **Streaming Nativo del SDK**
   - SDK streaming con `stream: true`
   - Eventos: `message_start`, `content_block_delta`, `message_delta`, `message_stop`
   - WebSocket propagation vía Socket.IO
   - Event sourcing en `message_events` table

5. **Prompt Caching Manual**
   - Habilitado vía `ENABLE_PROMPT_CACHING=true`
   - SDK maneja caching internamente
   - Reducción de costos y latencia

### Event Sourcing Pattern

**Append-Only Event Log**:
- Tabla `message_events` almacena todos los eventos
- Sequence numbers atómicos vía Redis INCR
- BullMQ procesa eventos async (3 queues)
- Rate limiting: 100 jobs/session/hour

**3 Queues BullMQ**:
1. **message-persistence**: Persiste mensajes completos en BD
2. **tool-execution**: Ejecuta tools post-aprobación
3. **event-processing**: Procesa eventos especiales (TodoWrite, errors)

### Arquitectura DirectAgentService

```typescript
// ✅ CORRECTO - Manual Agentic Loop con DirectAgentService
class DirectAgentService {
  async processMessage(sessionId: string, userMessage: string) {
    let shouldContinue = true;
    let turnCount = 0;

    while (shouldContinue && turnCount < 20) {
      // 1. Build system prompt (regenerado cada turn)
      const systemPrompt = this.buildSystemPrompt(session);

      // 2. Call SDK con streaming
      const response = await this.anthropicClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        system: systemPrompt,
        messages: conversationHistory,
        tools: this.vendoredMcpTools,  // 7 tools vendoreados
        stream: true
      });

      // 3. Stream eventos a WebSocket + Event Store
      for await (const event of response) {
        await this.eventStore.append(sessionId, event);
        this.socket.emit('agent:event', event);
      }

      // 4. Check stop_reason
      if (message.stop_reason === 'tool_use') {
        // Tool call detected
        const approval = await this.canUseTool(tool);
        if (approval.approved) {
          await this.executeTool(tool);
          shouldContinue = true;  // Continuar loop
        } else {
          shouldContinue = false;  // Terminar loop
        }
      } else if (message.stop_reason === 'end_turn') {
        shouldContinue = false;  // Respuesta final
      }

      turnCount++;
    }
  }
}

// ❌ INCORRECTO - NO usar Agent SDK (no instalado)
const result = await query({
  prompt,
  options: { agents: {...} }  // Este SDK NO está instalado
});
```

### Best Practices DirectAgentService

1. **Tool Definitions**
   - ✅ 7 tools vendoreados en `tool-definitions.ts`
   - ✅ Match exacto con MCP server schema
   - ❌ NO agregar tools sin validar con MCP server
   - ✅ Write tools requieren `requiresApproval: true`

2. **Approval Hooks**
   - ✅ `canUseTool()` intercepta ANTES de ejecución
   - ✅ Persiste approval request en BD
   - ✅ WebSocket notifica al usuario
   - ❌ NO ejecutar tool sin aprobación explícita

3. **Event Sourcing**
   - ✅ Append-only log en `message_events`
   - ✅ Atomic sequences vía Redis INCR
   - ✅ BullMQ para async processing
   - ❌ NO escribir eventos directamente sin sequence number

4. **Stop Reason Pattern**
   - ✅ `stop_reason='tool_use'` → continuar loop
   - ✅ `stop_reason='end_turn'` → terminar loop
   - ✅ `stop_reason='max_tokens'` → warning + terminar
   - ❌ NO ignorar stop_reason (puede causar loops infinitos)

### Performance y Rate Limiting

**BullMQ Configuration**:
- `QUEUE_MAX_JOBS_PER_SESSION=100` (rate limit)
- `QUEUE_RATE_LIMIT_WINDOW_SECONDS=3600` (1 hora)
- `QUEUE_MESSAGE_CONCURRENCY=10` (parallel messages)
- `QUEUE_TOOL_CONCURRENCY=5` (parallel tools)

**Prompt Caching**:
- Habilitado vía `ENABLE_PROMPT_CACHING=true`
- SDK maneja caching automáticamente
- System prompt es marcado como cacheable

**Context Management**:
- `MAX_CONTEXT_TOKENS=100000` (100K limit)
- Truncation automático de historia si excede
- Partial messages incluidos en context

### Known Issues y Workarounds

**Stop Reason Pattern (migration 008)**
- **Issue**: Content-length heuristic era unreliable
- **Fix**: Columna `stop_reason` en `assistant_messages` table
- **Migration**: `008_add_stop_reason_to_assistant_messages.sql`
- **Docs**: `docs/backend/06-sdk-message-structures.md`

**SDK Version**
- **Current**: `@anthropic-ai/sdk@0.68.0`
- **NOT using**: `@anthropic-ai/claude-agent-sdk` (no instalado)

### Verificación de Arquitectura

Antes de implementar cualquier feature, pregúntate:

1. ¿Estoy respetando el manual agentic loop en DirectAgentService?
2. ¿Estoy usando el stop_reason pattern correctamente?
3. ¿Estoy persistiendo eventos en el event store?
4. ¿Estoy usando BullMQ para async processing?

**Si la respuesta a cualquiera es "no", DETENTE y revisa la arquitectura.**

### Documentación de Referencia

- [Backend Architecture Deep Dive](docs/backend/architecture-deep-dive.md) - DirectAgentService, Event Sourcing, BullMQ
- [SDK Message Structures](docs/backend/06-sdk-message-structures.md) - Stop reason pattern, message types
- [WebSocket Contract](docs/backend/websocket-contract.md) - Event streaming, discriminated unions
- [API Reference](docs/backend/api-reference.md) - REST endpoints, error codes

---

## 📦 Convenciones de Dependencias NPM

**⚠️ MUY IMPORTANTE**: Al instalar o actualizar dependencias de npm, **SIEMPRE usa versiones exactas** sin símbolos `^` o `~`.

### Por qué versiones exactas

- **Reproducibilidad**: Garantiza que todos los entornos (dev, CI/CD, producción) usen exactamente las mismas versiones
- **Evita breaking changes**: Previene actualizaciones automáticas que puedan romper el build
- **CI/CD confiable**: npm ci funcionará de forma predecible
- **Debugging más fácil**: Sabes exactamente qué versión está instalada

### Formato correcto

```json
// ✅ CORRECTO - Versiones exactas
{
  "dependencies": {
    "@anthropic-ai/sdk": "0.68.0",
    "express": "5.1.0",
    "bullmq": "5.63.2",
    "socket.io": "4.8.1"
  }
}

// ❌ INCORRECTO - Versiones con rangos
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.68.0",   // NO usar ^
    "express": "~5.1.0",              // NO usar ~
    "bullmq": "^5.63.2",              // NO usar ^
    "socket.io": ">=4.0.0"            // NO usar >=
  }
}
```

### Workflow recomendado

```bash
# 1. Instalar nueva dependencia CON versión exacta
npm install package-name@1.2.3 --save-exact

# 2. O editar package.json manualmente con versión exacta
# Luego borrar package-lock.json y reinstalar
rm package-lock.json
npm install

# 3. Verificar versión instalada
npm list package-name
```

### Actualizar dependencias

Cuando necesites actualizar una dependencia:

1. Revisa el changelog de la nueva versión
2. Actualiza manualmente a la versión exacta en package.json
3. Borra package-lock.json
4. Ejecuta npm install
5. Prueba que todo funcione (npm run build, npm run test)
6. Commitea ambos archivos (package.json + package-lock.json)

---

**Última actualización**: 2025-11-19
- Updated documentation structure to reflect role-based organization (backend/, frontend/, common/)
- Changed from Agent SDK to Direct SDK (@anthropic-ai/sdk@0.68.0)
- Documented DirectAgentService manual agentic loop implementation
- Added Event Sourcing pattern, BullMQ queues, and Stop Reason pattern
- Updated all technology versions (Next.js 16.0.1, React 19.2.0, Express 5.1.0)
- Fixed port configuration (Backend: 3002, Frontend: 3000)
- Removed references to non-existent docs and deprecated approaches
- Updated all documentation file paths to actual locations (101 markdown files)