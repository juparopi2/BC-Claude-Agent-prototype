# BC-Claude-Agent-Prototype - Implementation TODO List

> **Timeline**: 6-9 semanas para MVP completo (según @docs\13-implementation-roadmap\01-mvp-definition.md)
>
> **Estado Actual**: Iniciando Phase 1 - Foundation (Week 1)

---

## 📋 Estado General

### ✅ Completado
- [x] Documentación completa (74 archivos)
- [x] Frontend base inicializado (Next.js 16 + React 19 + Tailwind CSS 4)
- [x] Resource Groups de Azure creados
- [x] Script de deployment de Azure infraestructura creado
- [x] MCP Server ya desplegado y accesible

### 🔄 En Progreso
- [ ] **PHASE 1: Foundation** (Semanas 1-3)

### ⏳ Pendiente
- [ ] PHASE 2: MVP Core Features (Semanas 4-7)
- [ ] PHASE 3: Polish & Testing (Semanas 8-9)

---

## 🎯 PHASE 1: Foundation (Semanas 1-3)

**Referencias**:
- @docs\13-implementation-roadmap\02-phase-1-foundation.md
- @docs\11-backend\01-backend-architecture.md
- @docs\12-development\01-setup-guide.md

**Objetivo**: Establecer infraestructura base y conectividad fundamental

---

### ✅ **Week 1: Project Setup** (Semana 1)

#### 1.1 Azure Infrastructure
**Referencias**: @docs\02-core-concepts\05-AZURE_NAMING_CONVENTIONS.md

- [x] Resource Groups verificados (rg-BCAgentPrototype-{app|data|sec}-dev)
- [x] Script de deployment creado (`infrastructure/deploy-azure-resources.sh`)
- [ ] **Ejecutar script de deployment**
  - [ ] Crear Key Vault (`kv-bcagent-dev`)
  - [ ] Crear Managed Identities (`mi-bcagent-backend-dev`, `mi-bcagent-frontend-dev`)
  - [ ] Crear Azure SQL Server (`sqlsrv-bcagent-dev`)
  - [ ] Crear SQL Database (`sqldb-bcagent-dev`)
  - [ ] Crear Redis Cache (`redis-bcagent-dev`)
  - [ ] Crear Storage Account (`sabcagentdev`)
  - [ ] Crear Container Registry (`crbcagentdev`)
  - [ ] Crear Container Apps Environment (`cae-bcagent-dev`)
- [ ] **Configurar secrets en Key Vault**
  - [ ] BC-TenantId (ya tenemos)
  - [ ] BC-ClientId (ya tenemos)
  - [ ] BC-ClientSecret (ya tenemos)
  - [ ] Claude-ApiKey (MANUAL - pendiente de agregar)
  - [ ] JWT-Secret (generado por script)
  - [ ] SqlDb-ConnectionString (generado por script)
  - [ ] Redis-ConnectionString (generado por script)

#### 1.2 Backend Project Setup
**Referencias**:
- @docs\11-backend\02-express-setup.md
- @docs\11-backend\03-api-endpoints.md
- @docs\02-core-concepts\03-tech-stack.md

- [ ] **Inicializar proyecto backend**
  ```bash
  mkdir backend
  cd backend
  npm init -y
  npm install express socket.io mssql redis @anthropic-ai/sdk @modelcontextprotocol/sdk
  npm install -D typescript @types/node @types/express ts-node nodemon
  ```
- [ ] **Configurar TypeScript** (`backend/tsconfig.json`)
- [ ] **Crear estructura de directorios**
  ```
  backend/
  ├── src/
  │   ├── server.ts
  │   ├── config/
  │   ├── routes/
  │   ├── services/
  │   ├── models/
  │   ├── middleware/
  │   └── types/
  ├── scripts/
  │   └── init-db.sql
  └── .env.example
  ```
- [ ] **Crear archivo de configuración** (`backend/src/config/`)
  - [ ] database.ts (Azure SQL)
  - [ ] redis.ts (Redis)
  - [ ] keyvault.ts (Key Vault client)
  - [ ] environment.ts (variables de entorno)

#### 1.3 Database Schema
**Referencias**: @docs\08-state-persistence\03-session-persistence.md

