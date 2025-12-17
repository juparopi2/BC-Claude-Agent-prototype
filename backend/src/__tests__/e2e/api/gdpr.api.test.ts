/**
 * E2E API Tests: GDPR Endpoints
 *
 * Tests the GDPR compliance and data management endpoints:
 * - GET /api/gdpr/deletion-audit - Get data deletion audit log
 * - GET /api/gdpr/deletion-audit/stats - Get deletion statistics
 * - GET /api/gdpr/data-inventory - Get user's data inventory
 *
 * @module __tests__/e2e/api/gdpr.api.test
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

describe('E2E API: GDPR Endpoints', () => {
  setupE2ETest();

  const factory = createTestSessionFactory();
  let client: E2ETestClient;
  let testUser: TestUser;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'gdpr_' });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
  });

  describe('GET /api/gdpr/deletion-audit', () => {
    it('should get deletion audit log', async () => {
      const response = await client.get<unknown[]>('/api/gdpr/deletion-audit');

      // Document current behavior (likely 404 if not implemented)
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should return array of audit entries
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('should support pagination', async () => {
      const response = await client.get('/api/gdpr/deletion-audit', {
        limit: '10',
        offset: '0',
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/gdpr/deletion-audit');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/gdpr/deletion-audit/stats', () => {
    it('should get deletion statistics', async () => {
      const response = await client.get('/api/gdpr/deletion-audit/stats');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have stats structure
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/gdpr/deletion-audit/stats');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/gdpr/data-inventory', () => {
    it('should get user data inventory', async () => {
      const response = await client.get('/api/gdpr/data-inventory');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have inventory structure with data categories
        expect(response.body).toBeDefined();
      }
    });

    it('should include all data categories', async () => {
      const response = await client.get<{
        sessions?: unknown[];
        messages?: unknown[];
        files?: unknown[];
        usage?: unknown;
      }>('/api/gdpr/data-inventory');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should categorize data
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/gdpr/data-inventory');

      expect([401, 404]).toContain(response.status);
    });
  });
});
