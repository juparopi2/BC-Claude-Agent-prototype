/**
 * SearchIndexComparator Unit Tests (PRD-304)
 *
 * Verifies that the comparator:
 *   1. Excludes folders (is_folder=false) from the DB query
 *   2. Correctly identifies files missing from the search index
 *   3. Correctly identifies orphaned documents in the search index
 *   4. Detects drift in both directions simultaneously
 *   5. Handles an empty DB result set (no ready files)
 *   6. Normalises all IDs to UPPERCASE
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

const mockFilesFindMany = vi.hoisted(() => vi.fn());
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: { files: { findMany: mockFilesFindMany } },
}));

const mockGetUniqueFileIds = vi.hoisted(() => vi.fn());
vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => ({
      getUniqueFileIds: mockGetUniqueFileIds,
    })),
  },
}));

// ============================================================================
// Subject under test (imported AFTER mocks are registered)
// ============================================================================

import { SearchIndexComparator } from '@/services/sync/health/detectors/SearchIndexComparator';

// ============================================================================
// Test constants
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-1111-2222-3333-444455556666';
const FILE_ID_A = 'FILE-AAAAAAAA-1111-2222-3333-444455556666';
const FILE_ID_B = 'FILE-BBBBBBBB-1111-2222-3333-444455556666';
const FILE_ID_C = 'FILE-CCCCCCCC-1111-2222-3333-444455556666';

// ============================================================================
// Tests
// ============================================================================

describe('SearchIndexComparator', () => {
  let comparator: SearchIndexComparator;

  beforeEach(() => {
    // Reset only the data mocks so that mockResolvedValueOnce queues from the
    // previous test do not bleed into the next. We avoid vi.resetAllMocks()
    // because that would also wipe the return value of createChildLogger,
    // which is captured in the class property initializer.
    mockFilesFindMany.mockReset();
    mockGetUniqueFileIds.mockReset();
    comparator = new SearchIndexComparator();
  });

  // --------------------------------------------------------------------------
  // 1. Folder exclusion
  // --------------------------------------------------------------------------

  describe('DB query — folder exclusion', () => {
    it('passes is_folder: false in the where clause to exclude folders', async () => {
      // DB returns two files on first call, empty array on second (end of pagination)
      mockFilesFindMany
        .mockResolvedValueOnce([{ id: FILE_ID_A }, { id: FILE_ID_B }])
        .mockResolvedValueOnce([]);
      mockGetUniqueFileIds.mockResolvedValueOnce([FILE_ID_A, FILE_ID_B]);

      await comparator.compare(USER_ID);

      expect(mockFilesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_folder: false }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. Missing from search
  // --------------------------------------------------------------------------

  describe('missingFromSearch', () => {
    it('returns files that are in DB but absent from the search index', async () => {
      // DB: [A, B] — Search: [A]  →  missing = [B]
      mockFilesFindMany
        .mockResolvedValueOnce([{ id: FILE_ID_A }, { id: FILE_ID_B }])
        .mockResolvedValueOnce([]);
      mockGetUniqueFileIds.mockResolvedValueOnce([FILE_ID_A]);

      const result = await comparator.compare(USER_ID);

      expect(result.missingFromSearch).toEqual([FILE_ID_B]);
      expect(result.orphanedInSearch).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Orphaned in search
  // --------------------------------------------------------------------------

  describe('orphanedInSearch', () => {
    it('returns documents that exist in the search index but have no matching DB row', async () => {
      // DB: [A] — Search: [A, C]  →  orphaned = [C]
      mockFilesFindMany
        .mockResolvedValueOnce([{ id: FILE_ID_A }])
        .mockResolvedValueOnce([]);
      mockGetUniqueFileIds.mockResolvedValueOnce([FILE_ID_A, FILE_ID_C]);

      const result = await comparator.compare(USER_ID);

      expect(result.orphanedInSearch).toEqual([FILE_ID_C]);
      expect(result.missingFromSearch).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Both directions simultaneously
  // --------------------------------------------------------------------------

  describe('symmetric difference', () => {
    it('detects drift in both directions at the same time', async () => {
      // DB: [A, B] — Search: [A, C]  →  missing = [B], orphaned = [C]
      mockFilesFindMany
        .mockResolvedValueOnce([{ id: FILE_ID_A }, { id: FILE_ID_B }])
        .mockResolvedValueOnce([]);
      mockGetUniqueFileIds.mockResolvedValueOnce([FILE_ID_A, FILE_ID_C]);

      const result = await comparator.compare(USER_ID);

      expect(result.missingFromSearch).toEqual([FILE_ID_B]);
      expect(result.orphanedInSearch).toEqual([FILE_ID_C]);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Empty DB
  // --------------------------------------------------------------------------

  describe('empty DB', () => {
    it('returns empty missingFromSearch and all search IDs as orphaned when DB has no ready files', async () => {
      // DB: [] — Search: [A, C]  →  missing = [], orphaned = [A, C]
      mockFilesFindMany.mockResolvedValueOnce([]);
      mockGetUniqueFileIds.mockResolvedValueOnce([FILE_ID_A, FILE_ID_C]);

      const result = await comparator.compare(USER_ID);

      expect(result.missingFromSearch).toEqual([]);
      expect(result.orphanedInSearch).toEqual(expect.arrayContaining([FILE_ID_A, FILE_ID_C]));
      expect(result.orphanedInSearch).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // 6. ID normalisation — UPPERCASE
  // --------------------------------------------------------------------------

  describe('ID normalisation', () => {
    it('uppercases IDs returned from both DB and the search index', async () => {
      const lowerA = FILE_ID_A.toLowerCase();
      const lowerB = FILE_ID_B.toLowerCase();

      // DB returns lowercase IDs; search index also returns lowercase
      mockFilesFindMany
        .mockResolvedValueOnce([{ id: lowerA }, { id: lowerB }])
        .mockResolvedValueOnce([]);
      mockGetUniqueFileIds.mockResolvedValueOnce([lowerA, lowerB]);

      const result = await comparator.compare(USER_ID);

      // Sets should contain UPPERCASE IDs
      expect(result.dbFileIds.has(FILE_ID_A)).toBe(true);
      expect(result.dbFileIds.has(FILE_ID_B)).toBe(true);
      expect(result.searchFileIds.has(FILE_ID_A)).toBe(true);
      expect(result.searchFileIds.has(FILE_ID_B)).toBe(true);

      // No drift because both sides have the same IDs (after normalisation)
      expect(result.missingFromSearch).toEqual([]);
      expect(result.orphanedInSearch).toEqual([]);
    });
  });
});
