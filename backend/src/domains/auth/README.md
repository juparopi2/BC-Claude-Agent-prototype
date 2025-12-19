# Authentication Services

## Overview

La carpeta `auth/` contiene todos los servicios relacionados con la autenticación y autorización del sistema BC-Claude-Agent, implementando Microsoft OAuth 2.0 con delegated permissions para Business Central.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Authentication Layer                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           MicrosoftOAuthService.ts                   │   │
│  │  • Authorization Code Flow                           │   │
│  │  • On-Behalf-Of (OBO) Flow                           │   │
│  │  • Token Refresh                                     │   │
│  └────────────┬─────────────────────────────────────────┘   │
│               │                                              │
│  ┌────────────▼─────────────────────────────────────────┐   │
│  │           BCTokenManager.ts                          │   │
│  │  • Store BC tokens (encrypted)                       │   │
│  │  • Retrieve BC tokens                                │   │
│  │  • Auto-refresh expired tokens                       │   │
│  │  • Revoke tokens                                     │   │
│  └────────────┬─────────────────────────────────────────┘   │
│               │                                              │
│  ┌────────────▼─────────────────────────────────────────┐   │
│  │           EncryptionService.ts                       │   │
│  │  • AES-256-GCM encryption                            │   │
│  │  • Key derivation (PBKDF2)                           │   │
│  │  • Secure token storage                              │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Services

### 1. MicrosoftOAuthService

**Purpose**: Maneja todas las interacciones con Microsoft Entra ID OAuth 2.0.

**Responsibilities**:
- Generar authorization URLs para login
- Intercambiar authorization codes por tokens
- Implementar On-Behalf-Of flow para BC tokens
- Refresh de tokens expirados
- Validar tokens JWT

**Key Methods**:

```typescript
class MicrosoftOAuthService {
  /**
   * Generate authorization URL for OAuth login
   * @param state - CSRF token
   * @returns Authorization URL to redirect user
   */
  getAuthCodeUrl(state: string): string;

  /**
   * Exchange authorization code for tokens
   * @param code - Authorization code from Microsoft callback
   * @returns Access token, refresh token, and ID token
   */
  async acquireTokenByCode(code: string): Promise<TokenResponse>;

  /**
   * Acquire BC token using On-Behalf-Of flow
   * @param userMsAccessToken - User's Microsoft access token
   * @returns BC access token and refresh token
   */
  async acquireBCToken(userMsAccessToken: string): Promise<BCTokenData>;

  /**
   * Refresh expired token
   * @param refreshToken - Refresh token
   * @returns New access token and possibly new refresh token
   */
  async refreshToken(refreshToken: string): Promise<BCTokenData>;

  /**
   * Validate JWT token
   * @param token - JWT token to validate
   * @returns Decoded token payload if valid
   */
  validateToken(token: string): TokenPayload | null;
}
```

**Configuration**:

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
const msOAuthService = new MicrosoftOAuthService({
  clientId: process.env.MICROSOFT_CLIENT_ID!,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
  tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
  redirectUri: process.env.MICROSOFT_REDIRECT_URI!,
  scopes: [
    'openid',
    'profile',
    'email',
    'offline_access',
    'User.Read',
    'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All'
  ]
});
```

**Usage Example**:

```typescript
// In auth route handler
const authUrl = msOAuthService.getAuthCodeUrl(state);
res.redirect(authUrl);

// In callback handler
const tokens = await msOAuthService.acquireTokenByCode(code);
const bcTokens = await msOAuthService.acquireBCToken(tokens.accessToken);
```

---

### 2. BCTokenManager

**Purpose**: Gestiona el ciclo de vida de los tokens de Business Central por usuario.

**Responsibilities**:
- Almacenar tokens BC cifrados en la base de datos
- Recuperar tokens BC descifrados
- Auto-refresh de tokens expirados
- Revocar tokens cuando usuario cierra sesión
- Multi-tenant token management

**Key Methods**:

```typescript
class BCTokenManager {
  /**
   * Store BC tokens for a user (encrypted)
   * @param userId - User ID
   * @param tokens - BC access and refresh tokens
   */
  async storeBCTokens(userId: string, tokens: BCTokenData): Promise<void>;

