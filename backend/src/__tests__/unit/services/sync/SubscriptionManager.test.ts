/**
 * SubscriptionManager Unit Tests (PRD-108)
 *
 * Tests the Microsoft Graph change notification subscription lifecycle:
 * - createSubscription: scope loading, driveId resolution, Graph POST, DB update
 * - renewSubscription: scope validation, Graph PATCH, DB update
 * - deleteSubscription: Graph DELETE, 404 swallow, DB cleanup
 * - findExpiringScopeSubscriptions: query shape and result mapping
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks (Hoisted — must come before any imports from mocked modules)
// ============================================================================

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock Prisma — tables used by SubscriptionManager
const mockScopesFindUnique = vi.hoisted(() => vi.fn());
const mockScopesUpdate = vi.hoisted(() => vi.fn());
const mockScopesFindMany = vi.hoisted(() => vi.fn());
const mockConnectionsFindUnique = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      findUnique: mockScopesFindUnique,
      update: mockScopesUpdate,
      findMany: mockScopesFindMany,
    },
    connections: {
      findUnique: mockConnectionsFindUnique,
    },
  },
}));

// Mock env config
vi.mock('@/infrastructure/config', () => ({
  env: {
    SUBSCRIPTION_MAX_DURATION_DAYS: 29,
    GRAPH_WEBHOOK_BASE_URL: 'https://webhook.example.com',
  },
}));

// Mock GraphTokenManager
const mockGetValidToken = vi.hoisted(() => vi.fn());
vi.mock('@/services/connectors/GraphTokenManager', () => ({
  getGraphTokenManager: vi.fn(() => ({
    getValidToken: mockGetValidToken,
  })),
}));

// Mock GraphHttpClient + GraphApiError
const mockGraphPost = vi.hoisted(() => vi.fn());
const mockGraphPatch = vi.hoisted(() => vi.fn());
const mockGraphDelete = vi.hoisted(() => vi.fn());

vi.mock('@/services/connectors/onedrive/GraphHttpClient', () => ({
  getGraphHttpClient: vi.fn(() => ({
    post: mockGraphPost,
    patch: mockGraphPatch,
    delete: mockGraphDelete,
  })),
  GraphApiError: class GraphApiError extends Error {
    readonly statusCode: number;
    readonly graphErrorCode: string | undefined;
    constructor(statusCode: number, message: string, graphErrorCode?: string) {
      super(message);
      this.name = 'GraphApiError';
      this.statusCode = statusCode;
      this.graphErrorCode = graphErrorCode;
    }
  },
}));

// Mock crypto
const mockRandomBytes = vi.hoisted(() => vi.fn());
vi.mock('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import { getSubscriptionManager, __resetSubscriptionManager } from '@/services/sync/SubscriptionManager';
import { GraphApiError } from '@/services/connectors/onedrive/GraphHttpClient';

// ============================================================================
// Test Constants
// ============================================================================

const CONNECTION_ID = 'CONN-1111-2222-3333-444444444444';
const SCOPE_ID = 'SCOPE-1111-2222-3333-444444444444';
const SUBSCRIPTION_ID = 'SUB-1111-2222-3333-444444444444';
const DRIVE_ID = 'DRIVE-1111-2222-3333-444444444444';
const TOKEN = 'mock-access-token';

// 64-byte hex string: 128 hex chars. We mock randomBytes to return a known lowercase buffer.
// The actual string returned by toString('hex') on a Buffer of 64 zero bytes is 128 '0' chars.
const KNOWN_HEX_LOWERCASE = 'aabbccdd'.padEnd(128, '0');
const CLIENT_STATE = KNOWN_HEX_LOWERCASE.toUpperCase();

// ============================================================================
// Sample fixtures
// ============================================================================

const sampleScope = {
  id: SCOPE_ID,
  connection_id: CONNECTION_ID,
  scope_type: 'folder' as const,
  scope_resource_id: 'FOLDER-001',
  remote_drive_id: null as string | null,
  subscription_id: SUBSCRIPTION_ID as string | null,
  subscription_expires_at: new Date('2025-02-01'),
  client_state: CLIENT_STATE as string | null,
};

const sampleConnection = {
  microsoft_drive_id: DRIVE_ID,
  provider: 'onedrive' as string,
};

// Graph API subscription response
const sampleGraphResponse = {
  id: SUBSCRIPTION_ID,
  expirationDateTime: '2025-03-01T12:00:00Z',
  resource: `drives/${DRIVE_ID}/root`,
};

// ============================================================================
// Tests
// ============================================================================

describe('SubscriptionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSubscriptionManager();

    // Default: token resolves
    mockGetValidToken.mockResolvedValue(TOKEN);

    // Default: scope and connection found
    mockScopesFindUnique.mockResolvedValue(sampleScope);
    mockConnectionsFindUnique.mockResolvedValue(sampleConnection);

    // Default: DB update succeeds
    mockScopesUpdate.mockResolvedValue({});

    // Default: Graph POST returns subscription
    mockGraphPost.mockResolvedValue(sampleGraphResponse);

    // Default: Graph PATCH returns updated subscription
    mockGraphPatch.mockResolvedValue(sampleGraphResponse);

    // Default: Graph DELETE resolves
    mockGraphDelete.mockResolvedValue(undefined);

    // Default: randomBytes returns a buffer whose hex encoding is the known lowercase string
    mockRandomBytes.mockReturnValue({
      toString: vi.fn().mockReturnValue(KNOWN_HEX_LOWERCASE),
    });
  });

  // ==========================================================================
  // createSubscription
  // ==========================================================================

  describe('createSubscription()', () => {
    it('happy path: POSTs to Graph and persists subscription_id, expiration, and client_state', async () => {
      const manager = getSubscriptionManager();
      // Use a non-library, non-shared scope so driveId comes from connection
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        scope_type: 'root',
        scope_resource_id: null,
        remote_drive_id: null,
        subscription_id: null,
      });

      await manager.createSubscription(CONNECTION_ID, SCOPE_ID);

      // Graph POST called with /subscriptions
      expect(mockGraphPost).toHaveBeenCalledTimes(1);
      const [path, token, body] = mockGraphPost.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(path).toBe('/subscriptions');
      expect(token).toBe(TOKEN);
      expect(body).toMatchObject({
        changeType: 'updated',
        resource: `drives/${DRIVE_ID}/root`,
        notificationUrl: 'https://webhook.example.com/api/webhooks/graph',
        lifecycleNotificationUrl: 'https://webhook.example.com/api/webhooks/graph/lifecycle',
        clientState: CLIENT_STATE,
      });
      expect(typeof body.expirationDateTime).toBe('string');

      // DB updated with subscription info
      expect(mockScopesUpdate).toHaveBeenCalledTimes(1);
      const updateCall = mockScopesUpdate.mock.calls[0] as [unknown, { where: unknown; data: Record<string, unknown> }];
      expect(updateCall[0]).toEqual({ where: { id: SCOPE_ID }, data: expect.objectContaining({
        subscription_id: SUBSCRIPTION_ID,
        client_state: CLIENT_STATE,
        subscription_expires_at: new Date(sampleGraphResponse.expirationDateTime),
      }) });
    });

    it('skips subscription for OneDrive shared scopes (remote_drive_id set, provider=onedrive)', async () => {
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        remote_drive_id: 'REMOTE-DRIVE-999',
      });
      mockConnectionsFindUnique.mockResolvedValue({ microsoft_drive_id: DRIVE_ID, provider: 'onedrive' });

      const manager = getSubscriptionManager();
      await manager.createSubscription(CONNECTION_ID, SCOPE_ID);

      // No Graph POST, no subscription DB update
      expect(mockGraphPost).not.toHaveBeenCalled();
      expect(mockScopesUpdate).not.toHaveBeenCalled();
    });

    // PRD-118: SharePoint folder scopes have remote_drive_id set to library driveId
    // but they DO need subscriptions — the guard must not skip them.
    it('creates subscription for SharePoint folder scopes (remote_drive_id set, provider=sharepoint)', async () => {
      const libraryDriveId = 'SP-LIBRARY-DRIVE-001';
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        scope_type: 'folder',
        scope_resource_id: 'SP-FOLDER-001',
        remote_drive_id: libraryDriveId,
        subscription_id: null,
      });
      mockConnectionsFindUnique.mockResolvedValue({ microsoft_drive_id: null, provider: 'sharepoint' });

      const manager = getSubscriptionManager();
      await manager.createSubscription(CONNECTION_ID, SCOPE_ID);

      // Graph POST should be called with the library driveId
      expect(mockGraphPost).toHaveBeenCalledTimes(1);
      const [, , body] = mockGraphPost.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(body.resource).toBe(`drives/${libraryDriveId}/root`);

      // DB should be updated with subscription info
      expect(mockScopesUpdate).toHaveBeenCalledTimes(1);
    });

    it('resolves driveId from scope_resource_id for library scope type', async () => {
      const libraryResourceId = 'LIB-RESOURCE-001';
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        scope_type: 'library',
        scope_resource_id: libraryResourceId,
        remote_drive_id: null,
        subscription_id: null,
      });

      const manager = getSubscriptionManager();
      await manager.createSubscription(CONNECTION_ID, SCOPE_ID);

      expect(mockGraphPost).toHaveBeenCalledTimes(1);
      const [, , body] = mockGraphPost.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(body.resource).toBe(`drives/${libraryResourceId}/root`);
    });

    it('resolves driveId from connection.microsoft_drive_id as fallback for non-library scopes', async () => {
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        scope_type: 'root',
        scope_resource_id: null,
        remote_drive_id: null,
        subscription_id: null,
      });
      mockConnectionsFindUnique.mockResolvedValue({ microsoft_drive_id: DRIVE_ID });

      const manager = getSubscriptionManager();
      await manager.createSubscription(CONNECTION_ID, SCOPE_ID);

      const [, , body] = mockGraphPost.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(body.resource).toBe(`drives/${DRIVE_ID}/root`);
    });

    it('throws when scope is not found', async () => {
      mockScopesFindUnique.mockResolvedValue(null);

      const manager = getSubscriptionManager();
      await expect(manager.createSubscription(CONNECTION_ID, SCOPE_ID)).rejects.toThrow(
        `Scope not found: ${SCOPE_ID}`
      );
    });

    it('throws when connection is not found', async () => {
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        scope_type: 'root',
        scope_resource_id: null,
        remote_drive_id: null,
        subscription_id: null,
      });
      mockConnectionsFindUnique.mockResolvedValue(null);

      const manager = getSubscriptionManager();
      await expect(manager.createSubscription(CONNECTION_ID, SCOPE_ID)).rejects.toThrow(
        `Connection not found: ${CONNECTION_ID}`
      );
    });

    it('throws when driveId cannot be resolved (no scope_resource_id, no remote_drive_id, no microsoft_drive_id)', async () => {
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        scope_type: 'root',
        scope_resource_id: null,
        remote_drive_id: null,
        subscription_id: null,
      });
      mockConnectionsFindUnique.mockResolvedValue({ microsoft_drive_id: null });

      const manager = getSubscriptionManager();
      await expect(manager.createSubscription(CONNECTION_ID, SCOPE_ID)).rejects.toThrow(
        `Cannot resolve driveId for subscription on scope ${SCOPE_ID}`
      );
    });

    it('generates UPPERCASE clientState from randomBytes hex', async () => {
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        scope_type: 'root',
        scope_resource_id: null,
        remote_drive_id: null,
        subscription_id: null,
      });

      const manager = getSubscriptionManager();
      await manager.createSubscription(CONNECTION_ID, SCOPE_ID);

      // Verify randomBytes was called with 64
      expect(mockRandomBytes).toHaveBeenCalledWith(64);

      // The clientState sent to Graph should be the UPPERCASE version
      const [, , body] = mockGraphPost.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(body.clientState).toBe(CLIENT_STATE);
      expect(body.clientState).toBe((body.clientState as string).toUpperCase());

      // The clientState stored in DB should also be UPPERCASE
      const updateData = mockScopesUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(updateData.data.client_state).toBe(CLIENT_STATE);
    });
  });

  // ==========================================================================
  // renewSubscription
  // ==========================================================================

  describe('renewSubscription()', () => {
    it('happy path: PATCHes subscription and updates expiration in DB', async () => {
      const renewedExpiration = '2025-04-01T12:00:00Z';
      mockGraphPatch.mockResolvedValue({
        id: SUBSCRIPTION_ID,
        expirationDateTime: renewedExpiration,
        resource: `drives/${DRIVE_ID}/root`,
      });

      const manager = getSubscriptionManager();
      await manager.renewSubscription(SCOPE_ID);

      // PATCH called with correct path and body
      expect(mockGraphPatch).toHaveBeenCalledTimes(1);
      const [path, token, body] = mockGraphPatch.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(path).toBe(`/subscriptions/${SUBSCRIPTION_ID}`);
      expect(token).toBe(TOKEN);
      expect(body).toHaveProperty('expirationDateTime');
      expect(typeof body.expirationDateTime).toBe('string');

      // DB updated with new expiration
      expect(mockScopesUpdate).toHaveBeenCalledTimes(1);
      const updateCall = mockScopesUpdate.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
      expect(updateCall).toMatchObject({
        where: { id: SCOPE_ID },
        data: { subscription_expires_at: new Date(renewedExpiration) },
      });
    });

    it('throws when scope is not found', async () => {
      mockScopesFindUnique.mockResolvedValue(null);

      const manager = getSubscriptionManager();
      await expect(manager.renewSubscription(SCOPE_ID)).rejects.toThrow(
        `Scope not found: ${SCOPE_ID}`
      );
    });

    it('throws when scope has no subscription_id', async () => {
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        subscription_id: null,
      });

      const manager = getSubscriptionManager();
      await expect(manager.renewSubscription(SCOPE_ID)).rejects.toThrow(
        `Scope ${SCOPE_ID} has no active subscription_id to renew`
      );
    });

    it('PATCHes the correct subscription path and sends expirationDateTime in body', async () => {
      const manager = getSubscriptionManager();
      await manager.renewSubscription(SCOPE_ID);

      const [path, , body] = mockGraphPatch.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(path).toBe(`/subscriptions/${SUBSCRIPTION_ID}`);
      // Body should only contain expirationDateTime (no clientState or other fields)
      expect(Object.keys(body)).toEqual(['expirationDateTime']);
    });
  });

  // ==========================================================================
  // deleteSubscription
  // ==========================================================================

  describe('deleteSubscription()', () => {
    it('happy path: DELETEs subscription from Graph and clears DB fields', async () => {
      const manager = getSubscriptionManager();
      await manager.deleteSubscription(SCOPE_ID);

      // Graph DELETE called with correct path
      expect(mockGraphDelete).toHaveBeenCalledTimes(1);
      const [path, token] = mockGraphDelete.mock.calls[0] as [string, string];
      expect(path).toBe(`/subscriptions/${SUBSCRIPTION_ID}`);
      expect(token).toBe(TOKEN);

      // DB fields cleared
      expect(mockScopesUpdate).toHaveBeenCalledTimes(1);
      const updateCall = mockScopesUpdate.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
      expect(updateCall).toMatchObject({
        where: { id: SCOPE_ID },
        data: {
          subscription_id: null,
          subscription_expires_at: null,
          client_state: null,
        },
      });
    });

    it('skips silently when scope has no subscription_id (no-op)', async () => {
      mockScopesFindUnique.mockResolvedValue({
        ...sampleScope,
        subscription_id: null,
      });

      const manager = getSubscriptionManager();
      await manager.deleteSubscription(SCOPE_ID);

      expect(mockGraphDelete).not.toHaveBeenCalled();
      expect(mockScopesUpdate).not.toHaveBeenCalled();
    });

    it('swallows Graph 404 and still clears DB fields', async () => {
      mockGraphDelete.mockRejectedValue(new GraphApiError(404, 'Not found'));

      const manager = getSubscriptionManager();
      // Should NOT throw
      await expect(manager.deleteSubscription(SCOPE_ID)).resolves.toBeUndefined();

      // DB fields still cleared even though Graph returned 404
      expect(mockScopesUpdate).toHaveBeenCalledTimes(1);
      const updateCall = mockScopesUpdate.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
      expect(updateCall).toMatchObject({
        where: { id: SCOPE_ID },
        data: {
          subscription_id: null,
          subscription_expires_at: null,
          client_state: null,
        },
      });
    });

    it('rethrows non-404 Graph errors without clearing DB fields', async () => {
      const networkError = new GraphApiError(500, 'Internal Server Error');
      mockGraphDelete.mockRejectedValue(networkError);

      const manager = getSubscriptionManager();
      await expect(manager.deleteSubscription(SCOPE_ID)).rejects.toThrow('Internal Server Error');

      // DB should NOT be cleared when a non-404 error occurs
      expect(mockScopesUpdate).not.toHaveBeenCalled();
    });

    it('throws when scope is not found', async () => {
      mockScopesFindUnique.mockResolvedValue(null);

      const manager = getSubscriptionManager();
      await expect(manager.deleteSubscription(SCOPE_ID)).rejects.toThrow(
        `Scope not found: ${SCOPE_ID}`
      );
    });
  });

  // ==========================================================================
  // findExpiringScopeSubscriptions
  // ==========================================================================

  describe('findExpiringScopeSubscriptions()', () => {
    it('returns scopes with expiring subscriptions', async () => {
      const expiringScopeRows = [
        { id: SCOPE_ID, connection_id: CONNECTION_ID, subscription_id: SUBSCRIPTION_ID },
        { id: 'SCOPE-2222-2222-2222-222222222222', connection_id: CONNECTION_ID, subscription_id: 'SUB-2222-2222-2222-222222222222' },
      ];
      mockScopesFindMany.mockResolvedValue(expiringScopeRows);

      const manager = getSubscriptionManager();
      const result = await manager.findExpiringScopeSubscriptions(2);

      expect(result).toEqual(expiringScopeRows);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no scopes are expiring', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      const manager = getSubscriptionManager();
      const result = await manager.findExpiringScopeSubscriptions(2);

      expect(result).toEqual([]);
    });

    it('queries with correct where clause shape including bufferHours threshold', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      const bufferHours = 6;
      const beforeCall = Date.now();

      const manager = getSubscriptionManager();
      await manager.findExpiringScopeSubscriptions(bufferHours);

      const afterCall = Date.now();

      expect(mockScopesFindMany).toHaveBeenCalledTimes(1);
      const findManyArg = mockScopesFindMany.mock.calls[0][0] as {
        where: {
          subscription_id: { not: null };
          subscription_expires_at: { not: null; lt: Date };
        };
        select: Record<string, boolean>;
      };

      // Where clause must require subscription_id to be non-null
      expect(findManyArg.where.subscription_id).toEqual({ not: null });

      // Where clause must require subscription_expires_at to be non-null and less than threshold
      expect(findManyArg.where.subscription_expires_at).toMatchObject({ not: null });
      const thresholdDate = findManyArg.where.subscription_expires_at.lt;
      expect(thresholdDate).toBeInstanceOf(Date);

      // Threshold should be approximately now + bufferHours
      const expectedMinThreshold = new Date(beforeCall + bufferHours * 3600 * 1000);
      const expectedMaxThreshold = new Date(afterCall + bufferHours * 3600 * 1000);
      expect(thresholdDate.getTime()).toBeGreaterThanOrEqual(expectedMinThreshold.getTime());
      expect(thresholdDate.getTime()).toBeLessThanOrEqual(expectedMaxThreshold.getTime());

      // Select should include id, connection_id, subscription_id
      expect(findManyArg.select).toMatchObject({
        id: true,
        connection_id: true,
        subscription_id: true,
      });
    });
  });
});
