# PRD-030: Planner Agent (Supervisor)

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: PRD-020 (Extended State), PRD-011 (Agent Registry)
**Bloquea**: PRD-031 (Plan Executor), PRD-032 (Plan Persistence)

---

## 1. Objetivo

Implementar un agente supervisor que:
- Analiza la complejidad de queries del usuario
- Genera planes de ejecución estructurados
- Decide qué agentes deben ejecutar cada step
- Proporciona contexto y constraints a cada agente

---

## 2. Contexto

### 2.1 Estado Actual

El sistema actual usa un router simple:
1. Slash commands → Agente específico
2. Keywords → Agente específico
3. Ambiguo → LLM clasifica intent

**Problema**: No hay planificación multi-paso ni coordinación.

### 2.2 Arquitectura Objetivo

```
User Query
    │
    ▼
┌─────────────────────┐
│   PLANNER AGENT     │
│   (Supervisor)      │
│                     │
│  1. Analyze query   │
│  2. Classify        │
│  3. Generate plan   │
│  4. Return plan     │
└─────────────────────┘
    │
    ▼
PlanState
```

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos

```
backend/src/modules/agents/supervisor/
├── PlannerAgent.ts           # Main planner implementation
├── prompts/
│   ├── planner.system.ts     # System prompt
│   ├── planner.examples.ts   # Few-shot examples
│   └── index.ts
├── schemas/
│   ├── PlanOutputSchema.ts   # Zod schema for LLM output
│   └── index.ts
├── utils/
│   ├── QueryClassifier.ts    # Classify query complexity
│   └── PlanValidator.ts      # Validate generated plans
└── index.ts
```

### 3.2 Query Classification

```typescript
// QueryClassifier.ts

export type QueryComplexity = 'simple' | 'moderate' | 'complex';

export interface QueryClassification {
  complexity: QueryComplexity;
  requiresPlanning: boolean;
  suggestedAgents: string[];
  reasoning: string;
}

/**
 * Classify query complexity to determine if planning is needed
 */
export class QueryClassifier {
  constructor(private registry: AgentRegistry) {}

  /**
   * Classify without LLM (fast path)
   */
  classifyHeuristic(query: string): QueryClassification {
    const lowerQuery = query.toLowerCase();

    // Simple: Direct questions, single-step tasks
    if (this.isSimpleQuery(lowerQuery)) {
      return {
        complexity: 'simple',
        requiresPlanning: false,
        suggestedAgents: [this.findBestAgent(query)],
        reasoning: 'Single-step query, direct routing',
      };
    }

    // Complex: Multiple parts, comparisons, workflows
    if (this.isComplexQuery(lowerQuery)) {
      return {
        complexity: 'complex',
        requiresPlanning: true,
        suggestedAgents: this.findRelevantAgents(query),
        reasoning: 'Multi-step query requiring coordination',
      };
    }

    // Moderate: Might need planning
    return {
      complexity: 'moderate',
      requiresPlanning: true,
      suggestedAgents: this.findRelevantAgents(query),
      reasoning: 'Moderate complexity, planning recommended',
    };
  }

  private isSimpleQuery(query: string): boolean {
    const simplePatterns = [
      /^(what|who|where|when|how much|how many)\s+is/i,
      /^show\s+me\s+/i,
      /^get\s+/i,
      /^find\s+/i,
      /^list\s+/i,
    ];
    return simplePatterns.some(p => p.test(query));
  }

  private isComplexQuery(query: string): boolean {
    const complexIndicators = [
      'and then', 'after that', 'followed by',
      'compare', 'analyze', 'summarize',
      'create a report', 'generate a chart',
      'for each', 'all of the',
    ];
    return complexIndicators.some(i => query.includes(i));
  }

  private findBestAgent(query: string): string {
    const agent = this.registry.findByKeywords(query);
    return agent?.id ?? 'orchestrator';
  }

  private findRelevantAgents(query: string): string[] {
    // Check all agents for keyword matches
    const agents: string[] = [];
    for (const agent of this.registry.getAll()) {
      if (!agent.isSystemAgent && agent.triggerKeywords?.some(kw =>
        query.toLowerCase().includes(kw.toLowerCase())
      )) {
        agents.push(agent.id);
      }
    }
    return agents.length > 0 ? agents : ['orchestrator'];
  }
}
```