  /**
   * Get BC tokens for a user (decrypted)
   * Auto-refreshes if expired
   * @param userId - User ID
   * @returns BC tokens or null if not available
   */
  async getBCTokens(userId: string): Promise<BCTokenData | null>;

  /**
   * Refresh BC token using refresh token
   * @param userId - User ID
   */
  async refreshBCToken(userId: string): Promise<void>;

  /**
   * Revoke BC tokens for a user
   * @param userId - User ID
   */
  async revokeBCTokens(userId: string): Promise<void>;

  /**
   * Check if user has BC tokens
   * @param userId - User ID
   * @returns true if user has granted BC consent
   */
  async hasBCTokens(userId: string): Promise<boolean>;
}
```

**Database Schema**:

```sql
-- users table stores encrypted BC tokens
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  microsoft_user_id VARCHAR(255) UNIQUE NOT NULL,

  -- BC tokens (encrypted with AES-256-GCM)
  bc_access_token_encrypted TEXT,
  bc_refresh_token_encrypted TEXT,
  bc_token_expires_at TIMESTAMP,
  bc_tenant_id VARCHAR(255),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Usage Example**:

```typescript
// Store BC tokens after OBO flow
await bcTokenManager.storeBCTokens(userId, bcTokens);

// Get BC tokens (auto-refresh if expired)
const tokens = await bcTokenManager.getBCTokens(userId);
if (!tokens) {
  throw new Error('User has not granted BC consent');
}

// Create BCClient with user's token
const bcClient = new BCClient(tokens.accessToken, tokens.tenantId);
```

---

### 3. EncryptionService

**Purpose**: Proporciona funciones de cifrado/descifrado para tokens sensibles.

**Responsibilities**:
- Cifrado de tokens con AES-256-GCM
- Descifrado de tokens almacenados
- Key derivation con PBKDF2
- Generación de IVs (Initialization Vectors) aleatorios

**Key Methods**:

```typescript
class EncryptionService {
  /**
   * Encrypt a string value
   * @param plaintext - Value to encrypt
   * @returns Encrypted value (base64)
   */
  async encrypt(plaintext: string): Promise<string>;

  /**
   * Decrypt an encrypted value
   * @param ciphertext - Encrypted value (base64)
   * @returns Decrypted value
   */
  async decrypt(ciphertext: string): Promise<string>;

  /**
   * Generate encryption key from password
   * @param password - Password for key derivation
   * @param salt - Salt for PBKDF2
   * @returns Derived key
   */
  deriveKey(password: string, salt: Buffer): Buffer;
}
```

**Configuration**:

```typescript
// backend/src/services/auth/EncryptionService.ts
const encryptionService = new EncryptionService({
  encryptionKey: process.env.ENCRYPTION_KEY!  // 32-byte base64 encoded key
});
```

**Encryption Format**:

```
Encrypted Token = IV (12 bytes) + Auth Tag (16 bytes) + Ciphertext
                  |__________________|
                         Base64 encoded
```

**Usage Example**:

```typescript
// Encrypt token before storing in DB
const encrypted = await encryptionService.encrypt(bcAccessToken);
await db.query(
  'UPDATE users SET bc_access_token_encrypted = $1 WHERE id = $2',
  [encrypted, userId]
);

// Decrypt token when retrieving from DB
const result = await db.query(
  'SELECT bc_access_token_encrypted FROM users WHERE id = $1',
  [userId]
);
const decrypted = await encryptionService.decrypt(result.rows[0].bc_access_token_encrypted);
```

---

## Service Interactions

### Flow 1: User Login (Microsoft OAuth)

```
User → Frontend → Backend
         ↓
MicrosoftOAuthService.getAuthCodeUrl()
         ↓
Microsoft Login Page
         ↓
MicrosoftOAuthService.acquireTokenByCode()
         ↓
Create session with MS tokens
         ↓
Redirect to Frontend Dashboard
```

### Flow 2: BC Token Acquisition (OBO)

