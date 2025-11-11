# Business Central Integration

## Overview

La integración con Microsoft Dynamics 365 Business Central utiliza **OAuth 2.0 Authorization Code Flow con Delegated Permissions**. Esto permite que cada usuario acceda a Business Central con sus propias credenciales, en lugar de usar un service account compartido.

**Cambio arquitectónico importante**: Ya NO usamos OAuth 2.0 Client Credentials (service-to-service). Cada operación BC se ejecuta **en nombre del usuario autenticado**.

---

## Authentication Flow

### 1. User Login con Microsoft

```typescript
// Usuario hace click en "Sign in with Microsoft"
// Frontend redirect a backend OAuth endpoint
window.location.href = '/api/auth/login';

// Backend genera authorization URL
const authUrl = microsoftOAuthService.getAuthCodeUrl(state);
// Redirect a login.microsoftonline.com con scopes:
// - openid profile email offline_access User.Read
// - https://api.businesscentral.dynamics.com/Financials.ReadWrite.All
```

### 2. Token Acquisition (Backend)

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
async acquireBCToken(userAccessToken: string): Promise<BCTokenData> {
  const result = await msalClient.acquireTokenOnBehalfOf({
    oboAssertion: userAccessToken,
    scopes: ['https://api.businesscentral.dynamics.com/Financials.ReadWrite.All']
  });

  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: new Date(Date.now() + result.expiresIn * 1000)
  };
}
```

### 3. Token Storage (Encrypted)

Los tokens BC se almacenan **cifrados** en la base de datos por usuario:

```typescript
// backend/src/services/auth/BCTokenManager.ts
async storeBCTokens(userId: string, tokens: BCTokenData): Promise<void> {
  // Cifrar tokens con AES-256-GCM
  const accessTokenEncrypted = await encryptionService.encrypt(tokens.accessToken);
  const refreshTokenEncrypted = await encryptionService.encrypt(tokens.refreshToken);

  // Guardar en BD
  await db.query(`
    UPDATE users
    SET bc_access_token_encrypted = ?,
        bc_refresh_token_encrypted = ?,
        bc_token_expires_at = ?
    WHERE id = ?
  `, [accessTokenEncrypted, refreshTokenEncrypted, tokens.expiresAt, userId]);
}
```

---

## BC Client with Delegated Token

### Constructor

```typescript
// backend/src/services/bc/BCClient.ts
class BCClient {
  constructor(
    private userAccessToken: string,  // ✅ Token del usuario (NO env vars)
    private apiUrl: string = process.env.BC_API_URL!
  ) {}

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.userAccessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  // Ya no existe authenticate() method - token viene por parámetro
}
```

### Usage in Agent Service

```typescript
// backend/src/services/agent/DirectAgentService.ts
async query(userId: string, sessionId: string, prompt: string) {
  // 1. Obtener token BC del usuario
  const bcTokens = await bcTokenManager.getBCTokens(userId);

  if (!bcTokens) {
    throw new Error('User has not granted BC consent');
  }

  // 2. Auto-refresh si expiró
  if (bcTokens.expiresAt < new Date()) {
    await bcTokenManager.refreshBCToken(userId);
    bcTokens = await bcTokenManager.getBCTokens(userId);
  }

  // 3. Crear BCClient con token delegado
  const bcClient = new BCClient(bcTokens.accessToken);

  // 4. Ejecutar operación BC
  const customers = await bcClient.query('customers', { $top: 10 });

  return customers;
}
```

---

## API Endpoints

### OData v4 API

**Base URL**:
```
https://api.businesscentral.dynamics.com/v2.0/{tenant}/{environment}/api/v2.0
```

**Parameters**:
- `{tenant}`: Tenant ID o GUID del tenant de BC
- `{environment}`: `production` o `sandbox`

**Headers**:
```http
Authorization: Bearer <user-delegated-token>
Content-Type: application/json
Accept: application/json
```

### Common Query Patterns

#### 1. Query with Filters

```typescript
// Query customers activos
const customers = await bcClient.query('customers', {
  $filter: 'blocked eq false',
  $select: ['number', 'displayName', 'email'],
  $top: 50,
  $orderby: 'displayName asc'
});

// Resultado:
// {
//   value: [
//     { number: "C001", displayName: "Contoso Ltd", email: "contact@contoso.com" },
//     ...
//   ],
//   "@odata.context": "...",
//   "@odata.nextLink": "..." // si hay más páginas
// }
```

#### 2. Get by ID

```typescript
// Obtener un customer específico
const customer = await bcClient.getById('customers', customerId);

// Con expand para entidades relacionadas
const salesOrder = await bcClient.getById('salesOrders', orderId, {
  $expand: ['salesOrderLines', 'customer']
});
```

#### 3. Create Entity

```typescript
// Crear nuevo customer
const newCustomer = await bcClient.create('customers', {
  displayName: 'Fabrikam Inc',
  email: 'contact@fabrikam.com',
  phoneNumber: '+1-555-0100',
  addressLine1: '123 Main St',
  city: 'Seattle',
  state: 'WA',
  postalCode: '98101',
  countryRegionCode: 'US'
});

