# System Architecture

## Visión Arquitectónica

BC-Claude-Agent implementa una **arquitectura de microservicios orientada a eventos** con un **sistema de agentes multi-capa** que combina principios de sistemas distribuidos con patrones de IA generativa.

## Principios Arquitectónicos

### 1. Separation of Concerns
Cada capa tiene responsabilidades claras y bien definidas:
- **UI Layer**: Presentación e interacción
- **API Layer**: Comunicación y middleware
- **Agent Layer**: Lógica de negocio e IA
- **Integration Layer**: Conexiones externas
- **Persistence Layer**: Estado y datos

### 2. Modularity & Extensibility
- Componentes intercambiables
- Plugins para nuevas capacidades
- Interface-driven design

### 3. Scalability
- Horizontal scaling en API y agents
- Stateless components donde sea posible
- Cache agresivo para reducir carga

### 4. Resilience
- Fault tolerance en cada layer
- Graceful degradation
- Retry logic y circuit breakers

### 5. Security
- Defense in depth
- Least privilege principle
- Zero trust architecture

## Arquitectura Detallada

### Layer 1: Presentation Layer (Frontend)

```
┌────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                          │
│                      (Next.js 15)                              │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │   Chat UI    │  │ Source       │  │   Approval        │   │
│  │              │  │ Explorer     │  │   Dialogs         │   │
│  │ • Messages   │  │ • Files      │  │ • Change Summary  │   │
│  │ • Input      │  │ • DB         │  │ • Approve/Reject  │   │
│  │ • Streaming  │  │ • MCP        │  │ • Rollback        │   │
│  └──────────────┘  └──────────────┘  └───────────────────┘   │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │ To-Do List   │  │ Context      │  │   Session         │   │
│  │ Viewer       │  │ Panel        │  │   Manager         │   │
│  │              │  │ • Drag&Drop  │  │ • History         │   │
│  │ • Progress   │  │ • Active     │  │ • Fork            │   │
│  │ • Status     │  │ • Sources    │  │ • Resume          │   │
│  └──────────────┘  └──────────────┘  └───────────────────┘   │
│                                                                │
│  State Management: Zustand                                    │
│  Data Fetching: React Query                                   │
│  Real-time: Socket.IO Client                                  │
└────────────────────────────────────────────────────────────────┘
```

**Responsabilidades**:
- Renderizado de UI
- Gestión de estado local
- Comunicación con API
- Streaming de respuestas
- Interacciones de usuario

**Patrones Implementados**:
- Component-based architecture
- Hooks para lógica reutilizable
- Server Components para SSR
- Client Components para interactividad

### Layer 2: API Gateway Layer

