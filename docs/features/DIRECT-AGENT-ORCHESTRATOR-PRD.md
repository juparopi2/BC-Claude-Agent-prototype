# Direct Agent Orchestrator (LangChain Evolution) PRD

**Version**: 2.1.0 (LangChain Pivot)
**Status**: In Progress / ~85% Complete
**Date**: December 12, 2025
**Last Updated**: December 12, 2025

---

## Implementation Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| **LangGraph StateGraph** | ✅ Complete | 4 nodes: router, orchestrator, bc-agent, rag-agent |
| **ModelFactory** | ✅ Complete | Anthropic, Google VertexAI, OpenAI support |
| **StreamAdapter** | ✅ Complete | LangGraph events → AgentEvent conversion |
| **Router (Intent Classification)** | ✅ Complete | Slash commands `/bc`, `/search`, `/rag` |
| **BC Agent** | ✅ Complete | 7 meta-tools bound |
| **RAG Agent** | ✅ Complete | SemanticSearchService integration |
| **DirectAgentService Integration** | ✅ Complete | Graph invocation + response extraction |
| **Unit Tests** | ✅ Passing | 5/5 orchestrator tests passing |
| **Guardrails** | ⚠️ Pending | Directory exists, no implementation |
| **Feature Flag** | ⚠️ Pending | Optional for safe rollout |

**Overall**: Core infrastructure complete. Ready for integration testing.

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

### 2.1 Current (Monolith)
-   `DirectAgentService.ts`: ~2500 lines. Mixed concerns (Tools, LLM calls, Context).
-   **Model**: Hardcoded `AnthropicClient`.
-   **Routing**: None (Single agent).

### 2.2 Target (LangGraph Network)
-   **Orchestrator (Main Node)**: A lightweight router using a fast/smart model (e.g., Claude 3.5 Sonnet or GPT-4o).
-   **State**: Shared `AgentState` object passed between nodes.
-   **Specialized Agents (Nodes)**:
    -   `BusinessCentralAgent` (Tools: Transactional, read/write BC data).
    -   `SemanticKnowledgeAgent` (Tools: RAG, Vector Search, Summary).
    -   `(Future) VideoAgent` (Model: Gemini 1.5 Pro).
-   **Framework**: `@langchain/langgraph` for orchestration, `@langchain/core` for interfaces.

---

## 3. Detailed Architecture

### 3.1 Folder Structure (Screaming Architecture)
We will refactor `backend/src/services/agent` to be module-centric.

```text
src/
  modules/
    agents/
      core/                 # Shared logic
        AgentFactory.ts     # Instantiates generic agents
        ModelFactory.ts     # Returns configured ChatModel (Anthropic/Google/OpenAI)
        guards/             # Input/Output Guardrails
      
      orchestrator/         # The Supervisor
        graph.ts            # StateGraph definition
        prompt.ts           # System prompt for routing
      
      business-central/     # Business Central Agent
        index.ts            # Node definition
        tools/              # BC specific tools
      
      rag-knowledge/        # Semantic Search Agent
        index.ts            # Node definition
        tools/              # Vector search tools
```

### 3.2 The Graph (LangGraph)
We will use a `StateGraph` where nodes are agents and edges are routing decisions.

```typescript
// Shared State Definition
interface AgentState {
  messages: BaseMessage[];
  activeAgent: string; // 'orchestrator' | 'bc-agent' | 'rag-agent'
  context: {
    userId: string;
    sessionId: string;
    modelPreferences: ModelConfig;
  };
}

// Graph Flow
const workflow = new StateGraph<AgentState>({ channels: ... })
  .addNode("orchestrator", orchestratorNode)
  .addNode("bc_agent", bcAgentNode)
  .addNode("rag_agent", ragAgentNode)
  .addEdge(START, "orchestrator")
  .addConditionalEdges("orchestrator", routeIntent); // Logic to pick next node
```

### 3.3 Multi-Model Strategy
We will introduce a `ModelRegistry` to handle environment variables and instantiation.

**Supported Providers**:
-   **Anthropic**: `ChatAnthropic` (Claude 3.5 Sonnet, Haiku, Opus)
-   **Google VertexAI**: `ChatVertexAI` (Gemini 1.5 Pro - *Best for Video/Long Context*)
-   **Azure OpenAI**: `ChatOpenAI` (GPT-4o, o1)

**Configuration**:
Each agent node will initialize its own model instance via factory:
```typescript
const model = ModelFactory.create({
  provider: 'google', 
  modelName: 'gemini-1.5-pro',
  temperature: 0.2
});
```

---

## 4. Migration Plan (Minimal Breakage)

We must maintain the existing `DirectAgentService` class reference to avoid breaking `socket.ts` and other consumers, but gut its internals to use the new runner.

