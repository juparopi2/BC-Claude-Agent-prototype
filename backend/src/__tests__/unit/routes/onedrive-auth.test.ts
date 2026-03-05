/**
 * Unit Tests - OneDrive OAuth Routes (PRD-101)
 *
 * Tests for OneDrive OAuth 2.0 authentication endpoints.
 * Uses supertest for HTTP endpoint testing with mocked dependencies.
 *
 * Endpoints tested:
 * - POST /connections/onedrive/auth/initiate  – Start (or fast-path) the auth flow.
 * - GET  /auth/callback/onedrive              – Microsoft OAuth redirect callback.
 *
 * Note: express-session is NOT used. Instead, a synthetic `req.session` object
 * is injected via middleware. This avoids MemoryStore serialization issues that
 * cause `session.save()` to hang in supertest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ============================================================================
// Hoisted mock factories
// ============================================================================

const {
  mockStoreTokens,
  mockFindFirst,
  mockCreate,
  mockUpdate,
  mockGetAuthCodeUrl,
  mockAcquireTokenSilent,
  mockAcquireTokenByCode,
  mockGetAccountByHomeId,
  mockSendInternalError,
  mockMsalInstance,
} = vi.hoisted(() => {
  const mockGetAccountByHomeId = vi.fn();
  const mockAcquireTokenSilent = vi.fn();
  const mockAcquireTokenByCode = vi.fn();
  const mockGetAuthCodeUrl = vi.fn();

  const mockMsalInstance = {
    getTokenCache: vi.fn().mockReturnValue({
      getAccountByHomeId: mockGetAccountByHomeId,
    }),
    acquireTokenSilent: mockAcquireTokenSilent,
    acquireTokenByCode: mockAcquireTokenByCode,
    getAuthCodeUrl: mockGetAuthCodeUrl,
  };

  return {
    mockStoreTokens: vi.fn(),
    mockFindFirst: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockGetAuthCodeUrl,
    mockAcquireTokenSilent,
    mockAcquireTokenByCode,
    mockGetAccountByHomeId,
    mockSendInternalError: vi.fn(),
    mockMsalInstance,
  };
});

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = 'TEST-USER-ID-0001';
    next();
  },
}));

vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: vi.fn().mockImplementation(() => mockMsalInstance),
}));

vi.mock('@/domains/auth/oauth/MsalRedisCachePlugin', () => ({
  MsalRedisCachePlugin: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/services/connectors/GraphTokenManager', () => ({
  getGraphTokenManager: vi.fn().mockReturnValue({
    storeTokens: mockStoreTokens,
  }),
}));

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connections: {
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
    },
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/shared/constants/errors', () => ({
  ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.mock('@/shared/utils/error-response', () => ({
  sendInternalError: mockSendInternalError,
}));

// ============================================================================
// Import router under test (after all mocks are declared)
// ============================================================================

import router from '@/routes/onedrive-auth';

// ============================================================================
// Test constants
// ============================================================================

const USER_ID = 'TEST-USER-ID-0001';
const CONNECTION_ID = 'CONN-1234-ABCD-5678-EFGH';
const HOME_ACCOUNT_ID = 'HOME-ACCOUNT-0001';
const MSAL_PARTITION_KEY = 'MSAL-PARTITION-KEY-0001';
const ACCESS_TOKEN = 'mock-access-token-xyz';
const AUTH_CODE_URL = 'https://login.microsoftonline.com/authorize?client_id=mock';
const FRONTEND_URL = 'http://localhost:3000';

// ============================================================================
// Synthetic session factory
// ============================================================================

/**
 * Creates a synthetic session object that mimics express-session interface.
 * `save()` always calls back immediately — avoids MemoryStore serialization
 * issues that hang in supertest.
 */
function createMockSession(data?: Record<string, unknown>): Record<string, unknown> {
  const sessionData: Record<string, unknown> = {
    id: 'test-session-id',
    cookie: { originalMaxAge: null, secure: false, httpOnly: true, path: '/' },
    ...data,
    save(cb: (err?: Error | null) => void) { cb(null); },
    destroy(cb: (err?: Error | null) => void) { cb(null); },
    regenerate(cb: (err?: Error | null) => void) { cb(null); },
    reload(cb: (err?: Error | null) => void) { cb(null); },
    touch() { /* noop */ },
    resetMaxAge() { /* noop */ },
  };
  return sessionData;
}

