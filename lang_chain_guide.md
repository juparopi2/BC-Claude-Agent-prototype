# Guía LangGraph para MyWorkMate - Principios y Patrones de Producción

Esta guía documenta los patrones y principios para construir sistemas multi-agente usando LangGraph y LangChain en producción.

---

# PARTE 1: PRINCIPIOS FUNDAMENTALES

## 1.1 Golden Rules

### USAR: Patrones Nativos de LangGraph

| Necesidad | Solución Nativa | Paquete |
|-----------|-----------------|---------|
| Multi-agent orchestration | `createSupervisor()` | `@langchain/langgraph/prebuilt` |
| Single agent with tools | `createReactAgent()` | `@langchain/langgraph/prebuilt` |
| Human-in-the-loop | `interrupt()` | `@langchain/langgraph` |
| Agent-to-agent handoffs | `Command(goto=...)` | `@langchain/langgraph` |
| State persistence | `PostgresSaver` | `@langchain/langgraph-checkpoint-postgres` |
| Multi-provider models | `initChatModel()` | `langchain` |
| Observability | LangSmith | `langsmith` |

### NO CONSTRUIR: Implementaciones Custom

| ❌ No Construir | ✅ Usar En Su Lugar |
|-----------------|---------------------|
| Custom PlannerAgent | `createSupervisor()` |
| Custom PlanExecutor | Supervisor handles automatically |
| Custom ApprovalManager | `interrupt()` |
| Custom HandoffManager | `Command(goto=...)` |
| Custom ModelFactory (multi-provider) | `initChatModel()` |
| FakeChatModel for tests | LangSmith evaluations |
| Custom state persistence | Checkpointers |

## 1.2 Arquitectura de Referencia

```
┌─────────────────────────────────────────────────────────────┐
│                    createSupervisor()                       │
│    ┌─────────────────────────────────────────────────┐     │
│    │           Router LLM (Haiku - fast)             │     │
│    └───────────────────────┬─────────────────────────┘     │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
     │createReact  │  │createReact  │  │createReact  │
     │Agent()      │  │Agent()      │  │Agent()      │
     │             │  │             │  │             │
     │ BC Agent    │  │ RAG Agent   │  │Graph Agent  │
     │ + tools     │  │ + tools     │  │ + tools     │
     └─────────────┘  └─────────────┘  └─────────────┘
            │                │                │
            └────────────────┴────────────────┘
                             │
                             ▼
                   PostgresSaver Checkpointer
```

---

# PARTE 2: PATRONES PREBUILT

## 2.1 createSupervisor() - Orquestación Multi-Agente

```typescript
import { createSupervisor } from "@langchain/langgraph/prebuilt";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";

// 1. Crear agentes especializados
const bcAgent = createReactAgent({
  llm: new ChatAnthropic({ model: "claude-sonnet-4-5-20250929" }),
  tools: bcTools,
  name: "bc-agent",
  prompt: "You are an expert in Microsoft Business Central...",
});

const ragAgent = createReactAgent({
  llm: new ChatAnthropic({ model: "claude-sonnet-4-5-20250929" }),
  tools: ragTools,
  name: "rag-agent",
  prompt: "You search and analyze documents...",
});

// 2. Crear supervisor
const supervisor = createSupervisor({
  agents: [bcAgent, ragAgent],
  model: new ChatAnthropic({ model: "claude-haiku-4-5-20251001" }), // Fast router
  prompt: `You route requests to specialized agents:
- bc-agent: Business Central ERP queries
- rag-agent: Document search and analysis`,
});

// 3. Compilar con checkpointer
const graph = supervisor.compile({
  checkpointer: new PostgresSaver(connectionString),
});

// 4. Invocar
const result = await graph.invoke(
  { messages: [new HumanMessage("Show me customer ABC")] },
  { configurable: { thread_id: "session-123" } }
);
```

## 2.2 createReactAgent() - Agente con Tools

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Definir tools
const searchCustomers = tool(
  async ({ query }) => {
    const results = await bcApi.searchCustomers(query);
    return JSON.stringify(results);
  },
  {
    name: "search_customers",
    description: "Search Business Central customers by name or ID",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
  }
);

// Crear agente
const agent = createReactAgent({
  llm: model,
  tools: [searchCustomers, getCustomer, createInvoice],
  name: "bc-agent",
  prompt: systemPrompt,
});
```

## 2.3 Cuándo Usar Cada Patrón

| Escenario | Patrón |
|-----------|--------|
| Single agent with tools | `createReactAgent()` |
| Multiple specialists coordinated | `createSupervisor()` |
| Agents that hand off to each other | Swarm pattern or Command |
| Complex multi-step workflows | `createSupervisor()` + checkpointer |

---

# PARTE 3: HUMAN-IN-THE-LOOP CON INTERRUPT

## 3.1 Básico: Pausar para Aprobación

```typescript
import { interrupt } from "@langchain/langgraph";

