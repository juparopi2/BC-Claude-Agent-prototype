/**
 * InitialSyncService Unit Tests (PRD-101)
 *
 * Tests the fire-and-forget initial sync orchestration:
 * - Full delta query enumeration with pagination
 * - File record creation and processing queue enqueue
 * - deltaLink persistence as last_sync_cursor
 * - Scope status transitions (syncing → idle / error)
 * - Skipping folders and deleted items
 * - Individual file failure resilience
 * - Error handling when delta query itself fails
 *
 * NOTE: Most tests call _runSync() directly (via type cast) to properly await
 * the async chain and avoid inter-test leakage. One test verifies the public
 * syncScope() fire-and-forget behavior separately.
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

// Mock Prisma — only the tables used by InitialSyncService
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockFilesCreate = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connections: {
      findUnique: mockFindUnique,
    },
    files: {
      create: mockFilesCreate,
    },
  },
}));

// Mock OneDrive service
const mockExecuteDeltaQuery = vi.hoisted(() => vi.fn());

vi.mock('@/services/connectors/onedrive', () => ({
  getOneDriveService: vi.fn(() => ({
    executeDeltaQuery: mockExecuteDeltaQuery,
  })),
}));

// Mock connections domain
const mockUpdateScope = vi.hoisted(() => vi.fn());

vi.mock('@/domains/connections', () => ({
  getConnectionRepository: vi.fn(() => ({
    updateScope: mockUpdateScope,
  })),
}));

// Mock message queue
const mockAddFileProcessingFlow = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: mockAddFileProcessingFlow,
  })),
}));

// Mock WebSocket — disabled for all tests (isSocketServiceInitialized returns false)
vi.mock('@/services/websocket/SocketService', () => ({
  getSocketIO: vi.fn(),
  isSocketServiceInitialized: vi.fn(() => false),
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import {
  InitialSyncService,
  __resetInitialSyncService,
} from '@/services/sync/InitialSyncService';

// ============================================================================
// Test Constants
// ============================================================================

const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const SCOPE_ID = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';
const DRIVE_ID = 'DRIV-99999999-8888-7777-6666-555544443333';
const DELTA_LINK = 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=xyz';

// ============================================================================
// Helper: call the private _runSync directly so we can await completion
// ============================================================================

/**
 * Calls _runSync directly to properly await the async chain and avoid
 * fire-and-forget inter-test leakage. _runSync has its own try/catch so
 * this never rejects — error tests can assert on mockUpdateScope calls.
 */
function runSync(service: InitialSyncService, connectionId: string, scopeId: string, userId: string): Promise<void> {
  return (service as unknown as { _runSync(c: string, s: string, u: string): Promise<void> })._runSync(connectionId, scopeId, userId);
}

// ============================================================================
// Delta Result Helpers
// ============================================================================

/** A minimal file change entry */
function makeFileChange(
  id: string,
  name: string,
  overrides?: Partial<{ mimeType: string; sizeBytes: number; eTag: string | null; webUrl: string }>
) {
  return {
    item: {
      id,
      name,
      isFolder: false,
      mimeType: overrides?.mimeType ?? 'application/pdf',
      sizeBytes: overrides?.sizeBytes ?? 1024,
      lastModifiedAt: '2024-01-01T00:00:00Z',
      webUrl: overrides?.webUrl ?? `https://example.com/${name}`,
      eTag: overrides?.eTag !== undefined ? overrides.eTag : `etag-${id}`,
      parentId: null,
      parentPath: null,
    },
    changeType: 'created' as const,
  };
}

/** A minimal folder change entry */
function makeFolderChange(id: string, name: string) {
  return {
    item: {
      id,
      name,
      isFolder: true,
      mimeType: null,
      sizeBytes: 0,
      lastModifiedAt: '2024-01-01T00:00:00Z',
      webUrl: '',
      eTag: null,
      parentId: null,
      parentPath: null,
    },
    changeType: 'created' as const,
  };
}