- [ ] **Crear script de inicialización** (`backend/scripts/init-db.sql`)
  - [ ] Tabla `users` (id, email, password_hash, created_at)
  - [ ] Tabla `sessions` (id, user_id, title, created_at, updated_at)
  - [ ] Tabla `messages` (id, session_id, role, content, created_at)
  - [ ] Tabla `approvals` (id, session_id, message_id, action_description, status, decided_at)
  - [ ] Tabla `checkpoints` (id, session_id, checkpoint_data, created_at)
  - [ ] Tabla `audit_log` (id, user_id, session_id, action, details, created_at)
- [ ] **Ejecutar script en Azure SQL Database**
- [ ] **Crear seed data para testing** (`backend/scripts/seed-data.sql`)

#### 1.4 Frontend Dependencies
**Referencias**: @docs\10-ui-ux\02-component-library.md

- [ ] **Instalar dependencias adicionales**
  ```bash
  cd frontend
  npm install socket.io-client zustand @tanstack/react-query lucide-react
  npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu
  ```
- [ ] **Configurar shadcn/ui**
  ```bash
  npx shadcn@latest init
  npx shadcn@latest add button card dialog input textarea scroll-area separator avatar badge
  ```
- [ ] **Crear archivos de configuración**
  - [ ] `frontend/.env.local.example`
  - [ ] `frontend/lib/api.ts` (API client)
  - [ ] `frontend/lib/socket.ts` (Socket.IO client)

---

### 🔄 **Week 2: MCP Integration & Authentication** (Semana 2)

#### 2.1 MCP Integration
**Referencias**:
- @docs\04-integrations\01-mcp-overview.md
- @docs\04-integrations\02-bc-integration.md

**MCP Server URL**: https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp

- [ ] **Instalar MCP SDK** (ya incluido en package.json)
- [ ] **Crear MCP Client wrapper** (`backend/src/services/mcp/MCPClient.ts`)
  - [ ] Conectar al MCP server existente
  - [ ] Implementar método `listTools()`
  - [ ] Implementar método `callTool(name, args)`
  - [ ] Implementar error handling
  - [ ] Implementar retry logic
- [ ] **Crear BC Client wrapper** (`backend/src/services/bc/BCClient.ts`)
  - [ ] Wrapper para operaciones de Business Central
  - [ ] Métodos: query, create, update, delete
  - [ ] Autenticación OAuth con BC credentials del Key Vault
- [ ] **Testing de conectividad**
  - [ ] Test: Listar herramientas disponibles en MCP
  - [ ] Test: Ejecutar `bc_query_entity` para leer Customers
  - [ ] Test: Ejecutar `bc_create_entity` en ambiente de prueba

#### 2.2 Authentication System
**Referencias**: @docs\07-security\01-tool-permissions.md

- [ ] **Implementar autenticación JWT**
  - [ ] Crear `backend/src/services/auth/AuthService.ts`
  - [ ] Hash de passwords con bcrypt
  - [ ] Generación de JWT tokens
  - [ ] Refresh token logic
- [ ] **Crear middleware de autenticación** (`backend/src/middleware/auth.ts`)
  - [ ] Verificar JWT token
  - [ ] Cargar usuario en request
  - [ ] Manejo de tokens expirados
- [ ] **Crear endpoints de autenticación** (`backend/src/routes/auth.ts`)
  - [ ] POST /api/auth/register
  - [ ] POST /api/auth/login
  - [ ] POST /api/auth/refresh
  - [ ] GET /api/auth/me
- [ ] **Proteger rutas del API**
  - [ ] Aplicar middleware a rutas protegidas

---

### ⏳ **Week 3: Basic Agent System** (Semana 3)

#### 3.1 Claude Integration
**Referencias**: @docs\02-core-concepts\02-llm-enhancements.md

- [ ] **Crear Claude Client wrapper** (`backend/src/services/agent/ClaudeClient.ts`)
  - [ ] Inicializar Anthropic SDK con API key del Key Vault
  - [ ] Configurar prompt caching (@docs\09-performance\01-prompt-caching.md)
  - [ ] Implementar streaming de respuestas
  - [ ] Implementar tool use
  - [ ] Manejo de errores y rate limits

#### 3.2 Main Orchestrator Agent
**Referencias**:
- @docs\03-agent-system\01-agentic-loop.md
- @docs\03-agent-system\02-main-orchestrator.md
- @docs\03-agent-system\06-context-management.md