```
User → "Connect to BC" button
         ↓
Backend gets MS token from session
         ↓
MicrosoftOAuthService.acquireBCToken(msToken)
         ↓
EncryptionService.encrypt(bcToken)
         ↓
BCTokenManager.storeBCTokens(userId, encryptedTokens)
         ↓
Store in Database
```

### Flow 3: BC API Request

```
User → BC operation request
         ↓
BCTokenManager.getBCTokens(userId)
         ↓
Check if token expired
         ↓ (if expired)
BCTokenManager.refreshBCToken(userId)
         ↓
MicrosoftOAuthService.refreshToken(refreshToken)
         ↓
EncryptionService.encrypt(newToken)
         ↓
Store new token in DB
         ↓
Return decrypted token to caller
         ↓
Create BCClient with token
         ↓
Execute BC operation
```

---

## Middleware

### authenticateMicrosoft

**Purpose**: Valida que el usuario tiene sesión activa de Microsoft.

**Usage**:

```typescript
// backend/src/middleware/auth-microsoft.ts
export function authenticateMicrosoft(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Optionally verify MS token validity
  const msToken = req.session.microsoftAccessToken;
  const isValid = msOAuthService.validateToken(msToken);

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  next();
}

// Apply to protected routes
app.use('/api/agent', authenticateMicrosoft, agentRoutes);
app.use('/api/session', authenticateMicrosoft, sessionRoutes);
```

---

## Environment Variables

```bash
# Microsoft OAuth
MICROSOFT_CLIENT_ID=<Azure App Registration Client ID>
MICROSOFT_CLIENT_SECRET=<Azure App Registration Client Secret>
MICROSOFT_TENANT_ID=common  # or specific tenant ID
MICROSOFT_REDIRECT_URI=http://localhost:3002/api/auth/callback
MICROSOFT_SCOPES="openid profile email offline_access User.Read https://api.businesscentral.dynamics.com/Financials.ReadWrite.All"

# Encryption
ENCRYPTION_KEY=<32-byte base64 encoded key>
# Generate with: openssl rand -base64 32

# Session Management
SESSION_SECRET=<random string>
# Generate with: openssl rand -base64 32
SESSION_MAX_AGE=86400000  # 24 hours
```

---

## Testing

### Unit Tests

```typescript
// test/services/auth/MicrosoftOAuthService.test.ts
describe('MicrosoftOAuthService', () => {
  it('should generate valid authorization URL', () => {
    const authUrl = msOAuthService.getAuthCodeUrl('test-state');
    expect(authUrl).toContain('login.microsoftonline.com');
    expect(authUrl).toContain('client_id=');
    expect(authUrl).toContain('state=test-state');
  });

  it('should exchange code for tokens', async () => {
    nock('https://login.microsoftonline.com')
      .post('/common/oauth2/v2.0/token')
      .reply(200, {
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        id_token: 'mock-id'
      });

    const tokens = await msOAuthService.acquireTokenByCode('mock-code');
    expect(tokens.accessToken).toBe('mock-token');
  });
});
```

### Integration Tests

```typescript
// test/services/auth/BCTokenManager.test.ts
describe('BCTokenManager', () => {
  it('should store and retrieve BC tokens', async () => {
    const userId = 'test-user-id';
    const tokens = {
      accessToken: 'bc-token',
      refreshToken: 'bc-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      tenantId: 'tenant-1'
    };

    await bcTokenManager.storeBCTokens(userId, tokens);

    const retrieved = await bcTokenManager.getBCTokens(userId);
    expect(retrieved.accessToken).toBe('bc-token');
    expect(retrieved.tenantId).toBe('tenant-1');
  });

  it('should auto-refresh expired tokens', async () => {
    const userId = 'test-user-id';

    // Store token that will be expired
    await bcTokenManager.storeBCTokens(userId, {
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() - 1000),  // Already expired
      tenantId: 'tenant-1'
    });

    // Mock refresh response
    nock('https://login.microsoftonline.com')
      .post('/common/oauth2/v2.0/token')
      .reply(200, {
        access_token: 'new-token',
        expires_in: 3600
      });

    // Should auto-refresh
    const tokens = await bcTokenManager.getBCTokens(userId);
    expect(tokens.accessToken).toBe('new-token');
  });
});
```

