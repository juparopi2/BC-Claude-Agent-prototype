# System Overview

## Descripción del Sistema

BC-Claude-Agent es un sistema multi-capa que combina una interfaz de usuario moderna con un backend de agentes de IA para interactuar con Microsoft Business Central de manera inteligente y autónoma.

## Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────────┐
│                     USUARIO FINAL                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  UI LAYER (Next.js 15)                       │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │   Chat     │  │  Drag &    │  │   Approval          │   │
│  │ Interface  │  │   Drop     │  │   System            │   │
│  └────────────┘  └────────────┘  └─────────────────────┘   │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │  Source    │  │  To-Do     │  │   Session           │   │
│  │  Explorer  │  │  Viewer    │  │   Manager           │   │
│  └────────────┘  └────────────┘  └─────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │ API Calls (REST/WebSocket)
┌─────────────────────────▼───────────────────────────────────┐
│              API LAYER (Express + Next.js API)               │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │  Agent     │  │   Session  │  │   Permission        │   │
│  │  Routes    │  │   Routes   │  │   Middleware        │   │
│  └────────────┘  └────────────┘  └─────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│            AGENT ORCHESTRATION LAYER                         │
│  ┌────────────────────────────────────────────────────┐     │
│  │         Main Orchestrator Agent                    │     │
│  │  • Task Planning                                   │     │
│  │  • Subagent Delegation                            │     │
│  │  • Context Management                             │     │
│  └────────────────────────────────────────────────────┘     │
│                          │                                   │
│  ┌───────────────┐  ┌───────────┐  ┌──────────────────┐    │
│  │ BC Query      │  │ BC Write  │  │  Analysis        │    │
│  │ Subagent      │  │ Subagent  │  │  Subagent        │    │
│  └───────────────┘  └───────────┘  └──────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                 TOOL & INTEGRATION LAYER                     │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │    MCP     │  │   Claude   │  │   File System       │   │
│  │   Server   │  │    API     │  │   Tools             │   │
│  │ (Pre-built)│  │            │  │                     │   │
│  └────────────┘  └────────────┘  └─────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│              PERSISTENCE & STATE LAYER                       │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │  Session   │  │ Checkpoint │  │   Memory            │   │
│  │   Store    │  │   Store    │  │   Store (CloudMD)   │   │
│  └────────────┘  └────────────┘  └─────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│           EXTERNAL SYSTEMS                                   │
│  ┌────────────────────────────────────────────────────┐     │
│  │      Microsoft Business Central                    │     │
│  │      • OData API                                   │     │
│  │      • REST API                                    │     │
│  │      • OAuth 2.0 Delegated Permissions            │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

## Componentes Principales

### 1. UI Layer (Frontend)

**Tecnología**: Next.js 15, React 19, TypeScript, Tailwind CSS

**Responsabilidades**:
- Renderizar interfaz conversacional tipo Claude Code
- Gestionar drag & drop de contextos
- Mostrar to-do lists y progreso
- Solicitar aprobaciones al usuario
- Visualizar fuentes de datos (files, DB, MCP entities)
- Manejar sesiones y chat forking

**Componentes Clave**:
- `ChatInterface`: Componente principal de conversación
- `SourceExplorer`: Explorador de fuentes de datos
- `ApprovalDialog`: Sistema de aprobación de cambios
- `TodoViewer`: Visualización de to-do lists
- `ContextPanel`: Panel de drag & drop de contextos
- `SessionManager`: Gestión de sesiones y forks

### 2. API Layer (Backend)

**Tecnología**: Express.js + Next.js API Routes, TypeScript

**Responsabilidades**:
- Exponer endpoints REST para el frontend
- Manejar WebSocket para streaming
- Microsoft OAuth 2.0 authentication (delegated permissions)
- Autorización y middleware de permisos
- Rate limiting y seguridad
- Logging y tracing

