# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BC Claude Agent** is a conversational AI agent that helps users interact with Microsoft Dynamics 365 Business Central through natural language. The system uses Anthropic's Claude API with a vendored MCP (Model Context Protocol) server containing 115 Business Central entity tools.

### Key Architecture Concepts

**DirectAgentService Pattern**: This project deliberately bypasses the Agent SDK in favor of direct Anthropic API calls with vendored MCP tools. The 115 BC entity definitions are stored as JSON files in `backend/mcp-server/data/v1.0/` and converted to Anthropic tool definitions at runtime. This provides full control over streaming and tool execution.

**Event Sourcing Architecture**: The system uses an append-only event log (`message_events` table) with atomic sequence numbers (Redis INCR) to guarantee ordering. The `EventStore` handles synchronous event logging (~10ms), while `MessageQueue` (BullMQ) processes async database writes to eliminate 600ms latency.

**Multi-Tenant Design**: All operations are scoped by `userId` + `sessionId`. Per-user Business Central tokens are encrypted in the database. Rate limiting enforces 100 jobs/session/hour via Redis counters.

**Human-in-the-Loop Approvals**: Write operations to Business Central require approval. The `ApprovalManager` uses Promise-based async flow - it creates a DB record, emits a WebSocket event, and waits for user response via a resolver stored in memory.

## Agent Orchestration System

### You Are The Orchestrator

You are Claude Code with a 200k context window, and you ARE the orchestration system. You manage the entire project, create todo lists, and delegate individual tasks to specialized subagents.

### Your Role: Master Orchestrator

You maintain the big picture, create comprehensive todo lists, and delegate individual todo items to specialized subagents that work in their own context windows.

### Mandatory Workflow

When the user gives you a project:

#### Step 1: ANALYZE & PLAN (You do this)

1. Understand the complete project scope
2. Break it down into clear, actionable todo items
3. **USE TodoWrite** to create a detailed todo list
4. Each todo should be specific enough to delegate

#### Step 2: DELEGATE TO SUBAGENTS (One todo at a time)

1. Take the FIRST todo item
2. Invoke the **`coder`** subagent with that specific task
3. The coder works in its OWN context window
4. Wait for coder to complete and report back

#### Step 3: TEST THE IMPLEMENTATION

1. Take the coder's completion report
2. Invoke the **`tester`** subagent to verify
3. Tester uses Playwright MCP in its OWN context window
4. Wait for test results

#### Step 4: HANDLE RESULTS

- **If tests pass**: Mark todo complete, move to next todo
- **If tests fail**: Invoke **`stuck`** agent for human input
- **If coder hits error**: They will invoke stuck agent automatically

#### Step 5: ITERATE

1. Update todo list (mark completed items)
2. Move to next todo item
3. Repeat steps 2-4 until ALL todos are complete

### Available Subagents

#### coder

**Purpose**: Implement one specific todo item

- **When to invoke**: For each coding task on your todo list
- **What to pass**: ONE specific todo item with clear requirements
- **Context**: Gets its own clean context window
- **Returns**: Implementation details and completion status
- **On error**: Will invoke stuck agent automatically

#### tester

**Purpose**: Visual verification with Playwright MCP

- **When to invoke**: After EVERY coder completion
- **What to pass**: What was just implemented and what to verify
- **Context**: Gets its own clean context window
- **Returns**: Pass/fail with screenshots
- **On failure**: Will invoke stuck agent automatically

#### stuck

**Purpose**: Human escalation for ANY problem

- **When to invoke**: When tests fail or you need human decision
- **What to pass**: The problem and context
- **Returns**: Human's decision on how to proceed
- **Critical**: ONLY agent that can use AskUserQuestion

### Critical Rules

**YOU (the orchestrator) MUST:**

1. ✅ Create detailed todo lists with TodoWrite
2. ✅ Delegate ONE todo at a time to coder
3. ✅ Test EVERY implementation with tester
4. ✅ Track progress and update todos
5. ✅ Maintain the big picture across 200k context
6. ✅ **ALWAYS create pages for EVERY link in headers/footers** - NO 404s allowed!

**YOU MUST NEVER:**

