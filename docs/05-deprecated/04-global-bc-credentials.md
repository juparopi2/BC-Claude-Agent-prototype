# Deprecated: Global BC Service Account

> **Status**: ❌ DEPRECATED (Week 2.5, January 2025)
> **Replaced By**: Per-user BC tokens (encrypted with AES-256-GCM)
> **Reason**: Multi-tenant support, audit compliance, security isolation

---

## What Was Deprecated

### Global BC Credentials (OLD)

```env
# .env (deprecated)
BC_TENANT_ID=1e9a7510-b103-463a-9ade-68951205e7bc
BC_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_SECRET=<secret>
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0
```

```typescript
// OLD - Global service account
class BCClient {
  constructor() {
    this.tenantId = process.env.BC_TENANT_ID;
    this.clientId = process.env.BC_CLIENT_ID;
    this.clientSecret = process.env.BC_CLIENT_SECRET;
  }

  async authenticate() {
    // Client credentials flow (service-to-service)
    const token = await getClientCredentialsToken(...);
  }

  async query(entity: string) {
    // All users use same token
    return fetch(this.apiUrl + entity, {
      headers: { 'Authorization': `Bearer ${this.globalToken}` }
    });
  }
}
```

### Problems

1. **No Audit Trail**: BC logs show "BCAgentService@example.com" for all operations
2. **No Multi-Tenant**: Can't access different BC tenants per user
3. **Security Risk**: Single compromised token → all users affected
4. **Compliance Violation**: Financial systems require per-user audit trail

---

## What Replaced It

### Per-User BC Tokens (NEW)

```sql
-- Database (Migration 005)
ALTER TABLE users ADD bc_access_token_encrypted NVARCHAR(MAX);  -- AES-256-GCM
ALTER TABLE users ADD bc_refresh_token_encrypted NVARCHAR(MAX);
ALTER TABLE users ADD bc_token_expires_at DATETIME2;
ALTER TABLE users ADD bc_tenant_id NVARCHAR(255);  -- Per-user tenant
```

```typescript
// NEW - Per-user delegated tokens
class BCClient {
  constructor(userAccessToken: string, apiUrl: string) {
    this.userToken = userAccessToken;  // User's delegated token
    this.apiUrl = apiUrl;
  }

  // No authenticate() needed - uses user's token directly

  async query(entity: string) {
    return fetch(this.apiUrl + entity, {
      headers: { 'Authorization': `Bearer ${this.userToken}` }  // User's token
    });
  }
}

// Usage
const user = await db.getUser(userId);
const bcToken = await encryptionService.decrypt(user.bc_access_token_encrypted);
const bcClient = new BCClient(bcToken, BC_API_URL);
const customers = await bcClient.query('customers');  // As this user
```

### Benefits

- ✅ **Real Audit Trail**: BC logs show actual user (john@example.com)
- ✅ **Multi-Tenant**: User A → BC Tenant X, User B → BC Tenant Y
- ✅ **Security Isolation**: Compromised token → only one user affected
- ✅ **Permission Delegation**: User's own BC access level applies
- ✅ **Compliance**: Meets SOX, GDPR, audit requirements

---

## Migration Guide

```typescript
// ❌ WRONG - Global credentials (deprecated)
const bcClient = new BCClient({
  tenantId: process.env.BC_TENANT_ID,
  clientId: process.env.BC_CLIENT_ID,
  clientSecret: process.env.BC_CLIENT_SECRET
});

// ✅ CORRECT - Per-user tokens
const user = await db.getUser(userId);
const bcToken = await bcTokenManager.getToken(userId);  // Auto-refresh if expired
const bcClient = new BCClient(bcToken, BC_API_URL);
```

---

## Related Documents

- **Token Encryption**: `docs/07-security/08-token-encryption.md` (to be created)
- **Microsoft OAuth**: `docs/07-security/06-microsoft-oauth-setup.md`
- **Direction Changes**: `docs/13-roadmap/07-direction-changes.md` (Direction Change #5)

---

**Deprecated**: 2025-01-11 (Week 2.5)
**Reason**: Multi-tenant support, audit compliance, security isolation
**Replaced By**: Per-user BC tokens (encrypted with AES-256-GCM)
**Status**: ❌ DO NOT USE GLOBAL CREDENTIALS
