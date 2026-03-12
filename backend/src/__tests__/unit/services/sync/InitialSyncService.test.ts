/**
 * InitialSyncService Unit Tests (PRD-101, PRD-104)
 *
 * Tests the fire-and-forget initial sync orchestration:
 * - Full delta query enumeration with pagination
 * - Scope-aware delta routing (root vs folder)
 * - File deduplication via findFirst + create/update pattern
 * - Conditional enqueue (only new files are enqueued)
 * - deltaLink persistence as last_sync_cursor
 * - Scope status transitions (syncing → idle / error)
 * - Skipping folders and deleted items
 * - Individual file failure resilience
 * - File-level sync with dedup
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
const mockConnectionsFindUnique = vi.hoisted(() => vi.fn());
const mockFilesFindFirst = vi.hoisted(() => vi.fn());
const mockFilesFindMany = vi.hoisted(() => vi.fn());
const mockFilesCreate = vi.hoisted(() => vi.fn());
const mockFilesUpdate = vi.hoisted(() => vi.fn());

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
  },
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
    mockUpdateScope.mockReset();
    mockSPExecuteDeltaQuery.mockReset();
    mockSPExecuteFolderDeltaQuery.mockReset();
    mockFindScopeById.mockReset();
    mockFindExclusionScopesByConnection.mockReset();
    mockAddFileProcessingFlow.mockReset();

    // Default: no exclusion scopes
    mockFindExclusionScopesByConnection.mockResolvedValue([]);

    __resetInitialSyncService();
    service = new InitialSyncService();

    // Default: connection found with a drive ID
    mockConnectionsFindUnique.mockResolvedValue({
      microsoft_drive_id: DRIVE_ID,
    });

    // Default: scope is root type
    mockFindScopeById.mockResolvedValue(defaultScopeRow());

    // Default: no existing file (new file path)
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

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // findFirst called: 1 for folder upsert + 1 for file dedup = 2
      // (report.xlsx has unsupported MIME type, filtered out by isFileSyncSupported)
      expect(mockFilesFindFirst).toHaveBeenCalledTimes(2);

      // 1 folder upsert + 1 file = 2 creates total
      expect(mockFilesCreate).toHaveBeenCalledTimes(2);

      // Verify folder record (created first via folder upsert loop)
      const folderCall = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(folderCall.data).toMatchObject({
        name: 'Docs',
        is_folder: true,
        mime_type: 'inode/directory',
      });

      // Verify file record
      const fileCall = mockFilesCreate.mock.calls[1]![0] as { data: Record<string, unknown> };
      expect(fileCall.data).toMatchObject({
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
      expect(fileCall.data.id as string).toMatch(/^[A-F0-9-]+$/);
    });

    it('enqueues new files for processing via messageQueue.addFileProcessingFlow', async () => {
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

      expect(mockUpdateScope).toHaveBeenNthCalledWith(
        1,
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'syncing' })
      );
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

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      const call = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(call.data.name).toBe('keep.pdf');
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

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // 2 folders upserted + 1 file = 3 total creates
      expect(mockFilesCreate).toHaveBeenCalledTimes(3);
      // itemCount only counts files, not folders
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

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteDeltaQuery).toHaveBeenCalledTimes(2);
      expect(mockExecuteDeltaQuery).toHaveBeenNthCalledWith(1, CONNECTION_ID);
      expect(mockExecuteDeltaQuery).toHaveBeenNthCalledWith(2, CONNECTION_ID, nextPageLink);

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

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockExecuteFolderDeltaQuery).toHaveBeenCalledWith(
        CONNECTION_ID,
        FOLDER_RESOURCE_ID
      );
      expect(mockExecuteDeltaQuery).not.toHaveBeenCalled();
      // PRD-112: 1 scope root folder + 1 file = 2 creates
      expect(mockFilesCreate).toHaveBeenCalledTimes(2);
    });

    it('uses executeDeltaQuery when scope_type is "root"', async () => {
      mockFindScopeById.mockResolvedValue(defaultScopeRow({ scope_type: 'root' }));

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'root-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

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

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // 1 scope root folder + 1 file = 2 creates
      expect(mockFilesCreate).toHaveBeenCalledTimes(2);

      // The file create should have parent_folder_id pointing to the scope root
      const fileCreate = mockFilesCreate.mock.calls[1]![0] as { data: Record<string, unknown> };
      expect(fileCreate.data.name).toBe('child-doc.pdf');
      // parent_folder_id should be the UUID generated for the scope root
      expect(fileCreate.data.parent_folder_id).toBeTruthy();
      expect(fileCreate.data.parent_folder_id).not.toBeNull();
    });
  });

  // ==========================================================================
  // syncScope — deduplication (PRD-104)
  // ==========================================================================

  describe('syncScope() — deduplication', () => {
    it('updates metadata (not creates) when file already exists', async () => {
      // Simulate existing file
      mockFilesFindFirst.mockResolvedValue({
        id: 'EXISTING-FILE-ID',
        pipeline_status: 'ready',
      });

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'existing-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // findFirst was called to check existence
      expect(mockFilesFindFirst).toHaveBeenCalledWith({
        where: { connection_id: CONNECTION_ID, external_id: 'file-1' },
        select: { id: true, pipeline_status: true },
      });

      // Should update, NOT create
      expect(mockFilesUpdate).toHaveBeenCalledTimes(1);
      expect(mockFilesCreate).not.toHaveBeenCalled();

      // Update should NOT include pipeline_status
      const updateCall = mockFilesUpdate.mock.calls[0]![0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(updateCall.where).toEqual({ id: 'EXISTING-FILE-ID' });
      expect(updateCall.data).toMatchObject({
        name: 'existing-doc.pdf',
        connection_scope_id: SCOPE_ID,
      });
      expect(updateCall.data).not.toHaveProperty('pipeline_status');
    });

    it('does NOT enqueue existing files', async () => {
      mockFilesFindFirst.mockResolvedValue({
        id: 'EXISTING-FILE-ID',
        pipeline_status: 'ready',
      });

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-1', 'existing-doc.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();

      // Sync still completes successfully
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle' })
      );
    });

    it('creates and enqueues new files', async () => {
      // No existing file
      mockFilesFindFirst.mockResolvedValue(null);

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [makeFileChange('file-new', 'brand-new.pdf')],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(1);
    });

    it('handles mixed new and existing files in same batch', async () => {
      // First file: new (not found), second file: existing
      mockFilesFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'EXISTING-ID', pipeline_status: 'ready' });

      mockExecuteDeltaQuery.mockResolvedValueOnce({
        changes: [
          makeFileChange('file-new', 'new.pdf'),
          makeFileChange('file-existing', 'existing.pdf'),
        ],
        deltaLink: DELTA_LINK,
        hasMore: false,
        nextPageLink: null,
      });

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // One create (new), one update (existing)
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(mockFilesUpdate).toHaveBeenCalledTimes(1);

      // Only the new file should be enqueued
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(1);
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

      expect(mockFilesCreate).not.toHaveBeenCalled();
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

      // Make the second file creation fail
      mockFilesCreate
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DB constraint violation'))
        .mockResolvedValueOnce({});

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle' })
      );

      expect(mockFilesCreate).toHaveBeenCalledTimes(3);

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

      expect(typeof call.data.size_bytes).toBe('bigint');
      expect(call.data.size_bytes).toBe(BigInt(204800));
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

      // File with null mimeType is not sync-supported and gets filtered out
      expect(mockFilesCreate).not.toHaveBeenCalled();
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle', itemCount: 0 })
      );
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
          syncStatus: 'idle',
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
    it('shared scope uses remote_drive_id as external_drive_id for created files', async () => {
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

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // PRD-112: 1 scope root folder + 1 file = 2 creates
      expect(mockFilesCreate).toHaveBeenCalledTimes(2);

      // The file create (second call) should use REMOTE_DRIVE_ID as external_drive_id
      const fileCreate = mockFilesCreate.mock.calls[1]![0] as { data: Record<string, unknown> };
      expect(fileCreate.data).toMatchObject({
        name: 'shared-doc.pdf',
        external_drive_id: REMOTE_DRIVE_ID,
        connection_id: CONNECTION_ID,
        connection_scope_id: SCOPE_ID,
        user_id: USER_ID,
      });
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

      // Track dynamic imports by verifying no SubscriptionManager is imported
      // The service uses dynamic import for subscription creation inside the
      // `if (!scope.remote_drive_id)` guard — we verify the sync completes normally.
      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // Sync should still complete with files created
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(mockUpdateScope).toHaveBeenCalledWith(
        SCOPE_ID,
        expect.objectContaining({ syncStatus: 'idle' })
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

      // File should be created with remote_drive_id as external_drive_id
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

      await runSync(service, CONNECTION_ID, SCOPE_ID, USER_ID);

      // PRD-112: 1 scope root folder + 1 file = 2 creates
      expect(mockFilesCreate).toHaveBeenCalledTimes(2);

      // File should use the connection's DRIVE_ID (from mockConnectionsFindUnique default)
      const fileCreate = mockFilesCreate.mock.calls[1]![0] as { data: Record<string, unknown> };
      expect(fileCreate.data).toMatchObject({
        name: 'local-doc.pdf',
        external_drive_id: DRIVE_ID,
        connection_id: CONNECTION_ID,
      });
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
});
