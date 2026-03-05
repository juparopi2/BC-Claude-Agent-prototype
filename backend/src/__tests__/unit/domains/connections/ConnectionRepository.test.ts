/**
 * ConnectionRepository Unit Tests (PRD-100)
 *
 * Tests the Prisma-based data access layer for connections and
 * connection_scopes tables.
 *
 * Covers:
 * - findByUser
 * - findById (not found)
 * - create (UPPERCASE ID)
 * - update
 * - delete
 * - countScopesByConnection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockFindMany = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockScopesCount = vi.hoisted(() => vi.fn());
const mockScopesFindMany = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connections: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
    connection_scopes: {
      findMany: mockScopesFindMany,
      count: mockScopesCount,
    },
  },
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
import { ConnectionRepository } from '@/domains/connections/ConnectionRepository';

// ============================================================================
// TEST HELPERS
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const CONN_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const now = new Date('2026-01-01T00:00:00Z');

function makeConnectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_ID,
    user_id: USER_ID,
    provider: 'onedrive',
    status: 'connected',
    display_name: 'My OneDrive',
    last_error: null,
    last_error_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ConnectionRepository', () => {
  let repo: ConnectionRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ConnectionRepository();
  });

  // ==========================================================================
  // findByUser
  // ==========================================================================

  describe('findByUser', () => {
    it('returns connections for the user with UPPERCASE IDs', async () => {
      const rawRow = makeConnectionRow({ id: 'conn-lowercase-id', user_id: 'user-lowercase-id' });
      mockFindMany.mockResolvedValue([rawRow]);

      const result = await repo.findByUser(USER_ID);

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('CONN-LOWERCASE-ID');
      expect(result[0]!.user_id).toBe('USER-LOWERCASE-ID');
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: USER_ID } })
      );
    });

    it('returns empty array when user has no connections', async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await repo.findByUser(USER_ID);

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // findById
  // ==========================================================================

  describe('findById', () => {
    it('returns null when connection is not found', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await repo.findById(USER_ID, CONN_ID);

      expect(result).toBeNull();
    });

    it('returns the row when found', async () => {
      mockFindFirst.mockResolvedValue(makeConnectionRow());

      const result = await repo.findById(USER_ID, CONN_ID);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(CONN_ID);
    });
  });

  // ==========================================================================
  // create
  // ==========================================================================

  describe('create', () => {
    it('creates a connection and returns an UPPERCASE UUID', async () => {
      mockCreate.mockResolvedValue({});

      const id = await repo.create(USER_ID, { provider: 'onedrive' });

      // UUID format + must be uppercase
      expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
      expect(mockCreate).toHaveBeenCalledOnce();
      const call = mockCreate.mock.calls[0]?.[0] as {
        data: { id: string; user_id: string; provider: string; status: string };
      };
      expect(call.data.id).toBe(id);
      expect(call.data.user_id).toBe(USER_ID);
      expect(call.data.provider).toBe('onedrive');
      expect(call.data.status).toBe('disconnected');
    });
  });

  // ==========================================================================
  // update
  // ==========================================================================

  describe('update', () => {
    it('calls prisma.connections.update with the correct connection ID', async () => {
      mockUpdate.mockResolvedValue({});

      await repo.update(CONN_ID, { status: 'expired', displayName: 'Renamed' });

      expect(mockUpdate).toHaveBeenCalledOnce();
      const call = mockUpdate.mock.calls[0]?.[0] as {
        where: { id: string };
        data: { status: string; display_name: string };
      };
      expect(call.where.id).toBe(CONN_ID);
      expect(call.data.status).toBe('expired');
      expect(call.data.display_name).toBe('Renamed');
    });
  });

  // ==========================================================================
  // delete
  // ==========================================================================

  describe('delete', () => {
    it('calls prisma.connections.delete with the correct connection ID', async () => {
      mockDelete.mockResolvedValue({});

      await repo.delete(CONN_ID);

      expect(mockDelete).toHaveBeenCalledOnce();
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: CONN_ID } });
    });
  });

  // ==========================================================================
  // countScopesByConnection
  // ==========================================================================

  describe('countScopesByConnection', () => {
    it('returns the scope count for the given connection', async () => {
      mockScopesCount.mockResolvedValue(3);

      const count = await repo.countScopesByConnection(CONN_ID);

      expect(count).toBe(3);
      expect(mockScopesCount).toHaveBeenCalledWith({
        where: { connection_id: CONN_ID },
      });
    });

    it('returns 0 when there are no scopes', async () => {
      mockScopesCount.mockResolvedValue(0);

      const count = await repo.countScopesByConnection(CONN_ID);

      expect(count).toBe(0);
    });
  });
});
