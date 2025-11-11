# OAuth 2.0 Authorization Flow

## Overview

Este documento detalla el flujo de autenticación OAuth 2.0 implementado en BC-Claude-Agent para Microsoft Entra ID y Business Central.

**Flujos implementados**:
1. **Authorization Code Flow** - Para login inicial del usuario con Microsoft
2. **On-Behalf-Of (OBO) Flow** - Para obtener token BC usando el token Microsoft del usuario
3. **Token Refresh Flow** - Para renovar tokens expirados

---

## 1. Authorization Code Flow (Initial Login)

### Sequence Diagram

```
┌────────┐      ┌──────────┐      ┌─────────┐      ┌──────────────┐
│ User   │      │ Frontend │      │ Backend │      │ Microsoft    │
│ Browser│      │ (Next.js)│      │ (Express)│      │ Entra ID     │
└───┬────┘      └────┬─────┘      └────┬────┘      └──────┬───────┘
    │                │                 │                   │
    │  Click "Sign in with Microsoft" │                   │
    │───────────────>│                 │                   │
    │                │                 │                   │
    │                │  GET /api/auth/login                │
    │                │────────────────>│                   │
    │                │                 │                   │
    │                │                 │  Generate state   │
    │                │                 │  (CSRF token)     │
    │                │                 │                   │
    │                │  302 Redirect to Microsoft          │
    │                │<────────────────│                   │
    │                │  + authorization_url                │
    │                │  + client_id                        │
    │                │  + redirect_uri                     │
    │                │  + scope                            │
    │                │  + state                            │
    │                │                 │                   │
    │  Redirect to login.microsoftonline.com               │
    │──────────────────────────────────────────────────────>│
    │                │                 │                   │
    │  Microsoft Login Page            │                   │
    │<──────────────────────────────────────────────────────│
    │                │                 │                   │
    │  User enters credentials         │                   │
    │──────────────────────────────────────────────────────>│
    │                │                 │                   │
    │  Consent Screen (permissions)    │                   │
    │<──────────────────────────────────────────────────────│
    │                │                 │                   │
    │  User clicks "Accept"            │                   │
    │──────────────────────────────────────────────────────>│
    │                │                 │                   │
    │  302 Redirect to backend callback│                   │
    │<──────────────────────────────────────────────────────│
    │  + code (authorization code)     │                   │
    │  + state                         │                   │
    │                │                 │                   │
    │  GET /api/auth/callback?code=...&state=...           │
    │──────────────────────────────────>│                   │
    │                │                 │                   │
    │                │                 │  Validate state   │
    │                │                 │  (CSRF check)     │
    │                │                 │                   │
    │                │                 │  POST /token      │
    │                │                 │  (exchange code)  │
    │                │                 │──────────────────>│
    │                │                 │                   │
    │                │                 │  Access Token     │
    │                │                 │  Refresh Token    │
    │                │                 │  ID Token (JWT)   │
    │                │                 │<──────────────────│
    │                │                 │                   │
    │                │                 │  Decode ID Token  │
    │                │                 │  (user profile)   │
    │                │                 │                   │
    │                │                 │  Create/Update    │
    │                │                 │  User in DB       │
    │                │                 │                   │
    │                │                 │  Create Session   │
    │                │                 │  (express-session)│
    │                │                 │                   │
    │                │  302 Redirect to Frontend           │
    │                │<────────────────│                   │
    │                │  Set-Cookie: session=...            │
    │                │                 │                   │
    │  Redirect to Frontend Dashboard  │                   │
    │<───────────────│                 │                   │
    │                │                 │                   │
```

### Step-by-Step

#### Step 1: Initiate OAuth Flow

**Frontend**:
```typescript
// frontend/components/LoginButton.tsx
function LoginButton() {
  const handleLogin = () => {
    // Redirect to backend OAuth endpoint
    window.location.href = '/api/auth/login';
  };

  return <button onClick={handleLogin}>Sign in with Microsoft</button>;
}
```

**Backend**:
```typescript
// backend/src/api/auth/index.ts
router.get('/login', (req, res) => {
  // Generate CSRF token
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  // Build authorization URL
  const authUrl = microsoftOAuthService.getAuthCodeUrl(state);

  // Redirect to Microsoft
  res.redirect(authUrl);
});
```

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
getAuthCodeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: this.clientId,
    response_type: 'code',
    redirect_uri: this.redirectUri,
    scope: this.scopes.join(' '),
    state: state,
    response_mode: 'query'
  });

  return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize?${params}`;
}
```

