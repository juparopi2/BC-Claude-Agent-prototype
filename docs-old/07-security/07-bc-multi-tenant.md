# Business Central Multi-Tenant Architecture

## Overview

El sistema BC-Claude-Agent soporta **multi-tenancy** para Business Central, permitiendo que usuarios de diferentes organizaciones accedan a sus respectivos entornos de BC sin interferencia entre ellos.

**Principio clave**: Cada usuario accede ÚNICAMENTE a los datos de BC a los que tiene permisos en su tenant, utilizando sus propias credenciales delegadas.

---

## Architecture

### Traditional (Single-Tenant) ❌

```
┌─────────────────────────────────────────┐
│         BC-Claude-Agent Backend         │
│                                         │
│  Global BC Credentials (env vars)       │
│  BC_TENANT_ID=tenant-1                 │
│  BC_CLIENT_ID=service-account          │
│  BC_CLIENT_SECRET=secret               │
│                                         │
│  Todos los usuarios → Mismo BC tenant  │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│    Business Central - Tenant 1          │
│    (Single organization)                │
└─────────────────────────────────────────┘
```

**Problemas**:
- Un solo tenant de BC soportado
- Todos los usuarios ven los mismos datos
- No hay aislamiento entre organizaciones
- Imposible servir múltiples clientes

### Multi-Tenant (Nueva arquitectura) ✅

```
┌─────────────────────────────────────────────────────────────┐
│              BC-Claude-Agent Backend                         │
│                                                              │
│  NO global BC credentials                                    │
│  Tokens almacenados per-user en BD (encrypted)              │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  User A      │  │  User B      │  │  User C      │      │
│  │  (Contoso)   │  │  (Fabrikam)  │  │  (AdventureW)│      │
│  │              │  │              │  │              │      │
│  │  BC Token    │  │  BC Token    │  │  BC Token    │      │
│  │  Tenant 1    │  │  Tenant 2    │  │  Tenant 3    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
           ↓                 ↓                 ↓
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ BC - Tenant 1    │ │ BC - Tenant 2    │ │ BC - Tenant 3    │
│ (Contoso)        │ │ (Fabrikam)       │ │ (AdventureWorks) │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

**Beneficios**:
- ✅ Múltiples tenants de BC soportados simultáneamente
- ✅ Aislamiento completo entre usuarios/organizaciones
- ✅ Cada usuario ve solo sus datos de BC
- ✅ Escalable a múltiples clientes
- ✅ Audit trail preciso (sabe qué usuario hizo qué)

---

## Database Schema

### Users Table

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255),
  microsoft_user_id VARCHAR(255) UNIQUE NOT NULL,  -- Azure AD object ID

  -- BC Tokens (encrypted per user)
  bc_access_token_encrypted TEXT,                  -- AES-256-GCM encrypted
  bc_refresh_token_encrypted TEXT,                 -- AES-256-GCM encrypted
  bc_token_expires_at TIMESTAMP,

  -- BC Tenant Info (auto-detected from token)
  bc_tenant_id VARCHAR(255),                       -- BC tenant GUID
  bc_environment VARCHAR(50) DEFAULT 'production', -- 'production' | 'sandbox'

  -- Authorization
  role VARCHAR(50) DEFAULT 'viewer',               -- admin, editor, viewer

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Indexes
  INDEX idx_microsoft_user_id (microsoft_user_id),
  INDEX idx_bc_tenant_id (bc_tenant_id)
);
```

**Key points**:
- `bc_tenant_id`: Automáticamente detectado del token BC (no manual)
- `bc_access_token_encrypted`: Token único por usuario
- `microsoft_user_id`: Link al usuario de Azure AD

---

## Token Management

### Token Acquisition