// BC retorna el customer creado con ID y metadata
// {
//   id: "550e8400-e29b-41d4-a716-446655440000",
//   number: "C1234",
//   displayName: "Fabrikam Inc",
//   ...
// }
```

#### 4. Update Entity

```typescript
// Actualizar item price (requiere etag para concurrency control)
const item = await bcClient.getById('items', itemId);

const updatedItem = await bcClient.update('items', itemId, {
  unitPrice: 129.99,
  description: 'Updated description'
}, item['@odata.etag']);

// Si etag no coincide (alguien más actualizó): 412 Precondition Failed
```

#### 5. Delete Entity

```typescript
// Eliminar customer
await bcClient.delete('customers', customerId);

// Con etag para concurrency control
const customer = await bcClient.getById('customers', customerId);
await bcClient.delete('customers', customerId, customer['@odata.etag']);
```

---

## Multi-Tenant Support

Cada usuario puede tener acceso a **diferentes tenants** de Business Central:

### Architecture

```typescript
// Usuario A: Accede a BC Tenant "Contoso"
const userA = await db.query('SELECT * FROM users WHERE id = ?', [userIdA]);
// bc_access_token_encrypted contiene token para Contoso tenant

// Usuario B: Accede a BC Tenant "Fabrikam"
const userB = await db.query('SELECT * FROM users WHERE id = ?', [userIdB]);
// bc_access_token_encrypted contiene token para Fabrikam tenant

// Aislamiento automático
const bcClientA = new BCClient(decryptedTokenA); // Solo ve datos de Contoso
const bcClientB = new BCClient(decryptedTokenB); // Solo ve datos de Fabrikam
```

### Tenant Detection

El tenant se detecta automáticamente del token del usuario:

```typescript
// Microsoft devuelve el token con el tenant_id embebido
// BCClient usa ese token sin especificar tenant manualmente

// URL completa de BC API se construye en tiempo de ejecución
const apiUrl = `${BC_API_URL}/${tokenTenantId}/${environment}/api/v2.0`;
```

### Environment Selection (Future Enhancement)

Actualmente todos los usuarios usan el mismo environment (`production`). Posible mejora:

```sql
-- Tabla user_bc_preferences (futuro)
CREATE TABLE user_bc_preferences (
  user_id UNIQUEIDENTIFIER PRIMARY KEY,
  environment VARCHAR(20) DEFAULT 'production',  -- 'production' | 'sandbox'
  company_id NVARCHAR(255) NULL,
  default_company_name NVARCHAR(255) NULL
);
```

---

## OData v4 Query Options

### $filter (Filtros)

```typescript
// Operadores de comparación
$filter=unitPrice gt 100                    // Mayor que
$filter=blocked eq false                    // Igual a
$filter=displayName ne 'Test'               // No igual a
$filter=lastModifiedDateTime ge 2025-01-01T00:00:00Z  // Mayor o igual

// Operadores lógicos
$filter=blocked eq false and unitPrice lt 50    // AND
$filter=type eq 'Inventory' or type eq 'Service'  // OR
$filter=not(blocked eq true)                     // NOT

// Funciones de string
$filter=startswith(displayName, 'Con')
$filter=endswith(email, '@contoso.com')
$filter=contains(description, 'widget')
```

### $select (Campos específicos)

```typescript
// Solo campos necesarios (reduce tamaño de respuesta)
$select=number,displayName,email

// Array notation
const customers = await bcClient.query('customers', {
  $select: ['number', 'displayName', 'balance']
});
```

### $expand (Entidades relacionadas)

```typescript
// Expandir salesOrderLines dentro de salesOrder
$expand=salesOrderLines

// Expandir múltiples relaciones
$expand=customer,salesOrderLines

// Expandir anidado
$expand=salesOrderLines($expand=item)
```

### $orderby (Ordenamiento)

```typescript
$orderby=displayName asc
$orderby=lastModifiedDateTime desc
$orderby=unitPrice desc, displayName asc  // Multi-field
```

### $top / $skip (Paginación)

```typescript
// Primera página (top 20)
$top=20&$skip=0

// Segunda página
$top=20&$skip=20

// En código
const page1 = await bcClient.query('customers', { $top: 20, $skip: 0 });
const page2 = await bcClient.query('customers', { $top: 20, $skip: 20 });
```

### $count (Total de resultados)

```typescript
// Incluir count en respuesta
$count=true