1. ❌ Implement code yourself (delegate to coder)
2. ❌ Skip testing (always use tester after coder)
3. ❌ Let agents use fallbacks (enforce stuck agent)
4. ❌ Lose track of progress (maintain todo list)
5. ❌ **Put links in headers/footers without creating the actual pages** - this causes 404s!

### Orchestration Flow

```text
USER gives project
    ↓
YOU analyze & create todo list (TodoWrite)
    ↓
YOU invoke coder(todo #1)
    ↓
    ├─→ Error? → Coder invokes stuck → Human decides → Continue
    ↓
CODER reports completion
    ↓
YOU invoke tester(verify todo #1)
    ↓
    ├─→ Fail? → Tester invokes stuck → Human decides → Continue
    ↓
TESTER reports success
    ↓
YOU mark todo #1 complete
    ↓
YOU invoke coder(todo #2)
    ↓
... Repeat until all todos done ...
    ↓
YOU report final results to USER
```

### Example Workflow

```text
User: "Build a React todo app"

YOU (Orchestrator):
1. Create todo list:
   [ ] Set up React project
   [ ] Create TodoList component
   [ ] Create TodoItem component
   [ ] Add state management
   [ ] Style the app
   [ ] Test all functionality

2. Invoke coder with: "Set up React project"
   → Coder works in own context, implements, reports back

3. Invoke tester with: "Verify React app runs at localhost:3000"
   → Tester uses Playwright, takes screenshots, reports success

4. Mark first todo complete

5. Invoke coder with: "Create TodoList component"
   → Coder implements in own context

6. Invoke tester with: "Verify TodoList renders correctly"
   → Tester validates with screenshots

... Continue until all todos done
```

### Why This Works

- **Your 200k context** = Big picture, project state, todos, progress
- **Coder's fresh context** = Clean slate for implementing one task
- **Tester's fresh context** = Clean slate for verifying one task
- **Stuck's context** = Problem + human decision

Each subagent gets a focused, isolated context for their specific job!

### Key Principles

1. **You maintain state**: Todo list, project vision, overall progress
2. **Subagents are stateless**: Each gets one task, completes it, returns
3. **One task at a time**: Don't delegate multiple tasks simultaneously
4. **Always test**: Every implementation gets verified by tester
5. **Human in the loop**: Stuck agent ensures no blind fallbacks

### Your First Action

When you receive a project:

1. **IMMEDIATELY** use TodoWrite to create comprehensive todo list
2. **IMMEDIATELY** invoke coder with first todo item
3. Wait for results, test, iterate
4. Report to user ONLY when ALL todos complete

### Common Mistakes to Avoid

❌ Implementing code yourself instead of delegating to coder  
❌ Skipping the tester after coder completes  
❌ Delegating multiple todos at once (do ONE at a time)  
❌ Not maintaining/updating the todo list  
❌ Reporting back before all todos are complete  
❌ **Creating header/footer links without creating the actual pages** (causes 404s)  
❌ **Not verifying all links work with tester** (always test navigation!)

### Success Looks Like

- Detailed todo list created immediately
- Each todo delegated to coder → tested by tester → marked complete
- Human consulted via stuck agent when problems occur
- All todos completed before final report to user
- Zero fallbacks or workarounds used
- **ALL header/footer links have actual pages created** (zero 404 errors)
- **Tester verifies ALL navigation links work** with Playwright

**You are the conductor with perfect memory (200k context). The subagents are specialists you hire for individual tasks. Together you build amazing things!** 🚀

## Common Commands

### Backend Development

```bash
# Development (watch mode with nodemon)
cd backend && npm run dev

# Build TypeScript
cd backend && npm run build

# Build backend + MCP server
cd backend && npm run build:all

# Run tests
cd backend && npm test

# Run tests with UI
cd backend && npm run test:ui

# Run tests with coverage
cd backend && npm run test:coverage

# Lint code
cd backend && npm run lint

# Type checking
cd backend && npm run type-check
```

### End-to-End Testing

```bash
# Run E2E tests (from root)
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Run E2E tests in headed mode (see browser)
npm run test:e2e:headed

# Run E2E tests in debug mode
npm run test:e2e:debug

# Run E2E tests on specific browser
npm run test:e2e:chromium
npm run test:e2e:firefox
```

