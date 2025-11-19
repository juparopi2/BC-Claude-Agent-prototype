# PRD 03: Auth Services Tests - OAuth & Token Management

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Author**: Claude Code (Anthropic)
**Status**: Active
**Reading Time**: 35-45 minutes
**Implementation Time**: 8 hours

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Part 1: MicrosoftOAuthService Tests](#part-1-microsoftoauthservice-tests)
3. [Part 2: BCTokenManager Tests](#part-2-bctokenmanager-tests)
4. [Implementation Checklist](#implementation-checklist)

---

## Executive Summary

### Why Auth Services Are Critical

Authentication is the entry point to the entire system. Without proper auth testing:
- Users cannot log in (system unusable)
- BC tokens expire mid-operation (data loss)
- Token encryption fails (security breach)
- Refresh logic breaks (session interruptions)

### Tests to Implement

| Service | Tests | Estimated Effort | Priority |
|---------|-------|------------------|----------|
| MicrosoftOAuthService | 10-12 tests | 5 hours | CRITICAL |
| BCTokenManager | 6-8 tests | 3 hours | HIGH |
| **TOTAL** | **16-20 tests** | **8 hours** | **CRITICAL** |

---

## Part 1: MicrosoftOAuthService Tests

### Overview

**File**: `backend/src/services/auth/MicrosoftOAuthService.ts`

**Purpose**: Handle Microsoft OAuth 2.0 authentication flow with BC token acquisition.

**OAuth Flow**:
```
1. User clicks "Login" → getAuthorizationUrl()
2. User redirects to Microsoft login → OAuth consent
3. Microsoft redirects back with code → exchangeCodeForTokens()
4. Get user profile → getUserProfile()
5. Acquire BC token → acquireBCToken()
6. Store encrypted token → BCTokenManager.encrypt()
7. Create session → Redis session store
```

**Key Scopes**:
- `openid` - Identity
- `profile` - User profile
- `email` - Email address
- `offline_access` - Refresh token
- `User.Read` - Microsoft Graph
- `https://api.businesscentral.dynamics.com/Financials.ReadWrite.All` - BC access

---

### Test File Setup

**File**: `backend/src/__tests__/unit/services/auth/MicrosoftOAuthService.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MicrosoftOAuthService } from '@/services/auth/MicrosoftOAuthService';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// MSW server for mocking Microsoft endpoints
const server = setupServer();

describe('MicrosoftOAuthService', () => {
  let oauthService: MicrosoftOAuthService;

  beforeEach(() => {
    server.listen();
    oauthService = new MicrosoftOAuthService({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tenantId: 'common',
      redirectUri: 'http://localhost:3002/api/auth/callback',
      scopes: [
        'openid',
        'profile',
        'email',
        'offline_access',
        'User.Read',
        'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All'
      ]
    });
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
    vi.clearAllMocks();
  });

  // Tests will be added here
});
```

---

### Test 1: Generate Authorization URL with Correct Scopes

**Test Code**:
```typescript
it('should generate authorization URL with all required scopes', () => {
  // Arrange
  const state = 'random-state-123';

  // Act
  const authUrl = oauthService.getAuthorizationUrl(state);

  // Assert: URL includes all components
  expect(authUrl).toContain('login.microsoftonline.com');
  expect(authUrl).toContain('test-client-id');
  expect(authUrl).toContain('response_type=code');
  expect(authUrl).toContain('redirect_uri=http://localhost:3002/api/auth/callback');
  expect(authUrl).toContain('state=random-state-123');

  // Assert: All scopes included
  const url = new URL(authUrl);
  const scopeParam = url.searchParams.get('scope');
  expect(scopeParam).toContain('openid');
  expect(scopeParam).toContain('profile');
  expect(scopeParam).toContain('email');
  expect(scopeParam).toContain('offline_access');
  expect(scopeParam).toContain('User.Read');
  expect(scopeParam).toContain('https://api.businesscentral.dynamics.com/Financials.ReadWrite.All');
});
```

**Assertions**:
- ✅ URL includes Microsoft login endpoint
- ✅ Client ID present
- ✅ All 6 scopes included
- ✅ State parameter for CSRF protection

---

### Test 2: Exchange Authorization Code for Tokens

**Test Code**:
```typescript
it('should exchange authorization code for access and refresh tokens', async () => {
  // Arrange: Mock Microsoft token endpoint
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => {
      return HttpResponse.json({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid profile email offline_access User.Read'
      });
    })
  );

  // Act
  const tokens = await oauthService.exchangeCodeForTokens('auth-code-123');

  // Assert: Tokens returned
  expect(tokens).toEqual({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresIn: 3600,
    tokenType: 'Bearer',
    scope: expect.any(String)
  });

  // Assert: Access token can be used
  expect(tokens.accessToken).toBeTruthy();
  expect(tokens.refreshToken).toBeTruthy();
});
```

**Assertions**:
- ✅ Access token returned
- ✅ Refresh token returned (offline_access)
- ✅ Expiry time included (3600s)
- ✅ Token type = Bearer

---

### Test 3: Refresh Access Token Using Refresh Token

**Test Code**:
```typescript
it('should refresh access token using refresh token', async () => {
  // Arrange: Mock refresh token endpoint
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', async ({ request }) => {
      const body = await request.text();
      const params = new URLSearchParams(body);

      if (params.get('grant_type') === 'refresh_token') {
        return HttpResponse.json({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer'
        });
      }
    })
  );

  // Act
  const newTokens = await oauthService.refreshAccessToken('old-refresh-token');

  // Assert: New tokens returned
  expect(newTokens.accessToken).toBe('new-access-token');
  expect(newTokens.refreshToken).toBe('new-refresh-token');
  expect(newTokens.expiresIn).toBe(3600);

  // Assert: Old refresh token replaced
  expect(newTokens.refreshToken).not.toBe('old-refresh-token');
});
```

**Assertions**:
- ✅ New access token returned
- ✅ New refresh token returned (rotating refresh tokens)
- ✅ grant_type=refresh_token in request
- ✅ Expiry reset to 3600s

---

### Test 4: Get User Profile from Microsoft Graph

**Test Code**:
```typescript
it('should retrieve user profile from Microsoft Graph API', async () => {
  // Arrange: Mock Microsoft Graph /me endpoint
  server.use(
    http.get('https://graph.microsoft.com/v1.0/me', ({ request }) => {
      const authHeader = request.headers.get('Authorization');
      if (authHeader === 'Bearer mock-access-token') {
        return HttpResponse.json({
          id: 'user-123',
          displayName: 'John Doe',
          userPrincipalName: 'john.doe@contoso.com',
          mail: 'john.doe@contoso.com',
          givenName: 'John',
          surname: 'Doe'
        });
      }
    })
  );

  // Act
  const profile = await oauthService.getUserProfile('mock-access-token');

  // Assert: User profile returned
  expect(profile).toEqual({
    id: 'user-123',
    displayName: 'John Doe',
    email: 'john.doe@contoso.com',
    firstName: 'John',
    lastName: 'Doe'
  });
});
```

**Assertions**:
- ✅ User ID returned
- ✅ Display name returned
- ✅ Email returned
- ✅ Authorization header includes Bearer token

---

### Test 5: Acquire Business Central Token

**Test Code**:
```typescript
it('should acquire Business Central token with delegated permissions', async () => {
  // Arrange: Mock BC token endpoint
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', async ({ request }) => {
      const body = await request.text();
      const params = new URLSearchParams(body);

      if (params.get('scope')?.includes('https://api.businesscentral.dynamics.com')) {
        return HttpResponse.json({
          access_token: 'bc-access-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All'
        });
      }
    })
  );

  // Act
  const bcToken = await oauthService.acquireBCToken('user-refresh-token');

  // Assert: BC token returned
  expect(bcToken.accessToken).toBe('bc-access-token');
  expect(bcToken.expiresIn).toBe(3600);

  // Assert: Scope is BC API
  expect(bcToken.scope).toContain('https://api.businesscentral.dynamics.com');
});
```

**Assertions**:
- ✅ BC access token returned
- ✅ Scope includes BC API
- ✅ Delegated permissions (user context)
- ✅ Expiry time included

---

### Test 6: Error Handling - consent_required

**Test Code**:
```typescript
it('should handle consent_required error and prompt user', async () => {
  // Arrange: Mock consent_required error
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => {
      return HttpResponse.json(
        {
          error: 'consent_required',
          error_description: 'User must grant consent for BC access'
        },
        { status: 400 }
      );
    })
  );

  // Act & Assert: Error thrown with consent_required
  await expect(
    oauthService.acquireBCToken('refresh-token')
  ).rejects.toMatchObject({
    code: 'CONSENT_REQUIRED',
    message: expect.stringContaining('consent'),
    retryable: false
  });
});
```

**Assertions**:
- ✅ Error code = CONSENT_REQUIRED
- ✅ Error message explains consent needed
- ✅ retryable = false (user action required)
- ✅ HTTP 400 status

---

### Test 7: Error Handling - invalid_grant (Expired Refresh Token)

**Test Code**:
```typescript
it('should handle invalid_grant error for expired refresh token', async () => {
  // Arrange: Mock invalid_grant error
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => {
      return HttpResponse.json(
        {
          error: 'invalid_grant',
          error_description: 'Refresh token has expired'
        },
        { status: 400 }
      );
    })
  );

  // Act & Assert: Error thrown
  await expect(
    oauthService.refreshAccessToken('expired-refresh-token')
  ).rejects.toMatchObject({
    code: 'INVALID_GRANT',
    message: expect.stringContaining('expired'),
    retryable: false
  });
});
```

**Assertions**:
- ✅ Error code = INVALID_GRANT
- ✅ Error message mentions expiration
- ✅ retryable = false (re-auth required)
- ✅ User must log in again

---

### Test 8: Error Handling - unauthorized_client

**Test Code**:
```typescript
it('should handle unauthorized_client error for invalid credentials', async () => {
  // Arrange: Mock unauthorized_client error
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => {
      return HttpResponse.json(
        {
          error: 'unauthorized_client',
          error_description: 'Invalid client credentials'
        },
        { status: 401 }
      );
    })
  );

  // Act & Assert: Error thrown
  await expect(
    oauthService.exchangeCodeForTokens('auth-code')
  ).rejects.toMatchObject({
    code: 'UNAUTHORIZED_CLIENT',
    message: expect.stringContaining('client credentials'),
    retryable: false
  });
});
```

**Assertions**:
- ✅ Error code = UNAUTHORIZED_CLIENT
- ✅ Error message explains invalid credentials
- ✅ retryable = false (config issue)
- ✅ HTTP 401 status

---

### Test 9: Token Expiry Check and Auto-Refresh

**Test Code**:
```typescript
it('should check token expiry and auto-refresh if needed', async () => {
  // Arrange: Token expires in 5 minutes (threshold)
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min from now

  vi.spyOn(oauthService, 'isTokenExpired').mockReturnValue(true);

  // Mock refresh endpoint
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => {
      return HttpResponse.json({
        access_token: 'refreshed-access-token',
        refresh_token: 'refreshed-refresh-token',
        expires_in: 3600
      });
    })
  );

  // Act
  const tokens = await oauthService.ensureValidToken({
    accessToken: 'old-token',
    refreshToken: 'refresh-token',
    expiresAt
  });

  // Assert: Token refreshed
  expect(tokens.accessToken).toBe('refreshed-access-token');
  expect(tokens.refreshToken).toBe('refreshed-refresh-token');

  // Assert: isTokenExpired checked
  expect(oauthService.isTokenExpired).toHaveBeenCalledWith(expiresAt);
});
```

**Assertions**:
- ✅ Token expiry checked (5 min threshold)
- ✅ Auto-refresh triggered if expired
- ✅ New tokens returned
- ✅ Old tokens replaced

---

### Test 10: Concurrent Refresh Prevention

**Test Code**:
```typescript
it('should prevent concurrent refresh token requests', async () => {
  // Arrange: Mock refresh endpoint with delay
  let refreshCallCount = 0;
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', async () => {
      refreshCallCount++;
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay
      return HttpResponse.json({
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        expires_in: 3600
      });
    })
  );

  // Act: Trigger 5 concurrent refreshes
  const refreshPromises = [];
  for (let i = 0; i < 5; i++) {
    refreshPromises.push(
      oauthService.refreshAccessToken('refresh-token')
    );
  }

  const results = await Promise.all(refreshPromises);

  // Assert: All 5 requests return same token
  results.forEach(result => {
    expect(result.accessToken).toBe('new-token');
  });

  // Assert: Only 1 refresh API call made (not 5)
  expect(refreshCallCount).toBe(1);
});
```

**Assertions**:
- ✅ Concurrent refreshes deduplicated
- ✅ Only 1 API call made (not 5)
- ✅ All callers receive same tokens
- ✅ Prevents token refresh race condition

---

### MicrosoftOAuthService Test Summary

**Total Tests**: 10 tests
**Estimated Time**: 5 hours
**Coverage Areas**:
- ✅ Authorization URL generation
- ✅ Code exchange for tokens
- ✅ Token refresh automation
- ✅ User profile retrieval
- ✅ BC token acquisition
- ✅ Error: consent_required
- ✅ Error: invalid_grant
- ✅ Error: unauthorized_client
- ✅ Token expiry check + auto-refresh
- ✅ Concurrent refresh prevention

---

## Part 2: BCTokenManager Tests

### Overview

**File**: `backend/src/services/auth/BCTokenManager.ts`

**Purpose**: Encrypt/decrypt BC tokens using AES-256-GCM for secure storage.

**Encryption Flow**:
```
BC Access Token (plaintext)
    ↓
AES-256-GCM Encryption (ENCRYPTION_KEY env var)
    ↓
Encrypted Token + IV + Auth Tag
    ↓
Store in users.bc_access_token_encrypted (NVARCHAR)
```

**Security Requirements**:
- AES-256-GCM (authenticated encryption)
- Random IV (Initialization Vector) per encryption
- Auth Tag for tamper detection
- 32-byte encryption key (256 bits)

---

### Test File Setup

**File**: `backend/src/__tests__/unit/services/auth/BCTokenManager.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BCTokenManager } from '@/services/auth/BCTokenManager';
import crypto from 'crypto';

describe('BCTokenManager', () => {
  let tokenManager: BCTokenManager;
  const encryptionKey = crypto.randomBytes(32).toString('hex'); // 32 bytes

  beforeEach(() => {
    tokenManager = new BCTokenManager(encryptionKey);
  });

  // Tests will be added here
});
```

---

### Test 1: Encrypt Token with AES-256-GCM

**Test Code**:
```typescript
it('should encrypt BC token with AES-256-GCM', () => {
  // Arrange
  const plainToken = 'bc-access-token-12345';

  // Act
  const encrypted = tokenManager.encrypt(plainToken);

  // Assert: Encrypted format includes IV + Auth Tag + Ciphertext
  expect(encrypted).toBeTruthy();
  expect(encrypted).not.toBe(plainToken); // Not plaintext
  expect(encrypted.length).toBeGreaterThan(plainToken.length); // IV + Auth Tag overhead

  // Assert: Format is iv:authTag:ciphertext (hex-encoded)
  const parts = encrypted.split(':');
  expect(parts).toHaveLength(3);

  const [iv, authTag, ciphertext] = parts;
  expect(iv).toHaveLength(32); // 16 bytes IV = 32 hex chars
  expect(authTag).toHaveLength(32); // 16 bytes Auth Tag = 32 hex chars
  expect(ciphertext).toBeTruthy();
});
```

**Assertions**:
- ✅ Encrypted string returned
- ✅ Format: `iv:authTag:ciphertext`
- ✅ IV length = 32 hex chars (16 bytes)
- ✅ Auth Tag length = 32 hex chars (16 bytes)
- ✅ Not plaintext

---

### Test 2: Decrypt Token Correctly

**Test Code**:
```typescript
it('should decrypt token correctly', () => {
  // Arrange
  const plainToken = 'bc-access-token-67890';

  // Act: Encrypt then decrypt
  const encrypted = tokenManager.encrypt(plainToken);
  const decrypted = tokenManager.decrypt(encrypted);

  // Assert: Decrypted matches original
  expect(decrypted).toBe(plainToken);
});
```

**Assertions**:
- ✅ Decrypt returns original plaintext
- ✅ Encryption/decryption round-trip works
- ✅ No data loss

---

### Test 3: Token Expiry Check (5 Min Buffer)

**Test Code**:
```typescript
it('should check if token is expired with 5 minute buffer', () => {
  // Arrange: Token expires in 6 minutes (NOT expired)
  const expiresAt1 = new Date(Date.now() + 6 * 60 * 1000);

  // Arrange: Token expires in 4 minutes (EXPIRED - within buffer)
  const expiresAt2 = new Date(Date.now() + 4 * 60 * 1000);

  // Arrange: Token already expired
  const expiresAt3 = new Date(Date.now() - 1000);

  // Act & Assert
  expect(tokenManager.isTokenExpired(expiresAt1)).toBe(false); // 6 min > 5 min buffer
  expect(tokenManager.isTokenExpired(expiresAt2)).toBe(true);  // 4 min < 5 min buffer
  expect(tokenManager.isTokenExpired(expiresAt3)).toBe(true);  // Already expired
});
```

**Assertions**:
- ✅ Token valid if expires > 5 minutes from now
- ✅ Token expired if expires < 5 minutes from now
- ✅ Token expired if already past expiry
- ✅ 5-minute buffer prevents mid-request expiry

---

### Test 4: Auto-Refresh Logic

**Test Code**:
```typescript
it('should auto-refresh token if needed', async () => {
  // Arrange: Token expires in 3 minutes (needs refresh)
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

  // Mock OAuth service refresh
  const mockOAuthService = {
    refreshAccessToken: vi.fn().mockResolvedValue({
      accessToken: 'new-bc-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 3600
    })
  };

  // Act
  const newToken = await tokenManager.refreshIfNeeded(
    'old-bc-token',
    'refresh-token',
    expiresAt,
    mockOAuthService
  );

  // Assert: Token refreshed
  expect(newToken.accessToken).toBe('new-bc-token');
  expect(mockOAuthService.refreshAccessToken).toHaveBeenCalledWith('refresh-token');
});
```

**Assertions**:
- ✅ Refresh triggered if token expires < 5 min
- ✅ OAuth service called with refresh token
- ✅ New token returned
- ✅ Expiry reset to 3600s

---

### Test 5: Tamper Detection (Auth Tag Validation)

**Test Code**:
```typescript
it('should detect tampered ciphertext via Auth Tag', () => {
  // Arrange
  const plainToken = 'bc-access-token-tamper-test';
  const encrypted = tokenManager.encrypt(plainToken);

  // Act: Tamper with ciphertext (flip a bit)
  const [iv, authTag, ciphertext] = encrypted.split(':');
  const tamperedCiphertext = ciphertext.slice(0, -1) + 'X'; // Change last char
  const tamperedEncrypted = `${iv}:${authTag}:${tamperedCiphertext}`;

  // Assert: Decryption fails due to Auth Tag mismatch
  expect(() => {
    tokenManager.decrypt(tamperedEncrypted);
  }).toThrow(/Auth Tag mismatch|Tampered data/);
});
```

**Assertions**:
- ✅ Tampered ciphertext detected
- ✅ Auth Tag validation fails
- ✅ Error thrown (not silent corruption)
- ✅ Security: AES-GCM authenticated encryption

---

### Test 6: Error - Invalid Encryption Key

**Test Code**:
```typescript
it('should throw error if encryption key is invalid', () => {
  // Arrange: Invalid key (wrong length)
  const invalidKey = 'short-key'; // Not 32 bytes

  // Act & Assert: Constructor throws error
  expect(() => {
    new BCTokenManager(invalidKey);
  }).toThrow(/Encryption key must be 32 bytes/);
});
```

**Assertions**:
- ✅ Invalid key rejected
- ✅ Error message explains requirement (32 bytes)
- ✅ Prevents weak encryption

---

### Test 7: Error - Corrupted Encrypted Data

**Test Code**:
```typescript
it('should handle corrupted encrypted data gracefully', () => {
  // Arrange: Corrupted data (invalid format)
  const corruptedData1 = 'not-a-valid-encrypted-string';
  const corruptedData2 = 'iv:only:two:parts'; // Missing ciphertext
  const corruptedData3 = 'invalid-hex:invalid-hex:invalid-hex';

  // Act & Assert: Decryption throws meaningful errors
  expect(() => {
    tokenManager.decrypt(corruptedData1);
  }).toThrow(/Invalid encrypted data format/);

  expect(() => {
    tokenManager.decrypt(corruptedData2);
  }).toThrow(/Invalid encrypted data format/);

  expect(() => {
    tokenManager.decrypt(corruptedData3);
  }).toThrow(/Invalid hex encoding/);
});
```

**Assertions**:
- ✅ Corrupted data detected
- ✅ Meaningful error messages
- ✅ No crashes or silent failures

---

### Test 8: Random IV per Encryption

**Test Code**:
```typescript
it('should use random IV for each encryption', () => {
  // Arrange
  const plainToken = 'bc-access-token-iv-test';

  // Act: Encrypt same token 3 times
  const encrypted1 = tokenManager.encrypt(plainToken);
  const encrypted2 = tokenManager.encrypt(plainToken);
  const encrypted3 = tokenManager.encrypt(plainToken);

  // Assert: Each encryption has different IV
  const iv1 = encrypted1.split(':')[0];
  const iv2 = encrypted2.split(':')[0];
  const iv3 = encrypted3.split(':')[0];

  expect(iv1).not.toBe(iv2);
  expect(iv2).not.toBe(iv3);
  expect(iv1).not.toBe(iv3);

  // Assert: All decrypt to same plaintext
  expect(tokenManager.decrypt(encrypted1)).toBe(plainToken);
  expect(tokenManager.decrypt(encrypted2)).toBe(plainToken);
  expect(tokenManager.decrypt(encrypted3)).toBe(plainToken);
});
```

**Assertions**:
- ✅ Each encryption uses unique IV
- ✅ Same plaintext produces different ciphertexts
- ✅ All ciphertexts decrypt correctly
- ✅ Security: IV randomness prevents pattern analysis

---

### BCTokenManager Test Summary

**Total Tests**: 8 tests
**Estimated Time**: 3 hours
**Coverage Areas**:
- ✅ AES-256-GCM encryption
- ✅ Decryption correctness
- ✅ Token expiry check (5 min buffer)
- ✅ Auto-refresh logic
- ✅ Tamper detection (Auth Tag)
- ✅ Error: Invalid encryption key
- ✅ Error: Corrupted data
- ✅ Random IV per encryption

---

## Implementation Checklist

### Before Starting
- [ ] Read PRD 01 (Testing Overview)
- [ ] Read PRD 02 (Critical Services Tests)
- [ ] Review source code:
  - `backend/src/services/auth/MicrosoftOAuthService.ts`
  - `backend/src/services/auth/BCTokenManager.ts`
- [ ] Install MSW for HTTP mocking (`npm install -D msw`)

### MicrosoftOAuthService Tests (5 hours)
- [ ] Test 1: Authorization URL (30 min)
- [ ] Test 2: Code exchange (30 min)
- [ ] Test 3: Token refresh (45 min)
- [ ] Test 4: User profile (30 min)
- [ ] Test 5: BC token acquisition (45 min)
- [ ] Test 6: consent_required error (20 min)
- [ ] Test 7: invalid_grant error (20 min)
- [ ] Test 8: unauthorized_client error (20 min)
- [ ] Test 9: Token expiry + auto-refresh (45 min)
- [ ] Test 10: Concurrent refresh prevention (45 min)

### BCTokenManager Tests (3 hours)
- [ ] Test 1: Encryption (20 min)
- [ ] Test 2: Decryption (15 min)
- [ ] Test 3: Expiry check (20 min)
- [ ] Test 4: Auto-refresh (30 min)
- [ ] Test 5: Tamper detection (30 min)
- [ ] Test 6: Invalid key error (15 min)
- [ ] Test 7: Corrupted data error (20 min)
- [ ] Test 8: Random IV (30 min)

### After Completion
- [ ] Run all tests: `npm test`
- [ ] Check coverage: `npm run test:coverage`
- [ ] Verify no regressions
- [ ] Update TODO.md
- [ ] Proceed to PRD 04 (Business Logic Tests)

---

**End of PRD 03: Auth Services Tests**
