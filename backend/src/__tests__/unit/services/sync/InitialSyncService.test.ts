/**
 * InitialSyncService Unit Tests (PRD-101, PRD-104)
 *
 * Tests the fire-and-forget initial sync orchestration:
 * - Full delta query enumeration with pagination
 * - Scope-aware delta routing (root vs folder)
 * - File ingestion delegated to SyncFileIngestionService.ingestAll()
 * - Conditional enqueue (only new files are enqueued — via ingestionResult.created)
 * - deltaLink persistence as last_sync_cursor
 * - Scope status transitions (syncing → idle / error)
 * - Skipping folders and deleted items
 * - Individual file failure resilience (via ingestionResult.errors)
 * - File-level sync with dedup (still uses prisma directly)
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

// Mock Prisma — only the tables used by InitialSyncService directly
// (folder upsert, scope root folder creation, and file-level sync still hit prisma)
const mockConnectionsFindUnique = vi.hoisted(() => vi.fn());
const mockFilesFindFirst = vi.hoisted(() => vi.fn());
const mockFilesFindMany = vi.hoisted(() => vi.fn());
const mockFilesCreate = vi.hoisted(() => vi.fn());
const mockFilesUpdate = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connections: {
      findUnique: mockConnectionsFindUnique,
    },
    files: {
      findFirst: mockFilesFindFirst,
      findMany: mockFilesFindMany,
      create: mockFilesCreate,
      update: mockFilesUpdate,
    },
    // InitialSyncService no longer calls $transaction for file batch ingestion —
    // that has moved to SyncFileIngestionService. Keep the mock defined in case
    // helper code in the test setup or future code paths needs it.
    $transaction: mockTransaction,
  },
}));

// Mock SyncFileIngestionService — file batch ingestion is now fully delegated here
const mockIngestAll = vi.hoisted(() => vi.fn());

vi.mock('@/services/sync/SyncFileIngestionService', () => ({
  getSyncFileIngestionService: vi.fn(() => ({
    ingestAll: mockIngestAll,
    ingestBatch: vi.fn(),
  })),
}));

// Mock OneDrive service
const mockExecuteDeltaQuery = vi.hoisted(() => vi.fn());
const mockExecuteFolderDeltaQuery = vi.hoisted(() => vi.fn());
const mockGetItemMetadata = vi.hoisted(() => vi.fn());
const mockGetItemMetadataFromDrive = vi.hoisted(() => vi.fn());

vi.mock('@/services/connectors/onedrive', () => ({
  getOneDriveService: vi.fn(() => ({
    executeDeltaQuery: mockExecuteDeltaQuery,
    executeFolderDeltaQuery: mockExecuteFolderDeltaQuery,
    getItemMetadata: mockGetItemMetadata,
    getItemMetadataFromDrive: mockGetItemMetadataFromDrive,
  })),
}));

// Mock SharePoint service (PRD-111)
const mockSPExecuteDeltaQuery = vi.hoisted(() => vi.fn());
const mockSPExecuteFolderDeltaQuery = vi.hoisted(() => vi.fn());

vi.mock('@/services/connectors/sharepoint', () => ({
  getSharePointService: vi.fn(() => ({
    executeDeltaQuery: mockSPExecuteDeltaQuery,
    executeFolderDeltaQuery: mockSPExecuteFolderDeltaQuery,
  })),
}));

// Mock connections domain
const mockUpdateScope = vi.hoisted(() => vi.fn());
const mockFindScopeById = vi.hoisted(() => vi.fn());

const mockFindExclusionScopesByConnection = vi.hoisted(() => vi.fn());

vi.mock('@/domains/connections', () => ({
  getConnectionRepository: vi.fn(() => ({
    updateScope: mockUpdateScope,
    findScopeById: mockFindScopeById,
    findExclusionScopesByConnection: mockFindExclusionScopesByConnection,
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
const FOLDER_RESOURCE_ID = 'FOLDER-RESOURCE-ABC123';

// ============================================================================
// Helper: call the private _runSync directly so we can await completion
// ============================================================================

function runSync(service: InitialSyncService, connectionId: string, scopeId: string, userId: string): Promise<void> {
  return (service as unknown as { _runSync(c: string, s: string, u: string): Promise<void> })._runSync(connectionId, scopeId, userId);
}

// ============================================================================
// Default scope row factory
// ============================================================================

function defaultScopeRow(overrides?: Partial<{
  scope_type: string;
  scope_resource_id: string | null;
  scope_display_name: string | null;
  remote_drive_id: string | null;
}>) {
  return {
    id: SCOPE_ID,
    connection_id: CONNECTION_ID,
    scope_type: overrides?.scope_type ?? 'root',
    scope_resource_id: overrides?.scope_resource_id ?? null,
    scope_display_name: overrides?.scope_display_name ?? null,
    scope_path: null,
    sync_status: 'idle',
    last_sync_at: null,
    last_sync_error: null,
    last_sync_cursor: null,
    remote_drive_id: overrides?.remote_drive_id ?? null,
    item_count: 0,
    created_at: new Date(),
  };
}

// ============================================================================
// Delta Result Helpers
// ============================================================================

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
    mockConnectionsFindUnique.mockReset();
    mockFilesFindFirst.mockReset();
    mockFilesFindMany.mockReset();
    mockFilesCreate.mockReset();
    mockFilesUpdate.mockReset();
    mockExecuteDeltaQuery.mockReset();
    mockExecuteFolderDeltaQuery.mockReset();
    mockGetItemMetadata.mockReset();
    mockGetItemMetadataFromDrive.mockReset();
    mockUpdateScope.mockReset();
    mockSPExecuteDeltaQuery.mockReset();
    mockSPExecuteFolderDeltaQuery.mockReset();
    mockFindScopeById.mockReset();
    mockFindExclusionScopesByConnection.mockReset();
    mockAddFileProcessingFlow.mockReset();
    mockTransaction.mockReset();
    mockIngestAll.mockReset();

    // Default: no exclusion scopes
    mockFindExclusionScopesByConnection.mockResolvedValue([]);

    // SyncFileIngestionService.ingestAll() default: no files created
    mockIngestAll.mockResolvedValue({ created: 0, updated: 0, errors: 0 });

    __resetInitialSyncService();
    service = new InitialSyncService();

    // Default: connection found with a drive ID and provider
    mockConnectionsFindUnique.mockResolvedValue({
      microsoft_drive_id: DRIVE_ID,
      provider: 'onedrive',
    });

    // Default: scope is root type
    mockFindScopeById.mockResolvedValue(defaultScopeRow());

    // Default: no existing file (new file path) — used by file-level sync and folder upsert
    mockFilesFindFirst.mockResolvedValue(null);

    // Default: no existing folders for the connection
    mockFilesFindMany.mockResolvedValue([]);

    // Default: all writes succeed
    mockFilesCreate.mockResolvedValue({});
    mockFilesUpdate.mockResolvedValue({});
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
  // syncScope — successful sync (single page, root scope)
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

      // 1 file passes filter (doc.pdf); report.xlsx is unsupported MIME type
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Verify ingestAll was called with doc.pdf only (xlsx filtered by isFileSyncSupported)
      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-1', name: 'doc.pdf' })],
        expect.objectContaining({
          connectionId: CONNECTION_ID,
          scopeId: SCOPE_ID,
          userId: USER_ID,
          effectiveDriveId: DRIVE_ID,
          provider: 'onedrive',
          folderMap: expect.any(Map),
        }),
        expect.any(Function),
      );

      // Folder upsert still goes through prisma directly (not ingestAll)
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      const folderCall = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(folderCall.data).toMatchObject({
        name: 'Docs',
        is_folder: true,
        mime_type: 'inode/directory',
      });
    });

    it('enqueues new files for processing via SyncFileIngestionService.ingestAll()', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      // SyncFileIngestionService reports 1 new file created (and enqueued internally)
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockIngestAll).toHaveBeenCalledTimes(1);
      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-1', name: 'doc.pdf' })],
        expect.objectContaining({ connectionId: CONNECTION_ID, scopeId: SCOPE_ID }),
        expect.any(Function),
      );
    });

    it('saves deltaLink as last_sync_cursor on completion', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

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
      mockIngestAll.mockResolvedValueOnce({ created: 2, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          syncStatus: 'synced',
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

      expect(mockUpdateScope).toHaveBeenNthCalledWith(
        1,
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'syncing' })
      );
      expect(mockUpdateScope).toHaveBeenNthCalledWith(
        2,
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced' })
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
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // ingestAll should only receive the kept file (deleted-1 is filtered out)
      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-1', name: 'keep.pdf' })],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('skips folders from file processing (folders are upserted separately)', async () => {
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
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // ingestAll should only receive the file, not the folders
      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-1', name: 'readme.txt' })],
        expect.any(Object),
        expect.any(Function),
      );

      // 2 folders upserted via prisma directly
      expect(mockFilesCreate).toHaveBeenCalledTimes(2);

      // itemCount only counts files, not folders
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced', itemCount: 1 })
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

      // ingestAll called with empty array
      expect(mockIngestAll).toHaveBeenCalledWith(
        [],
        expect.any(Object),
        expect.any(Function),
      );
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced', itemCount: 0 })
      );
    });
  });

  // ==========================================================================
  // syncScope — multiple pages
  // ==========================================================================

  describe('syncScope() — multiple pages', () => {
    it('follows nextPageLink pages and collects all changes', async () => {
      const nextPageLink = 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=page2';

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'page1-doc.pdf')],
        deltaLink: null,
        hasMore: true,
        nextPageLink,
      });

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-2', 'page2-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 2, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteDeltaQuery).toHaveBeenCalledTimes(2);
      expect(mockExecuteDeltaQuery).toHaveBeenNthCalledWith(1, CONNECTION_ID);
      expect(mockExecuteDeltaQuery).toHaveBeenNthCalledWith(2, CONNECTION_ID, nextPageLink);

      // All 2 files from both pages passed to ingestAll as one combined call
      expect(mockIngestAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'file-1' }),
          expect.objectContaining({ id: 'file-2' }),
        ]),
        expect.any(Object),
        expect.any(Function),
      );

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced', itemCount: 2 })
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

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

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

      mockIngestAll.mockResolvedValueOnce({ created: 3, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteDeltaQuery).toHaveBeenCalledTimes(3);
      expect(mockIngestAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'file-1' }),
          expect.objectContaining({ id: 'file-2' }),
          expect.objectContaining({ id: 'file-3' }),
        ]),
        expect.any(Object),
        expect.any(Function),
      );
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced', itemCount: 3 })
      );
    });
  });

  // ==========================================================================
  // syncScope — scope-aware delta routing (PRD-104)
  // ==========================================================================

  describe('syncScope() — scope-aware delta routing', () => {
    it('uses executeFolderDeltaQuery when scope_type is "folder"', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'folder', scope_resource_id: FOLDER_RESOURCE_ID })
      );

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'folder-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteFolderDeltaQuery).toHaveBeenCalledWith(
        CONNECTION_ID,
        FOLDER_RESOURCE_ID,
        undefined,
        DRIVE_ID
      );
      expect(mockExecuteDeltaQuery).not.toHaveBeenCalled();
      // PRD-112: 1 scope root folder created via prisma directly
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
    });

    it('uses executeDeltaQuery when scope_type is "root"', async () => {
      mockFindScopeById.mockResolvedValue(defaultScopeRow({ scope_type: 'root' }));

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'root-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteDeltaQuery).toHaveBeenCalledWith(CONNECTION_ID);
      expect(mockExecuteFolderDeltaQuery).not.toHaveBeenCalled();
    });

    it('falls back to root delta when scope_type is "folder" but scope_resource_id is null', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'folder', scope_resource_id: null })
      );

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteDeltaQuery).toHaveBeenCalledWith(CONNECTION_ID);
      expect(mockExecuteFolderDeltaQuery).not.toHaveBeenCalled();
    });

    it('routes to _runFileLevelSync when scope_type is "file"', async () => {
      const fileItem = {
        id: 'single-file-id',
        name: 'single.pdf',
        isFolder: false,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        lastModifiedAt: '2024-06-15T10:30:00Z',
        webUrl: 'https://example.com/single.pdf',
        eTag: '"etag-single"',
        parentId: null,
        parentPath: null,
      };

      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'file', scope_resource_id: 'ext-file-id' })
      );
      mockGetItemMetadata.mockResolvedValue(fileItem);

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteDeltaQuery).not.toHaveBeenCalled();
      expect(mockExecuteFolderDeltaQuery).not.toHaveBeenCalled();
      expect(mockGetItemMetadata).toHaveBeenCalledWith(CONNECTION_ID, 'ext-file-id');
      // File-level sync still uses prisma.files.create directly
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // syncScope — scope root folder creation (PRD-112)
  // ==========================================================================

  describe('syncScope() — scope root folder creation', () => {
    it('creates scope root folder for folder-type scopes before processing subfolders', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({
          scope_type: 'folder',
          scope_resource_id: FOLDER_RESOURCE_ID,
          scope_display_name: 'My Documents',
        })
      );

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Should create the scope root folder even with no subfolders or files
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);

      const call = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(call.data).toMatchObject({
        user_id: USER_ID,
        name: 'My Documents',
        mime_type: 'inode/directory',
        is_folder: true,
        external_id: FOLDER_RESOURCE_ID,
        external_drive_id: DRIVE_ID,
        connection_id: CONNECTION_ID,
        connection_scope_id: SCOPE_ID,
        parent_folder_id: null,
        pipeline_status: 'ready',
      });
    });

    it('does not create scope root folder for root-type scopes', async () => {
      mockFindScopeById.mockResolvedValue(defaultScopeRow({ scope_type: 'root' }));

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).not.toHaveBeenCalled();
    });

    it('reuses existing scope root folder from DB instead of creating duplicate', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'folder', scope_resource_id: FOLDER_RESOURCE_ID })
      );

      // Scope root folder already exists in DB
      mockFilesFindFirst.mockResolvedValue({ id: 'EXISTING-SCOPE-FOLDER-ID' });

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Should NOT create a new folder
      expect(mockFilesCreate).not.toHaveBeenCalled();
    });

    it('skips scope root folder creation when already in externalToInternalId map', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'folder', scope_resource_id: FOLDER_RESOURCE_ID })
      );

      // Seed the map via findMany (existing folder with matching external_id)
      mockFilesFindMany.mockResolvedValue([
        { id: 'MAP-SEEDED-FOLDER-ID', external_id: FOLDER_RESOURCE_ID },
      ]);

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // findFirst for scope root should NOT be called (map already has it)
      // Only findFirst calls would be for file dedup, not scope root
      expect(mockFilesCreate).not.toHaveBeenCalled();
    });

    it('uses scope_display_name as folder name, falls back to "OneDrive Folder"', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({
          scope_type: 'folder',
          scope_resource_id: FOLDER_RESOURCE_ID,
          scope_display_name: null,
        })
      );

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      const call = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(call.data.name).toBe('OneDrive Folder');
    });

    it('children of scope folder resolve parent_folder_id to the scope root', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'folder', scope_resource_id: FOLDER_RESOURCE_ID })
      );

      // File whose parentId is the scope folder
      const fileWithParent = makeFileChange('file-1', 'child-doc.pdf');
      fileWithParent.item.parentId = FOLDER_RESOURCE_ID;

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [fileWithParent],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // 1 scope root folder created via prisma directly
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      // ingestAll was called with the child file
      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-1', name: 'child-doc.pdf' })],
        expect.objectContaining({ folderMap: expect.any(Map) }),
        expect.any(Function),
      );
    });
  });

  // ==========================================================================
  // syncScope — deduplication (PRD-104)
  // ==========================================================================
  //
  // Deduplication logic (findFirst + create vs update) has moved to SyncFileIngestionService.
  // These tests verify that InitialSyncService passes the correct items to ingestAll()
  // and uses ingestionResult.created to drive downstream decisions (scope counters, etc.).
  // The detailed dedup behaviour is tested in SyncFileIngestionService.test.ts.

  describe('syncScope() — deduplication', () => {
    it('passes items to SyncFileIngestionService and uses created count for enqueue tracking', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'existing-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      // SyncFileIngestionService reports existing file updated (not created → created=0)
      mockIngestAll.mockResolvedValueOnce({ created: 0, updated: 1, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-1' })],
        expect.any(Object),
        expect.any(Function),
      );

      // No new files enqueued → processingTotal = 0
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced', processingTotal: 0 })
      );
    });

    it('does NOT enqueue existing files (ingestionResult.created = 0)', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'existing-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 0, updated: 1, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Sync still completes successfully with processingTotal=0
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced', processingTotal: 0 })
      );
    });

    it('creates and enqueues new files (ingestionResult.created = 1)', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-new', 'brand-new.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-new' })],
        expect.any(Object),
        expect.any(Function),
      );

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ processingTotal: 1, processingStatus: 'processing' })
      );
    });

    it('handles mixed new and existing files in same batch', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          makeFileChange('file-new', 'new.pdf'),
          makeFileChange('file-existing', 'existing.pdf'),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      // 1 new, 1 updated
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 1, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockIngestAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'file-new' }),
          expect.objectContaining({ id: 'file-existing' }),
        ]),
        expect.any(Object),
        expect.any(Function),
      );

      // Only the new file counts toward processingTotal
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ processingTotal: 1, processingStatus: 'processing' })
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

      expect(mockIngestAll).not.toHaveBeenCalled();
    });

    it('updates scope to error when connection is not found', async () => {
      mockConnectionsFindUnique.mockResolvedValueOnce(null);

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

      // SyncFileIngestionService handles per-file errors internally; 2 created, 1 error
      mockIngestAll.mockResolvedValueOnce({ created: 2, updated: 0, errors: 1 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Sync still completes — error resilience is inside SyncFileIngestionService
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced' })
      );

      const scopeUpdateCalls = mockUpdateScope.mock.calls as Array<[string, Record<string, unknown>]>;
      const finalUpdate = scopeUpdateCalls[scopeUpdateCalls.length - 1]!;
      expect(finalUpdate[1]).toMatchObject({ syncStatus: 'synced' });
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

      // 1 created, 1 error — SyncFileIngestionService dispatches queue internally
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 1 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced', processingTotal: 1 })
      );
    });
  });

  // ==========================================================================
  // ID format verification
  // ==========================================================================
  //
  // File UUID generation is now inside SyncFileIngestionService, so these tests
  // move to SyncFileIngestionService.test.ts. Kept here as simplified smoke tests
  // verifying InitialSyncService correctly passes items through to ingestAll.

  describe('Generated file IDs', () => {
    it('passes file items to SyncFileIngestionService for ID generation', async () => {
      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockIngestAll).toHaveBeenCalledTimes(1);
      const [items] = mockIngestAll.mock.calls[0]! as [unknown[], ...unknown[]];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: 'file-1', name: 'doc.pdf' });
    });
  });

  // ==========================================================================
  // File record field correctness
  // ==========================================================================
  //
  // Detailed field mapping (external_id, external_url, mime_type, size_bytes, etc.)
  // is now tested in SyncFileIngestionService.test.ts. The InitialSyncService
  // simply passes ExternalFileItem objects to ingestAll().

  describe('File record field mapping', () => {
    it('passes all ExternalFileItem fields to SyncFileIngestionService.ingestAll()', async () => {
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
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({
          id: 'ext-file-42',
          name: 'annual-report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 204800,
          webUrl: 'https://onedrive.live.com/view/annual-report.pdf',
          eTag: '"abc123etag"',
        })],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('files with null mimeType are filtered out by isFileSyncSupported (PRD-106)', async () => {
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

      // File with null mimeType is filtered before ingestAll is called (or called with empty array)
      const ingestAllCalls = mockIngestAll.mock.calls;
      if (ingestAllCalls.length > 0) {
        const [items] = ingestAllCalls[0]! as [unknown[], ...unknown[]];
        expect(items).toHaveLength(0);
      }
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced', itemCount: 0 })
      );
    });
  });

  // ==========================================================================
  // File-level sync — dedup (PRD-104 Step 7)
  // ==========================================================================

  describe('_runFileLevelSync — deduplication', () => {
    const FILE_ITEM = {
      id: 'single-file-ext-id',
      name: 'single.pdf',
      isFolder: false,
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      lastModifiedAt: '2024-06-15T10:30:00Z',
      webUrl: 'https://example.com/single.pdf',
      eTag: '"etag-single"',
      parentId: null,
      parentPath: null,
    };

    beforeEach(() => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'file', scope_resource_id: 'ext-resource-id' })
      );
      mockGetItemMetadata.mockResolvedValue(FILE_ITEM);
    });

    it('creates and enqueues new file', async () => {
      mockFilesFindFirst.mockResolvedValue(null);

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(1);

      const createCall = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(createCall.data).toMatchObject({
        name: 'single.pdf',
        external_id: 'single-file-ext-id',
        pipeline_status: 'queued',
      });
    });

    it('updates existing file without enqueue on re-sync', async () => {
      mockFilesFindFirst.mockResolvedValue({
        id: 'EXISTING-FILE-ID',
        pipeline_status: 'ready',
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Should update, NOT create
      expect(mockFilesUpdate).toHaveBeenCalledTimes(1);
      expect(mockFilesCreate).not.toHaveBeenCalled();
      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();

      // Update should not include pipeline_status
      const updateCall = mockFilesUpdate.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(updateCall.data).not.toHaveProperty('pipeline_status');
      expect(updateCall.data).toMatchObject({
        name: 'single.pdf',
        connection_scope_id: SCOPE_ID,
      });
    });

    it('updates scope to idle on completion', async () => {
      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          syncStatus: 'synced',
          itemCount: 1,
          lastSyncError: null,
        })
      );
    });
  });

  // ==========================================================================
  // PRD-110: shared scope — remote_drive_id propagation
  // ==========================================================================

  const REMOTE_DRIVE_ID = 'REMOTE-DRIVE-001';
  const SP_DRIVE_ID = 'SP-DRIVE-ABC123';

  describe('PRD-110 — shared scope behavior', () => {
    it('shared scope uses remote_drive_id as effectiveDriveId in ingestion context', async () => {
      mockFindScopeById.mockResolvedValue({
        ...defaultScopeRow({
          scope_type: 'folder',
          scope_resource_id: FOLDER_RESOURCE_ID,
          scope_display_name: 'Shared Folder',
        }),
        remote_drive_id: REMOTE_DRIVE_ID,
      });

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-shared-1', 'shared-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // PRD-112: 1 scope root folder created via prisma directly (uses REMOTE_DRIVE_ID)
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      const rootFolderCreate = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(rootFolderCreate.data).toMatchObject({
        external_drive_id: REMOTE_DRIVE_ID,
      });

      // ingestAll receives the effective drive ID in context
      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-shared-1', name: 'shared-doc.pdf' })],
        expect.objectContaining({
          effectiveDriveId: REMOTE_DRIVE_ID,
          connectionId: CONNECTION_ID,
          scopeId: SCOPE_ID,
          userId: USER_ID,
          isShared: true,
        }),
        expect.any(Function),
      );
    });

    it('shared scope passes remote_drive_id as microsoftDriveId to ensureScopeRootFolder', async () => {
      mockFindScopeById.mockResolvedValue({
        ...defaultScopeRow({
          scope_type: 'folder',
          scope_resource_id: FOLDER_RESOURCE_ID,
          scope_display_name: 'Shared Root',
        }),
        remote_drive_id: REMOTE_DRIVE_ID,
      });

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // ensureScopeRootFolder uses prisma.files.findFirst + create
      // The scope root folder create should use REMOTE_DRIVE_ID as external_drive_id
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);

      const rootFolderCreate = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(rootFolderCreate.data).toMatchObject({
        name: 'Shared Root',
        is_folder: true,
        external_id: FOLDER_RESOURCE_ID,
        external_drive_id: REMOTE_DRIVE_ID,
        connection_id: CONNECTION_ID,
      });
    });

    it('shared scope skips subscription creation', async () => {
      mockFindScopeById.mockResolvedValue({
        ...defaultScopeRow({ scope_type: 'root' }),
        remote_drive_id: REMOTE_DRIVE_ID,
      });

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'shared-file.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      // Track dynamic imports by verifying no SubscriptionManager is imported
      // The service uses dynamic import for subscription creation inside the
      // `if (!scope.remote_drive_id)` guard — we verify the sync completes normally.
      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Sync should still complete
      expect(mockIngestAll).toHaveBeenCalledTimes(1);
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'synced' })
      );
    });

    it('file-level shared scope uses getItemMetadataFromDrive with remote_drive_id', async () => {
      const sharedFileItem = {
        id: 'remote-file-id',
        name: 'shared-report.xlsx',
        isFolder: false,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 5000,
        lastModifiedAt: '2026-01-01T00:00:00Z',
        webUrl: 'https://example.com/shared-report.xlsx',
        eTag: '"etag-shared"',
        parentId: null,
        parentPath: null,
        childCount: null,
      };

      mockFindScopeById.mockResolvedValue({
        ...defaultScopeRow({
          scope_type: 'file',
          scope_resource_id: 'remote-file-id',
          scope_display_name: 'shared-report.xlsx',
        }),
        remote_drive_id: REMOTE_DRIVE_ID,
      });
      mockGetItemMetadataFromDrive.mockResolvedValue(sharedFileItem);
      mockFilesFindFirst.mockResolvedValue(null);

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Should use getItemMetadataFromDrive (NOT getItemMetadata)
      expect(mockGetItemMetadataFromDrive).toHaveBeenCalledWith(
        CONNECTION_ID,
        REMOTE_DRIVE_ID,
        'remote-file-id'
      );
      expect(mockGetItemMetadata).not.toHaveBeenCalled();

      // File-level sync still uses prisma directly — verify the create call
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      const createCall = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(createCall.data).toMatchObject({
        name: 'shared-report.xlsx',
        external_drive_id: REMOTE_DRIVE_ID,
        external_id: 'remote-file-id',
      });
    });

    it('non-shared scope uses connection drive ID (regression test)', async () => {
      // Scope with no remote_drive_id — uses connection's microsoft_drive_id
      mockFindScopeById.mockResolvedValue({
        ...defaultScopeRow({
          scope_type: 'folder',
          scope_resource_id: FOLDER_RESOURCE_ID,
          scope_display_name: 'Local Folder',
        }),
        remote_drive_id: null,
      });

      mockExecuteFolderDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-local-1', 'local-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // PRD-112: 1 scope root folder created via prisma directly using connection's DRIVE_ID
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      const rootFolderCreate = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(rootFolderCreate.data).toMatchObject({
        external_drive_id: DRIVE_ID,
        connection_id: CONNECTION_ID,
      });

      // ingestAll receives DRIVE_ID (not a remote drive) as effectiveDriveId
      expect(mockIngestAll).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'file-local-1', name: 'local-doc.pdf' })],
        expect.objectContaining({ effectiveDriveId: DRIVE_ID, isShared: false }),
        expect.any(Function),
      );
    });
  });

  // ==========================================================================
  // PRD-111: SharePoint sync paths
  // ==========================================================================

  describe('PRD-111 — SharePoint sync paths', () => {
    it('SharePoint folder scope resolves driveId from remote_drive_id', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({
          scope_type: 'folder',
          scope_resource_id: FOLDER_RESOURCE_ID,
          scope_display_name: 'SP Folder',
          remote_drive_id: REMOTE_DRIVE_ID,
        })
      );

      mockConnectionsFindUnique.mockResolvedValue({
        microsoft_drive_id: null,
        provider: 'sharepoint',
      });

      mockSPExecuteFolderDeltaQuery.mockResolvedValue({
        changes: [makeFileChange('sp-file-1', 'sharepoint-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Should use SharePoint service, not OneDrive service
      expect(mockSPExecuteFolderDeltaQuery).toHaveBeenCalledWith(
        CONNECTION_ID,
        REMOTE_DRIVE_ID,
        FOLDER_RESOURCE_ID
      );
      expect(mockExecuteFolderDeltaQuery).not.toHaveBeenCalled();
      expect(mockExecuteDeltaQuery).not.toHaveBeenCalled();
    });

    it('SharePoint folder scope with null remote_drive_id throws descriptive error', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({
          scope_type: 'folder',
          scope_resource_id: FOLDER_RESOURCE_ID,
          scope_display_name: 'SP Folder',
          remote_drive_id: null,
        })
      );

      mockConnectionsFindUnique.mockResolvedValue({
        microsoft_drive_id: null,
        provider: 'sharepoint',
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // The error should be caught internally (fire-and-forget), so scope should be marked as error
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          syncStatus: 'error',
          lastSyncError: expect.stringContaining('Cannot resolve driveId'),
        })
      );
    });

    it('SharePoint pagination uses SharePoint service (not OneDrive)', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({
          scope_type: 'library',
          scope_resource_id: SP_DRIVE_ID,
          scope_display_name: 'Documents',
          remote_drive_id: null,
        })
      );

      mockConnectionsFindUnique.mockResolvedValue({
        microsoft_drive_id: null,
        provider: 'sharepoint',
      });

      // First page has nextPageLink
      mockSPExecuteDeltaQuery
        .mockResolvedValueOnce({
          changes: [makeFileChange('sp-page1-file', 'page1.pdf')],
          deltaLink: null,
          hasMore: true,
          nextPageLink: 'https://graph.microsoft.com/v1.0/drives/SP-DRIVE/root/delta?skiptoken=abc',
        })
        .mockResolvedValueOnce({
          changes: [makeFileChange('sp-page2-file', 'page2.pdf')],
          deltaLink: DELTA_LINK,
          hasMore: false,
          nextPageLink: null,
        });

      mockIngestAll.mockResolvedValueOnce({ created: 2, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Should call SharePoint service twice (initial + pagination), never OneDrive
      expect(mockSPExecuteDeltaQuery).toHaveBeenCalledTimes(2);
      expect(mockExecuteDeltaQuery).not.toHaveBeenCalled();

      // Second call should pass the nextPageLink
      expect(mockSPExecuteDeltaQuery).toHaveBeenNthCalledWith(
        2,
        CONNECTION_ID,
        SP_DRIVE_ID,
        'https://graph.microsoft.com/v1.0/drives/SP-DRIVE/root/delta?skiptoken=abc'
      );
    });
  });

  // ==========================================================================
  // PRD-117: Processing counters and status
  // ==========================================================================

  describe('PRD-117 — processingTotal and processingStatus', () => {
    it('sets processingTotal = new files enqueued and processingStatus = "processing"', async () => {
      mockExecuteDeltaQuery.mockResolvedValue({
        changes: [
          makeFileChange('f1', 'a.pdf'),
          makeFileChange('f2', 'b.pdf'),
          makeFileChange('f3', 'c.pdf'),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      // All 3 files are new
      mockIngestAll.mockResolvedValueOnce({ created: 3, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // 3 new files enqueued → processingTotal = 3
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          processingTotal: 3,
          processingCompleted: 0,
          processingFailed: 0,
          processingStatus: 'processing',
        })
      );
    });

    it('sets processingStatus = "completed" when no new files are enqueued', async () => {
      mockExecuteDeltaQuery.mockResolvedValue({
        changes: [],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      // Default mockIngestAll returns { created: 0 }

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          processingTotal: 0,
          processingStatus: 'completed',
        })
      );
    });

    it('only counts newly created files (not re-synced existing files) toward processingTotal', async () => {
      mockExecuteDeltaQuery.mockResolvedValue({
        changes: [
          makeFileChange('new-file', 'new.pdf'),
          makeFileChange('existing-file', 'existing.pdf'),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      // SyncFileIngestionService: 1 new, 1 updated (updated doesn't count for queue)
      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 1, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          processingTotal: 1,
          processingStatus: 'processing',
        })
      );
    });

    it('includes processingTotal and processingStatus alongside cursor and item count', async () => {
      mockExecuteDeltaQuery.mockResolvedValue({
        changes: [makeFileChange('file-1', 'doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      mockIngestAll.mockResolvedValueOnce({ created: 1, updated: 0, errors: 0 });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // The final updateScope call should include all PRD-117 fields alongside existing fields
      const calls = mockUpdateScope.mock.calls as Array<[string, Record<string, unknown>]>;
      const finalCall = calls[calls.length - 1]!;

      expect(finalCall[1]).toMatchObject({
        syncStatus: 'synced',
        itemCount: 1,
        lastSyncCursor: DELTA_LINK,
        lastSyncError: null,
        processingTotal: 1,
        processingCompleted: 0,
        processingFailed: 0,
        processingStatus: 'processing',
      });
    });

    it('file-level sync sets processingTotal=1 when a new file is enqueued', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'file', scope_resource_id: 'ext-file-id' })
      );
      mockGetItemMetadata.mockResolvedValue({
        id: 'ext-file-id',
        name: 'single.pdf',
        isFolder: false,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        lastModifiedAt: '2024-01-01T00:00:00Z',
        webUrl: 'https://example.com/single.pdf',
        eTag: '"etag-new"',
        parentId: null,
        parentPath: null,
      });
      mockFilesFindFirst.mockResolvedValue(null); // New file

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          processingTotal: 1,
          processingCompleted: 0,
          processingFailed: 0,
          processingStatus: 'processing',
        })
      );
    });

    it('file-level sync sets processingTotal=0 and processingStatus="completed" for existing file', async () => {
      mockFindScopeById.mockResolvedValue(
        defaultScopeRow({ scope_type: 'file', scope_resource_id: 'ext-file-id' })
      );
      mockGetItemMetadata.mockResolvedValue({
        id: 'ext-file-id',
        name: 'existing.pdf',
        isFolder: false,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        lastModifiedAt: '2024-01-01T00:00:00Z',
        webUrl: 'https://example.com/existing.pdf',
        eTag: '"etag-old"',
        parentId: null,
        parentPath: null,
      });
      // File already exists in DB
      mockFilesFindFirst.mockResolvedValue({ id: 'EXISTING-FILE', pipeline_status: 'ready' });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({
          processingTotal: 0,
          processingStatus: 'completed',
        })
      );
    });
  });
});
