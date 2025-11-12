# SDK-First Philosophy

> **Status**: ⚠️ **PERMANENT ARCHITECTURAL PRINCIPLE** - Written in Stone
> **Last Updated**: 2025-11-12
> **Version**: 1.0

---

## The Golden Rule

> **If there is a problem with the SDK and we have to sacrifice our logic, our code, or our implementation to benefit from using the SDK, we are willing to do so. We must NOT bypass the SDK just because it doesn't work and create a solution on our own.**

This principle is the **foundation** of the BC-Claude-Agent-Prototype project. The Claude Agent SDK is the **maximum priority** and **source of truth**. NEVER bypass the SDK with custom solutions.

---

## Why SDK-First?

### Benefits of SDK Alignment

1. **Official Framework**: Built by Anthropic, the creators of Claude
2. **Automatic Updates**: Benefit from future SDK improvements automatically
3. **Proven Architecture**: Same framework used by Claude Code itself
4. **Reduced Maintenance**: ~1,500 lines of custom orchestration eliminated
5. **Faster Development**: Saved ~1.5 weeks on MVP by not building custom agent system
6. **Better Support**: Official documentation, GitHub issues, community

### Cost of Custom Solutions

1. **Technical Debt**: Custom orchestration requires ongoing maintenance
2. **Missed Improvements**: Don't benefit from SDK updates
3. **Complexity**: Manual agentic loops, tool calling, context management
4. **Testing Burden**: Must test custom logic extensively
5. **Knowledge Gaps**: Team knowledge doesn't transfer to SDK updates

---

## What the SDK Provides (DO NOT Rebuild)

The SDK includes these capabilities **built-in**. **NEVER reimplement them**:

### 1. Agentic Loop Automático (Think → Act → Verify → Repeat)

**SDK Provides**:
```typescript
// SDK handles the loop automatically
const result = await query({
  prompt: "Analyze customer data and create report",
  options: { maxTurns: 20 }
});
```

**DO NOT Do**:
```typescript
// ❌ WRONG - Manual loop
while (shouldContinue) {
  const response = await callClaude();
  if (needsTool) {
    await executeTool();
  }
  shouldContinue = checkConditions();
}
```

**Exception**: DirectAgentService implements manual loop as **SDK-compliant workaround** for ProcessTransport bug. It **mirrors the SDK's internal loop**, not a custom approach.

---

### 2. Tool Calling Nativo

**SDK Provides**:
- Automatic tool discovery via MCP
- Tool execution with error handling
- Tool result formatting
- Parallel tool execution

**DO NOT**:
- Manually parse tool_use blocks
- Build custom tool execution logic
- Create tool routing systems

---

### 3. Context Management

**SDK Provides**:
- Session persistence via `resume` parameter
- Automatic context window management
- Built-in memory across turns
- Context pruning when limits reached

**DO NOT**:
- Manually track conversation history
- Build custom context window logic
- Implement session state separately

---

### 4. Streaming Built-in

**SDK Provides**:
```typescript
const stream = query({ ..., includePartialMessages: true });
for await (const event of stream) {
  // Real-time events: message_chunk, tool_use, etc.
}
```

**DO NOT**:
- Build custom streaming infrastructure
- Manually chunk responses
- Create event emitters for streaming

---

### 5. Prompt Caching Automático

**SDK Provides**:
- Automatic prompt caching (not configurable)
- ~90% cost reduction on cached prompts
- Transparent to the application