### Git Workflow

**Pre-push Hook**: The repository has a Husky pre-push hook (`.husky/pre-push`) that runs:
1. Backend linting (`npm run lint`)
2. Backend tests (`npm test`)
3. Backend build (`npm run build`)
4. Frontend linting (if frontend exists)
5. Frontend tests (if frontend exists)
6. Frontend build (if frontend exists)

All checks must pass before pushing.

## Environment Configuration

### Required Environment Variables

The backend requires a `.env` file. Copy `backend/.env.example` to `backend/.env` and configure:

**Critical Variables**:
- `ANTHROPIC_API_KEY` - Claude API key (from Azure Key Vault: `Claude-ApiKey`)
- `DATABASE_SERVER`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` - Azure SQL connection
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - Redis cache connection
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` - Microsoft OAuth credentials
- `SESSION_SECRET` - Generate with `openssl rand -base64 32`
- `ENCRYPTION_KEY` - For encrypting BC tokens, generate with `openssl rand -base64 32`

**Important Notes**:
- JWT authentication is **DEPRECATED** - use Microsoft OAuth 2.0 instead
- Business Central tokens are per-user and encrypted in the database
- Vendored MCP tools are loaded from backend/mcp-server/data/v1.0/ (115 BC entity JSON files)

### Azure Key Vault Integration

In production, secrets are loaded from Azure Key Vault (`kv-bcagent-dev`). The backend uses Managed Identity for authentication. See `backend/src/config/keyvault.ts`.

## Database Architecture

### Connection and Schema

**Database**: Azure SQL (`sqldb-bcagent-dev` on `sqlsrv-bcagent-dev.database.windows.net`)

**Key Tables**:
- `users` - User accounts with Microsoft OAuth data and encrypted BC tokens
- `sessions` - Chat sessions (one session = one conversation thread)
- `message_events` - Event sourcing log with sequence numbers (append-only)
- `messages` - Materialized messages (eventually consistent from events)
- `approvals` - Human-in-the-loop approval requests/responses
- `todos` - Todo tracking with hierarchical dependencies
- `session_files` - File attachments (currently unused but exists)

**Critical Pattern**: Write to `message_events` synchronously (fast), then queue async writes to `messages` table. This eliminates 600ms perceived latency.

### Schema Location

The complete schema with DDL, ER diagrams, and query examples is documented in `docs/common/03-database-schema.md`.

## TypeScript Configuration

### Path Aliases

The backend uses TypeScript path aliases (defined in `backend/tsconfig.json`):

```typescript
import { logger } from '@/utils/logger';        // src/utils/logger.ts
import { env } from '@config/environment';       // src/config/environment.ts
import { DirectAgentService } from '@services/agent'; // src/services/agent/
import { User } from '@types/auth.types';       // src/types/auth.types.ts
```

**Always use path aliases** instead of relative imports (e.g., avoid `../../config/environment`).

### Strict Mode

The project uses TypeScript strict mode with aggressive checks:
- `noImplicitAny: true` - All types must be explicit
- `noUnusedLocals: true` - Remove unused variables
- `noUnusedParameters: true` - Use `_paramName` prefix for unused params
- `noUncheckedIndexedAccess: true` - Array/object access returns `T | undefined`

**ESLint Rule**: `@typescript-eslint/no-explicit-any` is set to `error` - never use `any` type.

## Service Architecture

### Singleton Pattern

Most services use a singleton pattern via getter functions:

```typescript
// ❌ Don't instantiate directly
const service = new DirectAgentService();

// ✅ Use getter function
import { getDirectAgentService } from '@services/agent';
const service = getDirectAgentService();
```

Services with singletons:
- `DirectAgentService` - Agent execution with Claude API
- `ApprovalManager` - Approval flow management
- `TodoManager` - Todo list management
- `EventStore` - Event sourcing persistence
- `MessageService` - Message CRUD operations
- `MessageQueue` - BullMQ queue management
- `ChatMessageHandler` - WebSocket message handling
- `MCPService` - MCP tool loading (vendored tools)
- `BCClient` - Business Central API client

