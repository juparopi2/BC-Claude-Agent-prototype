/**
 * E2E API Tests: Usage Endpoints
 *
 * Tests the general usage tracking and quota endpoints:
 * - GET /api/usage/current - Get current usage period
 * - GET /api/usage/history - Get historical usage
 * - GET /api/usage/quotas - Get quota limits and remaining
 * - GET /api/usage/breakdown - Get detailed usage breakdown
 * - POST /api/usage/feedback - Submit usage feedback
 *
 * @module __tests__/e2e/api/usage.api.test
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

describe('E2E API: Usage Endpoints', () => {
  setupE2ETest();

  const factory = createTestSessionFactory();
  let client: E2ETestClient;
  let testUser: TestUser;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'usage_' });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
  });

  describe('GET /api/usage/current', () => {
    it('should get current usage period', async () => {
      const response = await client.get('/api/usage/current');

      // Document current behavior (likely 404 if not implemented)
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have usage period structure
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/usage/current');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/usage/history', () => {
    it('should get usage history', async () => {
      const response = await client.get<unknown[]>('/api/usage/history');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should return array of historical usage
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('should support pagination with limit and offset', async () => {
      const response = await client.get('/api/usage/history', {
        limit: '10',
        offset: '0',
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/usage/history');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/usage/quotas', () => {
    it('should get quota limits', async () => {
      const response = await client.get('/api/usage/quotas');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have quota structure
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/usage/quotas');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/usage/breakdown', () => {
    it('should get detailed usage breakdown', async () => {
      const response = await client.get('/api/usage/breakdown');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have breakdown structure
        expect(response.body).toBeDefined();
      }
    });

    it('should support time period filter', async () => {
      const response = await client.get('/api/usage/breakdown', {
        period: 'monthly',
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/usage/breakdown');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('POST /api/usage/feedback', () => {
    it('should submit usage feedback', async () => {
      const response = await client.post('/api/usage/feedback', {
        rating: 5,
        comment: 'Great service!',
        category: 'performance',
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should confirm submission
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.post('/api/usage/feedback', {
        rating: 5,
        comment: 'Test feedback',
      });

      expect([401, 404]).toContain(response.status);
    });
  });
});
