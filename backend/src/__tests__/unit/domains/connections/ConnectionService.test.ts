/**
 * ConnectionService Unit Tests (PRD-100)
 *
 * Tests the business logic layer for connection management.
 * Covers ownership validation, CRUD delegation, and domain error throwing.
 *
 * Covers:
 * - listConnections
 * - getConnection (found, not found, forbidden)
 * - createConnection
 * - deleteConnection
 * - listScopes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockFindByUser = vi.hoisted(() => vi.fn());
const mockFindById = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockCountScopes = vi.hoisted(() => vi.fn());
const mockCountFiles = vi.hoisted(() => vi.fn());
const mockFindScopes = vi.hoisted(() => vi.fn());
const mockTimingSafeCompare = vi.hoisted(() => vi.fn());

vi.mock('@/domains/connections/ConnectionRepository', () => ({
  getConnectionRepository: vi.fn(() => ({
    findByUser: mockFindByUser,
    findById: mockFindById,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
    countScopesByConnection: mockCountScopes,
    countFilesByConnection: mockCountFiles,
    findScopesByConnection: mockFindScopes,
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
    ...overrides,
  };
}

function makeScopeRow() {
  return {
    id: 'SCOPE-AAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    connection_id: CONN_ID,
    scope_type: 'drive',
    scope_resource_id: 'drive-123',
    scope_display_name: 'Documents',
    sync_status: 'idle',
    last_sync_at: null,
    last_sync_error: null,
    item_count: 0,
    created_at: now,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ConnectionService', () => {
  let service: ConnectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: ownership check passes
    mockTimingSafeCompare.mockReturnValue(true);
    service = new ConnectionService();
  });

  // ==========================================================================
  // listConnections
  // ==========================================================================

  describe('listConnections', () => {
    it('returns ConnectionListResponse with correct shape', async () => {
      mockFindByUser.mockResolvedValue([makeRow()]);
      mockCountScopes.mockResolvedValue(2);
      mockCountFiles.mockResolvedValue(10);

      const result = await service.listConnections(USER_ID);

      expect(result.count).toBe(1);
      expect(result.connections).toHaveLength(1);
      const summary = result.connections[0]!;
      expect(summary.id).toBe(CONN_ID);
      expect(summary.provider).toBe('onedrive');
      expect(summary.status).toBe('connected');
      expect(summary.scopeCount).toBe(2);
      expect(summary.createdAt).toBe(now.toISOString());
      expect(summary.updatedAt).toBe(now.toISOString());
    });

    it('returns empty list when user has no connections', async () => {
      mockFindByUser.mockResolvedValue([]);

      const result = await service.listConnections(USER_ID);

      expect(result.connections).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  // ==========================================================================
  // getConnection
  // ==========================================================================

  describe('getConnection', () => {
    it('returns ConnectionSummary when found and owned', async () => {
      mockFindById.mockResolvedValue(makeRow());
      mockCountScopes.mockResolvedValue(1);
      mockCountFiles.mockResolvedValue(5);

      const result = await service.getConnection(USER_ID, CONN_ID);

      expect(result.id).toBe(CONN_ID);
      expect(result.scopeCount).toBe(1);
    });

    it('throws ConnectionNotFoundError when connection does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.getConnection(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionNotFoundError
      );
    });

    it('throws ConnectionForbiddenError when ownership check fails', async () => {
      mockFindById.mockResolvedValue(makeRow());
      mockTimingSafeCompare.mockReturnValue(false);

      await expect(service.getConnection(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionForbiddenError
      );
    });
  });

  // ==========================================================================
  // createConnection
  // ==========================================================================

  describe('createConnection', () => {
    it('creates a connection and returns its summary', async () => {
      mockCreate.mockResolvedValue(CONN_ID);
      mockFindById.mockResolvedValue(makeRow());

      const result = await service.createConnection(USER_ID, {
        provider: 'onedrive',
        displayName: 'My Drive',
      });

      expect(result.id).toBe(CONN_ID);
      expect(result.provider).toBe('onedrive');
      expect(result.scopeCount).toBe(0);
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // deleteConnection
  // ==========================================================================

  describe('deleteConnection', () => {
    it('deletes connection when owned by the user', async () => {
      mockFindById.mockResolvedValue(makeRow());
      mockDelete.mockResolvedValue(undefined);

      await expect(service.deleteConnection(USER_ID, CONN_ID)).resolves.not.toThrow();

      expect(mockDelete).toHaveBeenCalledOnce();
    });

    it('throws ConnectionNotFoundError when connection does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.deleteConnection(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionNotFoundError
      );
    });

    it('throws ConnectionForbiddenError when ownership check fails', async () => {
      mockFindById.mockResolvedValue(makeRow());
      mockTimingSafeCompare.mockReturnValue(false);

      await expect(service.deleteConnection(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionForbiddenError
      );

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // listScopes
  // ==========================================================================

  describe('listScopes', () => {
    it('returns scope details for a connection', async () => {
      mockFindById.mockResolvedValue(makeRow());
      mockFindScopes.mockResolvedValue([makeScopeRow()]);

      const result = await service.listScopes(USER_ID, CONN_ID);

      expect(result).toHaveLength(1);
      const scope = result[0]!;
      expect(scope.connectionId).toBe(CONN_ID);
      expect(scope.scopeType).toBe('drive');
      expect(scope.syncStatus).toBe('idle');
      expect(scope.itemCount).toBe(0);
      expect(scope.createdAt).toBe(now.toISOString());
    });

    it('throws ConnectionNotFoundError when connection not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.listScopes(USER_ID, CONN_ID)).rejects.toThrow(
        ConnectionNotFoundError
      );
    });
  });
});
