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
-   **`domains/`**: Pure business logic, agnostic of external frameworks. Contains 11 domains:
    -   `agent/`: Main agent domain with subdomains:
        -   `citations/`: CitationExtractor (extraction from RAG results)
        -   `context/`: FileContextPreparer, SemanticSearchHandler
        -   `emission/`: EventIndexTracker
        -   `orchestration/`: Flow control logic (`AgentOrchestrator`)
        -   `persistence/`: Saving coordination (`PersistenceCoordinator`)
        -   `tools/`: ToolLifecycleManager, ToolEventDeduplicator
        -   `usage/`: UsageTracker
    -   `approval/`: Human-in-the-Loop flow (ApprovalManager)
    -   `auth/`: Authentication and middleware (OAuth, Express middleware)
    -   `billing/`: Billing and cost tracking (UsageTrackingService, QuotaValidatorService)
    -   `business-central/`: Business Central integration (reserved)
    -   `chat/`: WebSocket chat abstraction
    -   `files/`: File management (upload, processing)
    -   `queue/`: BullMQ abstraction (Message Queue)
    -   `search/`: Semantic search
    -   `sessions/`: Session management (schemas, validations, pagination)
    -   `settings/`: User preferences
-   **`modules/`**: Concrete implementations of agents and graphs (LangGraph).
    -   `agents/orchestrator`: Main graph and routing (`router.ts`, `graph.ts`).
    -   `agents/business-central`: BC Agent and its tools.
    -   `agents/rag-knowledge`: RAG Agent.
-   **`shared/`**: Shared code and abstractions.
    -   `providers/`: LLM Adapters (e.g., `AnthropicAdapter`) to normalize events.
-   **`services/`**: Infrastructure services (15 directories: WebSocket, Files, EventStore, Sessions, etc.).

### 2.2 Frontend Structure (`frontend/src`)
-   **`domains/`**: Feature-based organization with Zustand stores and hooks. Contains 8 domains:
    -   `auth/`: Authentication store and session health hook
    -   `chat/`: Messages, agent state, approvals, citations (4 stores, 6+ hooks)
    -   `connection/`: WebSocket connection state management
    -   `files/`: File management - upload, selection, preview, etc. (8 stores, 9 hooks)
    -   `notifications/`: Job failure notifications hook
    -   `session/`: Session list management store
    -   `settings/`: User preferences (theme, etc.)
    -   `ui/`: UI preferences store
-   **`components/`**: React components organized by feature:
    -   `chat/`: ChatContainer, MessageList, ChatInput
    -   `files/`: FileItem, FileUploader, FilePreview
    -   `sessions/`: SessionList, SessionItem
    -   `settings/`: SettingsTabs, ThemeSelector
    -   `ui/`: Shared UI components (shadcn/ui based)
-   **`lib/`**: Utilities and API clients
-   **`app/`**: Next.js App Router pages

### 2.3 Key Principles
1.  **Single Responsibility**: Each service does 1 thing (e.g., `AgentOrchestrator` coordinates, does not implement persistence logic).
2.  **Provider Agnostic**: All business logic MUST use normalized events (`INormalizedStreamEvent`). Adapters (`AnthropicStreamAdapter`) isolate provider complexity.
3.  **Two-Phase Persistence**:
    -   **Phase 1 (Sync)**: Redis/EventStore to get atomic `sequenceNumber` (~10ms).
    -   **Phase 2 (Async)**: MessageQueue (BullMQ) for writing to Relational DB (~600ms).

---

## 3. Critical Flows

### 3.1 Message Processing (The 8-Layer Stack)
A user message flows through 8 strict layers (synchronous execution):

1.  **WebSocket Layer** (`ChatMessageHandler.ts`):
    -   Validates session and authentication.
    -   Delegates to `AgentOrchestrator`.

2.  **Orchestration Layer** (`AgentOrchestrator.ts`):
    -   Creates ExecutionContext.
    -   Prepares context (files + search).
    -   Persists user message (`PersistenceCoordinator`).
    -   Executes graph synchronously.

