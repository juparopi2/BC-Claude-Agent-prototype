/**
 * E2E API Tests: Health Endpoints
 *
 * Tests the health check endpoints:
 * - GET /health - Full health check with database and Redis status
 * - GET /health/liveness - Simple liveness probe
 *
 * @module __tests__/e2e/api/health.api.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import { createE2ETestClient, type E2ETestClient } from '../helpers';

describe('E2E API: Health Endpoints', () => {
  setupE2ETest();

  let client: E2ETestClient;

  beforeEach(() => {
    client = createE2ETestClient();
  });

  describe('GET /health', () => {
    it('should return health status with database and redis info', async () => {
      const response = await client.get<{
        status: string;
        timestamp: string;
        checks: {
          database: { status: string };
          redis: { status: string };
        };
      }>('/health');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('checks');

      // Verify database check exists
      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks.database).toHaveProperty('status');

      // Verify redis check exists
      expect(response.body.checks).toHaveProperty('redis');
      expect(response.body.checks.redis).toHaveProperty('status');
    });

    it('should return valid timestamp', async () => {
      const response = await client.get<{ timestamp: string }>('/health');

      expect(response.ok).toBe(true);

      // Verify timestamp is a valid ISO 8601 date
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();

      // Verify timestamp is recent (within last 5 seconds)
      const now = Date.now();
      const timestampMs = timestamp.getTime();
      expect(now - timestampMs).toBeLessThan(5000);
    });

    it('should have healthy database status', async () => {
      const response = await client.get<{
        checks: { database: { status: string } };
      }>('/health');

      expect(response.ok).toBe(true);
      expect(response.body.checks.database.status).toBe('healthy');
    });

    it('should have healthy redis status', async () => {
      const response = await client.get<{
        checks: { redis: { status: string } };
      }>('/health');

      expect(response.ok).toBe(true);
      expect(response.body.checks.redis.status).toBe('healthy');
    });
  });

  describe('GET /health/liveness', () => {
    it('should return 200 OK for liveness probe', async () => {
      const response = await client.get('/health/liveness');

      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
    });

    it('should return alive status JSON', async () => {
      const response = await client.get<{ status: string; timestamp: string }>('/health/liveness');

      expect(response.ok).toBe(true);
      expect(response.body).toEqual({
        status: 'alive',
        timestamp: expect.any(String),
      });
    });

    it('should respond quickly (< 100ms)', async () => {
      const start = Date.now();
      const response = await client.get('/health/liveness');
      const duration = Date.now() - start;

      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Health endpoint availability', () => {
    it('should not require authentication', async () => {
      // Create client without session cookie
      const unauthClient = createE2ETestClient();

      const healthResponse = await unauthClient.get('/health');
      expect(healthResponse.ok).toBe(true);

      const livenessResponse = await unauthClient.get('/health/liveness');
      expect(livenessResponse.ok).toBe(true);
    });
  });
});
