# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. System Overview

**Integrated Agent System with Business Central (BC Agent)**

This project implements a SaaS platform that orchestrates multiple AI agents (based on LLMs) to solve complex business problems. The core is a Node.js/TypeScript backend that integrates:

1.  **Agent Orchestrator**: Central brain that routes intents.
2.  **BC Agent**: Specialist in Microsoft Business Central (ERP).
3.  **RAG Agent**: Specialist in semantic search and document analysis.

The system uses an **Event Sourcing** architecture with two-phase persistence and real-time streaming via WebSocket.

### Tech Stack
-   **Backend**: Express 5 + TypeScript + Socket.IO + Azure SQL + Redis + BullMQ
-   **Frontend**: Next.js 16 (App Router) + React 19 + Zustand + Tailwind CSS 4 + shadcn/ui
-   **Shared**: `@bc-agent/shared` package for types, schemas (Zod), and constants
-   **Infrastructure**: Azure (SQL, Redis, Key Vault, Storage, Container Apps)

---

## 2. Architecture (Screaming Architecture)

The code is structured so that the folder structure "screams" what the system does.

### 2.1 Core Structure (`backend/src`)
-   **`domains/`**: Pure business logic, agnostic of external frameworks.
    -   `agent/orchestration`: Flow control logic (`AgentOrchestrator`).
    -   `agent/streaming`: Stream processing (`StreamEventRouter`, `GraphStreamProcessor`).
    -   `agent/persistence`: Saving coordination (`PersistenceCoordinator`).
    -   `agent/tools`: Tool execution and deduplication.
    -   `agent/context`: RAG context preparation (`FileContextPreparer`).
-   **`modules/`**: Concrete implementations of agents and graphs (LangGraph).
    -   `agents/orchestrator`: Main graph and routing (`router.ts`, `graph.ts`).
    -   `agents/business-central`: BC Agent and its tools.
    -   `agents/rag-knowledge`: RAG Agent.
-   **`shared/`**: Shared code and abstractions.
    -   `providers/`: LLM Adapters (e.g., `AnthropicStreamAdapter`) to normalize events.
-   **`services/`**: Infrastructure services (WebSocket, Files, EventStore).

### 2.2 Key Principles
1.  **Single Responsibility**: Each service does 1 thing (e.g., `AgentOrchestrator` coordinates, does not implement persistence logic).
2.  **Provider Agnostic**: All business logic MUST use normalized events (`INormalizedStreamEvent`). Adapters (`AnthropicStreamAdapter`) isolate provider complexity.
3.  **Two-Phase Persistence**:
    -   **Phase 1 (Sync)**: Redis/EventStore to get atomic `sequenceNumber` (~10ms).
    -   **Phase 2 (Async)**: MessageQueue (BullMQ) for writing to Relational DB (~600ms).

---

## 3. Critical Flows

### 3.1 Message Processing (The 6-Layer Stack)
A user message flows through 6 strict layers:

1.  **WebSocket Layer** (`ChatMessageHandler.ts`):
    -   Validates session and authentication.
    -   Delegates to `AgentOrchestrator`.

2.  **Orchestration Layer** (`AgentOrchestrator.ts`):
    -   Prepares context (files + search).
    -   Persists user message (`PersistenceCoordinator`).
    -   Initializes the LangGraph graph.

3.  **Routing Layer** (`StreamEventRouter.ts`):
    -   Intercepts raw LangChain events.
    -   Routes `on_chat_model_stream` -> StreamProcessor.
    -   Routes `tool_executions` -> ToolProcessor.

4.  **Stream Processing Layer** (`GraphStreamProcessor.ts`):
    -   Uses `StreamAdapter` to normalize events.
    -   Accumulates "thinking" (extended thought) and final content.
    -   Emits `thinking_chunk` and `message_chunk` (transient).

5.  **Tool Layer** (`ToolExecutionProcessor.ts`):
    -   Deduplicates executions.
    -   Emits `tool_use` and `tool_result` immediately to frontend.
    -   Persists tool events asynchronously.

6.  **Persistence Layer** (`PersistenceCoordinator.ts`):
    -   Guarantees global order with `sequenceNumber`.
    -   Handles "Append-Only" strategy in Redis and deferred SQL persistence.

### 3.2 Agent Routing (`orchestrator/router.ts`)
The system decides which agent to activate based on hybrid logic:
1.  **Slash Commands** (Max Priority): `/bc` -> BC Agent, `/search` -> RAG.
2.  **Keywords** (Deterministic rules): "invoice", "vendor", "inventory" -> BC Agent.
3.  **Context**: If files attached -> RAG Agent.
4.  **LLM Router**: If ambiguous, an LLM classifies the intent.

### 3.3 Business Central Agent (`bc-agent.ts`)
-   **Role**: ERP Expert.
-   **Tools**: 7 meta-tools (`tools.ts`) that query a local index (`mcp-server/data/v1.0`).
-   **Capabilities**: Currently reads metadata (entities, endpoints, workflows) and can simulate validations. Does not execute real writes in BC yet (prototype/read phase).

