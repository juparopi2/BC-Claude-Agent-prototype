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

**Estado actual**: Phase 1 - Week 1 en progreso (ver TODO.md para detalles)

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
- Autenticación JWT
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

**Ubicación**: `docs/`

La carpeta `docs/` contiene documentación técnica completa organizada en carpetas temáticas:

### Carpetas de Documentación

- **`00-overview/`** - Visión del proyecto, overview del sistema, tech stack
- **`01-architecture/`** - Arquitectura del sistema, patrones distribuidos, fault tolerance, principios ACI
- **`02-core-concepts/`** - Conceptos fundamentales de agentes, LLM enhancements, patrones de diseño, convenciones de Azure
- **`03-agent-system/`** - Agentic loop, orchestration, memory, context management, subagents
- **`04-integrations/`** - MCP overview, integración con Business Central
- **`05-control-flow/`** - Human-in-the-loop, permisos, hooks, error recovery
- **`06-observability/`** - Logging, tracing, metrics, monitoring, todo lists
- **`07-security/`** - Permisos de tools, seguridad
- **`08-state-persistence/`** - Checkpoints, sessions, state management
- **`09-performance/`** - Prompt caching, optimizaciones, token management
- **`10-ui-ux/`** - Diseño de interfaz, componentes, design system
- **`11-backend/`** - Arquitectura backend, Express setup, API endpoints
- **`12-development/`** - Setup guide, workflow, coding standards, testing strategy
- **`13-implementation-roadmap/`** - Definición MVP, fases de implementación, checklist

**Documentos clave para consultar frecuentemente**:
- Arquitectura: `docs/01-architecture/01-system-architecture.md`
- Agentic Loop: `docs/03-agent-system/01-agentic-loop.md`
- MCP Integration: `docs/04-integrations/01-mcp-overview.md`
- Human-in-the-Loop: `docs/05-control-flow/01-human-in-the-loop.md`
- MVP Definition: `docs/13-implementation-roadmap/01-mvp-definition.md`

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
PORT=3001
DATABASE_URL=<from Azure Key Vault>
REDIS_URL=<from Azure Key Vault>
ANTHROPIC_API_KEY=<from Azure Key Vault>
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0
BC_TENANT_ID=<from Azure Key Vault>
BC_CLIENT_ID=<from Azure Key Vault>
BC_CLIENT_SECRET=<from Azure Key Vault>
MCP_SERVER_URL=https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp
JWT_SECRET=<from Azure Key Vault>
```

**Nota**: Los secrets se almacenan en Azure Key Vault. Ver `infrastructure/deploy-azure-resources.sh` y TODO.md sección 1.1.

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
2. **Claude Agent SDK** - NO construyas sistema de agentes custom. Usa el SDK oficial de Anthropic
3. **Azure Naming Conventions** - Consulta `docs/02-core-concepts/05-AZURE_NAMING_CONVENTIONS.md` ANTES de crear recursos en Azure. Usa el comando `az` CLI
4. **MCP Server ya existe** - No hay que crearlo, solo conectarse via SDK
5. **Business Central** - Todas las operaciones de escritura requieren aprobación del usuario (usa hooks del SDK)
6. **Documentación actualizada** - Consulta `docs/02-core-concepts/06-agent-sdk-usage.md` PRIMERO antes de implementar agentes
7. **Azure Secrets** - Todos los secrets en Key Vault, nunca en código
8. **Tests** - No hay tests todavía, se implementarán en Phase 3 (ver TODO.md)
9. **Dependencias NPM** - **SIEMPRE usa versiones exactas** (sin `^` ni `~`) en package.json

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

**Última actualización**: 2025-10-28
- Never use any. Lint breaks because of that