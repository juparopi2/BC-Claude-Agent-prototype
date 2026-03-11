/**
 * ConnectionService.fullDisconnect & getDisconnectSummary Tests (PRD-109)
 *
 * Tests the full disconnect workflow and disconnect summary retrieval.
 * Covers happy path, partial failures, edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockFindById = vi.hoisted(() => vi.fn());
const mockFindByIdWithMsal = vi.hoisted(() => vi.fn());
const mockFindByUser = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockCountScopes = vi.hoisted(() => vi.fn());
const mockCountFiles = vi.hoisted(() => vi.fn());
const mockCountChunks = vi.hoisted(() => vi.fn());
const mockFindScopes = vi.hoisted(() => vi.fn());
const mockUpdateScope = vi.hoisted(() => vi.fn());
const mockTimingSafeCompare = vi.hoisted(() => vi.fn());
const mockRemoveScope = vi.hoisted(() => vi.fn());
const mockRevokeTokens = vi.hoisted(() => vi.fn());
const mockDeleteMsalCache = vi.hoisted(() => vi.fn());
const mockGetSocketIO = vi.hoisted(() => vi.fn());
const mockIsSocketServiceInitialized = vi.hoisted(() => vi.fn());

vi.mock('@/domains/connections/ConnectionRepository', () => ({
  getConnectionRepository: vi.fn(() => ({
    findByUser: mockFindByUser,
    findById: mockFindById,
    findByIdWithMsal: mockFindByIdWithMsal,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
    countScopesByConnection: mockCountScopes,
    countFilesByConnection: mockCountFiles,
    countChunksByConnection: mockCountChunks,
    findScopesByConnection: mockFindScopes,
    updateScope: mockUpdateScope,
  })),
}));

vi.mock('@/shared/utils/session-ownership', () => ({
  timingSafeCompare: mockTimingSafeCompare,
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@/services/sync/ScopeCleanupService', () => ({
  getScopeCleanupService: vi.fn(() => ({
    removeScope: mockRemoveScope,
  })),
}));

vi.mock('@/services/sync/InitialSyncService', () => ({
  getInitialSyncService: vi.fn(() => ({
    syncScope: vi.fn(),
  })),
}));

vi.mock('@/services/connectors/GraphTokenManager', () => ({
  getGraphTokenManager: vi.fn(() => ({
    revokeTokens: mockRevokeTokens,
  })),
}));

vi.mock('@/domains/auth/oauth/MsalRedisCachePlugin', () => ({
  deleteMsalCache: mockDeleteMsalCache,
}));

const mockEmit = vi.fn();
const mockTo = vi.fn(() => ({ emit: mockEmit }));

vi.mock('@/services/websocket/SocketService', () => ({
  isSocketServiceInitialized: mockIsSocketServiceInitialized,
  getSocketIO: mockGetSocketIO,
}));

// Import after mocks
import {
  ConnectionService,
  ConnectionNotFoundError,
  ConnectionForbiddenError,
} from '@/domains/connections/ConnectionService';

// ============================================================================
// TEST HELPERS
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const CONN_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const now = new Date('2026-01-01T00:00:00Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_ID,
    user_id: USER_ID,
    provider: 'onedrive',
    status: 'connected',
    display_name: 'My Drive',
    last_error: null,
    last_error_at: null,
    created_at: now,
    updated_at: now,
    token_expires_at: null,
    ...overrides,
  };
}

function makeRowWithMsal(overrides: Record<string, unknown> = {}) {
  return {
    ...makeRow(),
    msal_home_account_id: 'msal-home-account-123',
    ...overrides,
  };
}

function makeScopeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'SCOPE-AAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    connection_id: CONN_ID,
    scope_type: 'drive',
    scope_resource_id: 'drive-123',
    scope_display_name: 'Documents',
    scope_path: null,
    sync_status: 'idle',
    last_sync_at: null,
    last_sync_error: null,
    last_sync_cursor: null,
    item_count: 5,
    subscription_id: null,
    created_at: now,
    ...overrides,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ConnectionService', () => {
  let service: ConnectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTimingSafeCompare.mockReturnValue(true);
    mockGetSocketIO.mockReturnValue({ to: mockTo });
    mockIsSocketServiceInitialized.mockReturnValue(true);
    service = new ConnectionService();
  });

  // ==========================================================================
  // getDisconnectSummary
  // ==========================================================================

  describe('getDisconnectSummary', () => {
    it('returns correct counts for a connection', async () => {
      mockFindById.mockResolvedValue(makeRow());
      mockCountScopes.mockResolvedValue(3);
      mockCountFiles.mockResolvedValue(47);
      mockCountChunks.mockResolvedValue(235);

      const result = await service.getDisconnectSummary(USER_ID, CONN_ID);

      expect(result).toEqual({
        connectionId: CONN_ID,
        provider: 'onedrive',
        displayName: 'My Drive',
        scopeCount: 3,
        fileCount: 47,
        chunkCount: 235,
      });
    });

    it('returns zeros when connection has no data', async () => {
      mockFindById.mockResolvedValue(makeRow());
      mockCountScopes.mockResolvedValue(0);
      mockCountFiles.mockResolvedValue(0);
      mockCountChunks.mockResolvedValue(0);

      const result = await service.getDisconnectSummary(USER_ID, CONN_ID);

      expect(result.scopeCount).toBe(0);
      expect(result.fileCount).toBe(0);
      expect(result.chunkCount).toBe(0);
    });

    it('throws ConnectionNotFoundError when connection does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.getDisconnectSummary(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionNotFoundError
      );
    });

    it('throws ConnectionForbiddenError when ownership check fails', async () => {
      mockFindById.mockResolvedValue(makeRow());
      mockTimingSafeCompare.mockReturnValue(false);

      await expect(service.getDisconnectSummary(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionForbiddenError
      );
    });
  });

  // ==========================================================================
  // fullDisconnect
  // ==========================================================================

  describe('fullDisconnect', () => {
    it('happy path: all scopes cleaned, tokens revoked, MSAL deleted, connection deleted', async () => {
      const scope1 = makeScopeRow({ id: 'SCOPE-1' });
      const scope2 = makeScopeRow({ id: 'SCOPE-2' });

      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal());
      mockFindScopes.mockResolvedValue([scope1, scope2]);
      mockRemoveScope.mockResolvedValue({ scopeId: 'SCOPE-1', filesDeleted: 10 });
      mockRevokeTokens.mockResolvedValue(undefined);
      mockDeleteMsalCache.mockResolvedValue(undefined);
      mockDelete.mockResolvedValue(undefined);

      const result = await service.fullDisconnect(USER_ID, CONN_ID);

      expect(result.connectionId).toBe(CONN_ID);
      expect(result.scopesRemoved).toBe(2);
      expect(result.filesDeleted).toBe(20);
      expect(result.searchCleanupFailures).toBe(0);
      expect(result.tokenRevoked).toBe(true);
      expect(result.msalCacheDeleted).toBe(true);

      expect(mockRemoveScope).toHaveBeenCalledTimes(2);
      expect(mockRevokeTokens).toHaveBeenCalledOnce();
      expect(mockDeleteMsalCache).toHaveBeenCalledWith('msal-home-account-123');
      expect(mockDelete).toHaveBeenCalledWith(CONN_ID);
      expect(mockTo).toHaveBeenCalledWith(`user:${USER_ID}`);
    });

    it('throws ConnectionNotFoundError when connection does not exist', async () => {
      mockFindByIdWithMsal.mockResolvedValue(null);

      await expect(service.fullDisconnect(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionNotFoundError
      );
    });

    it('throws ConnectionForbiddenError when ownership check fails', async () => {
      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal());
      mockTimingSafeCompare.mockReturnValue(false);

      await expect(service.fullDisconnect(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionForbiddenError
      );

      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('continues when one scope cleanup fails (partial failure)', async () => {
      const scope1 = makeScopeRow({ id: 'SCOPE-1' });
      const scope2 = makeScopeRow({ id: 'SCOPE-2' });
      const scope3 = makeScopeRow({ id: 'SCOPE-3' });

      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal());
      mockFindScopes.mockResolvedValue([scope1, scope2, scope3]);
      mockRemoveScope
        .mockResolvedValueOnce({ scopeId: 'SCOPE-1', filesDeleted: 5 })
        .mockRejectedValueOnce(new Error('AI Search timeout'))
        .mockResolvedValueOnce({ scopeId: 'SCOPE-3', filesDeleted: 3 });
      mockRevokeTokens.mockResolvedValue(undefined);
      mockDeleteMsalCache.mockResolvedValue(undefined);
      mockDelete.mockResolvedValue(undefined);

      const result = await service.fullDisconnect(USER_ID, CONN_ID);

      expect(result.scopesRemoved).toBe(2);
      expect(result.filesDeleted).toBe(8);
      expect(result.searchCleanupFailures).toBe(1);
      // Connection is still deleted
      expect(mockDelete).toHaveBeenCalledOnce();
    });

    it('handles token revocation failure gracefully', async () => {
      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal());
      mockFindScopes.mockResolvedValue([]);
      mockRevokeTokens.mockRejectedValue(new Error('Token service unavailable'));
      mockDeleteMsalCache.mockResolvedValue(undefined);
      mockDelete.mockResolvedValue(undefined);

      const result = await service.fullDisconnect(USER_ID, CONN_ID);

      expect(result.tokenRevoked).toBe(false);
      // Connection is still deleted
      expect(mockDelete).toHaveBeenCalledOnce();
    });

    it('handles MSAL cache deletion failure gracefully', async () => {
      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal());
      mockFindScopes.mockResolvedValue([]);
      mockRevokeTokens.mockResolvedValue(undefined);
      mockDeleteMsalCache.mockRejectedValue(new Error('Redis unavailable'));
      mockDelete.mockResolvedValue(undefined);

      const result = await service.fullDisconnect(USER_ID, CONN_ID);

      expect(result.msalCacheDeleted).toBe(false);
      expect(mockDelete).toHaveBeenCalledOnce();
    });

    it('skips MSAL deletion when msal_home_account_id is null', async () => {
      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal({ msal_home_account_id: null }));
      mockFindScopes.mockResolvedValue([]);
      mockRevokeTokens.mockResolvedValue(undefined);
      mockDelete.mockResolvedValue(undefined);

      const result = await service.fullDisconnect(USER_ID, CONN_ID);

      expect(result.msalCacheDeleted).toBe(true); // True because nothing to delete
      expect(mockDeleteMsalCache).not.toHaveBeenCalled();
    });

    it('handles connection with no scopes', async () => {
      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal());
      mockFindScopes.mockResolvedValue([]);
      mockRevokeTokens.mockResolvedValue(undefined);
      mockDeleteMsalCache.mockResolvedValue(undefined);
      mockDelete.mockResolvedValue(undefined);

      const result = await service.fullDisconnect(USER_ID, CONN_ID);

      expect(result.scopesRemoved).toBe(0);
      expect(result.filesDeleted).toBe(0);
      expect(mockRemoveScope).not.toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalledOnce();
    });

    it('force-updates syncing scopes to idle before cleanup', async () => {
      const syncingScope = makeScopeRow({ id: 'SCOPE-SYNCING', sync_status: 'syncing' });

      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal());
      mockFindScopes.mockResolvedValue([syncingScope]);
      mockUpdateScope.mockResolvedValue(undefined);
      mockRemoveScope.mockResolvedValue({ scopeId: 'SCOPE-SYNCING', filesDeleted: 3 });
      mockRevokeTokens.mockResolvedValue(undefined);
      mockDeleteMsalCache.mockResolvedValue(undefined);
      mockDelete.mockResolvedValue(undefined);

      await service.fullDisconnect(USER_ID, CONN_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith('SCOPE-SYNCING', { syncStatus: 'idle' });
      expect(mockRemoveScope).toHaveBeenCalledOnce();
    });

    it('does not force-update idle scopes', async () => {
      const idleScope = makeScopeRow({ id: 'SCOPE-IDLE', sync_status: 'idle' });

      mockFindByIdWithMsal.mockResolvedValue(makeRowWithMsal());
      mockFindScopes.mockResolvedValue([idleScope]);
      mockRemoveScope.mockResolvedValue({ scopeId: 'SCOPE-IDLE', filesDeleted: 2 });
      mockRevokeTokens.mockResolvedValue(undefined);
      mockDeleteMsalCache.mockResolvedValue(undefined);
      mockDelete.mockResolvedValue(undefined);

      await service.fullDisconnect(USER_ID, CONN_ID);

      expect(mockUpdateScope).not.toHaveBeenCalled();
    });
  });
});