**Endpoints Principales**:
```typescript
// Authentication (Microsoft OAuth)
GET    /api/auth/login          // Iniciar flujo OAuth
GET    /api/auth/callback       // Callback OAuth
POST   /api/auth/logout         // Cerrar sesión
GET    /api/auth/me             // Obtener usuario actual
POST   /api/auth/bc-consent     // Solicitar consent BC
POST   /api/auth/bc-refresh     // Refresh token BC

// Agent
POST   /api/agent/chat          // Enviar mensaje al agente
GET    /api/agent/stream        // Stream de respuestas (WebSocket)

// Session
POST   /api/session/create      // Crear nueva sesión
GET    /api/session/:id         // Obtener sesión
POST   /api/session/:id/fork    // Fork de sesión

// Business Central
GET    /api/bc/entities         // Listar entities de BC

// Approval
POST   /api/approval/request    // Solicitar aprobación
POST   /api/approval/:id/approve // Aprobar cambio
```

### 3. Agent Orchestration Layer

**Tecnología**: Claude SDK, TypeScript

**Responsabilidades**:
- Gestionar ciclo de vida del agente
- Planificar tareas complejas
- Delegar a subagentes especializados
- Mantener contexto y memoria
- Ejecutar agentic loop (contexto → acción → verificación)
- Gestionar ejecuciones paralelas

**Patrones Implementados**:
- **Prompt Chaining**: Cadenas de prompts para tareas complejas
- **Routing**: Redirigir a agentes especializados
- **Parallelization**: Ejecutar múltiples operaciones simultáneamente
- **Orchestrator-Worker**: Orquestador que delega a workers
- **Evaluator-Optimizer**: Evaluar resultados y optimizar

### 4. Tool & Integration Layer

**Tecnología**: MCP (Model Context Protocol), Claude API

**Responsabilidades**:
- Exponer herramientas al agente (Tools)
- Proveer recursos de contexto (Resources)
- Ejecutar prompts especializados (Prompts)
- Conectar con Business Central via MCP
- Manejar file system operations
- Ejecutar código en sandbox

**MCP Server Existente**:
El proyecto cuenta con un **MCP server potente pre-construido** que expone:
- CRUD operations en BC entities
- Consultas OData complejas
- Batch operations
- Transacciones
- Webhooks y eventos

### 5. Persistence & State Layer

**Tecnología**: Base de datos (a definir), File System, CloudMD

**Responsabilidades**:
- Persistir sesiones de chat
- Guardar checkpoints para rollback
- Almacenar memoria de agente (CloudMD)
- Cache de prompts y contextos
- Gestionar archivos subidos por usuario

**Stores**:
- **Session Store**: Conversaciones completas
- **Checkpoint Store**: Snapshots de estado
- **Memory Store**: Información de largo plazo (CloudMD)
- **Cache Store**: Prompt cache y resultados

### 6. External Systems

**Microsoft Business Central**:
- Autenticación via OAuth 2.0 (delegated permissions)
- Multi-tenant support (cada usuario accede a su BC tenant)
- API OData v4 para queries
- API REST para operaciones
- Webhooks para eventos
- Integration via MCP
- Tokens BC almacenados cifrados (AES-256-GCM)

## Flujo de Datos Típico

### Ejemplo: "Crear usuario en BC"