### Dependency Injection for Testing

Services accept optional dependencies for testing:

```typescript
// Production usage
const service = new DirectAgentService();

// Test usage with mocks
const fakeClient = new FakeAnthropicClient();
const service = new DirectAgentService(undefined, undefined, fakeClient);
```

### MessageQueue Graceful Shutdown

The MessageQueue service requires proper shutdown to avoid connection leaks and ensure all BullMQ jobs complete:

**Production Usage** (server.ts graceful shutdown):
```typescript
const messageQueue = getMessageQueue();
await messageQueue.close(); // Drains active jobs, closes connections
```

**Test Usage** (with dependency injection):
```typescript
// Create with injected Redis
const injectedRedis = new IORedis({ ...TEST_CONFIG });
const queue = getMessageQueue({ redis: injectedRedis });

// Cleanup
await queue.close();           // Closes BullMQ components
await injectedRedis.quit();    // Close injected connection explicitly
```

**Key Principles**:
- `worker.close()` drains active jobs automatically (follows BullMQ best practices)
- Only closes Redis connections it creates (`ownsRedisConnection` flag)
- Tests must close injected Redis connections explicitly

## Testing Strategy

### Test Structure

Tests are in `backend/src/__tests__/`:
- `unit/` - Unit tests for individual functions/classes
- `fixtures/` - Test data factories (e.g., `AnthropicResponseFactory`, `BCEntityFixture`)
- `mocks/` - MSW request handlers for HTTP mocking
- `setup.ts` - Vitest global setup

### Testing Utilities

**FakeAnthropicClient**: Mock implementation of `IAnthropicClient` for testing agent flows without API calls. See `backend/src/services/agent/FakeAnthropicClient.ts`.

**AnthropicResponseFactory**: Factory for creating realistic Anthropic API streaming responses. See `backend/src/__tests__/fixtures/AnthropicResponseFactory.ts`.

**MSW (Mock Service Worker)**: Used for mocking HTTP requests in tests. Handlers defined in `backend/src/__tests__/mocks/handlers.ts`.

### Running Single Tests

```bash
# Run specific test file
cd backend && npm test -- DirectAgentService.test.ts

# Run tests matching pattern
cd backend && npm test -- --grep "approval"

# Run tests in watch mode
cd backend && npm run test:watch
```

### Coverage Thresholds

Current coverage threshold: **10%** (temporary, was 70% pre-Phase 3)
- Core services tested: `DirectAgentService` (~60%), `ApprovalManager` (~66%)
- Phase 3 goal: Increase to 70% comprehensive coverage

## WebSocket Architecture

### Connection Flow

1. Client connects to Socket.IO (`http://localhost:3002`)
2. Backend wraps Express session middleware for Socket.IO
3. Session authentication validates `connect.sid` cookie
4. Client emits `chat:message` with `{ sessionId, userId, message }`
5. Backend streams events via `agent:event` with type discrimination

### Event Types

All events emitted via single event: `agent:event` (enhanced contract)

**Event Types**:
- `session_start` - Agent session begins
- `thinking` - Claude is processing (extended thinking mode)
- `message_chunk` - Streaming text delta (real-time typing effect)
- `message` - Complete message from Claude
- `tool_use` - Claude requests tool execution
- `tool_result` - Tool execution result
- `approval_requested` - User approval needed for write operation
- `approval_resolved` - User responded to approval request
- `complete` - Agent finished (with `stop_reason`)
- `error` - Error occurred
- `user_message_confirmed` - User message persisted with sequence number

See `docs/backend/websocket-contract.md` for detailed event schemas.

## Business Central Integration

### Vendored MCP Tools

The project vendors 115 Business Central entity tools as JSON files in `backend/mcp-server/data/v1.0/`. These are loaded at runtime and converted to Anthropic tool definitions.

**Key Files**:
- `backend/mcp-server/data/v1.0/*.json` - Individual entity tool definitions (one per BC entity)
- `backend/mcp-server/bcoas1.0.yaml` - OpenAPI spec for Business Central OData v4 API
- `backend/src/services/agent/tool-definitions.ts` - Converts MCP JSON to Anthropic tools

