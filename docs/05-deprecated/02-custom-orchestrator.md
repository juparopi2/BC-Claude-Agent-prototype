# Deprecated: Custom Agent Orchestration

> **Status**: ❌ DEPRECATED (Week 4, November 2025)
> **Replaced By**: Claude Agent SDK native routing + DirectAgentService
> **Reason**: SDK already provides orchestration, ~1,500 lines of redundant code

---

## What Was Deprecated

### Custom Orchestration System (~1,500 lines)

```
backend/src/services/orchestration/
  - Orchestrator.ts              ~380 lines (routing logic, agent coordination)
  - IntentAnalyzer.ts            ~380 lines (manual intent classification with Claude Haiku)
  - AgentFactory.ts              ~220 lines (factory pattern for agent instantiation)

backend/src/types/
  - orchestration.types.ts       ~260 lines (custom types for orchestration)

backend/src/services/agents/
  - BaseAgent.ts                 ~150 lines (base class for all agents)
  - QueryAgent.ts                 ~80 lines (BC query specialist)
  - WriteAgent.ts                 ~80 lines (BC write specialist)
  - ValidationAgent.ts            ~80 lines (validation specialist)
```

### How It Worked (OLD)

```typescript
// 1. Analyze intent (extra Claude API call)
const intent = await intentAnalyzer.analyze(userPrompt);
// intent = { type: 'bc-query', confidence: 0.95, entities: ['customer'] }

// 2. Select agent based on intent
const agent = agentFactory.createAgent(intent.type);
// agent = new QueryAgent()

// 3. Orchestrate execution
const result = await orchestrator.orchestrate(agent, userPrompt);
// - Manual tool routing
// - Custom error handling
// - Manual retry logic
```

### Why It Was Deprecated

1. **Redundant with SDK**: Claude Agent SDK already provides:
   - Automatic routing via agent descriptions
   - Tool calling natively
   - Error handling
   - Agentic loop (Think → Act → Verify)

2. **Extra API Calls**: IntentAnalyzer called Claude Haiku for classification (unnecessary cost)

3. **Complexity**: 1,500 lines to maintain, test, debug

4. **Slower Development**: Building orchestration took ~1.5 weeks

---

## What Replaced It

### SDK Automatic Routing

```typescript
// NEW - SDK handles everything
const result = await query({
  prompt: userPrompt,
  options: {
    agents: {
      'bc-query': {
        description: 'Query Business Central data',  // SDK routes based on this
        prompt: `You are a BC query expert...`
      },
      'bc-write': {
        description: 'Create or update BC records',
        prompt: `You are a BC write expert...`
      }
    }
  }
});

// NO manual intent analysis
// NO agent factory
// NO custom orchestration
// SDK does it all automatically
```

### DirectAgentService (SDK Bug Workaround)

Due to SDK ProcessTransport bug (v0.1.29-0.1.30), we use DirectAgentService:

```typescript
// backend/src/services/agent/DirectAgentService.ts (~200 lines)
class DirectAgentService {
  async query(prompt: string, sessionId: string, userId: string) {
    // Manual agentic loop (mirrors SDK internal loop)
    // Uses @anthropic-ai/sdk directly
    // NOT custom orchestration - SDK-compliant workaround
  }
}
```

**Key Difference**: DirectAgentService is **NOT custom orchestration**
- Uses official `@anthropic-ai/sdk` package
- Mirrors SDK's internal agentic loop structure
- Easy migration path to SDK `query()` when bug fixed

---

## Code Impact

**Removed**: ~1,500 lines
**Added**: ~200 lines (DirectAgentService workaround)
**Net Savings**: ~1,300 lines (87% reduction)

---

## Migration Guide

```typescript
// ❌ WRONG - Custom orchestration (deprecated)
import { Orchestrator } from './orchestration/Orchestrator';
import { IntentAnalyzer } from './orchestration/IntentAnalyzer';

const intent = await intentAnalyzer.analyze(prompt);
const agent = agentFactory.createAgent(intent.type);
const result = await orchestrator.orchestrate(agent, prompt);

// ✅ CORRECT - DirectAgentService (SDK-aligned)
import { DirectAgentService } from './agent/DirectAgentService';

const result = await directAgentService.query(prompt, sessionId, userId);
```

---

## Related Documents

- **SDK-First Philosophy**: `docs/02-core-concepts/07-sdk-first-philosophy.md`
- **DirectAgentService**: `docs/11-backend/08-direct-agent-service.md`
- **Direction Changes**: `docs/13-roadmap/07-direction-changes.md` (Direction Change #2)

---

**Deprecated**: 2025-11-07 (Week 4)
**Reason**: Redundant with SDK capabilities, 1,500 lines of unnecessary code
**Replaced By**: SDK automatic routing + DirectAgentService workaround
**Status**: ❌ DO NOT USE
