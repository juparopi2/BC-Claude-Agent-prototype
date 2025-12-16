# Direct Agent Orchestrator (LangChain Evolution) PRD

**Version**: 3.1.0 (MessageQueue Integration Fix)
**Status**: In Progress / ~98% Complete
**Date**: December 12, 2025
**Last Updated**: December 15, 2025

---

## Implementation Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| **LangGraph StateGraph** | ✅ Complete | 4 nodes: router, orchestrator, bc-agent, rag-agent |
| **ModelFactory** | ✅ Complete | Anthropic, Google VertexAI, OpenAI + Prompt Caching + Extended Thinking |
| **StreamAdapter** | ✅ Complete | LangGraph events → AgentEvent conversion (fixed duplicate tool_use) |
| **Router (Intent Classification)** | ✅ Complete | Slash commands `/bc`, `/search`, `/rag` |
| **BC Agent** | ✅ Complete | 7 meta-tools bound |
| **RAG Agent** | ✅ Complete | SemanticSearchService integration |
| **AgentState Extended** | ✅ Complete | Options for thinking, attachments, fileContext |
| **runGraph() Full Features** | ✅ Complete | Extended Thinking, File Attachments, Semantic Search |
| **runGraph() MessageQueue** | ✅ Complete | **NEW**: tool_use, tool_result, message persistence to `messages` table |
| **runGraph() Token Tracking** | ✅ Complete | **NEW**: TokenUsageService + UsageTrackingService integration |
| **runGraph() Stop Reasons** | ✅ Complete | **NEW**: max_tokens, pause_turn, refusal handling |
| **ChatMessageHandler Migration** | ✅ Complete | Now calls `runGraph()` instead of `executeQueryStreaming()` |
| **Debug Logs Cleanup** | ✅ Complete | console.log → logger.debug() |
| **Unit Tests** | ✅ Passing | 2127/2127 tests passing |
| **Integration Tests** | ✅ Created | `orchestrator.integration.test.ts` (14 tests) |
| **Guardrails** | ⚠️ Pending | Directory exists, no implementation |
| **Legacy Cleanup** | ⚠️ Pending | `executeQueryStreaming()` can be deprecated |

**Overall**: Core migration complete with full MessageQueue integration. Messages and tools now persist correctly. Ready for E2E testing.

---

## 1. Vision & Objectives

The goal is to transition the current monolithic `DirectAgentService` into a strictly typed, scalable **Multi-Agent Orchestration System** utilizing the **LangChain.js** and **LangGraph.js** ecosystem.

This architecture will enable:
1.  **Massive Scalability**: Easily add new specialized agents by defining graph nodes.
2.  **Standardization**: Use LangChain's `BaseChatModel` and `Tool` interfaces for consistent implementation.
3.  **Multi-Model Support**: Dynamically assign models (e.g., `gemini-1.5-pro` for video, `claude-3-5-sonnet` for orchestration, `gpt-4o` for general chat) per agent.
4.  **Resilience**: Leverage LangGraph for state management, persistence, and reliable handoffs (checkpoints).
5.  **Clean Architecture**: Reorganize the codebase into a modular "Screaming Architecture" structure.

---

## 2. Current State vs. Target Architecture

### 2.1 Previous (Monolith) - DEPRECATED
-   `DirectAgentService.executeQueryStreaming()`: ~1200 lines. Mixed concerns.
-   **Model**: Hardcoded `AnthropicClient`.
-   **Routing**: None (Single agent).

### 2.2 Current (LangGraph Network) - ACTIVE
-   **Orchestrator (Main Node)**: Router using Claude Haiku for intent classification.
-   **State**: Extended `AgentState` with options, fileContext, and context.
-   **Specialized Agents (Nodes)**:
    -   `BusinessCentralAgent` (Tools: 7 meta-tools for BC data).
    -   `SemanticKnowledgeAgent` (Tools: RAG, Vector Search).
    -   `(Future) VideoAgent` (Model: Gemini 1.5 Pro).
