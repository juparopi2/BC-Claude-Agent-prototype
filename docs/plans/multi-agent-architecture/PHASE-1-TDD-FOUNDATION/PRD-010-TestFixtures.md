# PRD-010: Testing Strategy for Multi-Agent Architecture

**Estado**: Draft (Reformulado)
**Prioridad**: Alta
**Dependencias**: Fase 0 completada
**Bloquea**: Todas las fases siguientes

---

## 1. Objetivo

Establecer una estrategia de testing clara que distinga entre:
- **Código Determinístico**: Unit tests tradicionales
- **Comportamiento LLM**: LangSmith evaluations con datasets

### Principio Clave

> **No testear comportamiento LLM con fixtures determinísticos.**
> El escenario real NO es determinístico. Estaríamos validando algo que nosotros mismos definimos como "correcto".

---

## 2. ¿Qué Testear con Unit Tests?

### 2.1 Código Determinístico (SÍ usar Unit Tests)

| Componente | Qué Testear |
|------------|-------------|
| **Reducers** | State transitions son correctas |
| **Validators** | Zod schemas validan/rechazan correctamente |
| **Routing Rules** | Conditional edges retornan nodo correcto |
| **State Transformers** | Input -> Output es predecible |
| **Helpers/Utils** | Funciones puras sin LLM |
| **Contract Tests** | Schemas de eventos WebSocket |

### 2.2 Ejemplo: Test de Reducer

```typescript
import { describe, it, expect } from "vitest";
import { messagesReducer } from "@/modules/agents/orchestrator/state";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("messagesReducer", () => {
  it("appends new messages to existing", () => {
    const existing = [new HumanMessage("Hello")];
    const incoming = [new AIMessage("Hi there!")];

    const result = messagesReducer(existing, incoming);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Hello");
    expect(result[1].content).toBe("Hi there!");
  });

  it("handles empty incoming array", () => {
    const existing = [new HumanMessage("Hello")];
    const result = messagesReducer(existing, []);
    expect(result).toHaveLength(1);
  });
});
```

### 2.3 Ejemplo: Test de Routing Rule

```typescript
describe("routeToAgent", () => {
  it("routes to bc-agent when activeAgent is bc-agent", () => {
    const state = { activeAgent: "bc-agent", messages: [] };
    expect(routeToAgent(state)).toBe("bc-agent-node");
  });

  it("routes to END when no more steps", () => {
    const state = { activeAgent: "FINISH", messages: [] };
    expect(routeToAgent(state)).toBe("__end__");
  });
});
```

---

## 3. ¿Qué NO Testear con Unit Tests?

### 3.1 Comportamiento LLM (NO usar Unit Tests)

| Componente | Por qué NO |
|------------|------------|
| **LLM responses** | No determinístico, varía entre llamadas |
| **Tool selection** | LLM decide, no código |
| **Routing decisions by LLM** | Clasificación semántica variable |
| **Plan generation quality** | Subjetivo, requiere evaluación |
| **Response quality** | Necesita LLM-as-judge |

### 3.2 Anti-Pattern: FakeChatModel

```typescript
// ❌ ANTI-PATTERN - NO HACER ESTO
class FakeChatModel extends BaseChatModel {
  setResponse(response: string) {
    this.fixedResponse = response;
  }

  async _generate() {
    return { content: this.fixedResponse };
  }
}

// Este test no valida comportamiento real
it("agent responds correctly", async () => {
  const fake = new FakeChatModel();
  fake.setResponse("Here is customer info"); // Nosotros definimos qué es "correcto"

  const result = await agent.invoke(state, { llm: fake });

  expect(result.content).toContain("customer"); // Validamos lo que pusimos
  // ❌ Esto no prueba nada útil - es tautológico
});
```

---

## 4. LangSmith Evaluations para Comportamiento LLM

### 4.1 Cuándo Usar LangSmith

- Testing de calidad de respuestas
- Evaluación de tool selection
- Regression testing de prompts
- Comparación de modelos
- Validación de comportamiento end-to-end

### 4.2 Configuración Básica

```typescript
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";

const client = new Client({
  apiKey: process.env.LANGSMITH_API_KEY,
});
```

### 4.3 Crear Dataset

```typescript
// Crear dataset con ejemplos de referencia
const dataset = await client.createDataset("bc-agent-queries", {
  description: "Test queries for Business Central agent",
});

// Agregar ejemplos
await client.createExamples({
  datasetId: dataset.id,
  inputs: [
    { query: "Show me customer ABC" },
    { query: "What are the open invoices for vendor XYZ?" },
    { query: "Create a sales order for 10 units of item 123" },
  ],
  outputs: [
    { expected_tool: "bc_get_customer", expected_intent: "read" },
    { expected_tool: "bc_search_invoices", expected_intent: "read" },
    { expected_tool: "bc_create_sales_order", expected_intent: "write" },
  ],
});
```

