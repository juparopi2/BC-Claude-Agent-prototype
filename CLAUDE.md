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

**Estado actual**: Phase 2 - Week 7 (95% MVP Complete)

---

## 📚 CÓMO USAR LA DOCUMENTACIÓN

**⚠️ NUEVA ESTRUCTURA DE DOCUMENTACIÓN** (2025-11-12):

La documentación ha sido completamente reestructurada para reflejar el estado actual del proyecto y todas las decisiones arquitectónicas. **La documentación anterior se encuentra en `docs-old/` como referencia histórica.**

### Índice Maestro

**`docs/README.md`** es el **índice maestro** de toda la documentación. **Lee este archivo PRIMERO** antes de trabajar en cualquier feature.

### Documentos Críticos (LEER ANTES DE IMPLEMENTAR)

Antes de hacer cambios significativos, **SIEMPRE lee estos documentos**:

1. **`docs/README.md`** - Índice completo, quick navigation, update protocol
2. **`docs/13-roadmap/07-direction-changes.md`** - 8 cambios arquitectónicos mayores, por qué se hicieron
3. **`docs/02-core-concepts/07-sdk-first-philosophy.md`** - Principios SDK-first (PERMANENTE)
4. **`docs/01-architecture/01-system-architecture.md`** - Arquitectura actual con diagramas Mermaid
5. **`docs/08-state-persistence/10-database-schema.md`** - Schema completo (DDL + ER diagrams + queries)
6. **`docs/14-deprecated/`** - 4 approaches deprecados (NO reimplementar)

### Cuándo Consultar Cada Sección

| Tarea | Documentos a Leer |
|-------|-------------------|
| **Implementar agent features** | `02-core-concepts/07-sdk-first-philosophy.md`, `03-agent-system/01-agentic-loop.md` |
| **Cambiar base de datos** | `08-state-persistence/10-database-schema.md` |
| **Modificar autenticación** | `07-security/06-microsoft-oauth-setup.md`, `14-deprecated/01-jwt-authentication.md` |
| **Agregar endpoints** | `11-backend/01-api-architecture.md`, `11-backend/08-direct-agent-service.md` |
| **Crear recursos Azure** | `02-core-concepts/05-AZURE_NAMING_CONVENTIONS.md` |
| **Entender decisiones pasadas** | `13-roadmap/07-direction-changes.md` |

### Protocolo de Actualización de Documentación

**CADA VEZ QUE HAGAS UN CAMBIO SIGNIFICATIVO**:

1. ✅ **Actualiza el documento relevante** en `docs/XX-section/`
2. ✅ **Actualiza `docs/README.md`** si cambia la estructura
3. ✅ **Actualiza `TODO.md`** para reflejar progreso
4. ✅ **Actualiza `CLAUDE.md`** si cambian las instrucciones generales
5. ✅ **Agrega a `13-roadmap/07-direction-changes.md`** si es decisión arquitectónica
6. ✅ **Agrega a `14-deprecated/`** si deprecas un approach

**Regla de Oro**: "Si hiciste un cambio arquitectónico y NO actualizaste `docs/13-roadmap/07-direction-changes.md`, NO has terminado."

### Estructura de Carpetas docs/

```
docs/
├── README.md                      ⭐ ÍNDICE MAESTRO - LEE PRIMERO
├── 00-overview/                   Visión del proyecto, tech stack
├── 01-architecture/               ⭐ Arquitectura actual, diagramas
├── 02-core-concepts/              ⭐ SDK-first philosophy, fundamentals
├── 03-agent-system/               Agentic loop, DirectAgentService
├── 04-integrations/               MCP, BC integration
├── 05-control-flow/               Approvals, human-in-the-loop
├── 06-observability/              Logging, metrics, todos
├── 07-security/                   ⭐ OAuth, token encryption
├── 08-state-persistence/          ⭐ Database schema, sessions
├── 09-performance/                Optimización, caching
├── 10-ui-ux/                      Frontend components, design
├── 11-backend/                    ⭐ DirectAgentService, API endpoints
├── 12-development/                Setup, workflow, testing
├── 13-roadmap/                    ⭐ Direction changes, MVP definition
└── 14-deprecated/                 ⭐ Approaches deprecados (NO usar)

docs-old/                          📦 Backup (referencia histórica)
```

**⭐ = Documentos de alta prioridad, leer frecuentemente**

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

**Estado**: Inicializado (Next.js 16 + React 19 + Tailwind CSS 4)

Frontend Next.js con App Router que incluirá:
- Chat interface tipo Claude Code
- Panel de aprobaciones (Human-in-the-Loop)
- Panel de To-Do Lists
- Source panel
- WebSocket client

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

