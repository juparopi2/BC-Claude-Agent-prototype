# Business Central Connector

## BC Client

```typescript
export class BCClient {
  private baseUrl: string;
  private accessToken: string;

  constructor() {
    this.baseUrl = process.env.BC_API_URL!;
  }

  async authenticate() {
    this.accessToken = await getAccessToken();
  }

  async query(entity: string, options?: QueryOptions) {
    const url = `${this.baseUrl}/companies(${options?.companyId})/api/v2.0/${entity}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return response.json();
  }

  async create(entity: string, data: any) {
    const url = `${this.baseUrl}/companies(...)/api/v2.0/${entity}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    return response.json();
  }
}
```

## MCP Integration

```typescript
export class MCPConnector {
  private client: MCPClient;

  async initialize() {
    this.client = new MCPClient({
      serverUrl: process.env.MCP_SERVER_URL,
      transport: 'http'
    });

    await this.client.connect();
  }

  async callTool(name: string, params: any) {
    return await this.client.callTool({ name, arguments: params });
  }
}
```

---

**Versión**: 1.0
