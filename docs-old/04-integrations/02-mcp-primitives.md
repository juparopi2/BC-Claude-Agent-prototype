# MCP Primitives

## Tools (Herramientas)

El MCP server expone tools para interactuar con BC:

```typescript
// Example tools from MCP server
const bcTools = [
  {
    name: 'bc_query_entity',
    description: 'Query entities from Business Central',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string' },
        filters: { type: 'object' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'bc_create_entity',
    description: 'Create new entity in Business Central',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string' },
        data: { type: 'object' }
      }
    }
  },
  {
    name: 'bc_update_entity',
    description: 'Update existing entity',
    // ...
  },
  {
    name: 'bc_delete_entity',
    description: 'Delete entity from Business Central',
    // ...
  },
  {
    name: 'bc_batch_operation',
    description: 'Execute batch operations',
    // ...
  }
];
```

## Resources (Recursos)

Información contextual que el agente puede consultar:

```typescript
const bcResources = [
  {
    uri: 'bc://schemas/Customer',
    name: 'Customer Entity Schema',
    mimeType: 'application/json',
    description: 'Schema definition for Customer entity'
  },
  {
    uri: 'bc://docs/api-reference',
    name: 'BC API Reference',
    mimeType: 'text/markdown'
  },
  {
    uri: 'bc://companies/current',
    name: 'Current Company Info',
    mimeType: 'application/json'
  }
];
```

## Prompts (Plantillas)

Templates para tareas comunes:

```typescript
const bcPrompts = [
  {
    name: 'query_builder',
    description: 'Help build OData queries',
    arguments: [
      { name: 'entity', required: true },
      { name: 'requirements', required: true }
    ]
  },
  {
    name: 'data_validator',
    description: 'Validate data before creating entity',
    arguments: [
      { name: 'entity', required: true },
      { name: 'data', required: true }
    ]
  }
];
```

## Usage in Agent

```typescript
class BCAgent {
  private mcp: MCPClient;
  
  async queryCustomers(filters: any) {
    // Call MCP tool
    const result = await this.mcp.callTool({
      name: 'bc_query_entity',
      arguments: {
        entity: 'Customer',
        filters
      }
    });
    
    return result;
  }
  
  async getCustomerSchema() {
    // Read MCP resource
    const schema = await this.mcp.readResource({
      uri: 'bc://schemas/Customer'
    });
    
    return schema;
  }
}
```

---

**Versión**: 1.0
