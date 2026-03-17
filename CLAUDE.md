# CLAUDE.md

## 1. System Overview

**MyWorkMate** — Multi-Connector AI Business Assistant. SaaS platform orchestrating AI agents (Supervisor + ERP + RAG) to help users work across business systems.

**Stack**: Express 5 + TypeScript + Socket.IO + Azure SQL + Redis + BullMQ | Next.js 16 + React 19 + Zustand + Tailwind 4 + shadcn/ui | `@bc-agent/shared` for cross-cutting types/schemas/constants | Azure (SQL, Redis, Key Vault, Storage, Container Apps) | Connectors: Business Central, OneDrive, SharePoint

## 2. Architecture Principles

- **Screaming Architecture**: `domains/` = pure business logic, `services/` = infrastructure, `modules/` = agent implementations
- **Stateless singletons** with `ExecutionContext` per-request (see `domains/agent/CLAUDE.md`)
- **Two-Phase Persistence**: Redis sequence numbers (sync, ~10ms) → BullMQ (async, ~600ms) → Azure SQL
- **Provider agnostic**: `NormalizedAgentEvent` always — `BatchResultNormalizer` converts from any LLM
- **`@bc-agent/shared`** = single source of truth for types, event definitions, agent identifiers, classification logic
- **Supervisor-worker pattern**: supervisor routes (with thinking), workers execute domain tools (deterministic temperature)
- **Event pipeline**: Context → Graph Execution → Normalization → Sequencing → Event Processing → Tool Finalization

## 3. Golden Rules

1. **No `any`** — use `unknown` + Zod validation
2. **UUIDs UPPERCASE everywhere** — ingestion (`id.toUpperCase()`), comparison, logs, DB, tests, constants
3. **`createChildLogger({ service: 'Name' })`** — never `console.log` (see `.claude/rules/logging.md`)
4. **Multi-tenant isolation** — session ownership (`socket.userId` must match `session.ownerId`), RAG queries always filter by `user_id`
5. **No logic in controllers** — `ChatMessageHandler` validates + delegates only
6. **Tests required** — unit always, integration for persistence changes
7. **Persistence ≠ Visibility** — internal events persisted with `is_internal=true` for audit, but NOT emitted via WebSocket

## 4. Where To Find Things

| Area | Location | CLAUDE.md |
|---|---|---|
| Agent orchestration | `backend/src/domains/agent/` | `CLAUDE.md` |
| Supervisor graph | `backend/src/modules/agents/supervisor/supervisor-graph.ts` | — |
| Agent registry | `backend/src/modules/agents/core/registry/` | — |
| ERP Agent (BC) | `backend/src/modules/agents/business-central/` | — |
| RAG Agent | `backend/src/modules/agents/rag-knowledge/` | — |
| File sync pipeline | `backend/src/services/sync/` | `CLAUDE.md` |
| Cloud connectors (Graph API) | `backend/src/services/connectors/` | `CLAUDE.md` |
| File processing domain | `backend/src/domains/files/` | `CLAUDE.md` |
| File infrastructure | `backend/src/services/files/` | `CLAUDE.md` |
| Queue workers (BullMQ) | `backend/src/infrastructure/queue/` | `CLAUDE.md` |
| DB schema (Prisma) | `backend/prisma/schema.prisma` | `prisma/CLAUDE.md` |
| Search (vectors) | `backend/src/services/search/` | `CLAUDE.md` |
| Model config (LLM) | `backend/src/core/langchain/` | `CLAUDE.md` |
| Operational scripts | `backend/scripts/` | `CLAUDE.md` |
| Frontend files UI | `frontend/src/domains/files/` | `CLAUDE.md` |
| Frontend integrations | `frontend/src/domains/integrations/` | `CLAUDE.md` |
| Production operations | `infrastructure/` | `CLAUDE.md` |

## 5. Commands & Pre-Commit

See `.claude/rules/commands.md` for all dev, test, type-check, and lint commands.

## 6. Bug Prevention

See `.claude/rules/gotchas.md` for common runtime pitfalls, migration checklists, and PRD-discovered constraints.

## 7. Security

- **Session ownership**: `socket.userId` must match `session.ownerId` — enforced by `validateSessionOwnership` middleware
- **RAG isolation**: queries ALWAYS filter by `user_id` before vector search
- **Encrypted tokens**: AES-256-GCM for Microsoft OAuth tokens in `connections`/`users` tables
- **GDPR**: Cascade delete removes all user PII (sessions, messages, files, events)

## 8. Production Operations

See `infrastructure/CLAUDE.md` for the complete production operations guide including:
- Environment topology (dev vs prod resource naming)
- Deployment lifecycle (atomic pipeline: test → build → migrate → deploy → health check → traffic shift)
- Database migration rules (NEVER `db push` in prod)
- Downtime & maintenance window procedures
- Data integrity verification
- Incident response & rollback procedures
- Secret rotation schedule