**⚠️ ESTRUCTURA ACTUALIZADA (2025-11-12)**:

- **`docs/`** - Nueva documentación (95% MVP, estado actual)
- **`docs-old/`** - Backup (referencia histórica)

**SIEMPRE lee `docs/README.md` PRIMERO** - Es el índice maestro con navegación completa.

### Documentos Más Importantes

**Lee estos ANTES de implementar cualquier feature**:

1. **`docs/README.md`** ⭐ - Índice completo, quick navigation, cuándo leer qué
2. **`docs/13-roadmap/07-direction-changes.md`** ⭐ - 8 cambios arquitectónicos (por qué se hicieron)
3. **`docs/02-core-concepts/07-sdk-first-philosophy.md`** ⭐ - Principios SDK-first (PERMANENTE)
4. **`docs/01-architecture/01-system-architecture.md`** ⭐ - Arquitectura con diagramas Mermaid
5. **`docs/08-state-persistence/10-database-schema.md`** ⭐ - Schema completo (DDL + ER + queries)
6. **`docs/11-backend/08-direct-agent-service.md`** ⭐ - Workaround SDK bug (agent execution)
7. **`docs/14-deprecated/`** ⭐ - Approaches deprecados (JWT, Orchestrator, Git Submodule, Global BC)

### Carpetas de Documentación (15 secciones)