```
1. USUARIO → UI Layer
   - Usuario escribe: "Crea un usuario con nombre Juan Pérez"

2. UI Layer → API Layer
   POST /api/agent/chat
   Body: { message: "Crea un usuario...", sessionId: "abc123" }

3. API Layer → Agent Orchestration
   - Valida permisos
   - Carga contexto de sesión
   - Invoca Main Orchestrator Agent

4. Main Orchestrator Agent
   - Analiza intención: "crear_usuario"
   - Crea plan:
     a. Solicitar datos faltantes (email, rol, etc.)
     b. Validar datos
     c. Solicitar aprobación
     d. Ejecutar creación via BC Write Subagent
     e. Confirmar resultado
   - Genera to-do list automático

5. Agent → API Layer
   - Streaming de pensamiento: "Entiendo que quieres crear un usuario..."
   - Pregunta: "¿Qué email y rol debe tener Juan Pérez?"

6. API Layer → UI Layer (WebSocket)
   - UI muestra mensaje en tiempo real
   - UI muestra to-do list generado

7. USUARIO → UI Layer
   - Usuario responde: "Email juan@empresa.com, rol: vendedor"

8. [Flujo se repite hasta tener todos los datos]

9. Main Orchestrator → BC Write Subagent
   - Delega creación al subagente especializado
   - Marca to-do "Validar datos" como completado

10. BC Write Subagent → Tool Layer
    - Prepara llamada a MCP
    - Genera summary de cambios

11. Tool Layer → API Layer → UI Layer
    - Solicita aprobación
    - UI muestra ApprovalDialog con:
      * "Crear usuario: Juan Pérez"
      * Email: juan@empresa.com
      * Rol: vendedor
      * [Aprobar] [Rechazar]

12. USUARIO aprueba

13. BC Write Subagent → MCP Server → Business Central
    - Ejecuta creación via OData API
    - Crea checkpoint antes de ejecutar

14. Business Central → MCP → Subagent
    - Respuesta: Usuario creado con ID 12345

15. Subagent → Main Orchestrator → API → UI
    - "Usuario Juan Pérez creado exitosamente con ID 12345"
    - To-do "Ejecutar creación" marcado como completado
    - To-do "Confirmar resultado" marcado como completado
```

## Patrones de Comunicación

### Síncrona (Request-Response)
Usado para:
- Autenticación
- Consultas simples
- Validaciones
- CRUD operations

### Asíncrona (Streaming)
Usado para:
- Respuestas del agente
- Thinking mode visible
- Progress updates
- To-do list updates

### Event-Driven
Usado para:
- Webhooks de BC
- Notificaciones de sistema
- Cambios de estado
- Triggers de automatización

## Escalabilidad y Resiliencia

### Horizontal Scaling
- API Layer puede escalar horizontalmente
- Agents stateless (estado en Persistence Layer)
- Load balancing con session affinity

### Fault Tolerance
- Checkpoints antes de operaciones críticas
- Rollback automático en caso de error
- Retry logic con exponential backoff
- Circuit breaker para BC API

### Graceful Degradation
- Fallback a operaciones simples si subagentes fallan
- Modo offline con queue de operaciones
- Cache de respuestas frecuentes

## Seguridad

### Capas de Seguridad
1. **Autenticación**: Microsoft Entra ID OAuth 2.0 (delegated permissions)
2. **Autorización**: RBAC (Role-Based Access Control)
3. **Token Encryption**: AES-256-GCM para tokens BC
4. **Tool Permissions**: Permisos granulares por herramienta
5. **Sandboxing**: Código ejecutado en entorno aislado
6. **Rate Limiting**: Prevención de abuso
7. **Input Validation**: Anti-prompt injection

## Observabilidad

### Logging
- Structured logs (JSON)
- Log levels: DEBUG, INFO, WARN, ERROR
- Correlation IDs para tracing

### Tracing
- Distributed tracing con spans
- Visualización de flujo completo
- Performance metrics

### Monitoring
- Health checks
- Métricas de negocio (operaciones/min)
- Métricas técnicas (latency, error rate)
- Alertas automáticas

## Próximos Pasos

Ver documentación específica de cada layer:
- [Arquitectura Detallada](../01-architecture/01-system-architecture.md)
- [Sistema de Agentes](../03-agent-system/01-agentic-loop.md)
- [Integraciones](../04-integrations/01-mcp-overview.md)
- [UI/UX](../10-ui-ux/01-interface-design.md)
- [Backend](../11-backend/01-api-architecture.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
**Autor**: BC-Claude-Agent Team