```
┌────────────────────────────────────────────────────────────────┐
│                    API GATEWAY LAYER                           │
│              (Next.js API + Express)                           │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Next.js API Routes (Ligeras)                                 │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  /api/health          → Health check                 │     │
│  │  /api/auth/*          → Authentication               │     │
│  │  /api/static/*        → Datos estáticos              │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Express Server (Lógica Compleja)                             │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  POST /api/agent/chat        → Send message          │     │
│  │  WS   /api/agent/stream      → Stream responses      │     │
│  │  POST /api/session/create    → Create session        │     │
│  │  GET  /api/session/:id       → Get session           │     │
│  │  POST /api/session/:id/fork  → Fork session          │     │
│  │  GET  /api/bc/entities       → List BC entities      │     │
│  │  POST /api/approval/request  → Request approval      │     │
│  │  POST /api/approval/:id/...  → Approve/reject        │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Middleware Stack                                             │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  1. CORS                                             │     │
│  │  2. Rate Limiting                                    │     │
│  │  3. Authentication (JWT)                             │     │
│  │  4. Authorization (Permissions)                      │     │
│  │  5. Request Validation (Zod)                         │     │
│  │  6. Logging (Winston)                                │     │
│  │  7. Error Handling                                   │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

**Responsabilidades**:
- Routing de requests
- Autenticación y autorización
- Validación de input
- Rate limiting
- Logging y monitoring
- WebSocket para streaming

### Layer 3: Agent Orchestration Layer

```
┌────────────────────────────────────────────────────────────────┐
│              AGENT ORCHESTRATION LAYER                         │
│                  (Claude SDK + Custom)                         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                 Main Orchestrator Agent                        │
│  ┌──────────────────────────────────────────────────────┐     │
│  │                                                       │     │
│  │  Input: User message + context                       │     │
│  │                                                       │     │
│  │  Core Capabilities:                                  │     │
│  │  • Intent Analysis                                   │     │
│  │  • Task Planning & Decomposition                     │     │
│  │  • Subagent Delegation                              │     │
│  │  • Context Management                                │     │
│  │  • Progress Tracking                                 │     │
│  │  • Error Recovery                                    │     │
│  │                                                       │     │
│  │  Output: Structured plan + subagent invocations      │     │
│  └──────────────────────────────────────────────────────┘     │
│                           │                                    │
│                           ▼                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │            Specialized Subagents                       │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │                                                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │   │
│  │  │ BC Query     │  │ BC Write     │  │  Analysis   │ │   │
│  │  │ Agent        │  │ Agent        │  │  Agent      │ │   │
│  │  │              │  │              │  │             │ │   │
│  │  │ • Read ops   │  │ • Create     │  │ • Data viz  │ │   │
│  │  │ • Filters    │  │ • Update     │  │ • Insights  │ │   │
│  │  │ • Joins      │  │ • Delete     │  │ • Reports   │ │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │   │
│  │                                                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │   │
│  │  │ Validation   │  │ Transform    │  │  Approval   │ │   │
│  │  │ Agent        │  │ Agent        │  │  Agent      │ │   │
│  │  │              │  │              │  │             │ │   │
│  │  │ • Schema     │  │ • ETL        │  │ • Summarize │ │   │
│  │  │ • Business   │  │ • Format     │  │ • Request   │ │   │
│  │  │ • Data       │  │ • Map        │  │ • Track     │ │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  Agent Communication: Event Bus + Direct Calls                │
│  Memory: CloudMD + Redis Cache                                │
│  Tools: MCP + File System + Code Execution                    │
└────────────────────────────────────────────────────────────────┘
```

**Responsabilidades**:
- Análisis de intenciones
- Planificación de tareas
- Delegación a subagentes
- Orquestación de ejecución
- Gestión de contexto
- Memoria y aprendizaje

**Patrones**:
- Orchestrator-Worker
- Chain of Responsibility
- Strategy (diferentes subagentes)
- Observer (eventos)

### Layer 4: Tool & Integration Layer

```
┌────────────────────────────────────────────────────────────────┐
│            TOOL & INTEGRATION LAYER                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Model Context Protocol (MCP)                                 │
│  ┌──────────────────────────────────────────────────────┐     │
│  │                                                       │     │
│  │  MCP Server (Pre-built, Potente)                    │     │
│  │  ┌─────────────────────────────────────────────┐    │     │
│  │  │                                              │    │     │
│  │  │  Tools Exposed:                             │    │     │
│  │  │  • bc_query_entity                          │    │     │
│  │  │  • bc_create_entity                         │    │     │
│  │  │  • bc_update_entity                         │    │     │
│  │  │  • bc_delete_entity                         │    │     │
│  │  │  • bc_batch_operation                       │    │     │
│  │  │  • bc_execute_transaction                   │    │     │
│  │  │                                              │    │     │
│  │  │  Resources:                                  │    │     │
│  │  │  • Entity schemas                            │    │     │
│  │  │  • API documentation                         │    │     │
│  │  │  • Company data                              │    │     │
│  │  │                                              │    │     │
│  │  │  Prompts:                                    │    │     │
│  │  │  • Query builder assistant                   │    │     │
│  │  │  • Data validation helper                    │    │     │
│  │  └─────────────────────────────────────────────┘    │     │
│  │                                                       │     │
│  │  Connection: stdio / HTTP                            │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Additional Tools                                             │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  • File System (read/write/search)                   │     │
│  │  • Code Execution (sandboxed Python/Node)            │     │
│  │  • Web Search (optional)                             │     │
│  │  • Email/Notifications (optional)                    │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Claude API Client                                            │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  • Message API                                        │     │
│  │  • Streaming                                          │     │
│  │  • Prompt Caching                                     │     │
│  │  • Extended Thinking                                  │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

**Responsabilidades**:
- Exponer tools al agente
- Conectar con Business Central via MCP
- Ejecutar operaciones autorizadas
- Proveer recursos de contexto
- Cachear prompts y resultados

### Layer 5: Persistence & State Layer