- **00-overview/** - Visión del proyecto, tech stack summary
- **01-architecture/** ⭐ - System architecture, diagramas actuales, fault tolerance
- **02-core-concepts/** ⭐ - SDK-first philosophy, agent fundamentals, Azure conventions
- **03-agent-system/** - Agentic loop, DirectAgentService, specialized agents
- **04-integrations/** - MCP (vendored), BC integration (per-user tokens)
- **05-control-flow/** - Human-in-the-loop, approvals (priority + expiration)
- **06-observability/** - Logging, metrics, todo automation
- **07-security/** ⭐ - Microsoft OAuth, token encryption (AES-256-GCM), BC multi-tenant
- **08-state-persistence/** ⭐ - Database schema (11/15 tables), session cookies vs JWT
- **09-performance/** - Prompt caching, optimization strategies
- **10-ui-ux/** - Frontend design, shadcn/ui components
- **11-backend/** ⭐ - DirectAgentService, OAuth flow, API architecture
- **12-development/** - Setup guide, exact NPM versions, workflow
- **13-roadmap/** ⭐ - Direction changes (8 pivots), MVP definition, phases
- **14-deprecated/** ⭐ - JWT auth, Custom orchestrator, Git submodule, Global BC credentials

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

### Backend (Express - en construcción)
```bash
cd backend
npm install         # Instalar dependencias
npm run dev         # Dev server (puerto 3001)
npm run migrate     # Migrations de BD
npm run seed        # Seed de datos demo
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
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
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

**Sistema basado en Claude Agent SDK**:
1. **Frontend**: Next.js con chat interface + WebSocket client
2. **API Layer**: Express server con Socket.IO
3. **Agent Layer**: Claude Agent SDK con specialized agents (via system prompts)
   - QueryAgent: System prompt para queries
   - WriteAgent: System prompt + approval hooks
   - ValidationAgent: Read-only mode
4. **Integration Layer**: SDK conecta automáticamente con MCP → Business Central API
5. **Persistence**: Azure SQL + Redis

**Flujo típico de escritura con SDK**:
```
Usuario → Chat → WebSocket → Agent SDK query() →
SDK detecta bc_create tool → onPreToolUse hook →
Approval Request → Usuario Aprueba → SDK ejecuta tool automáticamente →
MCP → Business Central → SDK streamea resultado → Usuario
```

**Documentos de arquitectura detallada**:
- [Agent SDK Usage Guide](docs/02-core-concepts/06-agent-sdk-usage.md) - **NUEVO**
- [Agentic Loop with SDK](docs/03-agent-system/01-agentic-loop.md) - **ACTUALIZADO**
- [Orchestration with SDK](docs/03-agent-system/02-orchestration.md) - **ACTUALIZADO**

---

## 🎓 Contexto del Proyecto

**Objetivo**: Crear un sistema de agentes AI (inspirado en Claude Code) que permite interactuar con Microsoft Business Central mediante lenguaje natural, con aprobaciones humanas para operaciones críticas, to-do lists automáticos, y streaming en tiempo real.

**Tecnologías principales**:
- **LLM**: **Claude Agent SDK** (@anthropic-ai/claude-agent-sdk) - Framework oficial con agentic loop, tool calling y streaming built-in
- **Integration**: Model Context Protocol (MCP) con servidor pre-existente
- **Frontend**: Next.js 15 + React 19 + Tailwind CSS 4 + shadcn/ui
- **Backend**: Express + TypeScript + Socket.IO
- **Database**: Azure SQL + Redis
- **Cloud**: Azure (Container Apps, Key Vault, etc.)

**Timeline MVP**: 6-9 semanas divididas en 3 fases (ver TODO.md)

**⚠️ IMPORTANTE**: Usamos Claude Agent SDK en lugar de construir un sistema de agentes desde cero. Esto ahorra ~1.5 semanas de desarrollo.

---

## 📌 Recordatorios Importantes

1. **TODO.md es la fuente de verdad** - Consúltalo y actualízalo constantemente
2. **docs/README.md es el índice maestro** - Lee PRIMERO antes de cualquier feature. Navega la documentación desde ahí
3. **Actualiza la documentación SIEMPRE** - Cambio arquitectónico → actualizar `docs/13-roadmap/07-direction-changes.md`. Deprecar approach → agregar a `docs/14-deprecated/`
4. **Claude Agent SDK** - NO construyas sistema de agentes custom. Usa el SDK oficial de Anthropic (ver `docs/02-core-concepts/07-sdk-first-philosophy.md`)
5. **DirectAgentService es el workaround actual** - NO bypasear el SDK, este es SDK-compliant (ver `docs/11-backend/08-direct-agent-service.md`)
6. **Azure Naming Conventions** - Consulta `docs/02-core-concepts/05-AZURE_NAMING_CONVENTIONS.md` ANTES de crear recursos en Azure. Usa el comando `az` CLI
7. **MCP Server vendoreado** - 115 archivos en `backend/mcp-server/data/`. NO usar git submodule (deprecado, ver `docs/14-deprecated/03-git-submodule-mcp.md`)
8. **Business Central** - Per-user tokens (delegated), NO global credentials (deprecado, ver `docs/14-deprecated/04-global-bc-credentials.md`)
9. **Authentication** - Microsoft OAuth 2.0, NO JWT (deprecado, ver `docs/14-deprecated/01-jwt-authentication.md`)
10. **Azure Secrets** - Todos los secrets en Key Vault, nunca en código
11. **Database Schema** - Consulta `docs/08-state-persistence/10-database-schema.md` ANTES de modificar BD
12. **Tests** - No hay tests todavía, se implementarán en Phase 3 (ver TODO.md)
13. **Dependencias NPM** - **SIEMPRE usa versiones exactas** (sin `^` ni `~`) en package.json

---

## 🔥 Filosofía SDK-First - Escrito Sobre Piedra

**⚠️ REGLA DE ORO**: El Claude Agent SDK es la **máxima prioridad** y **fuente de verdad** de este proyecto. NUNCA bypasees el SDK con soluciones custom.

### Principio Fundamental

> "Si hay un problema con el SDK y tenemos que sacrificar nuestra lógica, nuestro código o nuestra implementación, con el beneficio de utilizar el SDK, estamos dispuestos a hacerlo. No debemos pasar por alto el SDK solo porque no funciona y crear una solución por nuestra cuenta."

### Qué Proporciona el SDK (NO reconstruir)

El SDK ya incluye estas capacidades **built-in**:

1. **Agentic Loop Automático** (Think → Act → Verify → Repeat)
   - NO implementes loops manuales
   - El SDK maneja iteraciones automáticamente

2. **Tool Calling Nativo**
   - Descubrimiento automático de tools vía MCP
   - Ejecución automática de tools
   - Manejo de errores integrado

3. **Context Management**
   - Session persistence vía `resume` parameter
   - Automatic context window management
   - Built-in memory across turns

4. **Streaming Built-in**
   - Real-time event streaming
   - Partial message support vía `includePartialMessages: true`

5. **Prompt Caching Automático**
   - SDK cachea prompts automáticamente
   - NO necesitas habilitar manualmente `promptCaching`
   - Reducción de costos y latencia transparente

6. **TodoWrite Tool Nativo**
   - SDK genera TODOs automáticamente para tareas complejas
   - Intercepta eventos, no reimplementes la generación

### Qué Construimos Nosotros (Capa de aplicación)

Nuestra responsabilidad es la **capa de aplicación** sobre el SDK:

1. **Specialized Agents** (vía `agents` config)
   - Descripciones concisas para routing
   - System prompts específicos de dominio (Business Central)
   - NO especifiques `tools` arrays - permite acceso a todos los tools

2. **Human-in-the-Loop** (vía `canUseTool` hook)
   - Intercepta write operations para aprobación
   - Return `{ behavior: 'deny' }` si no hay aprobación
   - NO bypasees el SDK ejecutando tools manualmente

3. **Event Streaming** (vía query stream)
   - Consume eventos del SDK (`agent:tool_use`, `agent:message_chunk`, etc.)
   - Propaga eventos al frontend via WebSocket
   - NO reimplementes el streaming

4. **Database Persistence** (nuestra lógica)
   - Intercepta eventos del SDK (`TodoWrite`, approvals)
   - Persiste en Azure SQL
   - NO reimplementes generación de datos que el SDK ya hace

### Arquitectura SDK-Compliant

```typescript
// ✅ CORRECTO - Usa SDK query() con configuración
const result = query({
  prompt,
  options: {
    mcpServers,              // MCP auto-discovery
    model: 'claude-sonnet-4-5',
    resume: sessionId,        // Session persistence
    maxTurns: 20,            // Safety limit
    agents: {                // Specialized routing
      'bc-query': {
        description: 'Query Business Central data',  // Conciso
        prompt: `System prompt...`,
        // NO tools array - permite MCP tools
      }
    },
    canUseTool: async (...) => { /* Approval logic */ },
  }
});