- [ ] **Crear MainOrchestrator class** (`backend/src/services/agent/MainOrchestrator.ts`)
  - [ ] Constructor con Claude client y MCP client
  - [ ] Método `processMessage(sessionId, message)`
  - [ ] Implementar intent analysis (query, write, analysis)
  - [ ] Implementar basic planning
  - [ ] Implementar tool selection
  - [ ] Integrar con MCP tools
- [ ] **Context Management**
  - [ ] Crear `backend/src/services/agent/ContextManager.ts`
  - [ ] Cargar mensajes previos de la sesión
  - [ ] Mantener contexto en Redis
  - [ ] Limitar contexto por tokens
- [ ] **WebSocket Integration**
  - [ ] Configurar Socket.IO en Express server
  - [ ] Eventos: `message`, `thinking`, `tool_use`, `approval_required`
  - [ ] Streaming de respuestas del agente

#### 3.3 Basic Testing
- [ ] **Test end-to-end básico**
  - [ ] Usuario se conecta por WebSocket
  - [ ] Usuario envía mensaje "Hello"
  - [ ] Agent responde
  - [ ] Usuario pide "List customers"
  - [ ] Agent llama a MCP y retorna resultados

---

### 📊 **Deliverables Phase 1**

Al final de Phase 1 (3 semanas), deberíamos tener:

- [x] ✅ Script de infraestructura creado
- [ ] ✅ Infraestructura Azure desplegada y configurada
- [ ] ✅ Backend server corriendo y conectado a BD
- [ ] ✅ Conexión con MCP server funcionando
- [ ] ✅ Autenticación JWT implementada
- [ ] ✅ Agent básico puede responder a mensajes simples
- [ ] ✅ Puede hacer queries a BC via MCP

---

## 🎯 PHASE 2: MVP Core Features (Semanas 4-7)

**Referencias**: @docs\13-implementation-roadmap\03-phase-2-ui.md

**Objetivo**: Implementar funcionalidades core del MVP

---

### ⏳ **Week 4: Subagents & Orchestration**

#### 4.1 BCQueryAgent
**Referencias**: @docs\03-agent-system\04-subagents.md

- [ ] **Crear BCQueryAgent** (`backend/src/services/agent/subagents/BCQueryAgent.ts`)
  - [ ] Especializado en queries a BC
  - [ ] Query building logic
  - [ ] OData filter construction
  - [ ] Response formatting (tablas, JSON)
  - [ ] Error handling específico
- [ ] **Testing**
  - [ ] Test: Query all customers
  - [ ] Test: Query items with filters
  - [ ] Test: Query vendors
  - [ ] Test: Handle empty results
  - [ ] Test: Handle BC errors

#### 4.2 BCWriteAgent
**Referencias**:
- @docs\03-agent-system\04-subagents.md
- @docs\05-control-flow\01-human-in-the-loop.md

- [ ] **Crear BCWriteAgent** (`backend/src/services/agent/subagents/BCWriteAgent.ts`)
  - [ ] Especializado en create/update operations
  - [ ] Data validation contra BC schemas
  - [ ] Integración con sistema de aprobaciones
  - [ ] Checkpoint creation antes de writes
  - [ ] Rollback on error
- [ ] **Testing**
  - [ ] Test: Create customer (con aprobación)
  - [ ] Test: Update item price (con aprobación)
  - [ ] Test: Validation errors
  - [ ] Test: Rollback on error

#### 4.3 Orchestration Logic
**Referencias**: @docs\03-agent-system\03-delegation-handoff.md

- [ ] **Mejorar MainOrchestrator**
  - [ ] Delegation logic (delegar a QueryAgent o WriteAgent)
  - [ ] Parallel execution de queries independientes
  - [ ] Result synthesis (combinar resultados de subagents)
  - [ ] Error recovery (retry, rollback)
  - [ ] Plan generation y tracking

---

### ⏳ **Week 5: UI Core Components**

#### 5.1 Chat Interface
**Referencias**: @docs\10-ui-ux\01-interface-design.md

- [ ] **Componentes de chat con shadcn/ui**
  - [ ] `components/chat/ChatInterface.tsx` (componente principal)
  - [ ] `components/chat/MessageList.tsx` (lista de mensajes)
  - [ ] `components/chat/Message.tsx` (mensaje individual, user/agent)
  - [ ] `components/chat/ChatInput.tsx` (input con envío)
  - [ ] `components/chat/ThinkingIndicator.tsx` (indicador de "thinking")