### 3.3 Plan Output Schema

```typescript
// PlanOutputSchema.ts
import { z } from 'zod';

/**
 * Schema for LLM plan generation output
 */
export const PlanOutputSchema = z.object({
  /** Summary of what the plan will accomplish */
  summary: z.string().min(10).max(500),

  /** Whether this query actually needs a multi-step plan */
  requiresMultiStep: z.boolean(),

  /** The execution steps */
  steps: z.array(z.object({
    /** Which agent should execute this step */
    agentId: z.string(),

    /** What the agent should do */
    task: z.string().min(5).max(500),

    /** Expected output type */
    expectedOutput: z.enum(['text', 'data', 'visualization', 'confirmation']).optional(),

    /** Why this agent was chosen */
    reasoning: z.string().max(200).optional(),
  })).min(1).max(10),

  /** Overall reasoning for the plan */
  reasoning: z.string().max(500),
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;

/**
 * Schema for simple (no-plan) response
 */
export const SimplePlanOutputSchema = z.object({
  requiresMultiStep: z.literal(false),
  directAgentId: z.string(),
  reasoning: z.string(),
});

export type SimplePlanOutput = z.infer<typeof SimplePlanOutputSchema>;
```

### 3.4 Planner Agent

```typescript
// PlannerAgent.ts
import { ChatAnthropic } from '@langchain/anthropic';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import { getAgentRegistry } from '@/modules/agents/core/registry';
import { QueryClassifier } from './utils/QueryClassifier';
import { PlanOutputSchema, type PlanOutput } from './schemas/PlanOutputSchema';
import { getPlannerSystemPrompt } from './prompts/planner.system';
import { getPlannerExamples } from './prompts/planner.examples';
import type { PlanState, PlanStep } from '@/modules/agents/orchestrator/state/PlanState';
import type { ExtendedAgentState } from '@/modules/agents/orchestrator/state';

export interface PlannerConfig {
  /** Model to use for planning (default: haiku for speed) */
  model?: string;

  /** Maximum steps allowed in a plan */
  maxSteps?: number;

  /** Whether to use heuristics before LLM */
  useHeuristics?: boolean;

  /** Temperature for generation */
  temperature?: number;
}

const DEFAULT_CONFIG: Required<PlannerConfig> = {
  model: 'claude-3-haiku-20240307',
  maxSteps: 8,
  useHeuristics: true,
  temperature: 0.1,
};

/**
 * Planner Agent - Generates execution plans for complex queries
 */
export class PlannerAgent {
  private classifier: QueryClassifier;
  private llm: ChatAnthropic;
  private config: Required<PlannerConfig>;

  constructor(config?: PlannerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.classifier = new QueryClassifier(getAgentRegistry());
    this.llm = new ChatAnthropic({
      modelName: this.config.model,
      temperature: this.config.temperature,
      maxTokens: 1024,
    });
  }

  /**
   * Generate a plan for the given query
   */
  async generatePlan(
    query: string,
    context: ExtendedAgentState['context']
  ): Promise<PlanState | null> {
    const registry = getAgentRegistry();

    // Step 1: Classify query (fast path)
    if (this.config.useHeuristics) {
      const classification = this.classifier.classifyHeuristic(query);

      if (!classification.requiresPlanning) {
        // Simple query - no plan needed, return null to signal direct routing
        return null;
      }
    }

    // Step 2: Generate plan with LLM
    const availableAgents = registry.getAll()
      .filter(a => !a.isSystemAgent)
      .map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        capabilities: a.capabilities,
      }));

    const systemPrompt = getPlannerSystemPrompt(availableAgents, this.config.maxSteps);
    const examples = getPlannerExamples();

    const messages = [
      new SystemMessage(systemPrompt),
      ...examples,
      new HumanMessage(query),
    ];

    // Generate plan
    const response = await this.llm.invoke(messages, {
      response_format: { type: 'json_object' },
    });

    // Parse and validate
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const parsed = JSON.parse(content);
    const validated = PlanOutputSchema.safeParse(parsed);

    if (!validated.success) {
      throw new Error(`Invalid plan output: ${validated.error.message}`);
    }

    const output = validated.data;

    // If LLM says no multi-step needed, return null
    if (!output.requiresMultiStep) {
      return null;
    }

    // Step 3: Build PlanState
    const planId = randomUUID().toUpperCase();
    const now = new Date().toISOString();

    const steps: PlanStep[] = output.steps.map((step, index) => ({
      stepId: randomUUID().toUpperCase(),
      stepIndex: index,
      agentId: step.agentId,
      task: step.task,
      expectedOutput: step.expectedOutput,
      status: 'pending' as const,
    }));

    return {
      planId,
      query,
      status: 'executing',
      steps,
      currentStepIndex: 0,
      summary: output.summary,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Decide if a query needs planning (without generating plan)
   */
  needsPlanning(query: string): boolean {
    const classification = this.classifier.classifyHeuristic(query);
    return classification.requiresPlanning;
  }
}

// Singleton
let instance: PlannerAgent | null = null;

export function getPlannerAgent(config?: PlannerConfig): PlannerAgent {
  if (!instance) {
    instance = new PlannerAgent(config);
  }
  return instance;
}

export function resetPlannerAgent(): void {
  instance = null;
}
```