const sensitiveToolNode = async (state) => {
  if (requiresApproval(state.toolCall)) {
    // Pausar ejecución
    const approved = interrupt({
      type: "approval_request",
      toolName: state.toolCall.name,
      args: state.toolCall.args,
    });

    if (!approved) {
      return { messages: [new AIMessage("Operation cancelled.")] };
    }
  }

  return await executeTool(state.toolCall);
};
```

## 3.2 Resume Después de Interrupt

```typescript
// Paso 1: Invocar - se pausa en interrupt()
const result1 = await graph.invoke(
  { messages: [new HumanMessage("Create invoice for ABC")] },
  { configurable: { thread_id: sessionId } }
);

// result1.__interrupt__ contiene los datos de la interrupción

// Paso 2: Usuario decide
const userDecision = true; // approved

// Paso 3: Resumir con decisión
const result2 = await graph.invoke(
  userDecision, // Este valor se retorna de interrupt()
  { configurable: { thread_id: sessionId } }
);
```

## 3.3 Checkpointer Requerido

`interrupt()` requiere un checkpointer para guardar el estado:

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL);

const graph = workflow.compile({ checkpointer });
// Ahora interrupt() funciona correctamente
```

---

# PARTE 4: STATE MANAGEMENT

## 4.1 MessagesAnnotation como Base

```typescript
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

// MessagesAnnotation incluye:
// - messages: BaseMessage[] con add_messages reducer
// Es la base recomendada para conversaciones

const MyState = Annotation.Root({
  ...MessagesAnnotation.spec,

  // Campos adicionales
  currentAgent: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "supervisor",
  }),

  context: Annotation<Record<string, unknown>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
});
```

## 4.2 Reducers Correctos

```typescript
// APPEND: Para arrays que crecen
messages: Annotation<BaseMessage[]>({
  reducer: (a, b) => a.concat(b),
  default: () => [],
}),

// REPLACE: Para valores que se reemplazan
activeAgent: Annotation<string>({
  reducer: (_, next) => next,
  default: () => "supervisor",
}),

// MERGE: Para objetos que se combinan
context: Annotation<Record<string, unknown>>({
  reducer: (prev, next) => ({ ...prev, ...next }),
  default: () => ({}),
}),
```

## 4.3 Command Pattern para Routing + State

```typescript
import { Command } from "@langchain/langgraph";

// Un nodo puede retornar Command para routing dinámico
const myNode = async (state) => {
  if (shouldHandoff) {
    return new Command({
      goto: "other-agent",
      update: {
        messages: state.messages,
        context: { handoffReason: "need specialized help" },
      },
    });
  }

  return { messages: [response] };
};
```

---

# PARTE 5: TESTING STRATEGY

## 5.1 Qué Testear con Unit Tests (Determinístico)

```typescript
describe("State Reducers", () => {
  it("messages reducer appends", () => {
    const existing = [msg1];
    const incoming = [msg2];
    const result = messagesReducer(existing, incoming);
    expect(result).toHaveLength(2);
  });
});

describe("Routing Functions", () => {
  it("routes to bc-agent for ERP queries", () => {
    const state = { activeAgent: "bc-agent" };
    expect(routeToAgent(state)).toBe("bc-agent-node");
  });
});
```

## 5.2 Qué NO Testear con Unit Tests

- LLM responses (no determinístico)
- Tool selection by LLM (variable)
- Plan generation quality (subjetivo)
- Response quality (necesita evaluación)

## 5.3 LangSmith Evaluations para LLM Behavior

```typescript
import { evaluate } from "langsmith/evaluation";
import { Client } from "langsmith";

// Crear dataset
const client = new Client();
await client.createExamples({
  datasetName: "agent-routing",
  inputs: [
    { query: "Show customer ABC" },
    { query: "Search my documents" },
  ],
  outputs: [
    { expected_agent: "bc-agent" },
    { expected_agent: "rag-agent" },
  ],
});

// Evaluar
const results = await evaluate(
  async (input) => {
    const result = await graph.invoke({
      messages: [new HumanMessage(input.query)],
    });
    return { agent: result.activeAgent };
  },
  {
    data: "agent-routing",
    evaluators: [
      {
        evaluate: ({ output, reference }) => ({
          key: "routing_accuracy",
          score: output.agent === reference.expected_agent ? 1 : 0,
        }),
      },
    ],
    numRepetitions: 3, // Para manejar variabilidad
  }
);
```

## 5.4 Estructura de Tests Recomendada

```
backend/src/__tests__/
├── unit/                    # Tests determinísticos
│   ├── reducers.test.ts
│   ├── routing.test.ts
│   └── validators.test.ts
├── contracts/               # Schema validation
│   └── events.contract.test.ts
└── langsmith/               # LLM behavior
    ├── datasets/
    └── evaluators/
```

---

# PARTE 6: CHECKPOINTERS Y PERSISTENCIA

## 6.1 Checkpointers por Ambiente

| Ambiente | Checkpointer | Paquete |
|----------|--------------|---------|
| Development | `MemorySaver` | `@langchain/langgraph` |
| Testing | `MemorySaver` | `@langchain/langgraph` |
| Production | `PostgresSaver` | `@langchain/langgraph-checkpoint-postgres` |

