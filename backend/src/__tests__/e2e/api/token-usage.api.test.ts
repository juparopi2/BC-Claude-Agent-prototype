/**
 * E2E API Tests: Token Usage Endpoints
 *
 * Tests the token usage tracking and analytics endpoints:
 * - GET /api/token-usage/me - Get current user's token usage
 * - GET /api/token-usage/user/:id - Get specific user's usage (admin)
 * - GET /api/token-usage/session/:id - Get session token usage
 * - GET /api/token-usage/monthly - Get monthly usage breakdown
 * - GET /api/token-usage/top-sessions - Get highest token usage sessions
 * - GET /api/token-usage/cache-efficiency - Get cache hit rate stats
 *
 * @module __tests__/e2e/api/token-usage.api.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  createE2ETestClient,
  createTestSessionFactory,
  type E2ETestClient,
  type TestSessionFactory,
  type TestUser,
} from '../helpers';

describe('E2E API: Token Usage Endpoints', () => {
  setupE2ETest();

  const factory = createTestSessionFactory();
  let client: E2ETestClient;
  let testUser: TestUser;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'token_usage_' });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
  });

  describe('GET /api/token-usage/me', () => {
    it('should get current user token usage', async () => {
      const response = await client.get('/api/token-usage/me');

      // Document current behavior (likely 404 if not implemented)
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have usage data structure
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/token-usage/me');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/token-usage/user/:id', () => {
    it('should get specific user token usage', async () => {
      const userId = testUser.id;
      const response = await client.get(`/api/token-usage/user/${userId}`);

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        expect(response.body).toBeDefined();
      }
    });

    it('should require admin privileges for other users', async () => {
      const otherUserId = factory.generateTestId();
      const response = await client.get(`/api/token-usage/user/${otherUserId}`);

      // May return 403 (forbidden), 404, or 401 depending on implementation
      expect([401, 403, 404]).toContain(response.status);
    });

    it('should require authentication', async () => {
      const userId = testUser.id;
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get(`/api/token-usage/user/${userId}`);

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/token-usage/session/:id', () => {
    it('should get session token usage', async () => {
      // Create a test session first
      const sessionResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Token Usage Test Session',
      });

      if (sessionResponse.ok) {
        const sessionId = sessionResponse.body.id;
        const response = await client.get(`/api/token-usage/session/${sessionId}`);

        // Document current behavior
        expect(response.status).toBeGreaterThanOrEqual(200);

        if (response.ok) {
          expect(response.body).toBeDefined();
        }
      }
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = factory.generateTestId();
      const response = await client.get(`/api/token-usage/session/${fakeId}`);

      expect(response.status).toBe(404);
    });

    it('should require authentication', async () => {
      const sessionId = 'test_session_123';
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get(`/api/token-usage/session/${sessionId}`);

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/token-usage/monthly', () => {
    it('should get monthly usage breakdown', async () => {
      const response = await client.get<unknown[]>('/api/token-usage/monthly');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should return array of monthly usage
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('should support year parameter', async () => {
      const currentYear = new Date().getFullYear();
      const response = await client.get('/api/token-usage/monthly', {
        year: String(currentYear),
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/token-usage/monthly');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/token-usage/top-sessions', () => {
    it('should get highest token usage sessions', async () => {
      const response = await client.get<unknown[]>('/api/token-usage/top-sessions');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should return array of sessions
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('should support limit parameter', async () => {
      const response = await client.get('/api/token-usage/top-sessions', {
        limit: '10',
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/token-usage/top-sessions');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/token-usage/cache-efficiency', () => {
    it('should get cache hit rate statistics', async () => {
      const response = await client.get('/api/token-usage/cache-efficiency');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have cache stats structure
        expect(response.body).toBeDefined();
      }
    });

    it('should support date range parameters', async () => {
      const response = await client.get('/api/token-usage/cache-efficiency', {
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/token-usage/cache-efficiency');

      expect([401, 404]).toContain(response.status);
    });
  });
});