**Authorization URL Example**:
```
https://login.microsoftonline.com/common/oauth2/v2.0/authorize
  ?client_id=12345678-1234-1234-1234-123456789012
  &response_type=code
  &redirect_uri=http%3A%2F%2Flocalhost%3A3002%2Fapi%2Fauth%2Fcallback
  &scope=openid+profile+email+offline_access+User.Read+https%3A%2F%2Fapi.businesscentral.dynamics.com%2FFinancials.ReadWrite.All
  &state=a1b2c3d4e5f6...
```

#### Step 2: User Authentication (Microsoft)

Usuario ve página de login de Microsoft y:
1. Ingresa email/password
2. Completa MFA (si está habilitado)
3. Ve consent screen con permisos solicitados
4. Hace click en "Accept"

#### Step 3: Authorization Callback

Microsoft redirect de vuelta al backend con authorization code:

```
http://localhost:3002/api/auth/callback
  ?code=M.C123-Aab...xyz
  &state=a1b2c3d4e5f6...
```

**Backend**:
```typescript
// backend/src/api/auth/index.ts
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  // Validate state (CSRF protection)
  if (state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid state' });
  }

  try {
    // Exchange code for tokens
    const tokens = await microsoftOAuthService.acquireTokenByCode(code);

    // Decode ID token to get user info
    const userInfo = jwt.decode(tokens.idToken);

    // Create or update user in database
    const user = await userService.createOrUpdateUser({
      email: userInfo.email,
      fullName: userInfo.name,
      microsoftUserId: userInfo.oid  // Azure AD object ID
    });

    // Create session
    req.session.userId = user.id;
    req.session.microsoftAccessToken = tokens.accessToken;
    req.session.microsoftRefreshToken = tokens.refreshToken;

    // Redirect to frontend
    res.redirect(process.env.FRONTEND_URL + '/dashboard');
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
});
```

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
async acquireTokenByCode(code: string): Promise<TokenResponse> {
  const response = await fetch(
    `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code'
      })
    }
  );

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresIn: data.expires_in
  };
}
```

---

## 2. On-Behalf-Of (OBO) Flow (BC Token Acquisition)

### Sequence Diagram

```
┌────────┐      ┌──────────┐      ┌─────────┐      ┌──────────────┐
│ User   │      │ Frontend │      │ Backend │      │ Microsoft    │
│ Browser│      │ (Next.js)│      │ (Express)│      │ Entra ID     │
└───┬────┘      └────┬─────┘      └────┬────┘      └──────┬───────┘
    │                │                 │                   │
    │  Click "Connect to Business Central"                │
    │───────────────>│                 │                   │
    │                │                 │                   │
    │                │  POST /api/auth/bc-consent          │
    │                │────────────────>│                   │
    │                │                 │                   │
    │                │                 │  Get MS Token     │
    │                │                 │  from session     │
    │                │                 │                   │
    │                │                 │  POST /token      │
    │                │                 │  (OBO flow)       │
    │                │                 │  - assertion:     │
    │                │                 │    MS token       │
    │                │                 │  - scope: BC      │
    │                │                 │──────────────────>│
    │                │                 │                   │
    │                │                 │  BC Access Token  │
    │                │                 │  BC Refresh Token │
    │                │                 │<──────────────────│
    │                │                 │                   │
    │                │                 │  Encrypt Tokens   │
    │                │                 │  (AES-256-GCM)    │
    │                │                 │                   │
    │                │                 │  Store in DB      │
    │                │                 │  (per user)       │
    │                │                 │                   │
    │                │  200 OK                             │
    │                │<────────────────│                   │
    │                │  { bcConnected: true }              │
    │                │                 │                   │
    │  Show "Connected to BC"          │                   │
    │<───────────────│                 │                   │
    │                │                 │                   │
```

### Implementation

```typescript
// backend/src/api/auth/index.ts
router.post('/bc-consent', authenticateMicrosoft, async (req, res) => {
  const userId = req.session.userId;
  const msAccessToken = req.session.microsoftAccessToken;

  try {
    // Acquire BC token using OBO flow
    const bcTokens = await microsoftOAuthService.acquireBCToken(msAccessToken);

    // Store encrypted BC tokens in database
    await bcTokenManager.storeBCTokens(userId, bcTokens);

    res.json({
      success: true,
      bcConnected: true,
      bcTokenExpiresAt: bcTokens.expiresAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to acquire BC token' });
  }
});
```

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
async acquireBCToken(userMsAccessToken: string): Promise<BCTokenData> {
  const response = await fetch(
    `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        assertion: userMsAccessToken,  // User's MS token
        scope: 'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All',
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        requested_token_use: 'on_behalf_of'
      })
    }
  );

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tenantId: jwt.decode(data.access_token).tid  // Extract tenant ID from token
  };
}
```

---

## 3. Token Refresh Flow

### Sequence Diagram

```
┌────────┐      ┌──────────┐      ┌─────────┐      ┌──────────────┐
│ User   │      │ Frontend │      │ Backend │      │ Microsoft    │
│ Browser│      │ (Next.js)│      │ (Express)│      │ Entra ID     │
└───┬────┘      └────┬─────┘      └────┬────┘      └──────┬───────┘
    │                │                 │                   │
    │  Make BC API Request             │                   │
    │───────────────>│                 │                   │
    │                │                 │                   │
    │                │  POST /api/bc/customers             │
    │                │────────────────>│                   │
    │                │                 │                   │
    │                │                 │  Get BC Token     │
    │                │                 │  from DB          │
    │                │                 │                   │
    │                │                 │  Check expiry     │
    │                │                 │  (expiresAt <     │
    │                │                 │   now)            │
    │                │                 │                   │
    │                │                 │  Token expired!   │
    │                │                 │                   │
    │                │                 │  POST /token      │
    │                │                 │  (refresh flow)   │
    │                │                 │  - refresh_token  │
    │                │                 │──────────────────>│
    │                │                 │                   │
    │                │                 │  New Access Token │
    │                │                 │  New Refresh Token│
    │                │                 │<──────────────────│
    │                │                 │                   │
    │                │                 │  Encrypt & Store  │
    │                │                 │  in DB            │
    │                │                 │                   │
    │                │                 │  Retry BC API     │
    │                │                 │  with new token   │
    │                │                 │                   │
    │                │  200 OK                             │
    │                │<────────────────│                   │
    │                │  { customers }  │                   │
    │                │                 │                   │
    │  Display customers               │                   │
    │<───────────────│                 │                   │
    │                │                 │                   │
```

### Implementation

```typescript
// backend/src/services/auth/BCTokenManager.ts
async getBCTokens(userId: string): Promise<BCTokenData | null> {
  // Fetch encrypted tokens from DB
  const result = await db.query(`
    SELECT bc_access_token_encrypted,
           bc_refresh_token_encrypted,
           bc_token_expires_at,
           bc_tenant_id
    FROM users
    WHERE id = $1
  `, [userId]);

  if (!result.rows[0]?.bc_access_token_encrypted) {
    return null;
  }

  const row = result.rows[0];

  // Check if token is expired
  const expiresAt = new Date(row.bc_token_expires_at);
  if (expiresAt < new Date()) {
    // Token expired, refresh it
    await this.refreshBCToken(userId);
    return this.getBCTokens(userId);  // Recursive call with new token
  }

  // Decrypt and return tokens
  return {
    accessToken: await encryptionService.decrypt(row.bc_access_token_encrypted),
    refreshToken: await encryptionService.decrypt(row.bc_refresh_token_encrypted),
    expiresAt: expiresAt,
    tenantId: row.bc_tenant_id
  };
}

async refreshBCToken(userId: string): Promise<void> {
  // Get encrypted refresh token from DB
  const result = await db.query(`
    SELECT bc_refresh_token_encrypted
    FROM users
    WHERE id = $1
  `, [userId]);

  const refreshTokenEncrypted = result.rows[0]?.bc_refresh_token_encrypted;
  if (!refreshTokenEncrypted) {
    throw new Error('No refresh token available');
  }

  // Decrypt refresh token
  const refreshToken = await encryptionService.decrypt(refreshTokenEncrypted);

  // Request new tokens from Microsoft
  const newTokens = await microsoftOAuthService.refreshToken(refreshToken);

  // Encrypt and store new tokens
  await this.storeBCTokens(userId, newTokens);
}
```

```typescript
// backend/src/services/auth/MicrosoftOAuthService.ts
async refreshToken(refreshToken: string): Promise<BCTokenData> {
  const response = await fetch(
    `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        scope: 'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All',
        grant_type: 'refresh_token'
      })
    }
  );

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,  // Might not return new refresh token
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tenantId: jwt.decode(data.access_token).tid
  };
}
```

---

## 4. Complete User Journey

### Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Initial Visit                                             │
│                                                              │
│ User → Frontend → "Sign in with Microsoft" button           │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ 2. Microsoft Authentication                                  │
│                                                              │
│ Backend → Redirect to login.microsoftonline.com             │
│ User → Enters credentials → Consents to permissions         │
│ Microsoft → Redirect to backend callback with code          │
│ Backend → Exchanges code for tokens → Creates session       │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ 3. Logged In (No BC Connection Yet)                          │
│                                                              │
│ User → Frontend Dashboard → "Connect to Business Central"   │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ 4. BC Token Acquisition (OBO)                                │
│                                                              │
│ Frontend → POST /api/auth/bc-consent                         │
│ Backend → OBO flow with MS token → Get BC token             │
│ Backend → Encrypts & stores BC token in DB                  │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ 5. Full Access (MS + BC)                                     │
│                                                              │
│ User → Can chat with agent                                   │
│ User → Can query BC data                                     │
│ User → Can create/update BC entities (with approval)         │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ 6. Token Refresh (Automatic)                                 │
│                                                              │
│ Backend → Detects expired BC token                           │
│ Backend → Auto-refresh using refresh token                   │
│ Backend → Updates DB with new tokens                         │
│ User → No interruption (transparent)                         │
└──────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

### 1. CSRF Protection

```typescript
// Generate and validate state parameter
router.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;  // Store in session
  const authUrl = getAuthUrl(state);
  res.redirect(authUrl);
});