- [ ] **Streaming support**
  - [ ] Display de mensajes mientras se reciben
  - [ ] Indicator de typing
- [ ] **Estados de UI**
  - [ ] Loading states
  - [ ] Error states
  - [ ] Empty state (nueva sesión)

#### 5.2 Source Panel (básico)
**Referencias**: @docs\10-ui-ux\01-interface-design.md (Source Explorer section)

- [ ] **Componentes**
  - [ ] `components/panels/SourcePanel.tsx`
  - [ ] `components/panels/FileExplorer.tsx` (lista de archivos)
  - [ ] File upload functionality
  - [ ] File selection para agregar a contexto

#### 5.3 Layout & Responsiveness
- [ ] **Main Layout**
  - [ ] `app/(chat)/layout.tsx` con sidebar
  - [ ] Header con user menu
  - [ ] Sidebar con lista de sesiones
- [ ] **Responsive Design**
  - [ ] Desktop layout (3 columnas: sidebar, chat, panels)
  - [ ] Tablet layout (collapsible sidebar)
  - [ ] Mobile layout (fullscreen chat)
- [ ] **Dark Mode** (usando shadcn/ui theming)

---

### ⏳ **Week 6: Approval System & To-Do Lists**

#### 6.1 Approval System - Backend
**Referencias**: @docs\05-control-flow\01-human-in-the-loop.md

- [ ] **Crear ApprovalManager** (`backend/src/services/approval/ApprovalManager.ts`)
  - [ ] Método `requestApproval(sessionId, action, data)`
  - [ ] Método `respondToApproval(approvalId, decision, userId)`
  - [ ] Persistencia en BD (tabla `approvals`)
  - [ ] WebSocket events: `approval_requested`, `approval_resolved`
- [ ] **Integrar con WriteAgent**
  - [ ] WriteAgent pausa antes de writes
  - [ ] Espera respuesta de aprobación
  - [ ] Continúa o cancela según decisión

#### 6.2 Approval System - Frontend
- [ ] **Componentes**
  - [ ] `components/approvals/ApprovalDialog.tsx` (dialog con shadcn/ui)
  - [ ] `components/approvals/ChangeSummary.tsx` (preview de cambios)
  - [ ] `components/approvals/ApprovalQueue.tsx` (queue de pending)
- [ ] **WebSocket Integration**
  - [ ] Escuchar evento `approval_requested`
  - [ ] Mostrar dialog automáticamente
  - [ ] Enviar decisión (approve/reject)

#### 6.3 To-Do Lists - Backend
**Referencias**: @docs\06-observability\06-todo-lists.md

- [ ] **Crear TodoManager** (`backend/src/services/todo/TodoManager.ts`)
  - [ ] Auto-generation de todos desde plans del agente
  - [ ] Actualización de status en tiempo real
  - [ ] Persistencia en memoria (Redis) o BD
  - [ ] WebSocket events: `todo_updated`, `todo_completed`

#### 6.4 To-Do Lists - Frontend
- [ ] **Componentes**
  - [ ] `components/panels/TodoList.tsx`
  - [ ] `components/panels/TodoItem.tsx`
  - [ ] Status visualization (pending, in_progress, completed)
- [ ] **Real-time Updates**
  - [ ] Escuchar eventos de WebSocket
  - [ ] Actualizar UI automáticamente

---

### ⏳ **Week 7: Integration & Polish**

#### 7.1 End-to-End Integration
- [ ] **Conectar todos los componentes**
  - [ ] Chat → Agent → MCP → BC
  - [ ] Approval flow completo
  - [ ] To-do lists automáticos
  - [ ] Error handling en toda la cadena

#### 7.2 Error Handling & States
**Referencias**: @docs\05-control-flow\05-error-recovery.md

- [ ] **Error handling robusto**
  - [ ] Network errors
  - [ ] BC API errors
  - [ ] MCP errors
  - [ ] Timeout handling
  - [ ] User-friendly error messages
- [ ] **UI States**
  - [ ] Loading states en todos los componentes
  - [ ] Empty states (no sessions, no messages)
  - [ ] Error states con retry options

#### 7.3 UI/UX Polish
- [ ] **Mejoras visuales**
  - [ ] Animations suaves (framer-motion)
  - [ ] Transitions
  - [ ] Hover effects
