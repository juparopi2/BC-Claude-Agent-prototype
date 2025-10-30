# Agent Service

Agent service using Claude Agent SDK for executing queries with automatic MCP tool integration.

## Overview

The Agent Service wraps the official `@anthropic-ai/claude-agent-sdk` to provide:
- Automatic MCP server integration
- Tool discovery and calling
- Event streaming
- Session management
- Business Central operations via MCP

## Installation

The Agent SDK is already installed:
```bash
@anthropic-ai/claude-agent-sdk@0.1.29
```

## Configuration

Required environment variables:
```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
MCP_SERVER_URL=https://app-erptools-mcp-dev...
```

## Usage

### Basic Query

```typescript
import { getAgentService } from '@/services/agent';

const agentService = getAgentService();

const result = await agentService.executeQuery(
  'List the first 5 customers from Business Central'
);

console.log(result.response);
console.log('Tools used:', result.toolsUsed);
```

### With Session ID

```typescript
const result = await agentService.executeQuery(
  'Create a new customer named Acme Corp',
  'session-123'
);
```

### With Event Streaming

```typescript
const result = await agentService.executeQuery(
  'Update customer X with new email',
  'session-123',
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
    "mcpConfigured": true,
    "model": "claude-3-5-sonnet-20241022"
  },
  "mcpServer": {
    "url": "https://app-erptools-mcp-dev...",
    "configured": true
  }
}
```

### POST /api/agent/query

Execute an agent query.

**Request:**
```json
{
  "prompt": "List the first 5 customers from Business Central",
  "sessionId": "session-123" // optional
}
```

**Response:**
```json
{
  "sessionId": "session-123",
  "response": "Here are the first 5 customers:\n1. Customer A\n2. Customer B...",
  "messageId": "msg_...",
  "tokenUsage": {
    "inputTokens": 1234,
    "outputTokens": 567,
    "totalTokens": 1801
  },
  "toolsUsed": ["bc_query_entity"],
  "durationMs": 2345,
  "success": true
}
```

## Testing

### Test Agent Status

```bash
curl http://localhost:3001/api/agent/status | json_pp
```

### Test Simple Query

```bash
curl -X POST http://localhost:3001/api/agent/query \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is 2+2?",
    "sessionId": "test-123"
  }' | json_pp
```

### Test BC Integration (requires MCP connectivity)

```bash
curl -X POST http://localhost:3001/api/agent/query \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "List the first 3 customers from Business Central",
    "sessionId": "bc-test-123"
  }' | json_pp
```

## Agent Events

The Agent SDK emits various event types:

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

## MCP Integration

The Agent SDK automatically:
1. Connects to configured MCP servers
2. Discovers available tools
3. Calls tools based on user prompts
4. Returns results

**Example flow:**
```
User: "List customers"
  ↓
Agent SDK analyzes prompt
  ↓
Discovers bc_query_entity tool from MCP
  ↓
Calls bc_query_entity(entity: 'customers', top: 5)
  ↓
MCP → Business Central API
  ↓
Returns customer data
  ↓
Agent formats response
  ↓
User receives: "Here are 5 customers: ..."
```

## Important Notes

### MCP Server Connectivity

**⚠️ Local Development Limitation:**
- The MCP server is deployed in Azure Container Apps
- NOT accessible from local network (timeouts expected)
- **Will work when backend is deployed to Azure** (same network)

**For local testing:**
- Agent SDK basic queries work (no MCP tools)
- MCP integration can only be tested in Azure deployment

### API Key Security

The API key is set via environment variable:
```typescript
process.env.ANTHROPIC_API_KEY = this.apiKey;
```

Never commit API keys to code. Use Azure Key Vault in production.

## Error Handling

```typescript
const result = await agentService.executeQuery(prompt);

if (!result.success) {
  console.error('Query failed:', result.error);
  // Handle error
}
```

Common errors:
- `ANTHROPIC_API_KEY not configured` - Missing API key
- `MCP server timeout` - MCP not accessible (expected in local dev)
- `Tool execution failed` - BC operation error

## Configuration Status

Check if Agent SDK is properly configured:

```typescript
const agentService = getAgentService();

if (!agentService.isConfigured()) {
  console.error('ANTHROPIC_API_KEY not set');
  return;
}

const status = agentService.getConfigStatus();
console.log('Has API Key:', status.hasApiKey);
console.log('MCP Configured:', status.mcpConfigured);
console.log('Model:', status.model);
```

## Next Steps

1. **Deploy to Azure** - Test MCP connectivity in production
2. **Add Authentication** - Protect agent endpoints with JWT
3. **Session Persistence** - Save conversations to database
4. **WebSocket Streaming** - Real-time event streaming to frontend
5. **Approval System** - Human-in-the-loop for write operations

## References

- [Claude Agent SDK Documentation](https://docs.claude.com/en/api/agent-sdk/typescript)
- [MCP Integration](../mcp/README.md)
- [BC Client](../bc/README.md)