// ❌ INCORRECTO - Custom agentic loop
while (shouldContinue) {
  const response = await callClaude();  // NO hagas esto
  if (needsTool) {
    await executeTool();                // SDK lo hace automáticamente
  }
}
```

### Best Practices SDK

1. **Agents Configuration**
   - ✅ Descriptions: Concisas (≤8 palabras) para routing
   - ✅ Prompts: Detallados con instrucciones de dominio
   - ❌ NO uses `tools: ['Read', 'Grep']` - bloquea MCP tools
   - ✅ Omite `tools` array para acceso completo

2. **Hook Callbacks**
   - ✅ Usa `canUseTool` para control de permisos
   - ✅ Return `PermissionResult` según la firma del SDK
   - ❌ NO ejecutes tools manualmente fuera del SDK
   - ✅ Usa `hooks: { PostToolUse }` para reaccionar a resultados

3. **MCP Integration**
   - ✅ Format: `{ 'server-name': { type: 'sse', url: '...' } }`
   - ✅ SDK auto-discover tools con prefijo `mcp__server-name__tool`
   - ❌ NO llames MCP directamente - deja que el SDK lo haga
   - ✅ Confía en el SDK para ejecutar tools MCP

4. **Performance**
   - ✅ Usa `maxTurns` para límites de seguridad
   - ✅ Caching es automático (no configurable)
   - ✅ System prompt es manejado internalmente por Claude Code
   - ❌ NO intentes configurar caching manualmente

### Known Issues y Workarounds

**ProcessTransport Error (v0.1.29)**
- **Issue**: "Claude Code process exited with code 1"
- **Causa**: Bug conocido con MCP servers vía SSE
- **Fix**: Update a SDK v0.1.30+ donde fue resuelto
- **GitHub**: Issues #176, #4619

**Minimum SDK Version**
- **Requerido**: `@anthropic-ai/claude-agent-sdk@0.1.30` o superior
- **Razón**: Fixes critical ProcessTransport bugs con MCP

### Verificación de Compliance

Antes de implementar cualquier feature, pregúntate:

1. ¿Estoy reimplementando algo que el SDK ya hace?
2. ¿Estoy bloqueando capacidades del SDK (como restricting tools)?
3. ¿Estoy siguiendo las firmas de tipos del SDK exactamente?
4. ¿Hay una manera de hacer esto MÁS alineada con el SDK?

**Si la respuesta a 1 o 2 es "sí", DETENTE y refactoriza para usar el SDK correctamente.**

### Documentación de Referencia

- SDK Official Docs: https://docs.claude.com/en/docs/agent-sdk/typescript
- Agent SDK Usage Guide: `docs/02-core-concepts/06-agent-sdk-usage.md`
- Agentic Loop with SDK: `docs/03-agent-system/01-agentic-loop.md`

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
    "@anthropic-ai/claude-agent-sdk": "0.1.29",
    "@anthropic-ai/sdk": "0.68.0",
    "zod": "3.25.76",
    "express": "5.1.0"
  }
}

// ❌ INCORRECTO - Versiones con rangos
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.29",  // NO usar ^
    "@anthropic-ai/sdk": "~0.68.0",               // NO usar ~
    "zod": "^3.25.76",                            // NO usar ^
    "express": ">=5.0.0"                          // NO usar >=
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

**Última actualización**: 2025-11-10
- Added SDK-First Philosophy section (permanent guidelines)
- Updated to SDK v0.1.30 (fixes ProcessTransport bugs)
- Never use any. Lint breaks because of that