- [ ] **Accessibility**
  - [ ] Keyboard navigation
  - [ ] ARIA labels
  - [ ] Screen reader support

---

### 📊 **Deliverables Phase 2**

Al final de Phase 2 (7 semanas acumuladas), deberíamos tener:

- [ ] ✅ Chat interface funcional y pulida
- [ ] ✅ Agent puede query y create entities en BC
- [ ] ✅ Sistema de aprobaciones funcionando
- [ ] ✅ To-do lists mostrando progreso
- [ ] ✅ Error handling robusto
- [ ] ✅ UI responsive y accesible

---

## 🎯 PHASE 3: Polish & Testing (Semanas 8-9)

**Referencias**: @docs\13-implementation-roadmap\04-phase-3-bc-integration.md

**Objetivo**: Pulir MVP, testing comprehensivo y preparar demo

---

### ⏳ **Week 8: Testing & Bug Fixes**

#### 8.1 Unit Tests
**Referencias**: @docs\12-development\04-testing-strategy.md

- [ ] **Backend Unit Tests** (Jest)
  - [ ] Agent tests (MainOrchestrator, Subagents)
  - [ ] Service tests (Auth, MCP, Approval, Todo)
  - [ ] Utility tests
  - [ ] Target: >70% coverage
- [ ] **Frontend Unit Tests** (Jest + React Testing Library)
  - [ ] Component tests (Chat, Approval, Todo)
  - [ ] Hook tests
  - [ ] Utility tests
  - [ ] Target: >70% coverage

#### 8.2 Integration Tests
- [ ] **API Endpoint Tests**
  - [ ] Auth endpoints
  - [ ] Chat endpoints
  - [ ] Approval endpoints
- [ ] **WebSocket Tests**
  - [ ] Connection/disconnection
  - [ ] Event handling
  - [ ] Streaming
- [ ] **MCP Integration Tests**
  - [ ] Tool calling
  - [ ] Error handling
- [ ] **Database Tests**
  - [ ] CRUD operations
  - [ ] Transactions

#### 8.3 E2E Tests
**Referencias**: @docs\12-development\04-testing-strategy.md

- [ ] **Playwright E2E Tests**
  - [ ] User login flow
  - [ ] Create new chat session
  - [ ] Send message and receive response
  - [ ] Query BC entities
  - [ ] Create entity with approval
  - [ ] Reject approval
  - [ ] Error scenarios

#### 8.4 Bug Fixes
- [ ] **Fix reported bugs** (crear issues en GitHub)
- [ ] **Edge case handling**
- [ ] **Performance issues**
- [ ] **UI glitches**

---

### ⏳ **Week 9: Documentation & Demo Prep**

#### 9.1 Documentation Updates
- [ ] **API Documentation**
  - [ ] Swagger/OpenAPI spec
  - [ ] Endpoint documentation
- [ ] **Deployment Guide**
  - [ ] Azure deployment steps
  - [ ] Environment variables
  - [ ] Troubleshooting
- [ ] **User Guide**
  - [ ] How to use the chat
  - [ ] How approvals work
  - [ ] Example scenarios
- [ ] **Admin Guide**
  - [ ] How to manage users
  - [ ] How to monitor logs
  - [ ] How to handle errors

#### 9.2 Demo Preparation
**Referencias**: @docs\13-implementation-roadmap\04-phase-3-bc-integration.md (Demo Scenarios)

- [ ] **Seed demo data en BC**
  - [ ] Demo customers
  - [ ] Demo items
  - [ ] Demo vendors
- [ ] **Prepare demo scenarios**
  - [ ] Scenario 1: Create customer "Acme Corp"
  - [ ] Scenario 2: Query all active customers
  - [ ] Scenario 3: Update item DESK001 price
- [ ] **Demo script**
  - [ ] Script con talking points
  - [ ] Screenshots
  - [ ] Video demo (opcional)
- [ ] **Test in clean environment**
  - [ ] Fresh database
  - [ ] Clean Azure deployment

#### 9.3 Performance Optimization
**Referencias**: @docs\09-performance\

- [ ] **Backend optimization**
  - [ ] Database query optimization (indexes)
  - [ ] API response times (<3s)
  - [ ] Cache implementation (Redis)
- [ ] **Frontend optimization**
  - [ ] Bundle size (<1MB)
  - [ ] Code splitting
  - [ ] Image optimization
  - [ ] Lazy loading