3.  **Routing Layer** (`router.ts`):
    -   Decides which agent processes the request (BC, RAG, Orchestrator).
    -   Routes based on slash commands, keywords, context, or LLM classification.

4.  **Execution Layer** (`graph.ts` + Agents):
    -   LangGraph StateGraph with agent nodes.
    -   Synchronous execution via `graph.invoke()`.

5.  **Normalization Layer** (`BatchResultNormalizer.ts`):
    -   Converts AgentState to NormalizedAgentEvent[].
    -   Orders events by originalIndex.

6.  **Pre-allocation Layer** (`EventStore.reserveSequenceNumbers()`):
    -   Reserves sequence numbers atomically via Redis INCRBY.

7.  **Tool Lifecycle Layer** (`ToolLifecycleManager.ts`):
    -   Coordinates tool_request + tool_response.
    -   Manages tool execution deduplication.

8.  **Persistence Layer** (`PersistenceCoordinator.ts`):
    -   Guarantees global order with `sequenceNumber`.
    -   Handles "Append-Only" strategy in EventStore + MessageQueue (Two-Phase).

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
-   **Pagination configuration**: See `docs/backend/02-PAGINATION.md`. Limits: Sessions (20/50), Messages (50/100), Files (50/100).

### 4.2 Golden Rules (Pre-Commit)
1.  **Strict Typing**: No `any`. Use `unknown` with Zod validation if necessary.
2.  **No Logic in Controllers**: `ChatMessageHandler` only validates and delegates.
3.  **Tests**: Every change requires a unit test. If touching persistence, integration test.
4.  **Logging**: Use structured logger (`createChildLogger`). Never `console.log`.
5.  **IDs**: All UUIDs/GUIDs must be **UPPERCASE** (see Section 12).

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

## 8. Stateless Architecture (ExecutionContext Pattern)

### 8.1 Why Stateless?
The backend runs on **Azure Container Apps** with horizontal auto-scaling. Multiple instances handle concurrent requests without sticky sessions. This requires all components to be **stateless** to prevent:
- **Race conditions**: Shared mutable state between concurrent users
- **Data leaks**: User A receiving events meant for User B
- **Scaling issues**: State not shared across container instances

### 8.2 The ExecutionContext Pattern
All mutable state lives in an `ExecutionContext` created per-execution:

```typescript
// CORRECT: Create context per execution
async executeAgent(prompt, sessionId, onEvent, userId, options) {
  const ctx = createExecutionContext(sessionId, userId, onEvent, options);

  // Pass ctx to all components
  await this.graphStreamProcessor.process(events, ctx);
  this.agentEventEmitter.emit(event, ctx);
  await this.toolExecutionProcessor.processExecutions(execs, ctx);
}
```

**ExecutionContext contains**:
- `callback`: Event emission function
- `eventIndex`: Auto-incrementing counter for event ordering
- `thinkingChunks`: Accumulated thinking content
- `contentChunks`: Accumulated response content
- `seenToolIds`: Tool deduplication (shared across processors)
- `totalInputTokens/totalOutputTokens`: Usage tracking

### 8.3 Component Design Rules

**DO - Stateless Singletons**:
```typescript
// Components have NO instance fields for mutable state
export class GraphStreamProcessor {
  // NO: private thinkingChunks: string[] = [];
  // NO: private callback: Function;

  async *process(events, ctx: ExecutionContext) {
    ctx.thinkingChunks.push(content);  // YES: Mutate ctx
  }
}

// Use singleton getter
const processor = getGraphStreamProcessor();
```

**DON'T - Shared Mutable State**:
```typescript
// WRONG: Mutable state in singleton
export class BadProcessor {
  private callback: Function;  // Overwritten by concurrent users!

  setCallback(cb) { this.callback = cb; }  // Race condition!
}
```