/** A deleted item change entry */
function makeDeletedChange(id: string) {
  return {
    item: {
      id,
      name: 'deleted-file.pdf',
      isFolder: false,
      mimeType: 'application/pdf',
      sizeBytes: 0,
      lastModifiedAt: '2024-01-01T00:00:00Z',
      webUrl: '',
      eTag: null,
      parentId: null,
      parentPath: null,
    },
    changeType: 'deleted' as const,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('InitialSyncService', () => {
  let service: InitialSyncService;

  beforeEach(() => {
    // Reset hoisted mocks fully (clearAllMocks doesn't clear mockResolvedValueOnce queues)
    mockFindUnique.mockReset();
    mockFilesCreate.mockReset();
    mockExecuteDeltaQuery.mockReset();
    mockUpdateScope.mockReset();
    mockAddFileProcessingFlow.mockReset();

    __resetInitialSyncService();
    service = new InitialSyncService();

    // Default: connection found with a drive ID
    mockFindUnique.mockResolvedValue({
      microsoft_drive_id: DRIVE_ID,
    });

    // Default: all writes succeed
    mockFilesCreate.mockResolvedValue({});
    mockAddFileProcessingFlow.mockResolvedValue(undefined);
    mockUpdateScope.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // syncScope — fire-and-forget behavior
  // ==========================================================================

  describe('syncScope() — fire-and-forget', () => {
    it('returns void (does not return a Promise)', () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      const result = service.syncScope(CONNECTION_ID, SCOPE_ID, USER_ID);
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // syncScope — successful sync (single page)
  // ==========================================================================

  describe('syncScope() — successful sync (single page)', () => {
    it('creates file records for each file (not folders) from delta query', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          makeFileChange('file-1', 'doc.pdf'),
          makeFolderChange('folder-1', 'Docs'),
          makeFileChange('file-2', 'report.xlsx', { mimeType: 'application/vnd.ms-excel' }),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(2);

      // Verify first file record fields
      const firstCall = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(firstCall.data).toMatchObject({
        name: 'doc.pdf',
        user_id: USER_ID,
        mime_type: 'application/pdf',
        is_folder: false,
        external_id: 'file-1',
        external_drive_id: DRIVE_ID,
        connection_id: CONNECTION_ID,
        connection_scope_id: SCOPE_ID,
        pipeline_status: 'queued',
        source_type: expect.any(String),
      });

      // ID must be UPPERCASE UUID
      expect(firstCall.data.id as string).toMatch(/^[A-F0-9-]+$/);

      // Second file
      const secondCall = mockFilesCreate.mock.calls[1]![0] as { data: Record<string, unknown> };
      expect(secondCall.data).toMatchObject({
        name: 'report.xlsx',
        external_id: 'file-2',
        mime_type: 'application/vnd.ms-excel',
      });
    });

    it('enqueues files for processing via messageQueue.addFileProcessingFlow', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(1);

      const flowCall = mockAddFileProcessingFlow.mock.calls[0]![0] as Record<string, unknown>;
      expect(flowCall).toMatchObject({
        userId: USER_ID,
        batchId: SCOPE_ID,
        mimeType: 'application/pdf',
        fileName: 'doc.pdf',
        fileId: expect.stringMatching(/^[A-F0-9-]+$/),
      });
    });

    it('saves deltaLink as last_sync_cursor on completion', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          lastSyncCursor: DELTA_LINK,
        })
      );
    });

    it('updates scope to idle with item count on completion', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          makeFileChange('file-1', 'doc.pdf'),
          makeFileChange('file-2', 'report.xlsx'),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          syncStatus: 'idle',
          itemCount: 2,
          lastSyncError: null,
        })
      );
    });

    it('marks scope as syncing first, then idle on completion', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // First call: syncing
      expect(mockUpdateScope).toHaveBeenNthCalledWith(
        1,
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'syncing' })
      );
      // Second call: idle
      expect(mockUpdateScope).toHaveBeenNthCalledWith(
        2,
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle' })
      );
    });

    it('skips deleted items', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          makeDeletedChange('deleted-1'),
          makeFileChange('file-1', 'keep.pdf'),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Only the non-deleted file should be created
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      const call = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(call.data.name).toBe('keep.pdf');
    });

    it('skips folders', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          makeFolderChange('folder-1', 'Documents'),
          makeFolderChange('folder-2', 'Images'),
          makeFileChange('file-1', 'readme.txt', { mimeType: 'text/plain' }),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle', itemCount: 1 })
      );
    });

    it('handles empty delta result (no files) gracefully', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).not.toHaveBeenCalled();
      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle', itemCount: 0 })
      );
    });
  });

  // ==========================================================================
  // syncScope — multiple pages
  // ==========================================================================

  describe('syncScope() — multiple pages', () => {
    it('follows nextPageLink pages and collects all changes', async () => {
      const nextPageLink = 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=page2';

      // First page returns nextPageLink
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'page1-doc.pdf')],
        deltaLink: null,
        hasMore: true,
        nextPageLink,
      });

      // Second page returns deltaLink (end of pages)
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-2', 'page2-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // executeDeltaQuery called twice: first without nextPageLink, second with it
      expect(mockExecuteDeltaQuery).toHaveBeenCalledTimes(2);
      expect(mockExecuteDeltaQuery).toHaveBeenNthCalledWith(1, CONNECTION_ID);
      expect(mockExecuteDeltaQuery).toHaveBeenNthCalledWith(2, CONNECTION_ID, nextPageLink);

      // Two files created — one from each page
      expect(mockFilesCreate).toHaveBeenCalledTimes(2);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle', itemCount: 2 })
      );
    });

    it('persists the final deltaLink from the last page', async () => {
      const secondPageLink = 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=page3';
      const finalDeltaLink = 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=final';

      mockExecuteDeltaQuery
        .mockResolvedValueOnce({
          changes: [],
          deltaLink: null,
          hasMore: true,
          nextPageLink: secondPageLink,
        })
        .mockResolvedValueOnce({
          changes: [makeFileChange('file-1', 'doc.pdf')],
          deltaLink: finalDeltaLink,
          hasMore: false,
          nextPageLink: null,
        });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ lastSyncCursor: finalDeltaLink })
      );
    });

    it('handles three pages correctly', async () => {
      const page2Link = 'https://graph.microsoft.com/v1.0/...delta?token=p2';
      const page3Link = 'https://graph.microsoft.com/v1.0/...delta?token=p3';

      mockExecuteDeltaQuery
        .mockResolvedValueOnce({
          changes: [makeFileChange('file-1', 'a.pdf')],
          deltaLink: null,
          hasMore: true,
          nextPageLink: page2Link,
        })
        .mockResolvedValueOnce({
          changes: [makeFileChange('file-2', 'b.pdf')],
          deltaLink: null,
          hasMore: true,
          nextPageLink: page3Link,
        })
        .mockResolvedValueOnce({
          changes: [makeFileChange('file-3', 'c.pdf')],
          deltaLink: DELTA_LINK,
          hasMore: false,
          nextPageLink: null,
        });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteDeltaQuery).toHaveBeenCalledTimes(3);
      expect(mockFilesCreate).toHaveBeenCalledTimes(3);
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle', itemCount: 3 })
      );
    });
  });

  // ==========================================================================
  // syncScope — error handling
  // ==========================================================================

  describe('syncScope() — error handling', () => {
    it('updates scope to error status when delta query fails', async () => {
      mockExecuteDeltaQuery.mockRejectedValueOnce(new Error('Graph API unavailable'));

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          syncStatus: 'error',
          lastSyncError: 'Graph API unavailable',
        })
      );

      // No files should have been created
      expect(mockFilesCreate).not.toHaveBeenCalled();
    });

    it('updates scope to error when connection is not found', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          syncStatus: 'error',
          lastSyncError: expect.stringContaining(CONNECTION_ID),
        })
      );
    });

    it('individual file failures are logged but do not stop the sync', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          makeFileChange('file-1', 'good.pdf'),
          makeFileChange('file-2', 'bad.pdf'),
          makeFileChange('file-3', 'also-good.pdf'),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      // Make the second file creation fail
      mockFilesCreate
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DB constraint violation'))
        .mockResolvedValueOnce({});

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Sync should complete (idle), not error, despite one file failing
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle' })
      );

      // All three create attempts were made
      expect(mockFilesCreate).toHaveBeenCalledTimes(3);

      // The final scope update should not be in error status
      const scopeUpdateCalls = mockUpdateScope.mock.calls as Array<[string, Record<string, unknown>]>;
      const finalUpdate = scopeUpdateCalls[scopeUpdateCalls.length - 1]!;
      expect(finalUpdate[1]).toMatchObject({ syncStatus: 'idle' });
    });

    it('still enqueues successfully created files when some fail', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          makeFileChange('file-1', 'good.pdf'),
          makeFileChange('file-2', 'bad.pdf'),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockFilesCreate
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Constraint error'));

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle' })
      );

      // Only one successful file should have been enqueued
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // ID format verification
  // ==========================================================================

  describe('Generated file IDs', () => {
    it('generates UPPERCASE UUIDs for file IDs', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);

      const call = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      const fileId = call.data.id as string;

      // Must be uppercase UUID (no lowercase hex)
      expect(fileId).toMatch(/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/);
    });

    it('uses the same fileId in both prisma.files.create and addFileProcessingFlow', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(1);

      const createCall = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      const flowCall = mockAddFileProcessingFlow.mock.calls[0]![0] as Record<string, unknown>;

      expect(flowCall.fileId).toBe(createCall.data.id);
    });
  });

  // ==========================================================================
  // File record field correctness
  // ==========================================================================

  describe('File record field mapping', () => {
    it('maps all ExternalFileItem fields correctly to the files table', async () => {
      const item = {
        id: 'ext-file-42',
        name: 'annual-report.pdf',
        isFolder: false,
        mimeType: 'application/pdf',
        sizeBytes: 204800,
        lastModifiedAt: '2024-06-15T10:30:00Z',
        webUrl: 'https://onedrive.live.com/view/annual-report.pdf',
        eTag: '"abc123etag"',
        parentId: null,
        parentPath: null,
      };

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [{ item, changeType: 'created' as const }],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);

      const call = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(call.data).toMatchObject({
        user_id: USER_ID,
        name: 'annual-report.pdf',
        mime_type: 'application/pdf',
        is_folder: false,
        external_id: 'ext-file-42',
        external_drive_id: DRIVE_ID,
        connection_id: CONNECTION_ID,
        connection_scope_id: SCOPE_ID,
        external_url: 'https://onedrive.live.com/view/annual-report.pdf',
        external_modified_at: new Date('2024-06-15T10:30:00Z'),
        content_hash_external: '"abc123etag"',
        pipeline_status: 'queued',
        processing_retry_count: 0,
        embedding_retry_count: 0,
        is_favorite: false,
        blob_path: null,
      });

      // size_bytes should be a BigInt
      expect(typeof call.data.size_bytes).toBe('bigint');
      expect(call.data.size_bytes).toBe(BigInt(204800));
    });

    it('uses application/octet-stream as fallback when mimeType is null', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          {
            item: {
              id: 'file-no-mime',
              name: 'binary-blob',
              isFolder: false,
              mimeType: null,
              sizeBytes: 512,
              lastModifiedAt: '2024-01-01T00:00:00Z',
              webUrl: 'https://example.com/binary-blob',
              eTag: null,
              parentId: null,
              parentPath: null,
            },
            changeType: 'created' as const,
          },
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);

      const call = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(call.data.mime_type).toBe('application/octet-stream');
    });

    it('sets external_url to null when webUrl is empty string', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          {
            item: {
              id: 'file-no-url',
              name: 'no-url-file.pdf',
              isFolder: false,
              mimeType: 'application/pdf',
              sizeBytes: 100,
              lastModifiedAt: '2024-01-01T00:00:00Z',
              webUrl: '',
              eTag: null,
              parentId: null,
              parentPath: null,
            },
            changeType: 'created' as const,
          },
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);

      const call = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(call.data.external_url).toBeNull();
    });
  });
});