-   **Entry Point**: `DirectAgentService.runGraph()` called from `ChatMessageHandler`.

---

## 3. Detailed Architecture

### 3.1 Folder Structure (Screaming Architecture)

```text
src/
  core/
    langchain/
      ModelFactory.ts       # Multi-provider model instantiation + Caching + Thinking
      ModelFactory.test.ts  # Unit tests (8 tests)
      StreamAdapter.ts      # LangGraph → AgentEvent conversion

  modules/
    agents/
      core/
        AgentFactory.ts     # IAgentNode interface, BaseAgent class
        guards/             # Input/Output Guardrails (pending)

      orchestrator/
        graph.ts            # StateGraph definition (4 nodes)
        router.ts           # Intent classification with Claude Haiku
        state.ts            # AgentState Annotation (extended)
        check_graph.ts      # Manual verification script

      business-central/
        bc-agent.ts         # BusinessCentralAgent node
        bc-agent.test.ts    # Unit tests (2/2 passing)
        tools.ts            # 7 BC meta-tools (LangChain format)

      rag-knowledge/
        rag-agent.ts        # RAGAgent node
        rag-agent.test.ts   # Unit tests (3/3 passing)
        tools.ts            # search_knowledge_base tool
```

### 3.2 Extended AgentState

```typescript
// Current State Definition (state.ts)
interface AgentState {
  messages: BaseMessage[];
  activeAgent: string; // 'orchestrator' | 'bc-agent' | 'rag-agent'
  context: {
    userId?: string;
    sessionId?: string;
    modelPreferences?: ModelConfig;
    options?: {
      enableThinking?: boolean;      // Extended Thinking support
      thinkingBudget?: number;       // Token budget (min 1024)
      attachments?: string[];        // File IDs
      enableAutoSemanticSearch?: boolean;
    };
    fileContext?: FileContextResult; // Prepared file content for injection
  };
}
```

### 3.3 ModelFactory Features

```typescript
const model = ModelFactory.create({
  provider: 'anthropic',
  modelName: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  enableCaching: true,     // Prompt Caching (beta header)
  enableThinking: true,    // Extended Thinking
  thinkingBudget: 10000,   // Token budget
});
```

---

## 4. Migration Plan (Minimal Breakage)

### Phase 1: Infrastructure (Non-Breaking) ✅ COMPLETE
1.  ✅ **Dependencies**: Installed `@langchain/core`, `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/google-vertexai`, `@langchain/openai`.
2.  ✅ **ModelFactory**: Multi-provider support with Prompt Caching and Extended Thinking.
3.  ✅ **Tools**: 7 BC meta-tools migrated to LangChain `tool()` format.

### Phase 2: The Orchestrator ✅ COMPLETE
1.  ✅ **Graph Setup**: `StateGraph` created with 4 nodes.
2.  ✅ **Streaming Adapter**: `StreamAdapter` converts LangGraph events to `AgentEvent` format.
3.  ✅ **Router**: Intent classification with slash commands (`/bc`, `/search`, `/rag`).

### Phase 3: Agent Split ✅ COMPLETE
1.  ✅ **BC Agent**: 7 meta-tools bound with system prompt.
2.  ✅ **RAG Agent**: SemanticSearchService integration with userId context.

### Phase 4: Integration ✅ COMPLETE
1.  ✅ **runGraph()**: Full implementation with Extended Thinking, File Attachments, Semantic Search.
2.  ✅ **Response Extraction**: Final response extracted from graph state.
3.  ✅ **Unit Tests**: 5/5 orchestrator agent tests passing.

### Phase 5: Full Migration ✅ COMPLETE
1.  ✅ **ChatMessageHandler**: Now calls `runGraph()` instead of `executeQueryStreaming()`.
2.  ✅ **Debug Cleanup**: All `console.log` converted to `logger.debug()`.
3.  ✅ **Test Updates**: All mocks updated for `runGraph()` method.
4.  ✅ **Integration Tests**: Created `orchestrator.integration.test.ts` (14 tests).