---

## Error Handling

### Common Errors

```typescript
// MicrosoftOAuthService
try {
  const tokens = await msOAuthService.acquireTokenByCode(code);
} catch (error) {
  if (error.message.includes('AADSTS50011')) {
    // Redirect URI mismatch
    logger.error('OAuth callback failed: redirect_uri mismatch', { error });
    throw new Error('Invalid redirect URI configuration');
  }

  if (error.message.includes('AADSTS65001')) {
    // User did not consent
    logger.warn('User did not grant consent', { error });
    throw new Error('User consent required');
  }

  // Generic error
  logger.error('OAuth token acquisition failed', { error });
  throw new Error('Authentication failed');
}

// BCTokenManager
try {
  const tokens = await bcTokenManager.getBCTokens(userId);
} catch (error) {
  if (error.message.includes('No refresh token')) {
    // User never granted BC consent
    throw new Error('User has not connected Business Central');
  }

  if (error.message.includes('Refresh failed')) {
    // Refresh token expired or revoked
    throw new Error('BC authorization expired, please reconnect');
  }

  throw error;
}
```

---

## Security Best Practices

### 1. Never Log Tokens

```typescript
// ❌ BAD
logger.info('Token acquired', { accessToken: token });

// ✅ GOOD
logger.info('Token acquired', {
  userId: user.id,
  expiresAt: tokens.expiresAt,
  scopes: tokens.scopes
});
```

### 2. Always Encrypt Tokens in DB

```typescript
// ❌ BAD
await db.query('UPDATE users SET bc_access_token = $1', [token]);

// ✅ GOOD
const encrypted = await encryptionService.encrypt(token);
await db.query('UPDATE users SET bc_access_token_encrypted = $1', [encrypted]);
```

### 3. Validate State Parameter (CSRF)

```typescript
// ✅ GOOD
router.get('/callback', (req, res) => {
  const { state } = req.query;
  if (state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid state' });
  }
  // Proceed
});
```

### 4. Use HTTPS in Production

```typescript
// backend/src/server.ts
app.use(session({
  cookie: {
    secure: process.env.NODE_ENV === 'production',  // HTTPS only
    httpOnly: true,
    sameSite: 'lax'
  }
}));
```

---

## Future Enhancements

### 1. Token Rotation

Implementar rotación automática de refresh tokens para mayor seguridad:

```typescript
async refreshBCToken(userId: string): Promise<void> {
  const newTokens = await msOAuthService.refreshToken(refreshToken);

  // Invalidate old refresh token
  await this.revokeRefreshToken(oldRefreshToken);

  // Store new refresh token
  await this.storeBCTokens(userId, newTokens);
}
```

### 2. Multi-Tenant Switching

Permitir a usuarios con acceso a múltiples BC tenants cambiar entre ellos:

```typescript
async switchBCTenant(userId: string, targetTenantId: string): Promise<void> {
  // Verify user has access to target tenant
  const tenants = await this.getUserBCTenants(userId);
  if (!tenants.includes(targetTenantId)) {
    throw new Error('User does not have access to this tenant');
  }

  // Update active tenant
  await db.query(
    'UPDATE users SET active_bc_tenant_id = $1 WHERE id = $2',
    [targetTenantId, userId]
  );
}
```

### 3. Audit Logging

Registrar todas las operaciones de autenticación para audit trail:

```typescript
await auditLog.log({
  userId,
  action: 'bc_token_acquired',
  tenantId: tokens.tenantId,
  timestamp: new Date(),
  metadata: { scopes: tokens.scopes }
});
```

---

## References

- [Microsoft OAuth Flow](../../../docs/11-backend/07-oauth-flow.md)
- [BC Authentication](../../../docs/07-security/05-bc-authentication.md)
- [Microsoft OAuth Setup](../../../docs/07-security/06-microsoft-oauth-setup.md)
- [Multi-Tenant Architecture](../../../docs/07-security/07-bc-multi-tenant.md)

---

**Last updated**: 2025-11-11
**Version**: 1.0