### 8.4 Key Files
- `ExecutionContext.ts`: Interface and factory function
- `AgentOrchestrator.ts`: Creates ctx and passes to components
- `GraphStreamProcessor.ts`, `AgentEventEmitter.ts`, `ToolExecutionProcessor.ts`: Stateless, receive ctx

### 8.5 Testing Pattern
Tests must create fresh ExecutionContext and pass to methods:

```typescript
function createTestContext(options?) {
  return createExecutionContext(
    options?.sessionId ?? 'test-session',
    options?.userId ?? 'test-user',
    options?.callback,
    { enableThinking: false }
  );
}

it('should emit events', () => {
  const ctx = createTestContext({ callback: (e) => events.push(e) });
  emitter.emit(event, ctx);  // Pass ctx
});
```

---

## 9. Other Key Patterns

### 9.1 SQL NULL Comparison
Never use `column = NULL` in SQL queries. Use `QueryBuilder` for nullable parameters:

```typescript
import { createWhereClause } from '@/utils/sql/QueryBuilder';

const { whereClause, params } = createWhereClause()
  .addCondition('user_id', userId)
  .addNullableCondition('parent_folder_id', folderId)  // Handles NULL correctly
  .build();
```

See `docs/backend/sql-best-practices.md` for detailed guidance.

### 9.2 WebSocket Events
Real-time communication uses Socket.IO with typed events from `@bc-agent/shared`:
- `chat:message` - Send user message
- `agent:*` events - Stream agent responses
- `approval:request/resolve` - Human-in-the-loop flow

### 9.3 Test Data (E2E)
E2E test data uses specific prefixes for safe cleanup:
- User IDs: `e2e00001-...`
- Session IDs: `e2e10001-...`
- Run `npm run e2e:seed` before tests, `npm run e2e:clean` after

---

## 10. Bug Prevention Strategy

### 10.1 Common Runtime Errors to Watch For

**Void functions with `.catch()` or `.then()`:**
```typescript
// ❌ WRONG: persistToolEventsAsync returns void
this.persistenceCoordinator.persistToolEventsAsync(data).catch(err => ...);

// ✅ CORRECT: Fire-and-forget (function handles errors internally)
this.persistenceCoordinator.persistToolEventsAsync(data);

// ✅ CORRECT: If you need the Promise, the function must return one
const result = await this.persistenceCoordinator.persistToolEventsAsync(data);
```

**Prevention:** Always annotate return types explicitly. TypeScript will catch `.catch()` on `void`:
```typescript
// Return type annotation catches misuse at compile time
persistToolEventsAsync(sessionId: string, data: ToolExecution[]): void { ... }
```

### 10.2 Migration Checklist

When removing features (e.g., streaming chunks → sync architecture):

1. **Search for all references** before removing types:
   ```bash
   # Find all usages of removed types
   grep -rn "message_chunk\|thinking_chunk\|message_partial" --include="*.ts"
   ```

2. **Update shared types FIRST** - Remove from `@bc-agent/shared` types
3. **Run type-check** - `npm run verify:types` will show all breaking usages
4. **Update test fixtures** - Factory methods, sequences, presets
5. **Update documentation** - Code comments, CLAUDE.md, contracts

### 10.3 Pre-Commit Verification

Before committing changes, always run:
```bash
# Full type verification (catches most issues)
npm run verify:types

# Backend lint (catches style issues)
npm run -w backend lint

# Frontend lint
npm run -w bc-agent-frontend lint
```

### 10.4 Error Serialization Pattern

Always serialize Error objects properly for logging:
```typescript
// ❌ WRONG: Error objects don't serialize to JSON
this.logger.error({ error }, 'Operation failed');  // logs error: {}

// ✅ CORRECT: Extract serializable properties
const errorInfo = error instanceof Error
  ? { message: error.message, stack: error.stack, name: error.name, cause: error.cause }
  : { value: String(error) };
this.logger.error({ error: errorInfo }, 'Operation failed');
```

