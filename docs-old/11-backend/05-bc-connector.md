# Business Central Connector

## BC Client

**⚠️ IMPORTANTE**: BCClient ahora usa **tokens delegados del usuario**, no credentials globales de env vars.

```typescript
export class BCClient {
  private baseUrl: string;

  /**
   * Constructor con token delegado del usuario
   * @param userAccessToken - Token BC del usuario (obtenido vía BCTokenManager)
   * @param apiUrl - Base URL de BC API (opcional, default from env)
   */
  constructor(
    private userAccessToken: string,  // ✅ Token del usuario, NO env vars
    apiUrl?: string
  ) {
    this.baseUrl = apiUrl || process.env.BC_API_URL!;
  }

  // ❌ authenticate() method ELIMINADO - token viene por parámetro

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.userAccessToken}`,  // Token delegado
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  async query(entity: string, options?: QueryOptions) {
    const url = `${this.baseUrl}/companies(${options?.companyId})/api/v2.0/${entity}`;

    const response = await fetch(url, {
      headers: this.getHeaders()  // ✅ Usa token delegado
    });

    if (!response.ok) {
      throw new Error(`BC API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async create(entity: string, data: any, companyId?: string) {
    const url = `${this.baseUrl}/companies(${companyId})/api/v2.0/${entity}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),  // ✅ Usa token delegado
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`BC API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async update(entity: string, id: string, data: any, etag?: string) {
    const url = `${this.baseUrl}/companies(...)/api/v2.0/${entity}(${id})`;

    const headers = this.getHeaders();
    if (etag) {
      headers['If-Match'] = etag;  // Concurrency control
    }

    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`BC API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async delete(entity: string, id: string, etag?: string) {
    const url = `${this.baseUrl}/companies(...)/api/v2.0/${entity}(${id})`;

    const headers = this.getHeaders();
    if (etag) {
      headers['If-Match'] = etag;
    }

    const response = await fetch(url, {
      method: 'DELETE',
      headers
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`BC API error: ${response.status} ${response.statusText}`);
    }
  }
}
```

### Usage Example

```typescript
// En AgentService o cualquier servicio que necesite acceder a BC
async function performBCOperation(userId: string) {
  // 1. Obtener token BC del usuario (descifrado)
  const bcTokens = await bcTokenManager.getBCTokens(userId);

  if (!bcTokens) {
    throw new Error('User has not granted BC consent');
  }

  // 2. Verificar expiración y auto-refresh si es necesario
  if (bcTokens.expiresAt < new Date()) {
    await bcTokenManager.refreshBCToken(userId);
    bcTokens = await bcTokenManager.getBCTokens(userId);
  }

  // 3. Crear BCClient con token delegado del usuario
  const bcClient = new BCClient(bcTokens.accessToken);

  // 4. Ejecutar operaciones BC
  const customers = await bcClient.query('customers', { $top: 10 });
  return customers;
}
```

**Token Management**: El token es responsabilidad de `BCTokenManager`, no de `BCClient`. BCClient solo lo usa, no lo obtiene ni lo refresca.

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