---

## 4. Developer Guide

### 4.1 Where to find things
-   **Add a new BC tool**: `backend/src/modules/agents/business-central/tools.ts`
-   **Change routing logic**: `backend/src/modules/agents/orchestrator/router.ts`
-   **Adjust socket event formats**: Check `docs/plans/Refactor/contracts/02-CONTRATO-BACKEND-FRONTEND.md`. Emission logic is in `backend/src/domains/agent/emission`.

### 4.2 Golden Rules (Pre-Commit)
1.  **Strict Typing**: No `any`. Use `unknown` with Zod validation if necessary.
2.  **No Logic in Controllers**: `ChatMessageHandler` only validates and delegates.
3.  **Tests**: Every change requires a unit test. If touching persistence, integration test.
4.  **Logging**: Use structured logger (`createChildLogger`). Never `console.log`.

### 4.3 Common Commands

#### Development
```bash
# Install dependencies (from root)
npm install

# Run backend dev server (port 3002)
cd backend && npm run dev

# Run frontend dev server (port 3000)
cd frontend && npm run dev

# Build shared package (required before type-check)
npm run build:shared
```

#### Testing
```bash
# Backend unit tests
npm run -w backend test:unit

# Backend integration tests (requires Redis)
npm run -w backend test:integration

# Backend E2E tests (requires Azurite + full stack)
npm run -w backend test:e2e

# Frontend unit tests
npm run -w bc-agent-frontend test

# Playwright E2E tests (auto-starts servers)
npm run test:e2e
npm run test:e2e:ui      # Interactive UI
npm run test:e2e:debug   # Debug mode
```

#### Type Checking & Linting
```bash
# Full type verification (builds shared first)
npm run verify:types

# Backend lint
npm run -w backend lint

# Frontend lint
npm run -w bc-agent-frontend lint
```

---

## 5. Technical Glossary
-   **Normalized Event**: Standard event (`reasoning_delta`, `content_delta`) independent of whether the model is Claude, GPT-4, or Gemini.
-   **Thinking Budget**: Token amount reserved for extended reasoning (Claude 3.7+).
-   **Transient Event**: Ephemeral event (streaming) not saved to DB (e.g., chunks).
-   **Persisted Event**: Event that has `sequenceNumber` and is the source of truth.

---

## 6. Business Intelligence & Billing (Critical)

### 6.1 Usage & Cost Metrics
The system captures critical metrics for billing in the `messages` table. Every agent-generated message includes:
-   **`input_tokens`**: Input cost.
-   **`output_tokens`**: Output cost (generation).
-   **`model`**: Model used (e.g., `claude-3-5-sonnet...`).
-   **`bc_company_id`**: For segmentation by ERP client (if applicable).

**⚠️ Important Note**: Currently there is NO aggregated `usage_events` table. Billing calculation must be done by summing over the `messages` table.

---

## 7. Security & Compliance (GDPR/SaaS)

### 7.1 Multi-Tenancy Isolation
The system enforces Application-Level Isolation.
-   **Session Ownership**: Each WebSocket request strictly verifies that `socket.userId` matches `session.ownerId` in the database.
-   **Middleware**: `validateSessionOwnership` (`backend/src/shared/utils/session-ownership.ts`) is the main defense barrier.
-   **Data Leak Prevention**: RAG queries *always* filter by `user_id` before searching vectors.

### 7.2 GDPR and Privacy
1.  **Encryption**: Access tokens (Microsoft, BC) are stored encrypted in DB (`encrypted` columns in `integrations` or `users`).
2.  **Right to be Forgotten**: Relational structure allows deleting a user and cascading delete of their sessions and messages, removing all PII traces.
3.  **Audit Trail**: The `message_events` table (EventStore) acts as an immutable log of all actions, crucial for security audits.

---

## 8. Key Patterns

### SQL NULL Comparison
Never use `column = NULL` in SQL queries. Use `QueryBuilder` for nullable parameters:

```typescript
import { createWhereClause } from '@/utils/sql/QueryBuilder';

const { whereClause, params } = createWhereClause()
  .addCondition('user_id', userId)
  .addNullableCondition('parent_folder_id', folderId)  // Handles NULL correctly
  .build();
```

See `docs/backend/sql-best-practices.md` for detailed guidance.

### WebSocket Events
Real-time communication uses Socket.IO with typed events from `@bc-agent/shared`:
- `chat:message` - Send user message
- `agent:*` events - Stream agent responses
- `approval:request/resolve` - Human-in-the-loop flow

### Test Data (E2E)
E2E test data uses specific prefixes for safe cleanup:
- User IDs: `e2e00001-...`
- Session IDs: `e2e10001-...`
- Run `npm run e2e:seed` before tests, `npm run e2e:clean` after
