# PRD-011: Agent Registry

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: PRD-010 (Test Fixtures)
**Bloquea**: Fase 2 (Extended State), Fase 3 (Supervisor)

---

## 1. Objetivo

Crear un registro programático de agentes que permita:
- Registrar agentes de forma declarativa
- Consultar agentes disponibles por ID, capabilities, o metadata
- Crear nodos de grafo dinámicamente desde definiciones
- Exponer agentes seleccionables al usuario (UI)
- Extensibilidad para nuevos agentes sin modificar código existente

---

## 2. Contexto

### 2.1 Estado Actual

Los agentes están definidos implícitamente en:
- `backend/src/modules/agents/orchestrator/router.ts` (routing logic)
- `backend/src/modules/agents/orchestrator/graph.ts` (graph nodes)
- `backend/src/modules/agents/business-central/bc-agent.ts`
- `backend/src/modules/agents/rag-knowledge/rag-agent.ts`

**Problemas**:
1. No hay lista centralizada de agentes
2. Añadir agente requiere modificar múltiples archivos
3. UI no puede consultar qué agentes existen
4. No hay metadata asociada (icon, color, description)

### 2.2 Por qué es Crítico

Para la arquitectura multi-agente necesitamos:
- Supervisor que conoce todos los agentes disponibles
- UI que muestra agentes seleccionables
- Handoffs dinámicos entre agentes
- Identificación visual de qué agente está respondiendo

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos

```
backend/src/modules/agents/core/
├── registry/
│   ├── AgentRegistry.ts         # Registro singleton
│   ├── AgentDefinition.ts       # Interface y tipos
│   └── index.ts
├── definitions/
│   ├── orchestrator.definition.ts
│   ├── bc-agent.definition.ts
│   ├── rag-agent.definition.ts
│   └── index.ts                 # Auto-registro
└── index.ts
```

### 3.2 Interfaces y Tipos

#### AgentDefinition.ts
```typescript
/**
 * Agent capability categories
 */
export type AgentCapability =
  | 'erp_query'      // Can query ERP data
  | 'erp_mutation'   // Can modify ERP data
  | 'rag_search'     // Can search documents
  | 'data_viz'       // Can create visualizations
  | 'planning'       // Can create execution plans
  | 'routing'        // Can route to other agents
  | 'general';       // General conversation

/**
 * Agent model configuration
 */
export interface AgentModelConfig {
  preferredModel: 'claude-3-5-sonnet' | 'claude-3-haiku' | 'claude-opus-4';
  maxTokens?: number;
  temperature?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
}

/**
 * Agent tool definition (simplified)
 */
export interface AgentToolDefinition {
  name: string;
  description: string;
  requiresApproval?: boolean;
  category?: string;
}

/**
 * Complete agent definition
 */
export interface AgentDefinition {
  // Identity
  id: string;                    // Unique identifier (e.g., 'bc-agent')
  name: string;                  // Display name (e.g., 'Business Central Expert')
  description: string;           // Short description for UI

  // Visual
  icon: string;                  // Icon name or emoji (e.g., '📊' or 'building')
  color: string;                 // Hex color for UI theming (e.g., '#3B82F6')

  // Capabilities
  capabilities: AgentCapability[];
  tools: AgentToolDefinition[];

  // Configuration
  systemPrompt: string;          // Base system prompt
  modelConfig: AgentModelConfig;

  // Availability
  isUserSelectable: boolean;     // Can user select this agent?
  isSystemAgent: boolean;        // Internal use only (e.g., orchestrator)

  // Routing hints
  triggerKeywords?: string[];    // Keywords that trigger this agent
  triggerPatterns?: RegExp[];    // Patterns that trigger this agent
}

/**
 * Partial definition for registration
 */
export type AgentDefinitionInput = Omit<AgentDefinition, 'tools'> & {
  tools?: AgentToolDefinition[];
};
```

