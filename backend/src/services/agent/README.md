# Agent Service

Direct implementation using Anthropic SDK for executing queries with Business Central integration.

## Overview

The Direct Agent Service provides:
- Direct Claude API integration via `@anthropic-ai/sdk`
- Custom agentic loop implementation
- Tool execution with Business Central data
- Event streaming
- Session management
- Local MCP data file integration

## Architecture

**DirectAgentService** is the production implementation that:
1. Uses `@anthropic-ai/sdk` for direct Claude API calls
2. Implements a custom agentic loop (Think → Act → Verify)
3. Loads Business Central entity metadata from local JSON files
4. Executes tool calls manually based on Claude's responses
5. Streams events in real-time via callback

## Installation

The core Anthropic SDK is installed:
```bash
@anthropic-ai/sdk@0.68.0
```

## Configuration

Required environment variables:
```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

## Usage

### Basic Query

```typescript
import { getDirectAgentService } from '@/services/agent';

const agentService = getDirectAgentService();

const result = await agentService.executeQueryStreaming(
  'List the first 5 customers from Business Central',
  'user-123',
  'session-456'
);

console.log(result.response);
console.log('Tools used:', result.toolsUsed);
```

### With Event Streaming

```typescript
const result = await agentService.executeQueryStreaming(
  'Create a new customer named Acme Corp',
  'user-123',
  'session-456',
  (event) => {
    switch (event.type) {
      case 'session_start':
        console.log('Session started');
        break;
      case 'thinking':
        console.log('Agent is thinking...');
        break;
      case 'tool_use':
        console.log('Using tool:', event.toolName);
        break;
      case 'message':
        console.log('Message:', event.content);
        break;
      case 'error':
        console.error('Error:', event.error);
        break;
    }
  }
);
```

## API Endpoints

### GET /api/agent/status

Check agent configuration status.

**Response:**
```json
{
  "configured": true,
  "config": {
    "hasApiKey": true,
    "model": "claude-3-5-sonnet-20241022"
  }
}
```

## Testing

### Test Agent Status

```bash
curl http://localhost:3002/api/agent/status | json_pp
```

### Test Simple Query

```bash
curl -X POST http://localhost:3002/api/agent/query \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is 2+2?",
    "sessionId": "test-123"
  }' | json_pp
```

## Agent Events

The DirectAgentService emits various event types:

| Event Type | Description | Fields |
|------------|-------------|--------|
| `session_start` | Session begins | sessionId, userId |
| `thinking` | Agent is reasoning | content, tokenCount |
| `message_partial` | Streaming message chunk | content, messageId |
| `message` | Complete message | content, messageId, role, tokenUsage |
| `tool_use` | Tool is being called | toolName, args, toolUseId |
| `tool_result` | Tool execution result | toolName, result, success, error |
| `error` | Error occurred | error, code |
| `session_end` | Session ends | reason |

## Business Central Integration

The DirectAgentService:
1. Loads entity metadata from `mcp-server/data/v1.0/*.json`
2. Provides Business Central tools to Claude:
   - `bc_query_entity` - Query entities (customers, vendors, items, etc.)
   - `bc_create_entity` - Create new records
   - `bc_update_entity` - Update existing records
   - `bc_delete_entity` - Delete records
3. Executes tool calls by making API requests to Business Central
4. Returns results to Claude for formatting

**Example flow:**
```
User: "List customers"
  ↓
DirectAgentService creates system prompt with BC tools
  ↓
Claude API analyzes prompt
  ↓
Claude responds with tool_use for bc_query_entity
  ↓
DirectAgentService executes tool manually
  ↓
Loads entity schema from mcp-server/data/v1.0/customers.json
  ↓
Business Central API call (via BCClient)
  ↓
Returns customer data to Claude
  ↓
Claude formats response
  ↓
User receives: "Here are 5 customers: ..."
```

## Important Notes

### Local MCP Data Files

**✅ All entity data is vendored locally:**
- Location: `backend/mcp-server/data/v1.0/`
- 52 entity JSON files with full schemas
- `bc_index.json` master index
- No external MCP server dependency for metadata

### API Key Security

The API key is loaded from environment variables:
```typescript
const apiKey = process.env.ANTHROPIC_API_KEY;
```

Never commit API keys to code. Use Azure Key Vault in production.

## Error Handling

```typescript
const result = await agentService.executeQueryStreaming(prompt, userId, sessionId);

if (!result.success) {
  console.error('Query failed:', result.error);
  // Handle error
}
```

Common errors:
- `ANTHROPIC_API_KEY not configured` - Missing API key
- `Tool execution failed` - BC operation error
- `Entity not found` - Invalid entity name in tool call

## Configuration Status

Check if DirectAgentService is properly configured:

```typescript
const agentService = getDirectAgentService();

if (!agentService.isConfigured()) {
  console.error('ANTHROPIC_API_KEY not set');
  return;
}

const status = agentService.getConfigStatus();
console.log('Has API Key:', status.hasApiKey);
console.log('Model:', status.model);
```

## Implementation Details

**DirectAgentService** implements:
- Custom agentic loop with max 10 iterations
- Tool use detection via Claude's `tool_use` content blocks
- Streaming support via `@anthropic-ai/sdk` MessageStream
- Session persistence via resume/conversation tracking
- Error handling with graceful degradation

**vs. Agent SDK approach:**
- Agent SDK required Claude Code CLI (not viable in Container Apps)
- DirectAgentService uses direct API calls (deployable anywhere)
- Manual tool execution gives more control
- Local data files eliminate external dependencies

## Next Steps

1. **Session Persistence** - Save conversations to database
2. **WebSocket Streaming** - Real-time event streaming to frontend (✅ implemented)
3. **Approval System** - Human-in-the-loop for write operations
4. **Testing** - Unit tests for tool execution
5. **Monitoring** - Token usage tracking and cost optimization

## References

- [Anthropic SDK Documentation](https://docs.anthropic.com/en/api/client-sdks)
- [BC Client](../bc/README.md)
- [DirectAgentService Implementation](./DirectAgentService.ts)
