# BC-Claude-Agent-Prototype - Documentation Index

> **Master Index**: Comprehensive technical documentation for the BC-Claude-Agent system
> **Version**: 2.0 (Restructured 2025-11-12)
> **Status**: Phase 2 - Week 7 | 95% MVP Complete

---

## 📋 Quick Navigation

| Section | Description | Key Documents |
|---------|-------------|---------------|
| [00-Overview](#00-overview) | Project vision, goals, tech stack summary | System overview, MVP definition |
| [01-Architecture](#01-architecture) | System architecture, design patterns, distributed systems | **System architecture**, fault tolerance |
| [02-Core Concepts](#02-core-concepts) | Fundamental concepts, SDK-first philosophy, Azure conventions | **SDK-first philosophy**, agent fundamentals |
| [03-Agent System](#03-agent-system) | Agentic loop, orchestration, DirectAgentService workaround | **Agentic loop**, DirectAgentService |
| [04-Integrations](#04-integrations) | MCP integration, BC API, vendoring strategy | **MCP overview**, BC integration |
| [05-Control Flow](#05-control-flow) | Human-in-the-loop, approvals, permissions, hooks | **Human-in-the-loop**, approval system |
| [06-Observability](#06-observability) | Logging, tracing, metrics, todo automation | Logging strategy, todo system |
| [07-Security](#07-security) | OAuth, BC authentication, token encryption, permissions | **Microsoft OAuth**, **Token encryption** |
| [08-State Persistence](#08-state-persistence) | Database schema, sessions, checkpoints, state management | **Database schema**, Session cookies vs JWT |
| [09-Performance](#09-performance) | Prompt caching, optimizations, token management | Prompt caching, optimization strategies |
| [10-UI/UX](#10-ui-ux) | Frontend design, components, design system | UI components, design system |
| [11-Backend](#11-backend) | Backend architecture, Express setup, API endpoints | **DirectAgentService**, OAuth flow |
| [12-Development](#12-development) | Setup guide, workflow, coding standards, testing | Development setup, testing strategy |
| [13-Roadmap](#13-roadmap) | MVP definition, implementation phases, **direction changes** | **Direction changes**, MVP checklist |
| [14-Deprecated](#14-deprecated) | Deprecated approaches and why they were replaced | JWT auth, Custom orchestrator |

**Bold documents** = Most frequently referenced, start here for context.

---

## 🎯 Current System State

### Completed (95%)
- ✅ Azure infrastructure deployed (Key Vault, SQL, Redis, Container Apps)
- ✅ Microsoft Entra ID OAuth 2.0 with delegated permissions
- ✅ DirectAgentService functional (SDK ProcessTransport workaround)
- ✅ MCP integration with 324 BC endpoints (52 entities), 7 tools
- ✅ Approval system with priority + expiration
- ✅ Todo system with custom generation
- ✅ 11/15 database tables functional (4 observability tables missing, non-critical)
- ✅ Frontend: Next.js 16 + React 19 + Tailwind CSS 4 + shadcn/ui
- ✅ Backend: Express + TypeScript + Socket.IO + @anthropic-ai/claude-agent-sdk@0.1.30

### Pending (5%)
- ⏳ **HIGH PRIORITY**: 5 Chat Session CRUD endpoints (2-3 hours)
- ⏳ 4 observability tables (1 hour, non-blocking)
- ⏳ Missing foreign keys (15 min, data integrity)

### Tech Stack Summary
**Backend**:
- Claude Agent SDK: 0.1.30
- Express: 5.1.0
- Socket.IO: 4.8.1
- Azure SQL + Redis
- MSAL Node: 3.8.1 (Microsoft OAuth)

**Frontend**:
- Next.js: 16.0.1
- React: 19.2.0
- Tailwind CSS: 4.1.17
- Zustand: 5.0.8
- Socket.IO Client: 4.8.1

**All dependencies use exact versions** (no `^` or `~`) for reproducibility.

---

## 📚 Documentation Structure

### 00-Overview
**Purpose**: High-level project vision and context

**Documents** (Reference `docs-old/00-overview/` for source material):
- `01-project-vision.md` - Goals, objectives, inspiration (Claude Code)
- `02-system-overview.md` - High-level architecture summary
- `03-tech-stack.md` - Complete technology stack with versions

**When to read**: First time onboarding, understanding project goals

---

### 01-Architecture
**Purpose**: System architecture, design patterns, distributed systems principles

**Documents** (some updated from `docs-old/01-architecture/`):
- **`01-system-architecture.md`** ⭐ - **Current architecture with Mermaid diagrams**
  - OAuth flow diagram
  - DirectAgentService integration
  - Per-user BC token storage
- `02-distributed-architecture.md` - Distributed systems patterns
- `03-fault-tolerance.md` - Error recovery, retry strategies
- `04-aci-principles.md` - Anthropic Claude Integration principles

**When to read**:
- Before making architectural changes
- Understanding system design decisions
- Troubleshooting complex issues

**Key diagrams**:
- System architecture flow (User → Frontend → Backend → Agent → MCP → BC)
- OAuth authorization code flow
- Approval flow (Agent → ApprovalManager → WebSocket → User)

---

### 02-Core Concepts
**Purpose**: Fundamental concepts, SDK-first philosophy, Azure conventions

**Documents** (Updated + new):
- `01-agents-fundamentals.md` - What are AI agents, agentic systems
- `02-llm-enhancements.md` - Extended thinking, prompt caching, tool calling
- `03-fundamental-patterns.md` - Design patterns for agentic systems
- `04-token-economics.md` - Token management, cost optimization
- `05-AZURE_NAMING_CONVENTIONS.md` - Azure resource naming standards
- `06-agent-sdk-usage.md` ✅ - How to use Claude Agent SDK
- **`07-sdk-first-philosophy.md`** ⭐ **NEW** - **Permanent SDK-first guidelines**

**When to read**:
- **ALWAYS read `07-sdk-first-philosophy.md` before implementing agent features**
- Before creating Azure resources (read `05-AZURE_NAMING_CONVENTIONS.md`)
- Understanding why SDK is prioritized over custom code

**Key principles**:
- **SDK-First Rule**: Never bypass SDK with custom solutions
- If SDK has a bug, create SDK-compliant workaround (e.g., DirectAgentService)
- Exact NPM versions for reproducibility

---

### 03-Agent System
**Purpose**: Agentic loop, orchestration, DirectAgentService implementation

**Documents** (Updated):
- **`01-agentic-loop.md`** ⭐ - **Updated for DirectAgentService**
  - Think → Act → Verify → Repeat cycle
  - How DirectAgentService implements manual loop
  - SDK automatic loop vs manual loop
- `02-orchestration.md` ✅ - SDK-native routing (not custom orchestrator)
- `03-memory-system.md` - Context management, session persistence
- `04-context-management.md` - Context window management
- `05-subagents.md` - Specialized agents (bc-query, bc-write, bc-validation, bc-analysis)
- `06-progressive-disclosure.md` - Progressive disclosure pattern

**When to read**:
- Understanding how agent execution works
- Debugging agent behavior
- Adding new specialized agents

**Key concepts**:
- DirectAgentService = Workaround for SDK ProcessTransport bug
- Specialized agents via system prompts (not separate classes)
- SDK handles tool discovery + execution automatically

---

### 04-Integrations
**Purpose**: MCP integration, Business Central API, vendoring strategy

**Documents** (Updated + new):
- **`01-mcp-overview.md`** ⭐ - Model Context Protocol introduction
- `02-mcp-primitives.md` - Resources, tools, prompts in MCP
- `03-custom-mcp-servers.md` - How to build MCP servers
- `04-bc-integration.md` - Business Central API integration
- `05-bc-entities.md` - 52 BC entities available via MCP (324 endpoints)
- `06-external-tools.md` - Other tools (Read, Grep, Bash, etc.)
- **`07-mcp-vendoring-strategy.md`** **NEW** - Why 115 files vendored instead of git submodule

**When to read**:
- Understanding MCP-BC connection
- Adding new BC operations
- Updating vendored MCP data files

**Key concepts**:
- 7 MCP tools: query, create, update, delete, schema, validate_workflow, validate_operation
- In-process MCP server (not subprocess)
- Vendored data: `backend/mcp-server/data/` (bcoas1.0.yaml + data/v1.0/)

---

### 05-Control Flow
**Purpose**: Human-in-the-loop, approvals, permissions, hooks

**Documents** (Updated):
- **`01-human-in-the-loop.md`** ⭐ - Approval system overview
- `02-permissions.md` - Tool permissions, role-based access control
- `03-hooks.md` - SDK hooks: canUseTool, onPreToolUse, onPostToolUse
- `04-checkpoints-rollbacks.md` - Checkpoint system for undo
- `05-stopping-conditions.md` - When to stop agent execution
- `06-todo-automation.md` - Todo generation from agent plans

**When to read**:
- Implementing new approval flows
- Understanding permission model
- Adding hooks for custom behavior

**Key concepts**:
- `canUseTool` hook intercepts write operations
- Approval flow: Agent requests → ApprovalManager → WebSocket → User → Approve/Reject
- Priority levels: low/medium/high, 5-minute expiration

---

### 06-Observability
**Purpose**: Logging, tracing, metrics, monitoring, todo tracking

**Documents** (Reference `docs-old/06-observability/`):
- `01-logging-strategy.md` - Logging levels, structured logging
- `02-distributed-tracing.md` - Request tracing across services
- `03-metrics-collection.md` - Performance metrics
- `04-monitoring-alerts.md` - Monitoring setup
- `05-todo-lists.md` - Todo system, automatic generation

**When to read**:
- Debugging production issues
- Setting up monitoring
- Understanding todo generation

**Key concepts**:
- audit_log table tracks all actions
- 4 observability tables missing (non-critical): mcp_tool_calls, session_files, error_logs, performance_metrics views

---

### 07-Security
**Purpose**: OAuth, BC authentication, token encryption, permissions

**Documents** (Updated + new):
- `01-tool-permissions.md` - Tool permission model
- `02-code-sandboxing.md` - Code execution sandboxing
- `03-permission-modes.md` - Permission modes (admin/editor/viewer)
- `04-classifier-systems.md` - Permission classification
- `05-bc-authentication.md` - Updated for per-user delegated tokens
- **`06-microsoft-oauth-setup.md`** ⭐ ✅ - **Microsoft Entra ID OAuth 2.0 setup**
- `07-bc-multi-tenant.md` ✅ - Multi-tenant BC support
- **`08-token-encryption.md`** **NEW** - **AES-256-GCM encryption, key management**

**When to read**:
- **ALWAYS before handling authentication/authorization changes**
- Setting up OAuth for new environments
- Understanding token encryption

**Key concepts**:
- Microsoft OAuth with delegated permissions (not client credentials)
- BC tokens encrypted per-user (AES-256-GCM) in `bc_access_token_encrypted` column
- Encryption key in Azure Key Vault
- Session cookies (not JWT)

---

### 08-State Persistence
**Purpose**: Database schema, sessions, checkpoints, state management

**Documents** (Updated + new):
- `01-stateful-execution.md` - Stateful vs stateless execution
- `02-checkpoint-system.md` - Checkpoint creation, rollback
- `03-session-persistence.md` - Session management
- `04-resume-from-errors.md` - Error recovery with state
- `05-file-system-config.md` - File system state
- `06-cloudmd-memory.md` - CLOUD.md memory system
- `07-files-api.md` - Files API for context
- `08-chat-forking.md` - Chat forking, branching
- **`09-session-cookies-vs-jwt.md`** **NEW** - **Why session cookies instead of JWT**
- **`10-database-schema.md`** **NEW** ⭐ - **Complete database schema with DDL + ER diagrams + queries**

**When to read**:
- **Before making database changes**
- Understanding session management
- Debugging data persistence issues

**Key concepts**:
- 11/15 tables functional: users, sessions, messages, approvals, checkpoints, audit_log, todos, tool_permissions, permission_presets, agent_executions, performance_metrics
- 4 missing tables (non-critical): mcp_tool_calls, session_files, error_logs, views
- Session-based auth (express-session + httpOnly cookies)
- Per-user BC tokens encrypted with AES-256-GCM

---

### 09-Performance
**Purpose**: Prompt caching, optimizations, token management

**Documents** (Reference `docs-old/09-performance/`):
- `01-prompt-caching.md` - SDK automatic caching
- `02-token-optimization.md` - Token cost reduction strategies
- `03-parallel-execution.md` - Parallel tool execution
- `04-caching-strategies.md` - Response caching, Redis
- `05-performance-metrics.md` - Latency, throughput metrics

**When to read**:
- Optimizing system performance
- Reducing API costs
- Understanding caching behavior

**Key concepts**:
- SDK handles prompt caching automatically (not configurable)
- Redis for caching BC queries (planned)
- Target: <3s P95 response time

---

### 10-UI/UX
**Purpose**: Frontend design, components, design system

**Documents** (Reference `docs-old/10-ui-ux/`):
- `01-ui-components.md` - Component library (shadcn/ui)
- `02-design-system.md` - Design tokens, patterns
- `03-chat-interface.md` - Chat UI design
- `04-approval-ui.md` - Approval dialog, queue
- `05-todo-ui.md` - Todo list UI
- `06-source-panel.md` - Source panel, file explorer
- `07-responsive-design.md` - Mobile, tablet, desktop
- `08-dark-mode.md` - Dark mode support

**When to read**:
- Adding new UI components
- Understanding frontend architecture
- Implementing responsive designs

**Key concepts**:
- Next.js 16 App Router
- React 19 with Suspense
- Tailwind CSS 4 + shadcn/ui components
- Zustand for state management

---

### 11-Backend
**Purpose**: Backend architecture, Express setup, API endpoints, DirectAgentService

**Documents** (Updated + new):
- `01-api-architecture.md` - API design, REST endpoints
- `02-express-setup.md` - Express configuration
- `03-endpoints.md` - API endpoint list
- `04-services-layer.md` - Service architecture
- `05-bc-connector.md` - BCClient implementation
- `06-agent-orchestrator.md` - Updated for SDK-native routing
- **`07-oauth-flow.md`** ⭐ ✅ - **Microsoft OAuth implementation**
- **`08-direct-agent-service.md`** **NEW** ⭐ - **DirectAgentService workaround for SDK bug**

**When to read**:
- **Before modifying agent execution logic**
- Adding new API endpoints
- Understanding OAuth flow
- Debugging SDK issues

**Key concepts**:
- DirectAgentService bypasses ProcessTransport bug with manual agentic loop
- Uses `@anthropic-ai/sdk` directly (not `query()`)
- May migrate back to SDK `query()` if future versions fix bug

---

### 12-Development
**Purpose**: Setup guide, workflow, coding standards, testing

**Documents** (Reference `docs-old/12-development/`):
- `01-development-setup.md` - Local setup, environment variables
- `02-development-workflow.md` - Git workflow, branching
- `03-coding-standards.md` - TypeScript standards, linting
- `04-testing-strategy.md` - Unit, integration, E2E tests
- `05-deployment-guide.md` - Azure deployment, CI/CD
- `06-troubleshooting.md` - Common issues, solutions

**When to read**:
- First time setting up project
- Contributing code
- Deploying to production

**Key concepts**:
- Exact NPM versions (no `^` or `~`)
- Frontend port: 3002, Backend port: 3001
- Phase 3: Testing implementation (70% coverage target)

---

### 13-Roadmap
**Purpose**: MVP definition, implementation phases, direction changes

**Documents** (Updated + new):
- `01-mvp-definition.md` - MVP scope, features
- `02-phase-1-foundation.md` - Phase 1 (Weeks 1-3) ✅ COMPLETED
- `03-phase-2-ui.md` - Phase 2 (Weeks 4-7) 95% COMPLETED
- `04-phase-3-polish.md` - Phase 3 (Weeks 8-9) PENDING
- `05-future-enhancements.md` - Post-MVP features
- `06-iteration-checklist.md` - Checklist for each iteration
- **`07-direction-changes.md`** **NEW** ⭐ - **8 major architectural pivots with rationale**

**When to read**:
- **REQUIRED before making architectural changes**
- Understanding project history
- Planning new features
- Avoiding deprecated approaches

**Key concepts**:
- 8 direction changes documented:
  1. JWT → Microsoft OAuth (Week 2.5)
  2. Custom orchestration → SDK native routing (Week 4)
  3. Git submodule → Vendored MCP data (Week 7)
  4. Token-based → Session cookies (Week 4)
  5. Global BC credentials → Per-user encrypted (Week 2.5)
  6. Manual loop → DirectAgentService (Week 4)
  7. Custom todo heuristics → SDK TodoWrite (intended, not yet available)
  8. Basic approvals → Priority + expiration (Migration 004)

---

### 14-Deprecated
**Purpose**: Deprecated approaches and why they were replaced

**Documents** (NEW):
- **`01-jwt-authentication.md`** - Why JWT deprecated, OAuth benefits
- **`02-custom-orchestrator.md`** - Why Orchestrator/IntentAnalyzer/AgentFactory eliminated (~1,500 lines)
- **`03-git-submodule-mcp.md`** - Why vendoring is better for CI/CD
- **`04-global-bc-credentials.md`** - Why per-user tokens required

**When to read**:
- **ALWAYS before reconsidering a deprecated approach**
- Understanding why certain patterns were removed
- Onboarding new developers (avoid repeating mistakes)

**Key concepts**:
- JWT auth removed: ~800 lines deleted (AuthService.ts, bcrypt, refresh_tokens table)
- Custom orchestration removed: ~1,500 lines deleted (Orchestrator, IntentAnalyzer, AgentFactory)
- Git submodule removed: CI/CD failures, 115 files vendored instead
- Global BC credentials removed: Multi-tenant support, audit compliance

---

## 🔍 Quick Reference Guides

### Common Tasks

| Task | Primary Document | Secondary Documents |
|------|------------------|---------------------|
| **Setup project locally** | `12-development/01-development-setup.md` | `CLAUDE.md`, `TODO.md` |
| **Understand current architecture** | `01-architecture/01-system-architecture.md` | `13-roadmap/07-direction-changes.md` |
| **Add new BC operation** | `04-integrations/04-bc-integration.md` | `05-control-flow/01-human-in-the-loop.md` |
| **Modify agent behavior** | `03-agent-system/01-agentic-loop.md` | `11-backend/08-direct-agent-service.md` |
| **Add new API endpoint** | `11-backend/01-api-architecture.md` | `11-backend/03-endpoints.md` |
| **Update database schema** | `08-state-persistence/10-database-schema.md` | `backend/scripts/migrations/` |
| **Setup Microsoft OAuth** | `07-security/06-microsoft-oauth-setup.md` | `07-security/08-token-encryption.md` |
| **Debug SDK issues** | `11-backend/08-direct-agent-service.md` | `02-core-concepts/07-sdk-first-philosophy.md` |
| **Understand direction changes** | `13-roadmap/07-direction-changes.md` | `14-deprecated/` |
| **Add UI component** | `10-ui-ux/01-ui-components.md` | `10-ui-ux/02-design-system.md` |

### File Locations Reference

| Resource | Location | Purpose |
|----------|----------|---------|
| TODO.md | Root | Task tracking, project progress |
| CLAUDE.md | Root | Instructions for Claude Code |
| docs/README.md | docs/ | **This file** - Documentation index |
| docs-old/ | Root | Backup of original docs (74 files) |
| deprecated/ | Root | Deprecated TODO archives |
| backend/scripts/init-db.sql | backend/scripts/ | Initial database schema (7 tables) |
| backend/scripts/migrations/ | backend/scripts/ | Database migrations 001-006 |
| backend/mcp-server/data/ | backend/mcp-server/ | Vendored MCP data (115 files) |
| frontend/components/ | frontend/ | React components |
| frontend/hooks/ | frontend/ | Custom React hooks |
| frontend/stores/ | frontend/ | Zustand state stores |

---

## 📐 Documentation Update Protocol

### When to Update Documentation

**ALWAYS update documentation when**:
1. ✅ Making architectural changes (update `13-roadmap/07-direction-changes.md`)
2. ✅ Deprecating an approach (add to `14-deprecated/`)
3. ✅ Adding new features (update relevant section + `TODO.md`)
4. ✅ Changing database schema (update `08-state-persistence/10-database-schema.md`)
5. ✅ Discovering bugs or workarounds (document in relevant section)
6. ✅ Completing a task (update `TODO.md` + relevant docs)

### How to Update

1. **Update the relevant document** in `docs/XX-section/`
2. **Update `docs/README.md`** if structure changes
3. **Update `TODO.md`** to reflect completion or new tasks
4. **Update `CLAUDE.md`** if instructions change
5. **Add to `13-roadmap/07-direction-changes.md`** if architectural decision made
6. **Add to `14-deprecated/`** if deprecating an approach

### Documentation Quality Standards

- ✅ **Accuracy**: Documentation reflects current code state
- ✅ **Completeness**: All major features documented
- ✅ **Clarity**: Technical but understandable
- ✅ **Examples**: Code snippets, diagrams where helpful
- ✅ **Context**: Explain "why" not just "what"
- ✅ **Navigation**: Cross-references to related docs

---

## 🚨 Critical Documents (READ FIRST)

If you're new to the project or making significant changes, **read these first**:

1. **`CLAUDE.md`** (root) - Instructions for working with this codebase
2. **`TODO.md`** (root) - Current project state, pending tasks
3. **`docs/README.md`** (this file) - Documentation index
4. **`13-roadmap/07-direction-changes.md`** - Understand what changed and why
5. **`02-core-concepts/07-sdk-first-philosophy.md`** - Permanent architectural principles
6. **`01-architecture/01-system-architecture.md`** - Current system architecture
7. **`08-state-persistence/10-database-schema.md`** - Database structure
8. **`11-backend/08-direct-agent-service.md`** - Agent execution workaround

**Total reading time**: ~45 minutes for all 8 critical documents

---

## 📞 Support & Contact

- **GitHub Issues**: For bugs, feature requests
- **TODO.md**: For task tracking
- **docs-old/**: Reference original documentation if needed

---

**Last Updated**: 2025-11-12
**Documentation Version**: 2.0
**System Version**: Phase 2 Week 7 (95% MVP Complete)
**Total Documents**: ~45 planned (10 new, 35 updated from docs-old/)