#### AgentRegistry.ts
```typescript
import type { AgentDefinition, AgentDefinitionInput, AgentCapability } from './AgentDefinition';

/**
 * AgentRegistry - Centralized agent management
 *
 * Singleton that holds all agent definitions and provides query APIs.
 * Used by:
 * - Supervisor for routing decisions
 * - UI for displaying available agents
 * - Graph builder for creating agent nodes
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private agents: Map<string, AgentDefinition> = new Map();

  private constructor() {}

  // ============================================
  // Singleton
  // ============================================

  public static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  public static resetInstance(): void {
    AgentRegistry.instance = null;
  }

  // ============================================
  // Registration
  // ============================================

  /**
   * Register an agent definition
   * @throws Error if agent with same ID already registered
   */
  register(definition: AgentDefinitionInput): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent '${definition.id}' is already registered`);
    }

    const fullDefinition: AgentDefinition = {
      ...definition,
      tools: definition.tools ?? [],
    };

    this.agents.set(definition.id, fullDefinition);
  }

  /**
   * Register multiple agents at once
   */
  registerAll(definitions: AgentDefinitionInput[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /**
   * Unregister an agent (mainly for testing)
   */
  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  // ============================================
  // Query APIs
  // ============================================

  /**
   * Get agent by ID
   */
  get(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all registered agents
   */
  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents that users can select
   */
  getUserSelectableAgents(): AgentDefinition[] {
    return this.getAll().filter(agent => agent.isUserSelectable);
  }

  /**
   * Get agents with specific capability
   */
  getByCapability(capability: AgentCapability): AgentDefinition[] {
    return this.getAll().filter(agent =>
      agent.capabilities.includes(capability)
    );
  }

  /**
   * Get agent that should handle a query (for routing)
   */
  findByKeywords(query: string): AgentDefinition | undefined {
    const lowerQuery = query.toLowerCase();

    for (const agent of this.agents.values()) {
      // Check keywords
      if (agent.triggerKeywords?.some(kw => lowerQuery.includes(kw.toLowerCase()))) {
        return agent;
      }

      // Check patterns
      if (agent.triggerPatterns?.some(pattern => pattern.test(query))) {
        return agent;
      }
    }

    return undefined;
  }

  /**
   * Check if agent exists
   */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Get agent count
   */
  get size(): number {
    return this.agents.size;
  }

  // ============================================
  // Serialization (for API responses)
  // ============================================

  /**
   * Get summary for UI (excludes sensitive data like systemPrompt)
   */
  getUISummary(): AgentUISummary[] {
    return this.getUserSelectableAgents().map(agent => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      icon: agent.icon,
      color: agent.color,
      capabilities: agent.capabilities,
    }));
  }
}

export interface AgentUISummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  capabilities: AgentCapability[];
}

// Convenience function
export function getAgentRegistry(): AgentRegistry {
  return AgentRegistry.getInstance();
}
```

### 3.3 Agent Definitions

#### bc-agent.definition.ts
```typescript
import { AgentDefinitionInput } from '../core/registry/AgentDefinition';

export const bcAgentDefinition: AgentDefinitionInput = {
  id: 'bc-agent',
  name: 'Business Central Expert',
  description: 'Specialist in Microsoft Business Central ERP operations',

  icon: '📊',
  color: '#3B82F6', // Blue

  capabilities: ['erp_query', 'erp_mutation'],

  tools: [
    { name: 'bc_search_entities', description: 'Search BC entities' },
    { name: 'bc_get_entity_fields', description: 'Get entity fields' },
    { name: 'bc_get_relationships', description: 'Get entity relationships' },
    { name: 'bc_validate_payload', description: 'Validate API payload' },
    { name: 'bc_get_workflows', description: 'Get business workflows' },
    { name: 'bc_explore_endpoints', description: 'Explore API endpoints' },
    { name: 'bc_get_best_practices', description: 'Get BC best practices' },
  ],

  systemPrompt: `You are an expert in Microsoft Business Central...`, // Actual prompt

  modelConfig: {
    preferredModel: 'claude-3-5-sonnet',
    maxTokens: 8192,
    temperature: 0.3,
  },

  isUserSelectable: true,
  isSystemAgent: false,

  triggerKeywords: [
    'business central', 'bc', 'dynamics',
    'customer', 'vendor', 'invoice', 'order',
    'inventory', 'item', 'sales', 'purchase',
  ],
};
```

#### rag-agent.definition.ts
```typescript
import { AgentDefinitionInput } from '../core/registry/AgentDefinition';

export const ragAgentDefinition: AgentDefinitionInput = {
  id: 'rag-agent',
  name: 'Knowledge Base Expert',
  description: 'Searches and analyzes your uploaded documents',

  icon: '🧠',
  color: '#10B981', // Green

  capabilities: ['rag_search'],

  tools: [
    { name: 'rag_semantic_search', description: 'Search documents semantically' },
  ],

  systemPrompt: `You are a knowledge assistant...`,

  modelConfig: {
    preferredModel: 'claude-3-5-sonnet',
    maxTokens: 8192,
    temperature: 0.2,
  },

  isUserSelectable: true,
  isSystemAgent: false,

  triggerKeywords: [
    'document', 'file', 'pdf', 'search',
    'knowledge', 'uploaded', 'my files',
  ],
  triggerPatterns: [
    /search\s+(in\s+)?(my\s+)?(files|documents)/i,
    /what\s+does\s+(the|my)\s+(document|file)/i,
  ],
};
```

#### orchestrator.definition.ts
```typescript
import { AgentDefinitionInput } from '../core/registry/AgentDefinition';

export const orchestratorDefinition: AgentDefinitionInput = {
  id: 'orchestrator',
  name: 'Orchestrator',
  description: 'Routes queries to specialized agents',

  icon: '🎯',
  color: '#8B5CF6', // Purple

  capabilities: ['routing', 'general'],

  tools: [],

  systemPrompt: `You are a routing assistant...`,

  modelConfig: {
    preferredModel: 'claude-3-haiku', // Fast for routing
    maxTokens: 1024,
    temperature: 0.1,
  },

  isUserSelectable: false, // Not directly selectable
  isSystemAgent: true,
};
```

### 3.4 Auto-Registration

#### definitions/index.ts
```typescript
import { getAgentRegistry } from '../core/registry';
import { orchestratorDefinition } from './orchestrator.definition';
import { bcAgentDefinition } from './bc-agent.definition';
import { ragAgentDefinition } from './rag-agent.definition';