### 3.5 System Prompt

```typescript
// prompts/planner.system.ts

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
}

export function getPlannerSystemPrompt(
  agents: AgentSummary[],
  maxSteps: number
): string {
  const agentList = agents.map(a =>
    `- **${a.id}** (${a.name}): ${a.description}\n  Capabilities: ${a.capabilities.join(', ')}`
  ).join('\n');

  return `You are a planning assistant that breaks down complex user queries into executable steps.

## Available Agents

${agentList}

## Your Task

Analyze the user's query and either:
1. Return a multi-step plan if the query requires coordination between agents or multiple operations
2. Indicate that no plan is needed if it's a simple, single-step query

## Output Format

Return a JSON object with this structure:

For complex queries (multi-step):
{
  "summary": "Brief description of what the plan accomplishes",
  "requiresMultiStep": true,
  "steps": [
    {
      "agentId": "agent-id",
      "task": "Specific task for this agent",
      "expectedOutput": "text|data|visualization|confirmation",
      "reasoning": "Why this agent was chosen"
    }
  ],
  "reasoning": "Overall reasoning for the plan"
}

For simple queries (no plan):
{
  "requiresMultiStep": false,
  "directAgentId": "agent-id",
  "reasoning": "Why this is a simple query"
}

## Guidelines

1. Keep plans concise - maximum ${maxSteps} steps
2. Each step should have a clear, actionable task
3. Consider dependencies between steps
4. Match agents to tasks based on their capabilities
5. Simple queries (single lookup, direct question) don't need plans
6. Complex queries (comparisons, reports, multi-data) need plans

## Examples of Simple Queries (NO PLAN NEEDED)
- "Show me customer ABC" → Direct to bc-agent
- "Search my documents for contracts" → Direct to rag-agent
- "What is the status of order 123?" → Direct to bc-agent

## Examples of Complex Queries (PLAN NEEDED)
- "Compare our top 5 customers by revenue and show a chart" → Multiple steps
- "Find all overdue invoices and summarize the payment patterns" → Analysis + summary
- "Search my documents for the contract terms and validate against BC data" → RAG + BC coordination
`;
}
```

### 3.6 Supervisor Node (Graph Integration)

