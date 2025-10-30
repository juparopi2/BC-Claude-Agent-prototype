# MCP Service

This service provides configuration and utilities for integrating with the Model Context Protocol (MCP) server via Claude Agent SDK.

## Overview

The MCP Service **does NOT create manual MCP connections**. Instead, it provides the configuration needed for Claude Agent SDK to automatically connect to and interact with the MCP server.

## Architecture

```
User Request → Agent SDK → MCP Service (config) → MCP Server → Business Central
                   ↑                                    ↓
                   └────────── Tool Results ────────────┘
```

The Agent SDK handles:
- Tool discovery from MCP server
- Tool calling based on user prompts
- Tool result streaming
- Error handling and retries

## Usage

### Basic Configuration

```typescript
import { getMCPService } from '@/services/mcp';
import { query } from '@anthropic-ai/sdk';

const mcpService = getMCPService();
const mcpConfig = mcpService.getMCPServerConfig();

// Use with Agent SDK
const result = query('List all customers from Business Central', {
  mcpServers: [mcpConfig],
  apiKey: process.env.ANTHROPIC_API_KEY,
});

for await (const event of result) {
  if (event.type === 'tool_use') {
    console.log('Tool called:', event.toolName);
  }
  if (event.type === 'message') {
    console.log('Response:', event.content);
  }
}
```

### Health Check

```typescript
import { getMCPService } from '@/services/mcp';

const mcpService = getMCPService();
const health = await mcpService.validateMCPConnection();

if (health.connected) {
  console.log('MCP server is reachable');
} else {
  console.error('MCP connection failed:', health.error);
}
```

### Configuration Check

```typescript
import { getMCPService } from '@/services/mcp';

const mcpService = getMCPService();

if (!mcpService.isConfigured()) {
  throw new Error('MCP_SERVER_URL is not configured');
}

console.log('MCP Server URL:', mcpService.getMCPServerUrl());
console.log('MCP Server Name:', mcpService.getMCPServerName());
```

## MCP Server Details

### URL
The MCP server is deployed at:
```
https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp
```

### Transport
- **Type**: SSE (Server-Sent Events) over HTTP
- **Protocol**: MCP over SSE
- **Authentication**: Currently none (server-side handles BC auth)

### Available Tools

The MCP server provides these Business Central tools:

- `bc_query_entity` - Query BC entities with OData filters
- `bc_create_entity` - Create new entities
- `bc_update_entity` - Update existing entities
- `bc_delete_entity` - Delete entities
- `bc_batch_operation` - Perform batch operations

### Available Resources

- `bc://schemas/Customer` - Customer entity schema
- `bc://schemas/Vendor` - Vendor entity schema
- `bc://schemas/Item` - Item entity schema
- `bc://docs/api-reference` - BC API documentation
- `bc://companies/current` - Current company info

### Available Prompts

- `query_builder` - Help build OData queries
- `data_validator` - Validate data before operations

## Configuration

The MCP server URL is configured via environment variable:

```bash
MCP_SERVER_URL=https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp
```

This is loaded from Azure Key Vault in production or `.env` file in development.

## Testing

To test MCP connectivity:

```bash
npx ts-node src/services/mcp/testMCPConnection.ts
```

See `testMCPConnection.ts` for implementation details.

## Error Handling

The Agent SDK handles most MCP errors automatically, including:
- Connection failures (with retry)
- Tool execution errors
- Timeout errors

Your application should handle:
- Agent-level errors (event.type === 'error')
- Tool result failures (event.type === 'tool_result' && !event.success)
- Business logic errors from BC

## Important Notes

1. **Do NOT create manual MCP clients** - The Agent SDK handles this
2. **MCP server is pre-deployed** - No need to run your own MCP server
3. **Tool discovery is automatic** - Agent SDK discovers tools from MCP server
4. **Streaming is built-in** - Agent SDK streams events in real-time
5. **Authentication is server-side** - MCP server handles BC OAuth

## References

- [MCP Overview](../../../docs/04-integrations/01-mcp-overview.md)
- [Agent SDK Usage](../../../docs/02-core-concepts/06-agent-sdk-usage.md)
- [BC Integration](../../../docs/04-integrations/02-bc-integration.md)