router.get('/callback', (req, res) => {
  const { state } = req.query;
  if (state !== req.session.oauthState) {
    return res.status(400).json({ error: 'CSRF validation failed' });
  }
  // Proceed with token exchange
});
```

### 2. Secure Token Storage

```typescript
// Never log tokens
logger.info('Token acquired', {
  userId: user.id,
  expiresAt: tokens.expiresAt
  // ❌ DO NOT: accessToken: tokens.accessToken
});

// Always encrypt tokens in DB
const encrypted = await encryptionService.encrypt(token);
await db.query('UPDATE users SET bc_access_token_encrypted = $1', [encrypted]);
```

### 3. Session Security

```typescript
// backend/src/server.ts
app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
    httpOnly: true,                                  // No JS access
    maxAge: 24 * 60 * 60 * 1000,                    // 24 hours
    sameSite: 'lax'                                  // CSRF protection
  }
}));
```

### 4. Token Expiry Handling

```typescript
// Always check expiry before using token
async function useBCToken(userId: string) {
  const tokens = await bcTokenManager.getBCTokens(userId);

  if (!tokens) {
    throw new Error('No BC token available');
  }

  if (tokens.expiresAt < new Date()) {
    // Auto-refresh
    await bcTokenManager.refreshBCToken(userId);
    return bcTokenManager.getBCTokens(userId);
  }

  return tokens;
}
```

---

## Error Handling

### Common Errors

```typescript
// backend/src/api/auth/index.ts
router.get('/callback', async (req, res) => {
  try {
    // Exchange code for tokens
    const tokens = await microsoftOAuthService.acquireTokenByCode(code);
    // ...
  } catch (error) {
    if (error.message.includes('AADSTS50011')) {
      // Reply URL mismatch
      return res.status(400).json({
        error: 'redirect_uri_mismatch',
        message: 'Redirect URI does not match Azure App Registration'
      });
    }

    if (error.message.includes('AADSTS65001')) {
      // User did not consent
      return res.status(403).json({
        error: 'consent_required',
        message: 'User must grant consent to requested permissions'
      });
    }

    // Generic error
    logger.error('OAuth callback failed', { error });
    return res.status(500).json({
      error: 'authentication_failed',
      message: 'Failed to complete authentication'
    });
  }
});
```

---

## Testing

### Manual Testing

```bash
# 1. Test login redirect
curl -v http://localhost:3002/api/auth/login
# Expected: 302 redirect to login.microsoftonline.com

