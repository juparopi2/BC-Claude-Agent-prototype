# Authentication Guide

Microsoft OAuth 2.0 authentication with delegated Business Central permissions.

---

## Overview

BC Claude Agent uses **Microsoft Entra ID OAuth 2.0** with:
- Single Sign-On (SSO) via Microsoft accounts
- Session-based authentication (Redis storage)
- Delegated Business Central permissions
- Automatic token refresh

---

## OAuth 2.0 Flow

### Step-by-Step Flow

```
1. User clicks "Login with Microsoft"
   → GET /api/auth/login

2. Backend generates state (CSRF protection)
   → Stores in session
   → Redirects to Microsoft login page

3. User authenticates with Microsoft account
   → Microsoft Entra ID login page

4. User consents to permissions:
   - openid, profile, email
   - User.Read (Microsoft Graph)
   - offline_access (refresh token)

5. Microsoft redirects to callback
   → GET /api/auth/callback?code=xxx&state=yyy

6. Backend validates state (CSRF check)

7. Backend exchanges code for tokens
   → POST to Microsoft token endpoint
   → Receives access_token + refresh_token

8. Backend fetches user profile
   → GET https://graph.microsoft.com/v1.0/me
   → Gets email, displayName, id

9. Backend creates/updates user in database
   → Inserts to users table if new
   → Updates last_microsoft_login

10. Backend stores session in Redis
    → Session contains: userId, microsoftId, tokens

11. Backend redirects to frontend
    → http://localhost:3000/new (with session cookie)
```

---

## Session Management

### Session Storage

Sessions are stored in **Redis** with the following structure:

```typescript
{
  cookie: {
    originalMaxAge: 86400000,  // 24 hours
    httpOnly: true,
    secure: false,  // true in production
    sameSite: 'lax'
  },
  microsoftOAuth: {
    userId: 'uuid',
    microsoftId: 'microsoft-uuid',
    displayName: 'John Doe',
    email: 'john@example.com',
    accessToken: 'eyJ...',
    refreshToken: 'eyJ...',
    tokenExpiresAt: '2025-11-20T10:00:00Z'
  }
}
```

### Session Cookie

**Name**: `connect.sid`

**Attributes**:
- `httpOnly: true` - Cannot be accessed by JavaScript
- `secure: true` - HTTPS only (production)
- `sameSite: 'lax'` - CSRF protection

**Expiration**: 24 hours (configurable via `SESSION_MAX_AGE`)

---

## Token Refresh

### Automatic Refresh

The backend **automatically refreshes** expired Microsoft Graph tokens:

```typescript
// Middleware: authenticateMicrosoft
if (tokenExpiresAt <= now && refreshToken) {
  const newTokens = await oauthService.refreshAccessToken(refreshToken);
  req.session.microsoftOAuth = { ...session, ...newTokens };
  await req.session.save();
  next();  // Continue with refreshed token
}
```

### Manual Refresh

You can also manually refresh tokens:

```typescript
const newTokens = await oauthService.refreshAccessToken(refreshToken);
```

---

## Business Central Consent

### Why BC Consent is Needed

Microsoft Graph tokens **do not** grant access to Business Central API. You need a **separate delegated token** with BC permissions.

### BC Consent Flow

```
1. User clicks "Grant BC Access"
   → POST /api/auth/bc-consent

2. Backend requests BC token using user's refresh token
   → POST to Microsoft token endpoint
   → Scope: https://api.businesscentral.dynamics.com/Financials.ReadWrite.All
   → Grant type: refresh_token

3. If user hasn't consented:
   → Microsoft returns error: consent_required
   → Backend returns consent URL to frontend

4. Frontend redirects user to consent URL
   → User grants BC permission
   → Redirects back to frontend

5. User retries BC consent
   → POST /api/auth/bc-consent
   → Now succeeds

6. Backend stores encrypted BC token
   → AES-256-CBC encryption
   → Stored in users.bc_access_token_encrypted
```

### Check BC Access Status

```bash
GET /api/auth/bc-status
```

Response:
```json
{
  "hasAccess": true,
  "tokenExpiresAt": "2025-11-20T10:00:00Z",
  "isExpired": false
}
```

---

## Protected Routes

### Middleware: `authenticateMicrosoft`

All routes except `/api/auth/*` and `/health/*` are protected:

```typescript
app.use('/api/chat', authenticateMicrosoft, chatRoutes);
app.use('/api/approvals', authenticateMicrosoft, approvalRoutes);
```

**What it does**:
1. Check session exists
2. Validate required fields
3. Check token expiration
4. Auto-refresh if needed
5. Attach `req.userId`, `req.userEmail`, `req.microsoftSession`
6. Call `next()` or return `401 Unauthorized`

### Middleware: `requireBCAccess`

Additional middleware for BC-specific routes:

```typescript
app.use('/api/bc', authenticateMicrosoft, requireBCAccess, bcRoutes);
```

**What it does**:
1. Check BC token exists
2. Check BC token not expired
3. Return `403 Forbidden` if missing/expired (with consent URL)

---

## Environment Variables

```env
# Microsoft OAuth
MICROSOFT_CLIENT_ID=<from Azure App Registration>
MICROSOFT_CLIENT_SECRET=<from Azure App Registration>
MICROSOFT_TENANT_ID=common  # or specific tenant ID
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/auth/callback
MICROSOFT_SCOPES="openid profile email offline_access User.Read https://api.businesscentral.dynamics.com/Financials.ReadWrite.All"

# Session
SESSION_SECRET=<generate with: openssl rand -base64 32>
SESSION_MAX_AGE=86400000  # 24 hours in ms

# Encryption for BC tokens
ENCRYPTION_KEY=<generate with: openssl rand -base64 32>
```

---

## Error Handling

### Common Errors

| Error | Status | Cause | Solution |
|-------|--------|-------|----------|
| `AUTH_SESSION_MISSING` | 401 | No session cookie | Redirect to login |
| `AUTH_TOKEN_EXPIRED` | 401 | Token expired, no refresh token | Redirect to login |
| `BC_ACCESS_REQUIRED` | 403 | No BC token | Redirect to BC consent |
| `BC_CONSENT_REQUIRED` | 403 | User hasn't consented to BC | Redirect to consent URL |

### Example Error Response

```json
{
  "error": "BC Access Required",
  "message": "Business Central access token not found. Please grant consent.",
  "code": "BC_ACCESS_REQUIRED",
  "consentUrl": "https://login.microsoftonline.com/..."
}
```

---

## Security Best Practices

### 1. CSRF Protection

- State parameter validated in OAuth callback
- SameSite cookie attribute (`lax`)

### 2. Token Encryption

- BC tokens encrypted with AES-256-CBC
- Encryption key stored in Azure Key Vault (production)

### 3. Session Security

- HttpOnly cookies (no JavaScript access)
- Secure flag in production (HTTPS only)
- 24-hour expiration

### 4. Token Storage

- Never store tokens in localStorage or sessionStorage
- Always use httpOnly cookies

---

**Last Updated**: 2025-11-19
