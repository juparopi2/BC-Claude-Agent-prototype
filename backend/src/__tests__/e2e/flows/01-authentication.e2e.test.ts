/**
 * E2E-01: Authentication Tests
 *
 * Tests the complete authentication flow including:
 * - Microsoft OAuth redirect
 * - Session cookie handling
 * - Authenticated vs unauthenticated requests
 * - Logout flow
 *
 * @module __tests__/e2e/flows/01-authentication.e2e.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupE2ETest, E2E_CONFIG } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
  ErrorValidator,
  type TestUser,
} from '../helpers';

describe('E2E-01: Authentication', () => {
  const { getBaseUrl, isServerRunning } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let testUser: TestUser;

  beforeAll(async () => {
    // Create a test user for authenticated tests
    testUser = await factory.createTestUser({ prefix: 'e2e_auth_' });
  });

  afterAll(async () => {
    // Clean up test data
    await factory.cleanup();
  });

  beforeEach(() => {
    // Create fresh client for each test
    client = createE2ETestClient();
  });

  describe('Server Health', () => {
    it('should have the server running', () => {
      expect(isServerRunning()).toBe(true);
    });

    it('should respond to liveness probe', async () => {
      const response = await client.get('/health/liveness');
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });

    it('should respond to full health check', async () => {
      const response = await client.get<{
        status: string;
        checks: Record<string, { status: string }>;
      }>('/health');
      expect(response.ok).toBe(true);
      expect(response.body.status).toBeDefined();
    });
  });

  describe('Unauthenticated Access', () => {
    it('should return 401 for protected endpoints without auth', async () => {
      const response = await client.get('/api/chat/sessions');

      expect(response.status).toBe(401);
      const validation = ErrorValidator.validateUnauthorized(response);
      expect(validation.valid).toBe(true);
    });

    it('should return 401 for session details without auth', async () => {
      const response = await client.get('/api/chat/sessions/some-session-id');

      expect(response.status).toBe(401);
    });

    it('should return 401 for approvals endpoint without auth', async () => {
      const response = await client.get('/api/approvals/pending');

      expect(response.status).toBe(401);
    });

    it('should return 401 for token usage endpoint without auth', async () => {
      const response = await client.get('/api/token-usage/summary');

      expect(response.status).toBe(401);
    });
  });

  describe('OAuth Flow', () => {
    it('should redirect to Microsoft login', async () => {
      // Note: In E2E tests, we can't follow the full OAuth redirect
      // because it requires actual Microsoft login.
      // Instead, we verify the redirect is initiated correctly.
      const response = await client.request('GET', '/api/auth/login', {
        headers: {
          // Don't follow redirects
          'Accept': 'text/html',
        },
      });

      // Should be a redirect to Microsoft
      expect([302, 303, 307]).toContain(response.status);
    });

    it('should return user info for authenticated requests', async () => {
      // Set the test user's session cookie
      client.setSessionCookie(testUser.sessionCookie);

      const response = await client.get<{
        userId: string;
        email: string;
      }>('/api/auth/me');

      expect(response.ok).toBe(true);
      expect(response.body.email).toBe(testUser.email);
    });
  });

  describe('Authenticated Access', () => {
    beforeEach(() => {
      // Set up authenticated client
      client.setSessionCookie(testUser.sessionCookie);
    });

    it('should access protected endpoints with valid session', async () => {
      const response = await client.get('/api/chat/sessions');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });

    it('should return user sessions', async () => {
      // Create a test session first
      const session = await factory.createChatSession(testUser.id);

      const response = await client.get<{
        sessions: Array<{ id: string; title: string }>;
      }>('/api/chat/sessions');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body.sessions)).toBe(true);

      // Find our test session
      const foundSession = response.body.sessions.find(s => s.id === session.id);
      expect(foundSession).toBeDefined();
    });

    it('should access approvals endpoint', async () => {
      const response = await client.get('/api/approvals/pending');

      expect(response.ok).toBe(true);
    });
  });

  describe('Session Validation', () => {
    it('should reject requests with invalid session cookie', async () => {
      client.setSessionCookie('connect.sid=invalid_cookie_value');

      const response = await client.get('/api/chat/sessions');

      expect(response.status).toBe(401);
    });

    it('should reject requests with malformed session cookie', async () => {
      client.setSessionCookie('not_a_valid_cookie_format');

      const response = await client.get('/api/chat/sessions');

      expect(response.status).toBe(401);
    });

    it('should maintain session across multiple requests', async () => {
      client.setSessionCookie(testUser.sessionCookie);

      // First request
      const response1 = await client.get('/api/auth/me');
      expect(response1.ok).toBe(true);

      // Second request with same session
      const response2 = await client.get('/api/chat/sessions');
      expect(response2.ok).toBe(true);

      // Third request
      const response3 = await client.get('/api/approvals/pending');
      expect(response3.ok).toBe(true);
    });
  });

  describe('WebSocket Authentication', () => {
    it('should connect to WebSocket with valid session', async () => {
      client.setSessionCookie(testUser.sessionCookie);

      await client.connect();

      expect(client.isConnected()).toBe(true);

      await client.disconnect();
    });

    it('should fail to connect without session cookie', async () => {
      // Don't set session cookie
      await expect(client.connect()).rejects.toThrow();
    });

    it('should fail to connect with invalid session cookie', async () => {
      client.setSessionCookie('connect.sid=invalid_session');

      await expect(client.connect()).rejects.toThrow();
    });
  });

  describe('Error Response Structure', () => {
    it('should return proper 401 error structure', async () => {
      const response = await client.get('/api/chat/sessions');

      expect(response.status).toBe(401);

      // Verify error structure
      const body = response.body as { error?: string; code?: string; message?: string };
      expect(body.error || body.message).toBeDefined();
    });

    it('should not leak sensitive information in errors', async () => {
      const response = await client.get('/api/chat/sessions');

      const bodyStr = JSON.stringify(response.body);

      // Should not contain stack traces
      expect(bodyStr).not.toContain('at ');
      expect(bodyStr).not.toContain('.ts:');

      // Should not contain internal details
      expect(bodyStr.toLowerCase()).not.toContain('redis');
      expect(bodyStr.toLowerCase()).not.toContain('database');
      expect(bodyStr.toLowerCase()).not.toContain('password');
    });
  });
});
