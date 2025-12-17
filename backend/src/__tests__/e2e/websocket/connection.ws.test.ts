/**
 * E2E Tests: WebSocket Connection Lifecycle
 *
 * Tests WebSocket connection, authentication, and disconnection flows.
 *
 * @module __tests__/e2e/websocket/connection.ws.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../helpers/E2ETestClient';
import { TestSessionFactory } from '../../integration/helpers/TestSessionFactory';

describe('E2E: WebSocket Connection', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let sessionCookie: string;

  beforeAll(async () => {
    const auth = await factory.createTestUser();
    sessionCookie = auth.sessionCookie;
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('Connection with authentication', () => {
    it('should connect successfully with valid session cookie', async () => {
      client.setSessionCookie(sessionCookie);
      await client.connect();
      expect(client.isConnected()).toBe(true);
      expect(client.getSocketId()).toBeDefined();
    });

    it('should fail to connect without session cookie', async () => {
      // No session cookie set
      await expect(client.connect()).rejects.toThrow();
    });

    it('should fail to connect with invalid session cookie', async () => {
      client.setSessionCookie('connect.sid=s%3Ainvalid_session.invalid_signature');
      await expect(client.connect()).rejects.toThrow();
    });
  });

  describe('Disconnection', () => {
    it('should disconnect cleanly', async () => {
      client.setSessionCookie(sessionCookie);
      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      // Should not throw when disconnecting while not connected
      await expect(client.disconnect()).resolves.not.toThrow();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('Reconnection', () => {
    it('should allow reconnection after disconnect', async () => {
      client.setSessionCookie(sessionCookie);

      // First connection
      await client.connect();
      expect(client.isConnected()).toBe(true);
      const firstSocketId = client.getSocketId();

      // Disconnect
      await client.disconnect();
      expect(client.isConnected()).toBe(false);

      // Reconnect
      await client.connect();
      expect(client.isConnected()).toBe(true);
      const secondSocketId = client.getSocketId();

      // Should have different socket IDs
      expect(secondSocketId).not.toBe(firstSocketId);
    });
  });
});