/**
 * Create a fresh Express app for each test.
 * Injects `req.session` and `req.sessionID` manually (no express-session needed).
 */
function createApp(oauthSession?: {
  userId?: string;
  homeAccountId?: string;
  msalPartitionKey?: string;
}) {
  const app = express();
  app.use(express.json());

  // Inject synthetic session before router
  app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const sessionObj = createMockSession({
      microsoftOAuth: oauthSession,
    });
    (req as unknown as Record<string, unknown>).session = sessionObj;
    (req as unknown as Record<string, unknown>).sessionID = 'test-session-id';
    next();
  });

  app.use('/', router);
  return app;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();

  // Restore mock implementations after clearAllMocks
  mockSendInternalError.mockImplementation(
    (res: express.Response) => { res.status(500).json({ code: 'INTERNAL_ERROR' }); }
  );
  mockMsalInstance.getTokenCache.mockReturnValue({
    getAccountByHomeId: mockGetAccountByHomeId,
  });

  process.env.MICROSOFT_CLIENT_ID = 'mock-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'mock-client-secret';
  process.env.FRONTEND_URL = FRONTEND_URL;

  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================================================
// Tests – POST /connections/onedrive/auth/initiate
// ============================================================================

describe('POST /connections/onedrive/auth/initiate', () => {
  it('fast-path: returns { connectionId, status: connected } when MSAL silent succeeds', async () => {
    mockFindFirst.mockResolvedValue({ id: CONNECTION_ID });
    mockGetAccountByHomeId.mockResolvedValue({ homeAccountId: HOME_ACCOUNT_ID });
    mockAcquireTokenSilent.mockResolvedValue({
      accessToken: ACCESS_TOKEN,
      expiresOn: new Date(Date.now() + 3600_000),
    });
    mockStoreTokens.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'drive-001', owner: { user: { displayName: 'Test' } } }),
    }) as unknown as typeof fetch;

    const app = createApp({
      userId: USER_ID,
      homeAccountId: HOME_ACCOUNT_ID,
      msalPartitionKey: MSAL_PARTITION_KEY,
    });

    const response = await request(app)
      .post('/connections/onedrive/auth/initiate')
      .expect(200);

    expect(response.body).toEqual({
      connectionId: CONNECTION_ID,
      status: 'connected',
    });
    expect(mockStoreTokens).toHaveBeenCalledOnce();
  });

  it('consent path: returns requires_consent when silent acquisition throws', async () => {
    mockFindFirst.mockResolvedValue({ id: CONNECTION_ID });
    mockGetAccountByHomeId.mockResolvedValue({ homeAccountId: HOME_ACCOUNT_ID });
    mockAcquireTokenSilent.mockRejectedValue(new Error('InteractionRequired'));
    mockGetAuthCodeUrl.mockResolvedValue(AUTH_CODE_URL);

    const app = createApp({
      userId: USER_ID,
      homeAccountId: HOME_ACCOUNT_ID,
      msalPartitionKey: MSAL_PARTITION_KEY,
    });

    const response = await request(app)
      .post('/connections/onedrive/auth/initiate')
      .expect(200);

    expect(response.body).toEqual({
      authUrl: AUTH_CODE_URL,
      connectionId: CONNECTION_ID,
      status: 'requires_consent',
    });
    expect(mockStoreTokens).not.toHaveBeenCalled();
  });

  it('consent path: skips fast-path when session has no homeAccountId', async () => {
    mockFindFirst.mockResolvedValue({ id: CONNECTION_ID });
    mockGetAuthCodeUrl.mockResolvedValue(AUTH_CODE_URL);

    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .post('/connections/onedrive/auth/initiate')
      .expect(200);

    expect(response.body.status).toBe('requires_consent');
    expect(response.body.authUrl).toBe(AUTH_CODE_URL);
    expect(mockAcquireTokenSilent).not.toHaveBeenCalled();
  });

  it('creates new connection when none exists for user', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});
    mockGetAuthCodeUrl.mockResolvedValue(AUTH_CODE_URL);

    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .post('/connections/onedrive/auth/initiate')
      .expect(200);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: USER_ID,
          provider: 'onedrive',
          status: 'disconnected',
        }),
      })
    );
    expect(response.body.status).toBe('requires_consent');
  });

  it('reuses existing connection when one already exists', async () => {
    mockFindFirst.mockResolvedValue({ id: CONNECTION_ID });
    mockGetAuthCodeUrl.mockResolvedValue(AUTH_CODE_URL);

    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .post('/connections/onedrive/auth/initiate')
      .expect(200);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(response.body.connectionId).toBe(CONNECTION_ID);
  });

  it('returns 500 on unexpected error', async () => {
    mockFindFirst.mockRejectedValue(new Error('DB down'));

    const app = createApp({ userId: USER_ID });

    await request(app)
      .post('/connections/onedrive/auth/initiate')
      .expect(500);

    expect(mockSendInternalError).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Tests – GET /auth/callback/onedrive
// ============================================================================

describe('GET /auth/callback/onedrive', () => {
  it('successful callback: redirects to frontend with connected=onedrive', async () => {
    mockFindFirst.mockResolvedValue({ id: CONNECTION_ID });
    mockAcquireTokenByCode.mockResolvedValue({
      accessToken: ACCESS_TOKEN,
      expiresOn: new Date(Date.now() + 3600_000),
      account: { homeAccountId: HOME_ACCOUNT_ID },
    });
    mockStoreTokens.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'drive-001', owner: { user: { displayName: 'Test' } } }),
    }) as unknown as typeof fetch;

    const app = createApp({
      userId: USER_ID,
      homeAccountId: HOME_ACCOUNT_ID,
      msalPartitionKey: MSAL_PARTITION_KEY,
    });

    const response = await request(app)
      .get('/auth/callback/onedrive')
      .query({ code: 'auth-code-abc', state: `onedrive:${CONNECTION_ID}` })
      .expect(302);

    const location = response.headers['location'] as string;
    expect(location).toContain(`${FRONTEND_URL}/files`);
    expect(location).toContain('connected=onedrive');
    expect(location).toContain(encodeURIComponent(CONNECTION_ID));
  });

  it('missing code: redirects with error=missing_code', async () => {
    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .get('/auth/callback/onedrive')
      .query({ state: `onedrive:${CONNECTION_ID}` })
      .expect(302);

    expect(response.headers['location']).toContain('error=missing_code');
  });

  it('invalid state prefix: redirects with error=invalid_state', async () => {
    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .get('/auth/callback/onedrive')
      .query({ code: 'abc', state: 'badprefix:123' })
      .expect(302);

    expect(response.headers['location']).toContain('error=invalid_state');
  });

  it('missing state: redirects with error=invalid_state', async () => {
    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .get('/auth/callback/onedrive')
      .query({ code: 'abc' })
      .expect(302);

    expect(response.headers['location']).toContain('error=invalid_state');
  });

  it('OAuth error from Microsoft: redirects with the error', async () => {
    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .get('/auth/callback/onedrive')
      .query({ error: 'access_denied', error_description: 'User denied' })
      .expect(302);

    expect(response.headers['location']).toContain('error=access_denied');
  });

  it('unauthenticated session: redirects with error=unauthenticated', async () => {
    // Session has microsoftOAuth but no userId
    const app = createApp({});

    const response = await request(app)
      .get('/auth/callback/onedrive')
      .query({ code: 'abc', state: `onedrive:${CONNECTION_ID}` })
      .expect(302);

    expect(response.headers['location']).toContain('error=unauthenticated');
  });

  it('connection not found: redirects with error=connection_not_found', async () => {
    mockFindFirst.mockResolvedValue(null);

    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .get('/auth/callback/onedrive')
      .query({ code: 'abc', state: `onedrive:${CONNECTION_ID}` })
      .expect(302);

    expect(response.headers['location']).toContain('error=connection_not_found');
  });

  it('no access token from code exchange: redirects with error=token_exchange_failed', async () => {
    mockFindFirst.mockResolvedValue({ id: CONNECTION_ID });
    mockAcquireTokenByCode.mockResolvedValue({ accessToken: null, account: null });

    const app = createApp({ userId: USER_ID });

    const response = await request(app)
      .get('/auth/callback/onedrive')
      .query({ code: 'abc', state: `onedrive:${CONNECTION_ID}` })
      .expect(302);

    expect(response.headers['location']).toContain('error=token_exchange_failed');
  });
});