### 10.5 Type Mismatches Between Modules

When types differ between modules (e.g., `FileContextPreparationResult` vs `FileContextResult`):

1. **Prefer the shared package type** - Use `@bc-agent/shared` types across modules
2. **Create adapter functions** if types differ intentionally
3. **Use type assertions only as last resort** with clear comments:
   ```typescript
   // FIXME: FileContextPreparationResult should be unified with FileContextResult
   fileContext: contextResult as unknown,
   ```

### 10.6 Sync Architecture Event Types

The system uses **synchronous execution** (not streaming). Valid event types:
- `session_start`, `session_end`, `complete` (lifecycle)
- `user_message_confirmed` (user message persisted)
- `thinking`, `thinking_complete` (extended thinking)
- `message` (complete assistant response)
- `tool_use`, `tool_result` (tool execution)
- `error` (errors)
- `approval_requested`, `approval_resolved` (human-in-the-loop)
- `turn_paused`, `content_refused` (SDK 0.71+)

**Removed types** (DO NOT USE): `thinking_chunk`, `message_chunk`, `message_partial`

---

## 11. Logging Pattern - Service Context

Always use `createChildLogger` with a service name to enable `LOG_SERVICES` filtering. This allows selective log output during development/debugging.

### 11.1 For Classes

```typescript
import { createChildLogger } from '@/shared/utils/logger';

export class MyService {
  private logger = createChildLogger({ service: 'MyService' });

  doSomething() {
    this.logger.info({ data }, 'Operation completed');
  }
}
```

### 11.2 For Routes/Middleware

```typescript
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'MyRoutes' });

router.get('/path', (req, res) => {
  logger.info('Handling request');
});
```

### 11.3 For Classes with Dependency Injection

```typescript
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';

export class MyService {
  private log: ILoggerMinimal;

  constructor(deps?: { logger?: ILoggerMinimal }) {
    this.log = deps?.logger ?? createChildLogger({ service: 'MyService' });
  }
}
```

### 11.4 Exceptions (use raw `logger` directly)

- `pinoHttp` middleware (`logging.ts`) - requires base logger instance for HTTP logging
- Shared utilities (`retry.ts`) - not service-scoped

### 11.5 Usage

Filter logs by service using `LOG_SERVICES` environment variable:

```bash
# Show only specific services
LOG_SERVICES=AgentOrchestrator,MessageQueue npm run dev

# Show all logs (default)
npm run dev
```

---

## 12. ID Standardization (GUID/UUID)

**CRITICAL RULE**: All IDs (User ID, File ID, Session ID, Workspace ID, etc.) that follow GUID/UUID format MUST be **UPPERCASE** throughout the entire system.

### 12.1 Implementation Rules
1.  **Ingestion Normalization**: When receiving an ID from any external source (API request, CLI input, integration, etc.):
    -   **Backend**: Convert to uppercase immediately upon receipt (e.g., in controllers or DTO transformation). `id.toUpperCase()`.
    -   **Frontend**: Convert to uppercase before sending to backend or storing in state.
    -   **Shared**: Zod schemas for IDs should ideally transform/validate to uppercase.
2.  **Comparison**: All ID comparisons must be done in uppercase.
3.  **Logging**: All IDs written to logs must be uppercase.
4.  **Database**: IDs stored in the database (SQL, Redis, etc.) must be uppercase.
5.  **Constants/Magic Strings**: Any hardcoded IDs in tests or code (e.g., `const TEST_USER_ID = '...'`) must be uppercase.

### 12.2 Examples
```typescript
// ✅ CORRECT
const userId = rawId.toUpperCase();
const sessionId = "A1B2C3D4-E5F6-7890-1234-567890ABCDEF";

// ❌ WRONG
const userId = rawId.toLowerCase(); // Never lowercase
const sessionId = "a1b2c3d4-e5f6-7890-1234-567890abcdef";
```