### 4.4 Evaluators

#### LLM-as-Judge Evaluator

```typescript
import { evaluate } from "langsmith/evaluation";

// Evaluador que usa LLM para juzgar calidad
const relevanceEvaluator = {
  evaluatorType: "llm",
  llm: new ChatAnthropic({ model: "claude-haiku-4-5-20251001" }),
  prompt: `You are evaluating an AI assistant's response.

Query: {input.query}
Response: {output.response}
Expected behavior: {reference.expected_intent}

Rate the response on a scale of 1-5:
1 = Completely wrong or irrelevant
2 = Partially relevant but missing key info
3 = Acceptable but could be better
4 = Good response, mostly correct
5 = Excellent, fully addresses the query

Respond with JSON: {"score": N, "reasoning": "..."}`,
};

// Evaluador de tool selection
const toolSelectionEvaluator = {
  evaluatorType: "custom",
  evaluate: async ({ input, output, reference }) => {
    const usedTool = output.tool_calls?.[0]?.name;
    const expectedTool = reference.expected_tool;

    return {
      key: "tool_selection",
      score: usedTool === expectedTool ? 1 : 0,
      comment: usedTool === expectedTool
        ? "Correct tool selected"
        : `Expected ${expectedTool}, got ${usedTool}`,
    };
  },
};
```

### 4.5 Ejecutar Evaluación

```typescript
// Target function (lo que queremos evaluar)
async function bcAgentTarget(input: { query: string }) {
  const result = await bcAgent.invoke({
    messages: [new HumanMessage(input.query)],
  });

  return {
    response: result.messages[result.messages.length - 1].content,
    tool_calls: result.toolExecutions,
  };
}

// Ejecutar evaluación
const results = await evaluate(bcAgentTarget, {
  data: "bc-agent-queries", // Dataset name
  evaluators: [relevanceEvaluator, toolSelectionEvaluator],
  experimentPrefix: "bc-agent-v1",
  numRepetitions: 3, // Ejecutar 3 veces para manejar variabilidad
  maxConcurrency: 5,
});

console.log("Average scores:", results.summary);
```

### 4.6 Manejar Variabilidad con `numRepetitions`

```typescript
// Para tests no-determinísticos, usar múltiples repeticiones
const results = await evaluate(target, {
  data: datasetName,
  evaluators: [evaluator],
  numRepetitions: 5, // 5 ejecuciones por ejemplo
  // Resultado: promedio de las 5 ejecuciones
});

// Criterio de aceptación: promedio >= 0.8
expect(results.summary.average_score).toBeGreaterThanOrEqual(0.8);
```

---

## 5. Estructura de Testing Recomendada

### 5.1 Estructura de Archivos

```
backend/src/__tests__/
├── unit/                          # Tests determinísticos
│   ├── agents/
│   │   ├── state/
│   │   │   ├── reducers.test.ts   # State reducers
│   │   │   └── validators.test.ts # Zod schemas
│   │   └── routing/
│   │       └── conditionalEdges.test.ts
│   ├── helpers/
│   │   └── createTestContext.ts   # Factory para ExecutionContext
│   └── contracts/
│       ├── agent-events.contract.test.ts
│       └── state-schema.contract.test.ts
├── integration/                   # Tests con DB/Redis
│   └── persistence/
│       └── checkpointer.test.ts
└── langsmith/                     # LangSmith evaluations
    ├── datasets/
    │   ├── bc-agent-queries.json
    │   ├── rag-agent-queries.json
    │   └── routing-queries.json
    ├── evaluators/
    │   ├── relevance.ts
    │   ├── tool-selection.ts
    │   └── response-quality.ts
    └── run-evaluations.ts         # Script para CI
```

### 5.2 createTestContext Helper

```typescript
// backend/src/__tests__/helpers/createTestContext.ts
import { createExecutionContext } from "@/domains/agent/orchestration/ExecutionContext";

export interface TestContextOptions {
  sessionId?: string;
  userId?: string;
  callback?: (event: AgentEvent) => void;
  enableThinking?: boolean;
}

export function createTestContext(options?: TestContextOptions) {
  const events: AgentEvent[] = [];
  const callback = options?.callback ?? ((e) => events.push(e));

  const ctx = createExecutionContext(
    options?.sessionId ?? `test-session-${Date.now()}`,
    options?.userId ?? `test-user-${Date.now()}`,
    callback,
    {
      enableThinking: options?.enableThinking ?? false,
      thinkingBudget: 10000,
    }
  );

  return {
    ctx,
    getEvents: () => events,
    getLastEvent: () => events[events.length - 1],
    clearEvents: () => events.length = 0,
  };
}
```

### 5.3 Contract Tests

