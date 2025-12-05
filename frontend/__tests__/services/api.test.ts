/**
 * API Client Tests
 *
 * Integration tests for the API client with MSW mocks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient, getApiClient, resetApiClient } from '../../lib/services/api';
import { server } from '../../vitest.setup';
import { errorHandlers, mockUser, mockSessions } from '../mocks/handlers';

describe('ApiClient', () => {
  let api: ApiClient;

  beforeEach(() => {
    resetApiClient();
    api = getApiClient();
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const result = await api.healthCheck();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('healthy');
        expect(result.data.timestamp).toBeDefined();
      }
    });
  });

  describe('Authentication', () => {
    it('should check auth status successfully', async () => {
      const result = await api.checkAuth();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.authenticated).toBe(true);
        expect(result.data.user).toEqual(mockUser);
      }
    });

    it('should get current user', async () => {
      const result = await api.getCurrentUser();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(mockUser.id);
        expect(result.data.email).toBe(mockUser.email);
      }
    });

    it('should handle unauthorized response gracefully', async () => {
      server.use(errorHandlers.unauthorized);

      const result = await api.checkAuth();

      // 401 is treated as "not authenticated" (success), not an error
      // This is intentional UX design - auth check doesn't "fail", it just returns not authenticated
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.authenticated).toBe(false);
        expect(result.data.user).toBeUndefined();
      }
    });
  });

  describe('Sessions', () => {
    it('should get all sessions', async () => {
      const result = await api.getSessions();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.id).toBe(mockSessions[0]?.id);
      }
    });

    it('should get a single session', async () => {
      const result = await api.getSession('session-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('session-1');
        expect(result.data.title).toBe('First Chat');
      }
    });

    it('should handle session not found', async () => {
      const result = await api.getSession('non-existent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SESSION_NOT_FOUND');
      }
    });

    it('should create a new session', async () => {
      const result = await api.createSession({ title: 'New Chat' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('New Chat');
        expect(result.data.id).toBeDefined();
      }
    });

    it('should update a session', async () => {
      const result = await api.updateSession('session-1', { title: 'Updated Title' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Updated Title');
      }
    });

    it('should delete a session', async () => {
      const result = await api.deleteSession('session-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(true);
      }
    });

    it('should handle server error', async () => {
      server.use(errorHandlers.serverError);

      const result = await api.getSessions();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('Messages', () => {
    it('should get messages for a session', async () => {
      const result = await api.getMessages('session-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.role).toBe('user');
        expect(result.data[1]?.role).toBe('assistant');
      }
    });

    it('should get messages with pagination', async () => {
      const result = await api.getMessages('session-1', { limit: 10, after: 0 });

      expect(result.success).toBe(true);
    });
  });

  describe('Token Usage', () => {
    it('should get session token usage', async () => {
      const result = await api.getSessionTokenUsage('session-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.total_input_tokens).toBeDefined();
        expect(result.data.total_output_tokens).toBeDefined();
      }
    });

    it('should get user token usage', async () => {
      const result = await api.getUserTokenUsage();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message_count).toBeDefined();
      }
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getApiClient();
      const instance2 = getApiClient();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton correctly', () => {
      const instance1 = getApiClient();
      resetApiClient();
      const instance2 = getApiClient();

      expect(instance1).not.toBe(instance2);
    });
  });
});
