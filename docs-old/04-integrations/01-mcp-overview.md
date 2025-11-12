# Model Context Protocol (MCP) Overview

## El MCP Existente

BC-Claude-Agent utiliza un **MCP server potente pre-construido** que expone capacidades avanzadas de Business Central.

## Arquitectura MCP

```
┌─────────────────┐
│  Agent/Claude   │
│     (Client)    │
└────────┬────────┘
         │ MCP Protocol
         │ (stdio/HTTP)
┌────────▼────────┐
│   MCP Server    │
│  (Pre-built)    │
├─────────────────┤
│ • Tools         │
│ • Resources     │
│ • Prompts       │
└────────┬────────┘
         │ BC API
┌────────▼────────┐
│   Business      │
│   Central       │
└─────────────────┘
```

## MCP Primitives

### 1. Tools
Funciones ejecutables que el agente puede llamar.

### 2. Resources
Información contextual (schemas, docs, data).

### 3. Prompts
Templates especializados para tareas comunes.

## Integration Approach

```typescript
import { MCPClient } from '@anthropic-ai/sdk';

const mcpClient = new MCPClient({
  serverUrl: process.env.MCP_SERVER_URL,
  transport: 'http' // or 'stdio'
});

// Initialize connection
await mcpClient.connect();

// List available capabilities
const tools = await mcpClient.listTools();
const resources = await mcpClient.listResources();
const prompts = await mcpClient.listPrompts();
```

## Benefits

✅ **Pre-built & Tested**: No need to develop BC integration
✅ **Powerful**: Comprehensive BC capabilities
✅ **Maintainable**: Updates to BC API handled by MCP
✅ **Secure**: Authentication & permissions built-in

---

**Versión**: 1.0