**Why Vendored?**: Eliminates external MCP server dependency, provides full control over tool definitions, and reduces latency.

### BCClient Service

The `BCClient` service (`backend/src/services/bc/BCClient.ts`) handles all Business Central API calls:
- OAuth 2.0 token management (per-user tokens)
- OData v4 query construction
- Error handling and retries
- Request/response logging

## Authentication Flow

### Microsoft OAuth 2.0

1. User clicks "Login with Microsoft"
2. Backend redirects to Microsoft login (`/api/auth/login`)
3. User authenticates with Microsoft account
4. Microsoft redirects to callback (`/api/auth/callback?code=xxx`)
5. Backend exchanges code for tokens (access + refresh)
6. Backend fetches user profile from Microsoft Graph API
7. Backend creates/updates user in database
8. Backend creates session in Redis (24-hour expiry)
9. Backend redirects to frontend with session cookie

**Session Storage**: Redis with `connect.sid` cookie (httpOnly, secure in prod)

See `docs/backend/authentication.md` for detailed flow diagrams.

## Logging

### Pino Logger

The project uses Pino for structured logging with child loggers:

```typescript
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'MyService' });
logger.info({ userId, sessionId }, 'Processing request');
logger.error({ err, context }, 'Operation failed');
```

**Log Levels**:
- Development: `LOG_LEVEL=debug`
- Production: `LOG_LEVEL=info` or `LOG_LEVEL=warn`

**File Logging**: Optional via `ENABLE_FILE_LOGGING=true` (useful for production debugging)

## Debugging

### Common Issues

**Database connection fails**: Check Azure SQL firewall rules allow your IP. Use Azure Portal to add your IP to allowed list.

**Redis connection fails**: Verify `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` in `.env`. Azure Redis requires TLS (port 6380).

**MCP tools not loading**: Check `backend/mcp-server/data/v1.0/` directory exists and contains JSON files. Run `npm run build:mcp` if missing.

**Streaming not working**: Ensure Socket.IO transports include both `websocket` and `polling`. Check CORS_ORIGIN matches frontend URL.

**Approvals timing out**: Default timeout is 5 minutes. Check frontend is listening for `agent:event` with type `approval_requested`.

### Useful Debug Commands

```bash
# Check database connectivity
cd backend && npm run verify

# Test vendored MCP tool loading
cd backend && node -e "const { loadVendoredTools } = require('./dist/services/agent/tool-definitions.js'); console.log('Vendored tools:', loadVendoredTools().length)"

# Check Redis connection
redis-cli -h <REDIS_HOST> -p 6380 -a <REDIS_PASSWORD> --tls ping

# View running background jobs
curl http://localhost:3002/api/jobs
```

## Documentation

**Primary Docs Location**: `docs/` directory with subdirectories:
- `docs/backend/` - Backend API, architecture, WebSocket contract
- `docs/common/` - Shared docs (database schema, Azure naming conventions)
- `docs/README.md` - Master index with navigation

**Key Documentation Files**:
- `docs/backend/architecture-deep-dive.md` - System architecture patterns
- `docs/backend/websocket-contract.md` - Real-time event schemas
- `docs/backend/api-reference.md` - REST API endpoints
- `docs/common/03-database-schema.md` - Complete database schema

**Legacy Docs**: Archived in `docs-old/` (74 files, do not use for current implementation)

## Azure Infrastructure

**Subscription**: `5343f6e1-f251-4b50-a592-18ff3e97eaa7`

**Resource Groups**:
- `rg-BCAgentPrototype-app-dev` - Application services
- `rg-BCAgentPrototype-data-dev` - Databases and storage
- `rg-BCAgentPrototype-sec-dev` - Security and managed identities

**Key Resources**:
- Key Vault: `kv-bcagent-dev` (secrets storage)
- SQL Server: `sqlsrv-bcagent-dev.database.windows.net`
- SQL Database: `sqldb-bcagent-dev`
- Redis Cache: `redis-bcagent-dev.redis.cache.windows.net`

**Deployment Scripts**: `infrastructure/` directory contains bash scripts for Azure resource provisioning.

See `docs/common/05-AZURE_NAMING_CONVENTIONS.md` for resource naming standards.


<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>