## 6.2 PostgresSaver Setup

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Crear checkpointer
const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL);

// Setup crea tablas automáticamente
await checkpointer.setup();

// Usar con graph
const graph = workflow.compile({ checkpointer });

// Invocar con thread_id para persistencia
await graph.invoke(input, {
  configurable: { thread_id: "user-session-123" },
});
```

## 6.3 Nivel de Checkpoint: Nodo, no Evento

Los checkpoints se guardan **después de cada nodo**, no después de cada evento LLM. Esto significa:
- Estado consistente entre nodos
- Resume desde el último nodo completado
- No resume mid-streaming

---

# PARTE 7: MODEL ABSTRACTION

## 7.1 initChatModel() - Multi-Proveedor

```typescript
import { initChatModel } from "langchain";

// Sintaxis unificada
const claude = await initChatModel("claude-sonnet-4-5-20250929");
const gpt = await initChatModel("openai:gpt-4o");
const gemini = await initChatModel("google-genai:gemini-2.5-flash-lite");

// Con configuración
const model = await initChatModel("claude-haiku-4-5-20251001", {
  temperature: 0.3,
  maxTokens: 8192,
});
```

## 7.2 Feature Detection con model.profile

```typescript
const model = await initChatModel("claude-sonnet-4-5-20250929");

// Detectar capacidades
if (model.profile?.reasoningOutput) {
  // Soporta extended thinking
}

if (model.profile?.toolCalling) {
  // Soporta tool calling
}

if (model.profile?.imageInputs) {
  // Soporta imágenes
}
```

## 7.3 Runtime Provider Switching

```typescript
// En configuración del grafo
const graph = workflow.compile({ checkpointer });

// Invocar con provider específico
await graph.invoke(input, {
  configurable: {
    thread_id: sessionId,
    modelProvider: "openai", // Switch provider at runtime
  },
});
```

---

# PARTE 8: RAG PIPELINE

## 8.1 Pipeline Completo

```typescript
import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";

// 1. Load
const loader = new CheerioWebBaseLoader(url);
const docs = await loader.load();

// 2. Split
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});
const splits = await splitter.splitDocuments(docs);

// 3. Embed & Store
const vectorStore = await MemoryVectorStore.fromDocuments(
  splits,
  new OpenAIEmbeddings()
);

// 4. Retrieve
const retriever = vectorStore.asRetriever({ k: 5 });
const relevantDocs = await retriever.invoke(query);
```

## 8.2 Mejores Prácticas

- **Chunk size**: 500-1000 tokens con 10-20% overlap
- **Embeddings**: OpenAI `text-embedding-3-small` o `text-embedding-3-large`
- **Retrieval**: Hybrid search (semantic + keyword) para mejor recall
- **Reranking**: Cross-encoders para refinar top-k

---

# PARTE 9: OBSERVABILIDAD CON LANGSMITH

## 9.1 Configuración

```typescript
// Variables de entorno
process.env.LANGSMITH_TRACING = "true";
process.env.LANGSMITH_API_KEY = "<key>";
process.env.LANGSMITH_PROJECT = "my-project";

// Tracing automático con LangChain
import { ChatAnthropic } from "@langchain/anthropic";
const llm = new ChatAnthropic({ model: "claude-sonnet-4-5-20250929" });
// Todas las llamadas se tracean automáticamente
```

## 9.2 Tracing Manual

```typescript
import { traceable } from "langsmith/traceable";

const myFunction = traceable(
  async (input: string) => {
    // Tu lógica
    return result;
  },
  { name: "My Function", run_type: "chain" }
);
```

## 9.3 Evaluaciones

```typescript
import { evaluate } from "langsmith/evaluation";

await evaluate(targetFunction, {
  data: "my-dataset",
  evaluators: [relevanceEvaluator, qualityEvaluator],
  experimentPrefix: "v1.0",
  numRepetitions: 3,
});
```

---

# PARTE 10: RECURSOS

## Documentación Oficial

| Recurso | URL |
|---------|-----|
| LangGraph.js | https://langchain-ai.github.io/langgraphjs/ |
| LangChain.js | https://js.langchain.com/docs/ |
| LangSmith | https://docs.smith.langchain.com/ |
| LangGraph Prebuilts | https://langchain-ai.github.io/langgraphjs/reference/functions/langgraph_prebuilt.createSupervisor.html |

## Paquetes npm

```bash
# Core
npm install langchain @langchain/core
npm install @langchain/anthropic @langchain/openai

# LangGraph
npm install @langchain/langgraph
npm install @langchain/langgraph-checkpoint-postgres

# Observability
npm install langsmith
```

## Cursos y Tutoriales

- [LangChain Academy](https://academy.langchain.com/)
- [RAG From Scratch](https://youtube.com/playlist?list=PLfaIDFEXuae2LXbO1_PKyVJiQ23ZztA0x)
- [Multi-Agent Workflows Blog](https://blog.langchain.com/langgraph-multi-agent-workflows/)

---

*Última actualización: 2026-02-02*