### Phase 1: Infrastructure (Non-Breaking) ✅ COMPLETE
1.  ✅ **Dependencies**: Installed `@langchain/core`, `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/google-vertexai`, `@langchain/openai`.
2.  ✅ **ModelFactory**: Implemented in `backend/src/core/langchain/ModelFactory.ts` - supports Anthropic, Google VertexAI, OpenAI.
3.  ✅ **Tools**: 7 BC meta-tools migrated to LangChain `tool()` format in `backend/src/modules/agents/business-central/tools.ts`.

### Phase 2: The Orchestrator (Parallel) ✅ COMPLETE
1.  ✅ **Graph Setup**: `StateGraph` created with 4 nodes in `backend/src/modules/agents/orchestrator/graph.ts`.
2.  ✅ **Streaming Adapter**: `StreamAdapter` in `backend/src/core/langchain/StreamAdapter.ts` converts LangGraph events to `AgentEvent` format.
3.  ✅ **Router**: Intent classification with Claude Haiku in `backend/src/modules/agents/orchestrator/router.ts`.

### Phase 3: Agent Split ✅ COMPLETE
1.  ✅ **BC Agent**: 7 meta-tools in `modules/agents/business-central/`:
    - `list_all_entities` - List all BC entities
    - `search_entity_operations` - Search by keyword
    - `get_entity_details` - Entity details
    - `get_entity_relationships` - Entity relationships
    - `validate_workflow_structure` - Validate workflows
    - `build_knowledge_base_workflow` - Build workflow docs
    - `get_endpoint_documentation` - Endpoint docs
2.  ✅ **RAG Agent**: Implemented in `modules/agents/rag-knowledge/` with `SemanticSearchService` integration.

### Phase 4: Integration ✅ COMPLETE
1.  ✅ **Switchover**: `DirectAgentService.runGraph()` invokes `orchestratorGraph.streamEvents()`.
2.  ✅ **Response Extraction**: Final response extracted from graph state (replaced placeholder).
3.  ✅ **Unit Tests**: 5/5 orchestrator tests passing.

### Phase 5: Production Hardening ⚠️ PENDING (Optional)
1.  ⬜ **Feature Flag**: `USE_LANGGRAPH_ORCHESTRATOR` env var for toggling old/new system.
2.  ⬜ **Guardrails**: Input/output validation in `core/guards/`.
3.  ⬜ **Integration Tests**: Full E2E tests with real LLM calls.
4.  ⬜ **LangSmith**: Optional tracing for debugging.

---

## 5. Requirements for "LangChain-ification"

-   **Type Safety**: Strict strict TS config for all new modules.
-   **Environment Variables**:
    -   `ANTHROPIC_API_KEY` (Existing)
    -   `AZURE_OPENAI_API_KEY` (Existing)
    -   `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_API_KEY` (New - for Gemini)
-   **Guardrails**:
    -   Implement "System Message" checks to ensure agents don't hallucinate capabilities.

## 6. Testing Strategy

-   **Unit**: Test `ModelFactory` returns correct instances. Test `routeIntent` logic in isolation.
-   **Graph Integration**: Use `LangSmith` (if available keys) or local mocking to visualize graph traversal.
-   **E2E**: Verify that `/bc` command correctly routes to BC agent and tools execute.

---

## 7. Implemented Files Reference

### Core Infrastructure
```
backend/src/core/langchain/
├── ModelFactory.ts      # Multi-provider model instantiation
└── StreamAdapter.ts     # LangGraph → AgentEvent conversion
```

### Agent Modules (Screaming Architecture)
```
backend/src/modules/agents/
├── core/
│   └── AgentFactory.ts          # IAgentNode interface, BaseAgent class
├── orchestrator/
│   ├── graph.ts                 # StateGraph definition (4 nodes)
│   ├── router.ts                # Intent classification with Claude Haiku
│   ├── state.ts                 # AgentState Annotation
│   └── check_graph.ts           # Manual verification script
├── business-central/
│   ├── bc-agent.ts              # BusinessCentralAgent node
│   ├── bc-agent.test.ts         # Unit tests (2/2 passing)
│   └── tools.ts                 # 7 BC meta-tools (LangChain format)
└── rag-knowledge/
    ├── rag-agent.ts             # RAGAgent node
    ├── rag-agent.test.ts        # Unit tests (3/3 passing)
    └── tools.ts                 # search_knowledge_base tool
```

### Integration Point
```
backend/src/services/agent/DirectAgentService.ts
└── runGraph()                   # Lines 2537-2662 - LangGraph invocation
```

---

## 8. Changelog

| Date | Version | Change |
|------|---------|--------|
| 2025-12-12 | 2.1.0 | Phase 4 complete: Response extraction, test fixes, 7 BC tools |
| 2025-12-12 | 2.0.0 | Initial LangGraph infrastructure: StateGraph, ModelFactory, StreamAdapter |