/**
 * Register all built-in agents
 * Called once during application startup
 */
export function registerBuiltInAgents(): void {
  const registry = getAgentRegistry();

  registry.registerAll([
    orchestratorDefinition,
    bcAgentDefinition,
    ragAgentDefinition,
  ]);
}

// Export definitions for testing
export {
  orchestratorDefinition,
  bcAgentDefinition,
  ragAgentDefinition,
};
```

---

## 4. Integration Points

### 4.1 Router Integration
```typescript
// In router.ts
import { getAgentRegistry } from '@/modules/agents/core/registry';

function routeByKeywords(query: string): string | null {
  const registry = getAgentRegistry();
  const agent = registry.findByKeywords(query);
  return agent?.id ?? null;
}
```

### 4.2 API Endpoint for UI
```typescript
// In routes/agents.ts
import { getAgentRegistry } from '@/modules/agents/core/registry';

router.get('/api/agents', authenticateMicrosoft, (req, res) => {
  const registry = getAgentRegistry();
  const agents = registry.getUISummary();
  res.json({ agents });
});
```

### 4.3 Application Startup
```typescript
// In app.ts or index.ts
import { registerBuiltInAgents } from '@/modules/agents/definitions';

// During startup
registerBuiltInAgents();
```

---

## 5. Tests Requeridos

### 5.1 AgentRegistry Tests
```typescript
describe('AgentRegistry', () => {
  beforeEach(() => {
    AgentRegistry.resetInstance();
  });

  describe('registration', () => {
    it('registers agent successfully');
    it('throws on duplicate registration');
    it('registers multiple agents');
    it('unregisters agent');
  });

  describe('queries', () => {
    it('gets agent by ID');
    it('returns undefined for unknown ID');
    it('gets all agents');
    it('gets user-selectable agents only');
    it('gets agents by capability');
    it('finds agent by keywords');
    it('finds agent by pattern');
  });

  describe('serialization', () => {
    it('returns UI summary without systemPrompt');
    it('includes all required fields');
  });
});
```

### 5.2 Definition Tests
```typescript
describe('Agent Definitions', () => {
  it('bc-agent has required fields');
  it('rag-agent has required fields');
  it('orchestrator is system agent');
  it('all IDs are unique');
  it('all colors are valid hex');
});
```

---

## 6. Criterios de Aceptación

- [ ] AgentRegistry singleton works correctly
- [ ] All existing agents registered
- [ ] Query APIs work correctly
- [ ] UI summary excludes sensitive data
- [ ] Router uses registry for keyword matching
- [ ] API endpoint returns agent list
- [ ] Tests cover all functionality
- [ ] `npm run verify:types` pasa sin errores

---

## 7. Archivos a Crear

- `backend/src/modules/agents/core/registry/AgentRegistry.ts`
- `backend/src/modules/agents/core/registry/AgentDefinition.ts`
- `backend/src/modules/agents/core/registry/index.ts`
- `backend/src/modules/agents/definitions/orchestrator.definition.ts`
- `backend/src/modules/agents/definitions/bc-agent.definition.ts`
- `backend/src/modules/agents/definitions/rag-agent.definition.ts`
- `backend/src/modules/agents/definitions/index.ts`
- `backend/src/routes/agents.ts` (new API endpoint)
- `backend/src/__tests__/unit/agents/AgentRegistry.test.ts`

---

## 8. Archivos a Modificar

- `backend/src/modules/agents/orchestrator/router.ts` (use registry)
- `backend/src/app.ts` or startup file (register agents)
- `backend/src/routes/index.ts` (mount agents routes)

---

## 9. Impacto en Fases Posteriores

### Fase 3 (Supervisor)
El supervisor usará el registry para:
```typescript
// Get all agents supervisor can delegate to
const delegatableAgents = registry.getAll()
  .filter(a => !a.isSystemAgent);

// Include in plan generation prompt
const agentList = delegatableAgents.map(a =>
  `- ${a.id}: ${a.description} (capabilities: ${a.capabilities.join(', ')})`
).join('\n');
```

### Fase 5 (Graphing Agent)
Añadir nueva definición:
```typescript
registry.register({
  id: 'graphing-agent',
  name: 'Data Visualization Expert',
  capabilities: ['data_viz'],
  // ...
});
```

### Fase 6 (UI)
Frontend consume API:
```typescript
const { data } = await api.get('/api/agents');
// Display agent selector with data.agents
```

---

## 10. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Registration order issues | Baja | Medio | Single registration point |
| Singleton state leaks in tests | Media | Medio | resetInstance() method |
| Definition out of sync with impl | Media | Medio | Contract tests |

---

## 11. Estimación

- **Desarrollo**: 3-4 días
- **Testing**: 1-2 días
- **Integration**: 1 día
- **Total**: 5-7 días

---

## 12. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