```typescript
// backend/src/__tests__/contracts/agent-events.contract.test.ts
import { describe, it, expect } from "vitest";
import {
  MessageEventSchema,
  ToolUseEventSchema,
  AgentHandoffEventSchema,
} from "@bc-agent/shared";

describe("Agent Event Contracts", () => {
  describe("MessageEvent", () => {
    it("validates complete message event", () => {
      const event = {
        type: "message",
        sessionId: "SESSION-123",
        eventId: "EVENT-456",
        messageId: "MSG-789",
        content: "Hello, world!",
        role: "assistant",
        timestamp: new Date().toISOString(),
        persistenceState: "persisted",
      };

      const result = MessageEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("rejects event without required fields", () => {
      const event = {
        type: "message",
        content: "Hello",
        // Missing sessionId, eventId, etc.
      };

      const result = MessageEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("AgentHandoffEvent", () => {
    it("validates handoff event", () => {
      const event = {
        type: "agent_handoff",
        sessionId: "SESSION-123",
        eventId: "EVENT-456",
        timestamp: new Date().toISOString(),
        handoffId: "HANDOFF-789",
        fromAgent: { agentId: "bc-agent", agentName: "BC Expert" },
        toAgent: { agentId: "rag-agent", agentName: "Knowledge Base" },
        reason: "capability_match",
      };

      const result = AgentHandoffEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });
});
```

---

## 6. CI/CD Integration

### 6.1 Unit Tests (Fast, on every PR)

```yaml
# .github/workflows/test.yml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:unit
        # Solo tests determinísticos, ~30 segundos
```

### 6.2 LangSmith Evaluations (Slower, on merge to main)

```yaml
  langsmith-eval:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:langsmith
        env:
          LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        # Evaluaciones con LLM real, ~5 minutos
```

### 6.3 Script de Evaluación

```typescript
// backend/scripts/run-langsmith-evals.ts
import { evaluate } from "langsmith/evaluation";
import { bcAgentTarget } from "./targets/bc-agent";
import { ragAgentTarget } from "./targets/rag-agent";
import { relevanceEvaluator, toolSelectionEvaluator } from "./evaluators";

async function runEvaluations() {
  const results = [];

  // BC Agent
  results.push(await evaluate(bcAgentTarget, {
    data: "bc-agent-queries",
    evaluators: [relevanceEvaluator, toolSelectionEvaluator],
    experimentPrefix: `bc-agent-${process.env.GITHUB_SHA?.slice(0, 7)}`,
    numRepetitions: 3,
  }));

  // RAG Agent
  results.push(await evaluate(ragAgentTarget, {
    data: "rag-agent-queries",
    evaluators: [relevanceEvaluator],
    experimentPrefix: `rag-agent-${process.env.GITHUB_SHA?.slice(0, 7)}`,
    numRepetitions: 3,
  }));

  // Verificar umbrales
  for (const result of results) {
    if (result.summary.average_score < 0.8) {
      console.error(`Evaluation failed: ${result.experimentName}`);
      process.exit(1);
    }
  }

  console.log("All evaluations passed!");
}

runEvaluations().catch(console.error);
```

---

## 7. Criterios de Aceptación

- [ ] Unit tests cubren todos los reducers
- [ ] Unit tests cubren todas las routing functions
- [ ] Contract tests validan todos los event schemas
- [ ] `createTestContext()` helper implementado
- [ ] Al menos 1 LangSmith dataset creado por agente
- [ ] Al menos 2 evaluators implementados (relevance, tool_selection)
- [ ] CI ejecuta unit tests en PRs
- [ ] CI ejecuta LangSmith evals en merge to main
- [ ] Documentación de cómo agregar nuevos tests

---

## 8. Archivos a Crear

```
backend/src/__tests__/
├── helpers/
│   └── createTestContext.ts
├── unit/
│   └── agents/
│       └── state/
│           └── reducers.test.ts
├── contracts/
│   └── agent-events.contract.test.ts
└── langsmith/
    ├── datasets/
    │   └── bc-agent-queries.json
    ├── evaluators/
    │   ├── relevance.ts
    │   └── tool-selection.ts
    └── run-evaluations.ts
```

---

## 9. Qué se ELIMINÓ de la Versión Original

| Componente Eliminado | Razón |
|----------------------|-------|
| `FakeChatModel.ts` | Anti-pattern - no valida comportamiento real |
| `LLMResponseSimulator.ts` | Anti-pattern - fixtures determinísticos para LLM |
| `FakeAgentRegistry.ts` | Usar registry real con agentes de test |
| Tests que mockean respuestas LLM | Reemplazados por LangSmith evaluations |

---

## 10. Estimación

- **Unit tests setup**: 2-3 días
- **Contract tests**: 1-2 días
- **LangSmith setup**: 2-3 días
- **CI integration**: 1 día
- **Total**: 6-9 días

---

## 11. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial con FakeChatModel |
| 2026-02-02 | 2.0 | Reformulado: Eliminado FakeChatModel, agregado LangSmith evaluations |
