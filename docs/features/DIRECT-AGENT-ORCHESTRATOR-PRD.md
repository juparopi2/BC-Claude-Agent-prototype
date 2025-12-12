# Direct Agent Orchestrator (LangChain Evolution) PRD

**Version**: 2.0.0 (LangChain Pivot)
**Status**: Draft / Planning
**Date**: December 12, 2025

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

### Phase 1: Infrastructure (Non-Breaking)
1.  **Dependencies**: Install `@langchain/core`, `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/google-vertexai`, `@langchain/openai`.
2.  **Core Core**: Implement `ModelFactory` and `EnvManager` for secure key access.
3.  **Tools**: Adapt existing `Tool` interfaces to LangChain `StructuredTool`.

### Phase 2: The Orchestrator (Parallel)
1.  **Graph Setup**: Create the basic `StateGraph` with just one node (the existing logic wrapped).
2.  **Streaming Adapter**: Create a bridge to convert LangChain's `streamEvents` to our `AgentEvent` format for WebSockets. (Critical for UI compatibility).

### Phase 3: Agent Split
1.  **Extract BC Logic**: Move BC tools and prompt to `modules/agents/business-central`.
2.  **Create RAG Agent**: Implement the new semantic search logic using LangChain's `VectorStore` interfaces (or wrap our existing service).

### Phase 4: Integration
1.  **Switchover**: Update `DirectAgentService.ts` to instantiate and `await workflow.invoke()` instead of running the old hardcoded loop.
2.  **Validation**: Run full integration test suite.

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