Cada usuario obtiene su propio token BC mediante OAuth delegado:

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
async acquireBCToken(userMsAccessToken: string): Promise<BCTokenData> {
  // On-Behalf-Of (OBO) flow
  const result = await this.msalClient.acquireTokenOnBehalfOf({
    oboAssertion: userMsAccessToken,  // User's MS token
    scopes: ['https://api.businesscentral.dynamics.com/Financials.ReadWrite.All']
  });

  // Token es específico para el tenant del usuario
  return {
    accessToken: result.accessToken,       // ✅ Usuario A → BC Tenant 1
    refreshToken: result.refreshToken,
    expiresAt: new Date(Date.now() + result.expiresIn * 1000),
    tenantId: result.tenantId              // Auto-detected
  };
}
```

**Flujo**:
1. Usuario A se autentica con Microsoft (tenant Contoso)
2. Backend solicita BC token via OBO con el token de Usuario A
3. Microsoft devuelve BC token válido SOLO para tenant Contoso
4. Backend almacena token cifrado en BD

**Resultado**: Usuario A puede acceder SOLO a BC tenant Contoso, no a otros tenants.

### Token Storage (Encrypted)

```typescript
// backend/src/services/auth/BCTokenManager.ts
async storeBCTokens(userId: string, tokens: BCTokenData): Promise<void> {
  // 1. Encrypt tokens with AES-256-GCM
  const accessTokenEncrypted = await this.encryptionService.encrypt(tokens.accessToken);
  const refreshTokenEncrypted = await this.encryptionService.encrypt(tokens.refreshToken);

  // 2. Store in database
  await this.db.query(`
    UPDATE users
    SET bc_access_token_encrypted = $1,
        bc_refresh_token_encrypted = $2,
        bc_token_expires_at = $3,
        bc_tenant_id = $4,
        updated_at = NOW()
    WHERE id = $5
  `, [
    accessTokenEncrypted,
    refreshTokenEncrypted,
    tokens.expiresAt,
    tokens.tenantId,  // ✅ Store tenant ID
    userId
  ]);
}

async getBCTokens(userId: string): Promise<BCTokenData | null> {
  // 1. Fetch encrypted tokens from DB
  const result = await this.db.query(`
    SELECT bc_access_token_encrypted,
           bc_refresh_token_encrypted,
           bc_token_expires_at,
           bc_tenant_id
    FROM users
    WHERE id = $1
  `, [userId]);

  if (!result.rows[0]?.bc_access_token_encrypted) {
    return null;  // User hasn't granted BC consent
  }

  // 2. Decrypt tokens
  const accessToken = await this.encryptionService.decrypt(
    result.rows[0].bc_access_token_encrypted
  );
  const refreshToken = await this.encryptionService.decrypt(
    result.rows[0].bc_refresh_token_encrypted
  );

  return {
    accessToken,
    refreshToken,
    expiresAt: result.rows[0].bc_token_expires_at,
    tenantId: result.rows[0].bc_tenant_id
  };
}
```

**Security**:
- Tokens nunca se almacenan en plain text
- Cada usuario tiene su propio encryption context
- Si BD se compromete, tokens siguen protegidos (requiere `ENCRYPTION_KEY`)

---

## BC Client per User

### Constructor

```typescript
// backend/src/services/bc/BCClient.ts
class BCClient {
  private baseUrl: string;

