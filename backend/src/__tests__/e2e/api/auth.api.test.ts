/**
 * E2E API Tests: Authentication Endpoints
 *
 * Tests the authentication endpoints:
 * - GET /api/auth/login - Redirect to Microsoft OAuth
 * - GET /api/auth/me - Get current user info
 * - POST /api/auth/logout - Logout and destroy session
 * - GET /api/auth/bc-status - Business Central token status
 *
 * @module __tests__/e2e/api/auth.api.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  createE2ETestClient,
  createTestSessionFactory,
  type E2ETestClient,
  type TestSessionFactory,
} from '../helpers';

describe('E2E API: Auth Endpoints', () => {
  setupE2ETest();

  const factory = createTestSessionFactory();
  let client: E2ETestClient;

  beforeAll(async () => {
    // Factory is created at describe scope
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
  });

  describe('GET /api/auth/login', () => {
    it('should redirect to Microsoft OAuth', async () => {
      const response = await client.request('GET', '/api/auth/login', {
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      expect(response.headers.has('location')).toBe(true);

      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).toContain('login.microsoftonline.com');
    });

    it('should include OAuth parameters in redirect URL', async () => {
      const response = await client.request('GET', '/api/auth/login', {
        redirect: 'manual',
      });

      const location = response.headers.get('location');
      expect(location).toBeTruthy();

      // Verify OAuth parameters
      expect(location).toContain('client_id=');
      expect(location).toContain('redirect_uri=');
      expect(location).toContain('response_type=code');
      expect(location).toContain('scope=');
    });

    it('should not require authentication', async () => {
      // Create unauthenticated client
      const unauthClient = createE2ETestClient();

      const response = await unauthClient.request('GET', '/api/auth/login', {
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
    });
  });

  describe('GET /api/auth/me (unauthenticated)', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await client.get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.ok).toBe(false);
    });

    it('should return error message for unauthenticated request', async () => {
      const response = await client.get<{ error: string }>('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/auth/me (authenticated)', () => {
    it('should return user info when authenticated', async () => {
      const testUser = await factory.createTestUser({ prefix: 'auth_me_' });
      client.setSessionCookie(testUser.sessionCookie);

      const response = await client.get<{
        id: string;
        email: string;
        displayName: string;
        isActive: boolean;
      }>('/api/auth/me');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('email');
      expect(response.body).toHaveProperty('displayName');
    });

    it('should return correct user data', async () => {
      const testUser = await factory.createTestUser({ prefix: 'auth_data_' });
      client.setSessionCookie(testUser.sessionCookie);

      const response = await client.get<{
        id: string;
        email: string;
        displayName: string;
      }>('/api/auth/me');

      expect(response.ok).toBe(true);
      expect(response.body.id).toBe(testUser.id);
      expect(response.body.email).toBe(testUser.email);
    });

    it('should include user role information', async () => {
      const testUser = await factory.createTestUser({ prefix: 'auth_role_' });
      client.setSessionCookie(testUser.sessionCookie);

      const response = await client.get<{
        role: string;
        isAdmin: boolean;
      }>('/api/auth/me');

      expect(response.ok).toBe(true);
      expect(response.body).toHaveProperty('role');
      expect(response.body).toHaveProperty('isAdmin');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should destroy session and return success', async () => {
      const testUser = await factory.createTestUser({ prefix: 'logout_' });
      client.setSessionCookie(testUser.sessionCookie);

      const response = await client.post<{ success: boolean }>('/api/auth/logout');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });

    it('should invalidate session after logout', async () => {
      const testUser = await factory.createTestUser({ prefix: 'logout_invalid_' });
      client.setSessionCookie(testUser.sessionCookie);

      // Logout
      const logoutResponse = await client.post('/api/auth/logout');
      expect(logoutResponse.ok).toBe(true);

      // Try to access protected endpoint with same session
      const meResponse = await client.get('/api/auth/me');
      expect(meResponse.status).toBe(401);
    });

    it('should handle logout without authentication gracefully', async () => {
      // Create client without session cookie
      const unauthClient = createE2ETestClient();

      const response = await unauthClient.post('/api/auth/logout');

      // Should still return success (idempotent)
      expect(response.ok).toBe(true);
    });
  });

  describe('GET /api/auth/bc-status', () => {
    it('should return BC token status for authenticated user', async () => {
      const testUser = await factory.createTestUser({ prefix: 'bc_status_' });
      client.setSessionCookie(testUser.sessionCookie);

      const response = await client.get<{
        hasToken: boolean;
        isValid: boolean;
      }>('/api/auth/bc-status');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('hasToken');
    });

    it('should indicate no token for new test user', async () => {
      const testUser = await factory.createTestUser({ prefix: 'bc_no_token_' });
      client.setSessionCookie(testUser.sessionCookie);

      const response = await client.get<{ hasToken: boolean }>('/api/auth/bc-status');

      expect(response.ok).toBe(true);
      expect(response.body.hasToken).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await client.get('/api/auth/bc-status');

      expect(response.status).toBe(401);
    });

    it('should return consistent structure', async () => {
      const testUser = await factory.createTestUser({ prefix: 'bc_structure_' });
      client.setSessionCookie(testUser.sessionCookie);

      const response = await client.get<{
        hasToken: boolean;
        isValid?: boolean;
        expiresAt?: string;
      }>('/api/auth/bc-status');

      expect(response.ok).toBe(true);
      expect(typeof response.body.hasToken).toBe('boolean');

      // Optional fields should be present only when hasToken is true
      if (response.body.hasToken) {
        expect(response.body).toHaveProperty('isValid');
        expect(typeof response.body.isValid).toBe('boolean');
      }
    });
  });

  describe('Session persistence', () => {
    it('should maintain session across multiple requests', async () => {
      const testUser = await factory.createTestUser({ prefix: 'persist_' });
      client.setSessionCookie(testUser.sessionCookie);

      // First request
      const response1 = await client.get<{ id: string }>('/api/auth/me');
      expect(response1.ok).toBe(true);

      // Second request
      const response2 = await client.get<{ id: string }>('/api/auth/me');
      expect(response2.ok).toBe(true);

      // Should return same user ID
      expect(response1.body.id).toBe(response2.body.id);
    });

    it('should handle concurrent requests with same session', async () => {
      const testUser = await factory.createTestUser({ prefix: 'concurrent_' });
      client.setSessionCookie(testUser.sessionCookie);

      // Make multiple concurrent requests
      const [response1, response2, response3] = await Promise.all([
        client.get<{ id: string }>('/api/auth/me'),
        client.get('/api/auth/bc-status'),
        client.get('/api/chat/sessions'),
      ]);

      expect(response1.ok).toBe(true);
      expect(response2.ok).toBe(true);
      expect(response3.ok).toBe(true);
    });
  });
});