# 2. Test callback (with mock code)
curl -v "http://localhost:3002/api/auth/callback?code=mock-code&state=mock-state"
# Expected: 302 redirect to frontend or 400 error (if state invalid)

# 3. Test current user
curl -v http://localhost:3002/api/auth/me \
  -H "Cookie: session=<session-cookie>"
# Expected: { user: {...}, bcConnected: true/false }
```

### Integration Tests

```typescript
// test/auth-flow.test.ts
describe('OAuth Flow', () => {
  it('should complete full OAuth flow', async () => {
    // Step 1: Initiate login
    const loginResponse = await request(app)
      .get('/api/auth/login')
      .expect(302);

    expect(loginResponse.headers.location).toContain('login.microsoftonline.com');

    // Step 2: Mock callback with code
    nock('https://login.microsoftonline.com')
      .post('/common/oauth2/v2.0/token')
      .reply(200, {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        id_token: 'mock-id-token',
        expires_in: 3600
      });

    const callbackResponse = await request(app)
      .get('/api/auth/callback')
      .query({ code: 'mock-code', state: 'mock-state' })
      .expect(302);

    expect(callbackResponse.headers['set-cookie']).toBeDefined();

    // Step 3: Verify session
    const sessionCookie = callbackResponse.headers['set-cookie'][0];

    const meResponse = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie)
      .expect(200);

    expect(meResponse.body.user).toBeDefined();
  });
});
```

---

## References

- [Microsoft OAuth Documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [On-Behalf-Of Flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow)
- [BC Authentication](../07-security/05-bc-authentication.md)
- [Microsoft OAuth Setup](../07-security/06-microsoft-oauth-setup.md)

---

**Last updated**: 2025-11-11
**Version**: 1.0