  constructor(
    private userAccessToken: string,  // ✅ Token del usuario específico
    private tenantId: string,         // ✅ Tenant del usuario
    private environment: string = 'production'
  ) {
    // Construct BC API URL with user's tenant
    this.baseUrl = `https://api.businesscentral.dynamics.com/v2.0/${tenantId}/${environment}/api/v2.0`;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.userAccessToken}`,  // ✅ User-specific token
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  async query(entity: string, options?: QueryOptions) {
    // URL includes user's tenant → isolated access
    const url = `${this.baseUrl}/companies(${options?.companyId})/${entity}`;

    const response = await fetch(url, {
      headers: this.getHeaders()  // ✅ User-specific auth header
    });

    return response.json();
  }
}
```

### Usage in Agent Service

```typescript
// backend/src/services/agent/DirectAgentService.ts
async performBCOperation(userId: string, operation: string) {
  // 1. Get user's BC tokens (includes tenant info)
  const bcTokens = await this.bcTokenManager.getBCTokens(userId);

  if (!bcTokens) {
    throw new Error('User has not granted BC consent');
  }

  // 2. Check if token expired
  if (bcTokens.expiresAt < new Date()) {
    // Auto-refresh token
    await this.bcTokenManager.refreshBCToken(userId);
    bcTokens = await this.bcTokenManager.getBCTokens(userId);
  }

  // 3. Create BCClient with user's token and tenant
  const bcClient = new BCClient(
    bcTokens.accessToken,  // ✅ Usuario A → Solo ve datos de Tenant 1
    bcTokens.tenantId,     // ✅ Aislamiento automático
    'production'
  );

  // 4. Execute operation (automatically isolated to user's tenant)
  const customers = await bcClient.query('customers', { $top: 10 });

  return customers;
}
```

**Key principle**: Cada `BCClient` está vinculado a un usuario específico y su tenant. No hay manera de que un usuario acceda a datos de otro tenant.

---

## Tenant Isolation

### Automatic Isolation

```typescript
// User A (Contoso - Tenant 1)
const userATokens = await bcTokenManager.getBCTokens('user-a-id');
const clientA = new BCClient(userATokens.accessToken, userATokens.tenantId);
const customersA = await clientA.query('customers');
// Result: Customers from Tenant 1 (Contoso) ONLY

// User B (Fabrikam - Tenant 2)
const userBTokens = await bcTokenManager.getBCTokens('user-b-id');
const clientB = new BCClient(userBTokens.accessToken, userBTokens.tenantId);
const customersB = await clientB.query('customers');
// Result: Customers from Tenant 2 (Fabrikam) ONLY
```

**Enforcement points**:
1. **Token**: User's BC token is issued by Microsoft para un tenant específico
2. **API URL**: Includes tenant ID → BC API valida que token pertenece a ese tenant
3. **Database**: Tokens almacenados per-user → no hay cross-contamination
4. **Session**: Session cookie vincula a un usuario → requests automáticamente aisladas

### Security Guarantees

**Scenario 1: User A intenta acceder a Tenant 2**

```typescript
// User A's token (Tenant 1)
const userATokens = await bcTokenManager.getBCTokens('user-a-id');

// Attempt to access Tenant 2 (malicious or bug)
const clientMalicious = new BCClient(
  userATokens.accessToken,  // Token for Tenant 1
  'tenant-2-id'             // Try to access Tenant 2
);

const result = await clientMalicious.query('customers');
// BC API returns: 401 Unauthorized
// Reason: Token is not valid for Tenant 2
```

**Resultado**: BC API rechaza la request porque el token no es válido para ese tenant.

**Scenario 2: User without BC consent**

```typescript
// User logged in with Microsoft but didn't grant BC consent
const tokens = await bcTokenManager.getBCTokens('user-without-consent');
// Returns: null

// Agent service checks:
if (!tokens) {
  throw new Error('User has not granted BC consent');
  // Frontend shows "Connect to Business Central" button
}
```

**Resultado**: Usuario debe otorgar consent explícito para acceder a BC.

---

## Multi-Tenant Best Practices

### 1. Never Hardcode Tenant IDs

```typescript
// ❌ BAD - Hardcoded tenant
const BC_TENANT_ID = 'f2d5e8b3-...';
const client = new BCClient(token, BC_TENANT_ID);

// ✅ GOOD - Tenant from user's token
const tokens = await bcTokenManager.getBCTokens(userId);
const client = new BCClient(tokens.accessToken, tokens.tenantId);
```

### 2. Always Validate User Context

```typescript
// ❌ BAD - No user validation
app.post('/api/bc/query', async (req, res) => {
  const token = req.body.token;  // Anyone can pass any token
  const client = new BCClient(token, 'any-tenant');
  // ...
});

// ✅ GOOD - Validate user session
app.post('/api/bc/query', authenticateMicrosoft, async (req, res) => {
  const userId = req.session.userId;  // From authenticated session
  const tokens = await bcTokenManager.getBCTokens(userId);
  const client = new BCClient(tokens.accessToken, tokens.tenantId);
  // ...
});
```

### 3. Log Tenant Access for Audit

```typescript
// backend/src/services/bc/BCClient.ts
async query(entity: string, options?: QueryOptions) {
  logger.info('BC Query', {
    userId: this.userId,
    tenantId: this.tenantId,
    entity,
    timestamp: new Date()
  });

  const url = `${this.baseUrl}/companies(${options?.companyId})/${entity}`;
  const response = await fetch(url, { headers: this.getHeaders() });

  if (!response.ok) {
    logger.error('BC Query Failed', {
      userId: this.userId,
      tenantId: this.tenantId,
      entity,
      status: response.status
    });
  }

  return response.json();
}
```

**Resultado**: Audit trail completo de qué usuario accedió a qué tenant y cuándo.

### 4. Handle Tenant Switching (Future)

Si un usuario tiene acceso a múltiples tenants:

```sql
-- Table: user_bc_tenants
CREATE TABLE user_bc_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  bc_tenant_id VARCHAR(255) NOT NULL,
  bc_tenant_name VARCHAR(255),
  bc_access_token_encrypted TEXT,
  bc_refresh_token_encrypted TEXT,
  bc_token_expires_at TIMESTAMP,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, bc_tenant_id)
);
```

```typescript
// Get user's active tenant
async getActiveTenant(userId: string): Promise<string> {
  const result = await db.query(`
    SELECT bc_tenant_id
    FROM user_bc_tenants
    WHERE user_id = $1 AND is_default = TRUE
  `, [userId]);

  return result.rows[0]?.bc_tenant_id;
}

// Switch tenant
async switchTenant(userId: string, newTenantId: string): Promise<void> {
  // Unset current default
  await db.query(`
    UPDATE user_bc_tenants
    SET is_default = FALSE
    WHERE user_id = $1
  `, [userId]);

  // Set new default
  await db.query(`
    UPDATE user_bc_tenants
    SET is_default = TRUE
    WHERE user_id = $1 AND bc_tenant_id = $2
  `, [userId, newTenantId]);
}
```

---

## Testing Multi-Tenancy

### Unit Tests

```typescript
// test/bc-multi-tenant.test.ts
describe('BC Multi-Tenant', () => {
  it('should isolate users to their BC tenants', async () => {
    // User A (Tenant 1)
    const userA = await createTestUser('user-a@contoso.com', 'tenant-1');
    const tokensA = await bcTokenManager.getBCTokens(userA.id);
    expect(tokensA.tenantId).toBe('tenant-1');

    // User B (Tenant 2)
    const userB = await createTestUser('user-b@fabrikam.com', 'tenant-2');
    const tokensB = await bcTokenManager.getBCTokens(userB.id);
    expect(tokensB.tenantId).toBe('tenant-2');

    // User A cannot see User B's data
    const clientA = new BCClient(tokensA.accessToken, tokensA.tenantId);
    const customersA = await clientA.query('customers');
    expect(customersA.value).not.toContainEqual(
      expect.objectContaining({ displayName: 'Fabrikam Customer' })
    );
  });

  it('should reject cross-tenant access', async () => {
    const userA = await createTestUser('user-a@contoso.com', 'tenant-1');
    const tokensA = await bcTokenManager.getBCTokens(userA.id);

    // Try to access tenant-2 with tenant-1 token
    const clientMalicious = new BCClient(tokensA.accessToken, 'tenant-2');

    await expect(clientMalicious.query('customers')).rejects.toThrow('401');
  });
});
```

### Integration Tests

```bash
# Test with two real BC tenants (if available)

# User 1 login (Tenant 1)
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user1@tenant1.com", "password": "..."}'

# Get User 1's customers
curl http://localhost:3002/api/bc/customers \
  -H "Cookie: session=<user1-session>"
# Expected: Customers from Tenant 1 only

# User 2 login (Tenant 2)
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user2@tenant2.com", "password": "..."}'

# Get User 2's customers
curl http://localhost:3002/api/bc/customers \
  -H "Cookie: session=<user2-session>"
# Expected: Customers from Tenant 2 only (different from User 1)
```

---

## Performance Considerations

### Caching per Tenant

```typescript
// backend/src/services/bc/BCCache.ts
class BCCache {
  private cache: Map<string, Map<string, any>>;  // Map<tenantId, Map<cacheKey, value>>

  get(tenantId: string, key: string): any | null {
    return this.cache.get(tenantId)?.get(key) || null;
  }

  set(tenantId: string, key: string, value: any, ttl: number): void {
    if (!this.cache.has(tenantId)) {
      this.cache.set(tenantId, new Map());
    }

    this.cache.get(tenantId)!.set(key, value);

    // Expire after TTL
    setTimeout(() => {
      this.cache.get(tenantId)?.delete(key);
    }, ttl);
  }
}

// Usage
const cache = new BCCache();

async function getCompanies(tenantId: string, bcClient: BCClient) {
  const cacheKey = 'companies';

  // Check cache for this tenant
  const cached = cache.get(tenantId, cacheKey);
  if (cached) return cached;

  // Fetch from BC
  const companies = await bcClient.query('companies');

  // Cache for this tenant (5 minutes)
  cache.set(tenantId, cacheKey, companies, 5 * 60 * 1000);

  return companies;
}
```

**Key**: Cache aislado por tenant → User A's cache no contamina User B's cache.

---

## Monitoring

### Metrics to Track

```typescript
// backend/src/middleware/metrics.ts
app.use((req, res, next) => {
  if (req.path.startsWith('/api/bc/')) {
    const userId = req.session.userId;
    const tenantId = req.session.bcTenantId;

    metrics.increment('bc_api_requests', {
      tenantId,
      endpoint: req.path,
      method: req.method
    });

    const start = Date.now();
    res.on('finish', () => {
      metrics.histogram('bc_api_latency', Date.now() - start, {
        tenantId,
        endpoint: req.path,
        status: res.statusCode
      });
    });
  }

  next();
});
```

**Dashboards**:
- Requests per tenant
- Latency per tenant
- Error rate per tenant
- Active users per tenant

---

## References

- [BC Authentication](./05-bc-authentication.md)
- [BC Integration](../04-integrations/04-bc-integration.md)
- [Microsoft OAuth Setup](./06-microsoft-oauth-setup.md)

---

**Last updated**: 2025-11-11
**Version**: 1.0