**DO NOT**:
- Try to enable caching manually
- Build custom caching logic
- Specify `promptCaching: true` (doesn't exist in SDK config)

---

### 6. TodoWrite Tool Nativo (Intended)

**SDK Documentation Claims**:
- Automatic TODO generation for complex tasks
- Integration with agentic loop

**Reality**: SDK v0.1.30 does **NOT** include TodoWrite tool despite documentation

**Current Approach**: Custom TodoManager with heuristics (temporary)

**Future**: If SDK adds TodoWrite, **immediately migrate** to SDK native implementation

---

## What We Build (Application Layer)

Our responsibility is the **application layer** on top of the SDK:

### 1. Specialized Agents (via `agents` config)

**Correct Approach**:
```typescript
const result = await query({
  prompt,
  options: {
    agents: {
      'bc-query': {
        description: 'Expert in querying BC data',  // Concise (≤8 words)
        prompt: `You are a Business Central query expert...`  // Detailed
        // NO tools array - allows all MCP tools
      },
      'bc-write': {
        description: 'Expert in creating/updating BC records',
        prompt: `You are a Business Central write expert...`
      }
    }
  }
});
```

**Key Points**:
- **Descriptions**: Concise (≤8 words) for SDK routing
- **Prompts**: Detailed domain-specific instructions
- **NO `tools` array**: Omit to allow access to all MCP tools
- **SDK Routes Automatically**: Based on descriptions

---

### 2. Human-in-the-Loop (via `canUseTool` hook)

**Correct Approach**:
```typescript
const result = await query({
  prompt,
  options: {
    canUseTool: async (toolName, toolInput) => {
      // Intercept write operations
      if (this.isWriteOperation(toolName)) {
        const approved = await this.approvalManager.requestApproval(...);
        if (!approved) {
          return {
            behavior: 'deny',
            reason: 'User rejected the operation'
          };
        }
      }

      return { behavior: 'allow' };
    }
  }
});
```

**DO NOT**:
- Execute tools manually outside SDK
- Bypass SDK tool execution
- Implement custom approval after tool execution

---

### 3. Event Streaming (consume SDK stream)

**Correct Approach**:
```typescript
const stream = query({ ... });

for await (const event of stream) {
  switch (event.type) {
    case 'agent:message_chunk':
      this.websocket.emit('message:chunk', event.data);
      break;
    case 'agent:tool_use':
      this.websocket.emit('tool:use', event.data);
      break;
    // ... handle other events
  }
}
```

**DO NOT**:
- Reimplement streaming logic
- Create custom event types
- Bypass SDK event stream

---

### 4. Database Persistence (intercept SDK events)

**Correct Approach**:
```typescript
const stream = query({ ... });

for await (const event of stream) {
  if (event.type === 'agent:message_delta') {
    // Save to database
    await this.db.insertMessage({ sessionId, content: event.data });
  }

  if (event.type === 'agent:tool_use' && event.data.toolName === 'TodoWrite') {
    // Intercept SDK todo generation
    await this.todoManager.createFromSDK(event.data);
  }
}
```

**DO NOT**:
- Regenerate data that SDK already provides
- Create parallel state tracking
- Duplicate SDK's internal state

---

## SDK-Compliant Architecture Pattern

### Correct Structure

```typescript
// ✅ CORRECT - SDK-compliant
import { query } from '@anthropic-ai/claude-agent-sdk';

class AgentService {
  async executeQuery(prompt: string, sessionId: string, userId: string) {
    // 1. Fetch user's BC token
    const bcToken = await this.bcTokenManager.getToken(userId);

    // 2. Setup MCP servers with BC token
    const mcpServers = {
      'bc-mcp': {
        type: 'sse',
        url: process.env.MCP_SERVER_URL,
        headers: {
          'Authorization': `Bearer ${bcToken}`
        }
      }
    };

    // 3. Query with SDK (handles agentic loop automatically)
    const stream = query({
      prompt,
      options: {
        mcpServers,
        model: 'claude-sonnet-4-5',
        resume: sessionId,
        maxTurns: 20,
        agents: {
          'bc-query': {
            description: 'Query Business Central data',
            prompt: `You are a BC query expert...`,
            // NO tools array
          }
        },
        canUseTool: async (toolName, toolInput) => {
          // Approval logic
          if (this.isWriteOperation(toolName)) {
            const approved = await this.requestApproval(...);
            return { behavior: approved ? 'allow' : 'deny' };
          }
          return { behavior: 'allow' };
        }
      }
    });

    // 4. Stream events to frontend
    for await (const event of stream) {
      this.websocket.emit(event.type, event.data);
    }
  }
}
```

### Incorrect Structure

```typescript
// ❌ WRONG - Custom orchestration
class CustomOrchestrator {
  async executeQuery(prompt: string) {
    // Manual intent classification
    const intent = await this.intentAnalyzer.analyze(prompt);

    // Manual agent selection
    const agent = this.agentFactory.createAgent(intent);

    // Manual agentic loop
    let shouldContinue = true;
    while (shouldContinue) {
      const response = await this.callClaude();

      if (response.needsTool) {
        // Manual tool execution
        const result = await this.executeTool(response.tool);
        shouldContinue = this.evaluateResult(result);
      }
    }
  }
}
```

**Problem**: Reimplements SDK's built-in capabilities (~1,500 lines of redundant code).

---

## Best Practices for SDK Compliance

### 1. Agents Configuration

✅ **DO**:
- Use **concise descriptions** (≤8 words) for routing
- Provide **detailed prompts** with domain knowledge
- **Omit `tools` array** to allow all MCP tools
- Let SDK handle routing automatically

❌ **DON'T**:
- Use `tools: ['Read', 'Grep']` - blocks MCP tools
- Create manual routing logic
- Build custom intent classification

**Example**:
```typescript
agents: {
  'bc-query': {
    description: 'Query Business Central data',  // 4 words - SDK routes here
    prompt: `You are an expert in querying Microsoft Business Central...`
  },
  'bc-write': {
    description: 'Create or update BC records',  // 5 words
    prompt: `You are an expert in creating and updating BC records...`
  }
}
```

---

### 2. Hook Callbacks

✅ **DO**:
- Use `canUseTool` for permission control
- Return `PermissionResult` per SDK signature
- Use `onPreToolUse` for side effects (logging)
- Use `onPostToolUse` to react to results

❌ **DON'T**:
- Execute tools manually outside SDK
- Bypass SDK tool execution flow
- Modify tool parameters (use canUseTool denial instead)

**Example**:
```typescript
canUseTool: async (toolName, toolInput) => {
  // Log pre-execution
  await this.auditLog.log('tool:pre', { toolName, toolInput });

  // Approval check
  if (this.isWriteOperation(toolName)) {
    const approved = await this.approvalManager.request(...);
    if (!approved) {
      return { behavior: 'deny', reason: 'User rejected' };
    }
  }

  return { behavior: 'allow' };
}
```

---

### 3. MCP Integration

✅ **DO**:
- Use format: `{ 'server-name': { type: 'sse', url: '...' } }`
- Let SDK auto-discover tools (prefix: `mcp__server-name__tool`)
- Trust SDK for tool execution
- Pass auth tokens via headers

❌ **DON'T**:
- Call MCP API directly (bypass SDK)
- Manual tool discovery
- Custom tool name mapping

**Example**:
```typescript
mcpServers: {
  'bc-mcp': {
    type: 'sse',  // or 'stdio' for subprocess
    url: 'https://mcp-server.example.com/mcp',
    headers: {
      'Authorization': `Bearer ${userBCToken}`
    }
  }
}
```

---

### 4. Performance Optimization

✅ **DO**:
- Use `maxTurns` for safety limits
- Trust SDK automatic caching (not configurable)
- Monitor token usage via SDK events
- Optimize prompt lengths

❌ **DON'T**:
- Try to configure caching manually
- Build custom caching layers
- Bypass SDK for "performance"

---

## Known Issues & SDK-Compliant Workarounds

### 1. ProcessTransport Bug (v0.1.29-0.1.30)

**Issue**: SDK crashes with "Claude Code process exited with code 1" when using MCP servers.

**GitHub Issues**: #176, #4619

**SDK-Compliant Workaround**: DirectAgentService

**Why SDK-Compliant**:
- Uses `@anthropic-ai/sdk` directly (Anthropic official package)
- Implements **manual agentic loop** that **mirrors SDK's internal loop**
- Maintains SDK architecture patterns (hooks, streaming, tools)
- Easy migration path back to SDK `query()` when bug fixed

**Code**:
```typescript
// backend/src/services/agent/DirectAgentService.ts
class DirectAgentService {
  async query(prompt: string, sessionId: string) {
    // Manual agentic loop (mirrors SDK internal loop)
    let turnCount = 0;
    const maxTurns = 20;

    while (turnCount < maxTurns) {
      // Call Claude with tools (same as SDK does internally)
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        messages: conversationHistory,
        tools: mcpServer.listTools(),  // MCP tools
        stream: true
      });

      // Process tool calls (same flow as SDK)
      for await (const chunk of response) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'tool_use') {
          // Approval hook (same as canUseTool)
          if (this.isWriteOperation(chunk.delta.name)) {
            const approved = await this.approvalManager.request(...);
            if (!approved) continue;
          }

          // Execute tool via MCP (same as SDK does)
          const result = await mcpServer.callTool(chunk.delta.name, args);
          conversationHistory.push({ role: 'user', content: [{ type: 'tool_result', ...result }] });
        }
      }

      turnCount++;
    }
  }
}
```

**NOT a Custom Solution**: This is **SDK-aligned** because:
1. Uses official `@anthropic-ai/sdk` package
2. Mirrors SDK's internal agentic loop structure
3. Maintains same hook patterns (canUseTool equivalent)
4. Easy to replace with `query()` when SDK fixes bug

**Future**: Migrate back to SDK `query()` if v0.1.31+ fixes ProcessTransport.

---

### 2. TodoWrite Tool Missing

**Issue**: SDK documentation mentions TodoWrite tool, but v0.1.30 doesn't include it.

**SDK-Compliant Workaround**: Custom TodoManager (temporary)

**Why Temporary**:
- SDK documentation implies future support
- Custom heuristics as placeholder
- **Will immediately migrate** to SDK native TodoWrite when available

**Code**:
```typescript
// backend/src/services/todos/TodoManager.ts (temporary)
class TodoManager {
  async generateFromPlan(sessionId: string, agentPlan: string) {
    // Heuristic parsing (temporary until SDK provides TodoWrite)
    const steps = this.parseNumberedSteps(agentPlan);
    for (const step of steps) {
      await this.db.createTodo({ sessionId, content: step });
    }
  }
}
```

**Future**: Replace with SDK event interception:
```typescript
// When SDK adds TodoWrite tool
for await (const event of stream) {
  if (event.type === 'agent:tool_use' && event.data.toolName === 'TodoWrite') {
    await this.todoManager.createFromSDK(event.data);
  }
}
```

---

## Verification Checklist

Before implementing any feature, ask yourself:

### 1. Am I reimplementing something the SDK already does?

**Check**:
- Agentic loop: SDK handles automatically
- Tool calling: SDK discovers + executes
- Context management: SDK manages
- Streaming: SDK provides events
- Caching: SDK handles automatically

**If YES**: STOP. Use SDK capability instead.

---

### 2. Am I blocking SDK capabilities?

**Check**:
- Using `tools: ['Read', 'Grep']` restricts MCP tools
- Bypassing `canUseTool` breaks approval flow
- Not using `resume` loses session context

**If YES**: STOP. Remove restrictions, use SDK fully.

---

### 3. Am I following SDK type signatures exactly?

**Check**:
```typescript
// ✅ Correct - matches SDK signature
canUseTool: async (toolName: string, toolInput: unknown): Promise<PermissionResult> => {
  return { behavior: 'allow' };
}

// ❌ Wrong - custom signature
canUseTool: (tool: Tool) => boolean {
  return true;
}
```

**If NO**: STOP. Match SDK types exactly.

---

### 4. Is there a more SDK-aligned way?

**Always prefer**:
- SDK hooks over custom logic
- SDK events over manual tracking
- SDK routing over custom orchestration
- SDK streaming over manual chunking

**If unsure**: Read SDK docs, check examples, ask team.

---

## Documentation References

**Official SDK Docs**: https://docs.claude.com/en/docs/agent-sdk/typescript

**Internal Docs**:
- Agent SDK Usage: `docs/02-core-concepts/06-agent-sdk-usage.md`
- Agentic Loop: `docs/03-agent-system/01-agentic-loop.md`
- DirectAgentService: `docs/11-backend/08-direct-agent-service.md`

---

## Commitment to SDK-First

This project is **committed to SDK-first** architecture. Even when faced with SDK bugs (ProcessTransport), we chose **SDK-compliant workarounds** (DirectAgentService) over fully custom solutions.

**This demonstrates**:
- Long-term thinking (benefit from SDK updates)
- Team discipline (no shortcuts)
- Architectural integrity (maintain SDK patterns)

**Result**: When SDK fixes bugs, we have an easy migration path. If we had built custom orchestration, we'd be stuck with technical debt forever.

---

## Final Reminder

> "The SDK is the foundation. We build on it, not around it."

**NEVER bypass the SDK.** If you encounter limitations, build **SDK-compliant workarounds** that maintain SDK architecture patterns and provide easy migration paths when SDK improves.

---

**Document Version**: 1.0
**Status**: ⚠️ PERMANENT - Do Not Modify Without Team Consensus
**Last Updated**: 2025-11-12
**Maintainer**: BC-Claude-Agent Team