### Phase 6: Production Hardening ⚠️ PENDING
1.  ⬜ **Guardrails**: Input/output validation in `core/guards/`.
2.  ⬜ **Legacy Cleanup**: Deprecate/remove `executeQueryStreaming()`.
3.  ⬜ **LangSmith**: Optional tracing for debugging.
4.  ⬜ **E2E Manual Testing**: Full frontend-to-backend validation.

---

## 5. Requirements for "LangChain-ification"

-   **Type Safety**: Strict TS config for all new modules. ✅
-   **Environment Variables**:
    -   `ANTHROPIC_API_KEY` (Existing) ✅
    -   `AZURE_OPENAI_KEY` (Existing) ✅
    -   `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_API_KEY` (For Gemini - optional)
-   **Guardrails**:
    -   Implement "System Message" checks to ensure agents don't hallucinate capabilities. ⚠️ Pending

---

## 6. Testing Strategy

| Test Type | Status | Notes |
|-----------|--------|-------|
| **Unit Tests** | ✅ 2127 passing | Full coverage of existing functionality |
| **ModelFactory Tests** | ✅ 8 passing | Caching, Thinking, validation |
| **BC Agent Tests** | ✅ 2 passing | Tool binding and invocation |
| **RAG Agent Tests** | ✅ 3 passing | UserId validation, model invocation |
| **Integration Tests** | ✅ 14 created | Routing, streaming, error handling |
| **E2E Tests** | ⚠️ Pending | Manual frontend testing required |

---

## 7. Implemented Files Reference

### Core Infrastructure
```
backend/src/core/langchain/
├── ModelFactory.ts          # Multi-provider + Caching + Thinking (126 lines)
├── ModelFactory.test.ts     # Unit tests (8 tests)
└── StreamAdapter.ts         # LangGraph → AgentEvent conversion (82 lines)
```

### Agent Modules (Screaming Architecture)
```
backend/src/modules/agents/
├── core/
│   └── AgentFactory.ts              # IAgentNode interface, BaseAgent class
├── orchestrator/
│   ├── graph.ts                     # StateGraph definition (4 nodes)
│   ├── router.ts                    # Intent classification with Claude Haiku
│   ├── state.ts                     # Extended AgentState Annotation
│   └── check_graph.ts               # Manual verification script
├── business-central/
│   ├── bc-agent.ts                  # BusinessCentralAgent node (97 lines)
│   ├── bc-agent.test.ts             # Unit tests (2/2 passing)
│   └── tools.ts                     # 7 BC meta-tools (681 lines)
└── rag-knowledge/
    ├── rag-agent.ts                 # RAGAgent node (53 lines)
    ├── rag-agent.test.ts            # Unit tests (3/3 passing)
    └── tools.ts                     # search_knowledge_base tool (48 lines)
```

### Integration Points
```
backend/src/services/agent/DirectAgentService.ts
└── runGraph()                       # Lines 2581-2840 - Full LangGraph invocation
                                     # Supports: Extended Thinking, Attachments, Semantic Search

backend/src/services/websocket/ChatMessageHandler.ts
└── handle()                         # Line 242 - Calls runGraph() (was executeQueryStreaming)
```

### Tests
```
backend/src/__tests__/
├── integration/agent/
│   └── orchestrator.integration.test.ts  # 14 integration tests (745 lines)
└── unit/services/websocket/
    └── ChatMessageHandler.test.ts        # 22 tests (updated for runGraph)
```

---

## 8. Pending Tasks

### High Priority (P0)
| Task | Description | Effort |
|------|-------------|--------|
| **E2E Manual Testing** | Test full flow with frontend: `/bc`, `/search`, attachments | 2-4 hours |
| **Guardrails Implementation** | Input validation, output sanitization in `core/guards/` | 4-6 hours |
| **Smart Slash Commands** | Backend discovery endpoint + Frontend autocomplete/styling (TDD) | 6-8 hours |

