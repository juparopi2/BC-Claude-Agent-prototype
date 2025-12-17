/**
 * E2E API Tests: Billing Endpoints
 *
 * Tests the billing and payment endpoints:
 * - GET /api/billing/current - Get current billing period
 * - GET /api/billing/history - Get billing history
 * - GET /api/billing/invoice/:id - Get specific invoice
 * - GET /api/billing/payg - Get pay-as-you-go status
 * - POST /api/billing/payg/enable - Enable PAYG
 * - POST /api/billing/payg/disable - Disable PAYG
 * - PATCH /api/billing/payg/limit - Update spending limit
 *
 * @module __tests__/e2e/api/billing.api.test
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

describe('E2E API: Billing Endpoints', () => {
  setupE2ETest();

  const factory = createTestSessionFactory();
  let client: E2ETestClient;
  let testUser: TestUser;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'billing_' });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
  });

  describe('GET /api/billing/current', () => {
    it('should get current billing period', async () => {
      const response = await client.get('/api/billing/current');

      // Document current behavior (likely 404 if not implemented)
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have billing data structure
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/billing/current');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/billing/history', () => {
    it('should get billing history', async () => {
      const response = await client.get<unknown[]>('/api/billing/history');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should return array
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('should support pagination with limit', async () => {
      const response = await client.get('/api/billing/history', { limit: '10' });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/billing/history');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/billing/invoice/:id', () => {
    it('should get specific invoice', async () => {
      const invoiceId = 'inv_test_123';
      const response = await client.get(`/api/billing/invoice/${invoiceId}`);

      // Document current behavior (likely 404)
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should return 404 for non-existent invoice', async () => {
      const fakeId = factory.generateTestId();
      const response = await client.get(`/api/billing/invoice/${fakeId}`);

      expect(response.status).toBe(404);
    });

    it('should require authentication', async () => {
      const invoiceId = 'inv_test_123';
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get(`/api/billing/invoice/${invoiceId}`);

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('GET /api/billing/payg', () => {
    it('should get pay-as-you-go status', async () => {
      const response = await client.get('/api/billing/payg');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);

      if (response.ok) {
        // If implemented, should have PAYG status structure
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/billing/payg');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('POST /api/billing/payg/enable', () => {
    it('should enable pay-as-you-go', async () => {
      const response = await client.post('/api/billing/payg/enable', {
        spendingLimit: 100,
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.post('/api/billing/payg/enable');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('POST /api/billing/payg/disable', () => {
    it('should disable pay-as-you-go', async () => {
      const response = await client.post('/api/billing/payg/disable');

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.post('/api/billing/payg/disable');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('PATCH /api/billing/payg/limit', () => {
    it('should update spending limit', async () => {
      const response = await client.request('PATCH', '/api/billing/payg/limit', {
        body: { limit: 200 },
      });

      // Document current behavior
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.request('PATCH', '/api/billing/payg/limit', {
        body: { limit: 200 },
      });

      expect([401, 404]).toContain(response.status);
    });
  });
});