```typescript
// SupervisorNode.ts - Integration with LangGraph

import { ExtendedAgentState } from '@/modules/agents/orchestrator/state';
import { getPlannerAgent } from './PlannerAgent';
import type { PlanState } from '@/modules/agents/orchestrator/state/PlanState';

/**
 * Supervisor node for LangGraph
 *
 * Decides whether to generate a plan or route directly.
 */
export async function supervisorNode(
  state: ExtendedAgentState
): Promise<Partial<ExtendedAgentState>> {
  const planner = getPlannerAgent();

  // Get the last user message
  const lastMessage = state.messages[state.messages.length - 1];
  const query = typeof lastMessage.content === 'string'
    ? lastMessage.content
    : JSON.stringify(lastMessage.content);

  // Check if in directed mode (user selected agent)
  if (state.operationMode === 'directed' && state.directedModeContext) {
    // Skip planning, route directly to selected agent
    return {
      activeAgent: state.directedModeContext.targetAgentId,
      plan: null,
    };
  }

  // Generate plan
  const plan = await planner.generatePlan(query, state.context);

  if (plan === null) {
    // Simple query - use existing router logic
    return {
      activeAgent: 'router', // Signal to use traditional routing
      plan: null,
    };
  }

  // Return plan for execution
  return {
    plan,
    activeAgent: 'plan-executor',
    currentAgentIdentity: {
      agentId: 'supervisor',
      agentName: 'Supervisor',
      agentIcon: '🎯',
      agentColor: '#8B5CF6',
    },
  };
}
```

---

## 4. Tests Requeridos

### 4.1 QueryClassifier Tests
```typescript
describe('QueryClassifier', () => {
  describe('classifyHeuristic', () => {
    it('classifies simple queries as not requiring planning');
    it('classifies complex queries as requiring planning');
    it('identifies relevant agents from keywords');
  });
});
```

### 4.2 PlannerAgent Tests
```typescript
describe('PlannerAgent', () => {
  describe('generatePlan', () => {
    it('returns null for simple queries');
    it('generates valid plan for complex queries');
    it('respects maxSteps limit');
    it('validates plan output schema');
    it('handles LLM errors gracefully');
  });

  describe('needsPlanning', () => {
    it('returns false for simple queries');
    it('returns true for complex queries');
  });
});
```

### 4.3 Integration Tests
```typescript
describe('Supervisor Node Integration', () => {
  it('routes directly in directed mode');
  it('generates plan for complex autonomous queries');
  it('skips planning for simple queries');
  it('sets correct agent identity');
});
```

---

## 5. Criterios de Aceptación

- [ ] Simple queries bypass planning (< 200ms)
- [ ] Complex queries generate valid plans
- [ ] Plans have 1-8 steps maximum
- [ ] Each step has valid agentId from registry
- [ ] Directed mode bypasses supervisor
- [ ] LLM errors are handled gracefully
- [ ] Plan output matches Zod schema
- [ ] `npm run verify:types` pasa sin errores

---

## 6. Archivos a Crear

- `backend/src/modules/agents/supervisor/PlannerAgent.ts`
- `backend/src/modules/agents/supervisor/SupervisorNode.ts`
- `backend/src/modules/agents/supervisor/prompts/planner.system.ts`
- `backend/src/modules/agents/supervisor/prompts/planner.examples.ts`
- `backend/src/modules/agents/supervisor/schemas/PlanOutputSchema.ts`
- `backend/src/modules/agents/supervisor/utils/QueryClassifier.ts`
- `backend/src/modules/agents/supervisor/utils/PlanValidator.ts`
- `backend/src/modules/agents/supervisor/index.ts`
- Tests correspondientes

---

## 7. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| LLM genera planes inválidos | Media | Alto | Validación Zod + retry |
| Latencia alta en planning | Media | Medio | Haiku model + heuristics |
| Over-planning simple queries | Media | Bajo | Heuristic classifier |
| Agents no disponibles en plan | Baja | Alto | Validar contra registry |

---

## 8. Estimación

- **Desarrollo**: 5-6 días
- **Testing**: 2-3 días
- **Prompts tuning**: 2 días
- **Total**: 9-11 días

---

## 9. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