// Resultado:
// {
//   "@odata.count": 150,
//   "value": [...]
// }
```

---

## Error Handling

### Common BC API Errors

#### 1. 401 Unauthorized

**Causa**: Token expirado o inválido

**Solución**:
```typescript
try {
  const result = await bcClient.query('customers');
} catch (error) {
  if (error.status === 401) {
    // Auto-refresh token
    await bcTokenManager.refreshBCToken(userId);
    const bcTokens = await bcTokenManager.getBCTokens(userId);
    const bcClient = new BCClient(bcTokens.accessToken);

    // Retry
    const result = await bcClient.query('customers');
  }
}
```

#### 2. 403 Forbidden

**Causa**: Usuario no tiene permisos en BC para esta operación

**Solución**:
- Verificar permisos del usuario en BC Admin Center
- Verificar que el scope `Financials.ReadWrite.All` fue otorgado con consent

#### 3. 404 Not Found

**Causa**: Entidad o endpoint no existe

**Solución**:
```typescript
// Verificar nombre de entidad (case-sensitive)
await bcClient.query('customers');  // ✅ Correcto
await bcClient.query('Customers');  // ❌ 404 Not Found
```

#### 4. 412 Precondition Failed

**Causa**: ETag no coincide (concurrency conflict)

**Solución**:
```typescript
// Re-fetch entity para obtener nuevo etag
const customer = await bcClient.getById('customers', customerId);

// Retry update con nuevo etag
await bcClient.update('customers', customerId, data, customer['@odata.etag']);
```

#### 5. 429 Too Many Requests

**Causa**: Rate limiting de BC API

**Solución**:
```typescript
// Implementar exponential backoff
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}
```

---

## Testing

### Manual Testing with BC Token

```bash
# 1. Get user's BC token (descifrado)
curl http://localhost:3002/api/auth/me -H "Cookie: session=..."

# 2. Test BC API directly
curl -H "Authorization: Bearer <bc-token>" \
  https://api.businesscentral.dynamics.com/v2.0/{tenant}/production/api/v2.0/companies

# 3. Test query
curl -H "Authorization: Bearer <bc-token>" \
  "https://api.businesscentral.dynamics.com/v2.0/{tenant}/production/api/v2.0/companies({companyId})/customers?\$top=5"
```

### Unit Testing BCClient

```typescript
// Mock BCClient in tests
const mockBCClient = {
  query: jest.fn().mockResolvedValue({ value: [{ id: '1', displayName: 'Test' }] }),
  create: jest.fn().mockResolvedValue({ id: '2', displayName: 'Created' }),
  update: jest.fn().mockResolvedValue({ id: '1', displayName: 'Updated' }),
  delete: jest.fn().mockResolvedValue(undefined)
};
```

---

## Performance Considerations

### 1. Use $select to Reduce Payload

```typescript
// ❌ BAD: Fetch all fields (slow)
const customers = await bcClient.query('customers', { $top: 100 });

// ✅ GOOD: Only fetch needed fields
const customers = await bcClient.query('customers', {
  $top: 100,
  $select: ['number', 'displayName', 'balance']
});
```

### 2. Batch Requests (Future Enhancement)

BC API soporta `$batch` para múltiples operaciones en una request:

```http
POST /v2.0/{tenant}/production/api/v2.0/$batch
Content-Type: multipart/mixed; boundary=batch_boundary

--batch_boundary
Content-Type: application/http

GET /companies({id})/customers('{customerId}') HTTP/1.1

--batch_boundary
Content-Type: application/http

GET /companies({id})/items?$top=10 HTTP/1.1

--batch_boundary--
```

### 3. Caching (Application Level)

```typescript
// Cache frequent queries (e.g., company list)
const cache = new Map();

async function getCompanies(bcClient: BCClient) {
  const cacheKey = 'companies';

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const companies = await bcClient.query('companies');
  cache.set(cacheKey, companies);

  // Expire after 5 minutes
  setTimeout(() => cache.delete(cacheKey), 5 * 60 * 1000);

  return companies;
}
```

---

## Comparison: Before vs After

### Before (Client Credentials) ❌

```typescript
// Global credentials shared by all users
const bcClient = new BCClient();  // Uses BC_CLIENT_ID/BC_CLIENT_SECRET from .env

await bcClient.query('customers');
// BC audit log: "API Client (service account) queried customers"
// ❌ No way to know which user made the request
```

### After (Delegated Permissions) ✅

```typescript
// Each user has their own token
const bcTokens = await bcTokenManager.getBCTokens(userId);
const bcClient = new BCClient(bcTokens.accessToken);

await bcClient.query('customers');
// BC audit log: "john.doe@contoso.com queried customers"
// ✅ Full audit trail of user actions
```

---

## References

- **BC API Docs**: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/
- **OData v4 Spec**: https://www.odata.org/documentation/
- **OAuth Delegated Flow**: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- **BC OAuth Setup**: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication

---

**Last updated**: 2025-11-11 (updated for Microsoft OAuth delegated permissions + multi-tenant support)