---

### 📊 **Deliverables Phase 3**

Al final de Phase 3 (9 semanas totales), deberíamos tener:

- [ ] ✅ MVP completamente funcional
- [ ] ✅ Tests passing (>70% coverage)
- [ ] ✅ Documentation completa
- [ ] ✅ Demo ready
- [ ] ✅ Known issues documentados
- [ ] ✅ Performance acceptable (<3s response time)

---

## 🚀 MVP Launch Checklist

Antes de considerar el MVP "listo":

- [ ] ✅ Todas las features core funcionando
- [ ] ✅ No hay bugs críticos
- [ ] ✅ Performance aceptable (<3s)
- [ ] ✅ Security review hecho
- [ ] ✅ Documentation completa
- [ ] ✅ Demo exitoso con stakeholders
- [ ] ✅ Stakeholder approval
- [ ] ✅ Deployment plan listo

---

## 📂 Archivos Clave Creados/A Crear

### ✅ Ya Creados
- `infrastructure/deploy-azure-resources.sh` - Script deployment Azure
- `infrastructure/README.md` - Guía de deployment
- `frontend/` - Next.js 16 base project
- `docs/` - 74 archivos de documentación

### 🔄 A Crear (Phase 1)
```
backend/
├── src/
│   ├── server.ts
│   ├── config/
│   │   ├── database.ts
│   │   ├── redis.ts
│   │   ├── keyvault.ts
│   │   └── environment.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── chat.ts
│   │   └── approvals.ts
│   ├── services/
│   │   ├── agent/
│   │   │   ├── ClaudeClient.ts
│   │   │   ├── MainOrchestrator.ts
│   │   │   ├── ContextManager.ts
│   │   │   └── subagents/
│   │   │       ├── BCQueryAgent.ts
│   │   │       └── BCWriteAgent.ts
│   │   ├── auth/
│   │   │   └── AuthService.ts
│   │   ├── mcp/
│   │   │   └── MCPClient.ts
│   │   ├── bc/
│   │   │   └── BCClient.ts
│   │   ├── approval/
│   │   │   └── ApprovalManager.ts
│   │   └── todo/
│   │       └── TodoManager.ts
│   ├── models/
│   ├── middleware/
│   │   └── auth.ts
│   └── types/
├── scripts/
│   ├── init-db.sql
│   └── seed-data.sql
├── tests/
├── .env.example
├── Dockerfile
├── package.json
└── tsconfig.json
```

```
frontend/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   ├── (chat)/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── components/
│       ├── ui/ (shadcn)
│       ├── chat/
│       │   ├── ChatInterface.tsx
│       │   ├── MessageList.tsx
│       │   ├── Message.tsx
│       │   ├── ChatInput.tsx
│       │   └── ThinkingIndicator.tsx
│       ├── approvals/
│       │   ├── ApprovalDialog.tsx
│       │   └── ApprovalQueue.tsx
│       └── panels/
│           ├── SourcePanel.tsx
│           ├── TodoList.tsx
│           └── ContextPanel.tsx
├── lib/
│   ├── socket.ts
│   ├── api.ts
│   └── store.ts
├── hooks/
├── .env.local.example
└── Dockerfile
```

---

## 📝 Notas Importantes

### Decisiones Técnicas Tomadas
1. **Base de datos**: Azure SQL (en lugar de PostgreSQL) para datos transaccionales
2. **Vector DB**: Solo si es necesario, usar PostgreSQL (actualmente no requerido para MVP)
3. **MCP Server**: Ya desplegado externamente, no hay que crearlo
4. **Hosting**: Azure Container Apps (serverless, escalado automático)
5. **UI Library**: shadcn/ui (en lugar de solo Tailwind)

### Recursos Existentes
- **Subscription ID**: 5343f6e1-f251-4b50-a592-18ff3e97eaa7
- **MCP Server**: https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp
- **BC Tenant ID**: 1e9a7510-b103-463a-9ade-68951205e7bc
- **BC Client ID**: 99bdec72-7de1-4744-8fa1-afd49e1ef993

### Próximos Pasos Inmediatos
1. ✅ Ejecutar `infrastructure/deploy-azure-resources.sh`
2. ✅ Agregar Claude API key al Key Vault
3. ✅ Inicializar proyecto backend
4. ✅ Configurar TypeScript y dependencias
5. ✅ Crear database schema

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