### Medium Priority (P1)
| Task | Description | Effort |
|------|-------------|--------|
| **Deprecate executeQueryStreaming** | Mark as `@deprecated`, plan removal | 1 hour |
| **LangSmith Integration** | Optional tracing for production debugging | 2-3 hours |
| **Performance Benchmarks** | Compare runGraph vs executeQueryStreaming latency | 2 hours |

### Low Priority (P2)
| Task | Description | Effort |
|------|-------------|--------|
| **Video Agent** | Add Gemini 1.5 Pro agent for video/long context | 8+ hours |
| **Graph Checkpoints** | Implement LangGraph persistence for recovery | 4-6 hours |
| **Remove Legacy Code** | Delete executeQueryStreaming after validation | 1 hour |

---

## 9. Known Issues

1. **Type-check Memory**: `tsc --noEmit` runs out of memory on large codebase. Use `npm run build` instead.
2. **Integration Tests Excluded**: Vitest config excludes `*.integration.test.ts` from default run. Use explicit path to run them.

---

## 10. Changelog

| Date | Version | Change |
|------|---------|--------|
| 2025-12-15 | 3.1.0 | **MessageQueue Integration Fix**: runGraph() now properly persists tool_use, tool_result, and messages to `messages` table via MessageQueue. Fixed toolUseId inconsistency in StreamAdapter (removed duplicate emission from content array). Added Extended Thinking initial event. Added TokenUsageService integration. Added stop_reason handling (max_tokens, pause_turn, refusal). |
| 2025-12-13 | 3.0.0 | **Full Migration**: ChatMessageHandler now uses runGraph(), Extended Thinking/Attachments/Semantic Search integrated, 2127 tests passing |
| 2025-12-13 | 2.2.0 | ModelFactory extended with Prompt Caching and Extended Thinking support |
| 2025-12-13 | 2.1.1 | AgentState extended with options, fileContext for full feature parity |
| 2025-12-12 | 2.1.0 | Phase 4 complete: Response extraction, test fixes, 7 BC tools |
| 2025-12-12 | 2.0.0 | Initial LangGraph infrastructure: StateGraph, ModelFactory, StreamAdapter |

---

## 11. Quick Start

### Test the Orchestrator
```bash
# Run unit tests
cd backend && npm test

# Run orchestrator integration tests specifically
cd backend && npx vitest run src/__tests__/integration/agent/orchestrator.integration.test.ts

# Run lint
cd backend && npm run lint
```

### Use Slash Commands (Frontend)
- `/bc <query>` - Routes to Business Central Agent
- `/search <query>` - Routes to RAG Knowledge Agent
- `/rag <query>` - Alias for semantic search

  }
}
```

---

## 12. Specification: Smart Slash Commands (TDD)

**Objective**: enhance discoverability and UX of agent capabilities using TDD.

### 12.1 Requirements
1.  **Backend Metadata Endpoint**:
    -   `GET /api/agents/commands`
    -   Return: `[{ command: "/bc", description: "Business Central", agentId: "bc-agent", color: "blue" }, ...]`
2.  **Frontend Autocomplete**:
    -   Detect `/` in `ChatInput`.
    -   Show popup/dropdown with available commands.
    -   Filter as user types (e.g., `/b` -> `/bc`).
3.  **Visual Styling**:
    -   Render selected command as a "chip" or colored text in the input.
    -   Color-code based on the agent (e.g., BC=Green, RAG=Blue).

### 12.2 TDD Implementation Plan

#### Cycle 1: Backend Metadata (TDD)
1.  **Red**: Write test `GET /api/agents/commands` -> Expect 404 (does not exist).
2.  **Green**: Implement simple route returning hardcoded list.
3.  **Refactor**: standardise the `AgentRegistry` to dynamically return bound tools/agents.

#### Cycle 2: Frontend Command Logic (TDD)
1.  **Red**: Create `CommandSuggester.test.ts`. `detectCommand('/')` should return true.
2.  **Green**: Implement detection logic.
3.  **Refactor**: Extract to custom hook `useCommandSuggestions`.

#### Cycle 3: Components (Component Testing)
-   Test `CommandPopup` renders list.
-   Test clicking item inserts text.