```
┌────────────────────────────────────────────────────────────────┐
│           PERSISTENCE & STATE LAYER                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  PostgreSQL (Primary Database)                                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  Tables:                                             │     │
│  │  • users (authentication, roles)                     │     │
│  │  • sessions (chat sessions, metadata)                │     │
│  │  • messages (chat history)                           │     │
│  │  • approvals (pending approvals, decisions)          │     │
│  │  • checkpoints (state snapshots)                     │     │
│  │  • audit_log (all operations)                        │     │
│  │  • memory (agent memory via CloudMD)                 │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Redis (Cache & Queue)                                        │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  • Prompt cache (Claude caching)                     │     │
│  │  • Session cache (active sessions)                   │     │
│  │  • Rate limit counters                               │     │
│  │  • Message queue (async tasks)                       │     │
│  │  • Pub/Sub (real-time events)                        │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  File System                                                  │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  • Uploaded files                                    │     │
│  │  • CloudMD memory files                              │     │
│  │  • Generated reports                                 │     │
│  │  • Checkpoint snapshots                              │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

### Layer 6: External Systems

```
┌────────────────────────────────────────────────────────────────┐
│                   EXTERNAL SYSTEMS                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Microsoft Business Central                                   │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  • OData v4 API (queries)                            │     │
│  │  • REST API (operations)                             │     │
│  │  • OAuth 2.0 (authentication)                        │     │
│  │  • Webhooks (events)                                 │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Anthropic Claude API                                         │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  • Messages API                                       │     │
│  │  • Streaming                                          │     │
│  │  • Models: Sonnet, Opus, Haiku                       │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

## Flujos de Datos

### Flujo de Lectura (Query)

```
User → UI → API → Main Agent → BC Query Subagent → MCP → BC API
                                                             │
                                                             ▼
User ← UI ← API ← Main Agent ← BC Query Subagent ← MCP ← Response
```

### Flujo de Escritura (Create/Update/Delete)

```
User → UI → API → Main Agent → BC Write Subagent
                                      │
                                      ├→ Validation Agent (validate data)
                                      │
                                      ├→ Approval Agent (request approval)
                                      │      │
                                      │      ▼
User ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  Approval Dialog
                                      │
                                      ▼
                               Create Checkpoint
                                      │
                                      ▼
                               MCP → BC API
                                      │
                                      ▼
                             Verify & Confirm
                                      │
                                      ▼
User ← UI ← API ← Main Agent ← Success/Error
```

## Patrones de Comunicación

### Síncrono (Request-Response)
```typescript
// API call simple
const result = await apiClient.post('/api/bc/entities', {
  entity: 'Customer',
  data: {...}
});
```

### Asíncrono (Streaming)
```typescript
// Streaming de respuestas del agente
socket.on('agent:message', (chunk) => {
  appendToChat(chunk);
});

socket.on('agent:todo-update', (todo) => {
  updateTodoList(todo);
});
```

### Event-Driven
```typescript
// Event bus interno
eventBus.on('approval:granted', async (approvalId) => {
  await resumeOperation(approvalId);
});

eventBus.on('checkpoint:created', (checkpointId) => {
  logger.info(`Checkpoint created: ${checkpointId}`);
});
```

## Escalabilidad

### Horizontal Scaling
- **API Layer**: Múltiples instancias detrás de load balancer
- **Agent Layer**: Pool de workers para procesamiento paralelo
- **Database**: Read replicas para queries

### Vertical Scaling
- **Redis**: Clustering para alta disponibilidad
- **PostgreSQL**: Partitioning de tablas grandes

### Caching Strategy
```
L1 Cache: In-memory (Node.js)
    ↓ Miss
L2 Cache: Redis
    ↓ Miss
L3 Cache: Postgres
    ↓ Miss
Source: Business Central API
```

## Seguridad

### Defense in Depth

```
Layer 1: Network (Firewall, VPN)
Layer 2: API Gateway (Rate limiting, CORS)
Layer 3: Authentication (JWT, OAuth)
Layer 4: Authorization (RBAC)
Layer 5: Tool Permissions (Granular per-tool)
Layer 6: Sandboxing (Code execution isolation)
Layer 7: Audit (Log everything)
```

## Monitoreo y Observabilidad

### Logging
```
Application Logs → Winston → File/Console
                           → Elasticsearch (opcional)
```

### Tracing
```
Request → Trace ID (generated)
       → Span per service
       → Jaeger/Zipkin (opcional)
```

### Metrics
```
Business Metrics: Operations/min, Success rate
Technical Metrics: Latency, Error rate, CPU, Memory
```

## Próximos Pasos

- [Distributed Patterns](./02-distributed-patterns.md)
- [Fault Tolerance](./03-fault-tolerance.md)
- [ACI Principles](./04-aci-principles.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
**Autor**: BC-Claude-Agent Team
