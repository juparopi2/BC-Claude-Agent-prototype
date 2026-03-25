/**
 * SyncFileIngestionService Unit Tests (PRD-117)
 *
 * Tests the shared batch ingestion service:
 * - Atomic DB writes inside prisma.$transaction()
 * - New file creation with correct field mapping
 * - Existing file updates without touching pipeline_status
 * - Post-commit BullMQ queue dispatch for new files only
 * - Per-file error isolation (one failure doesn't abort batch)
 * - UUID generation in UPPERCASE
 * - source_type derivation from provider
 * - is_shared propagation from context
 * - Transaction failure handling (EREQINPROG, timeout)
 * - ingestAll batching, progress callbacks, result aggregation
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

const mockFilesFindFirst = vi.hoisted(() => vi.fn());
const mockFilesCreate = vi.hoisted(() => vi.fn());
const mockFilesUpdate = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findFirst: mockFilesFindFirst,
      create: mockFilesCreate,
      update: mockFilesUpdate,
    },
    $transaction: mockTransaction,
  },
}));

const mockAddFileProcessingFlow = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: mockAddFileProcessingFlow,
  })),
}));

// resolveParentFolderId returns null for most tests — folder mapping not under test here
vi.mock('@/services/sync/FolderHierarchyResolver', () => ({
  resolveParentFolderId: vi.fn(() => null),
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import {
  SyncFileIngestionService,
  INGESTION_BATCH_SIZE,
  INGESTION_TX_TIMEOUT,
} from '@/services/sync/SyncFileIngestionService';
import type {
  IngestionContext,
} from '@/services/sync/SyncFileIngestionService';
import type { ExternalFileItem } from '@bc-agent/shared';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';

// ============================================================================
// Test Constants
// ============================================================================

const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const SCOPE_ID = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';
const DRIVE_ID = 'DRIV-99999999-8888-7777-6666-555544443333';

// ============================================================================
// Helpers
// ============================================================================

function defaultCtx(overrides?: Partial<IngestionContext>): IngestionContext {
  return {
    connectionId: CONNECTION_ID,
    scopeId: SCOPE_ID,
    userId: USER_ID,
    effectiveDriveId: DRIVE_ID,
    provider: 'onedrive',
    isShared: false,
    folderMap: new Map(),
    ...overrides,
  };
}

function makeItem(id: string, name: string, overrides?: Partial<ExternalFileItem>): ExternalFileItem {
  return {
    id,
    name,
    isFolder: false,
    // Use 'in' check so that explicitly passing null is preserved (not overridden by default)
    mimeType: overrides && 'mimeType' in overrides ? (overrides.mimeType ?? null) : 'application/pdf',
    sizeBytes: overrides?.sizeBytes ?? 1024,
    lastModifiedAt: overrides?.lastModifiedAt ?? '2024-01-01T00:00:00Z',
    webUrl: overrides?.webUrl ?? `https://example.com/${name}`,
    eTag: overrides?.eTag !== undefined ? overrides.eTag : `etag-${id}`,
    parentId: overrides?.parentId ?? null,
    parentPath: overrides?.parentPath ?? null,
    childCount: overrides?.childCount ?? null,
  };
}

/** Build a tx proxy that forwards to the top-level mock functions. */
function makeTxProxy() {
  return {
    files: {
      findFirst: mockFilesFindFirst,
      create: mockFilesCreate,
      update: mockFilesUpdate,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SyncFileIngestionService', () => {
  let service: SyncFileIngestionService;

  beforeEach(() => {
    mockFilesFindFirst.mockReset();
    mockFilesCreate.mockReset();
    mockFilesUpdate.mockReset();
    mockTransaction.mockReset();
    mockAddFileProcessingFlow.mockReset();

    // Default transaction: execute callback with a tx proxy
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(makeTxProxy());
    });

    // Default: file does not exist yet
    mockFilesFindFirst.mockResolvedValue(null);

    // Default: writes succeed
    mockFilesCreate.mockResolvedValue({});
    mockFilesUpdate.mockResolvedValue({});
    mockAddFileProcessingFlow.mockResolvedValue(undefined);

    service = new SyncFileIngestionService();
  });

  // ==========================================================================
  // ingestBatch
  // ==========================================================================

  describe('ingestBatch()', () => {
    it('creates new file records when they do not exist', async () => {
      const item = makeItem('EXT-001', 'report.pdf');
      mockFilesFindFirst.mockResolvedValue(null);

      const result = await service.ingestBatch([item], defaultCtx());

      expect(mockFilesCreate).toHaveBeenCalledOnce();
      const createData = mockFilesCreate.mock.calls[0][0].data;

      expect(createData).toMatchObject({
        user_id: USER_ID,
        name: 'report.pdf',
        mime_type: 'application/pdf',
        external_id: 'EXT-001',
        external_drive_id: DRIVE_ID,
        connection_id: CONNECTION_ID,
        connection_scope_id: SCOPE_ID,
        pipeline_status: 'queued',
        is_folder: false,
        is_shared: false,
        source_type: FILE_SOURCE_TYPE.ONEDRIVE,
      });

      // size_bytes must be a BigInt
      expect(typeof createData.size_bytes).toBe('bigint');
      expect(createData.size_bytes).toBe(BigInt(1024));

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('updates existing file records without touching pipeline_status', async () => {
      const item = makeItem('EXT-EXISTING', 'existing.pdf');
      mockFilesFindFirst.mockResolvedValue({ id: 'EXISTING-INTERNAL-UUID', pipeline_status: 'ready' });

      const result = await service.ingestBatch([item], defaultCtx());

      expect(mockFilesUpdate).toHaveBeenCalledOnce();
      const updateData = mockFilesUpdate.mock.calls[0][0].data;

      // Metadata fields must be updated
      expect(updateData).toMatchObject({
        name: 'existing.pdf',
        mime_type: 'application/pdf',
        connection_scope_id: SCOPE_ID,
      });

      // pipeline_status must NOT be present in the update payload
      expect(updateData).not.toHaveProperty('pipeline_status');

      // update targets the existing internal ID
      expect(mockFilesUpdate.mock.calls[0][0].where).toEqual({ id: 'EXISTING-INTERNAL-UUID' });

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.errors).toBe(0);

      // No file should be created
      expect(mockFilesCreate).not.toHaveBeenCalled();
    });

    it('dispatches new files to the queue after commit', async () => {
      const item = makeItem('EXT-NEW', 'new-file.pdf');
      mockFilesFindFirst.mockResolvedValue(null);

      await service.ingestBatch([item], defaultCtx());

      expect(mockAddFileProcessingFlow).toHaveBeenCalledOnce();
      const callArg = mockAddFileProcessingFlow.mock.calls[0][0];

      expect(callArg).toMatchObject({
        batchId: SCOPE_ID,
        userId: USER_ID,
        mimeType: 'application/pdf',
        fileName: 'new-file.pdf',
      });
      // fileId must be a non-empty string
      expect(typeof callArg.fileId).toBe('string');
      expect(callArg.fileId.length).toBeGreaterThan(0);
    });

    it('does NOT dispatch existing files to the queue', async () => {
      const item = makeItem('EXT-OLD', 'old-file.pdf');
      mockFilesFindFirst.mockResolvedValue({ id: 'EXISTING-ID', pipeline_status: 'ready' });

      await service.ingestBatch([item], defaultCtx());

      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
    });

    it('handles per-file errors without aborting the batch', async () => {
      const item1 = makeItem('EXT-A', 'a.pdf');
      const item2 = makeItem('EXT-B', 'b.pdf');
      const item3 = makeItem('EXT-C', 'c.pdf');

      // Second file throws during findFirst — isolated failure
      mockFilesFindFirst
        .mockResolvedValueOnce(null)                    // item1: new
        .mockRejectedValueOnce(new Error('DB timeout')) // item2: error
        .mockResolvedValueOnce(null);                   // item3: new

      const result = await service.ingestBatch([item1, item2, item3], defaultCtx());

      expect(result.errors).toBe(1);
      // item1 and item3 should still be created
      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
    });

    it('generates UPPERCASE UUID file IDs for new files', async () => {
      const item = makeItem('EXT-UUID-TEST', 'uuid-test.pdf');
      mockFilesFindFirst.mockResolvedValue(null);

      await service.ingestBatch([item], defaultCtx());

      const createData = mockFilesCreate.mock.calls[0][0].data;
      const fileId: string = createData.id;

      // UUID pattern: only uppercase hex characters and hyphens
      expect(fileId).toMatch(/^[A-F0-9-]+$/);
      expect(fileId.length).toBeGreaterThan(30);
    });

    it('sets source_type to SHAREPOINT when provider is "sharepoint"', async () => {
      const item = makeItem('EXT-SP', 'sp-file.docx');
      mockFilesFindFirst.mockResolvedValue(null);
      const ctx = defaultCtx({ provider: 'sharepoint' });

      await service.ingestBatch([item], ctx);

      const createData = mockFilesCreate.mock.calls[0][0].data;
      expect(createData.source_type).toBe(FILE_SOURCE_TYPE.SHAREPOINT);
    });

    it('sets source_type to ONEDRIVE for any non-sharepoint provider', async () => {
      const item = makeItem('EXT-OD', 'od-file.pdf');
      mockFilesFindFirst.mockResolvedValue(null);
      const ctx = defaultCtx({ provider: 'onedrive' });

      await service.ingestBatch([item], ctx);

      const createData = mockFilesCreate.mock.calls[0][0].data;
      expect(createData.source_type).toBe(FILE_SOURCE_TYPE.ONEDRIVE);
    });

    it('sets is_shared from context when true', async () => {
      const item = makeItem('EXT-SHARED', 'shared.pdf');
      mockFilesFindFirst.mockResolvedValue(null);
      const ctx = defaultCtx({ isShared: true });

      await service.ingestBatch([item], ctx);

      const createData = mockFilesCreate.mock.calls[0][0].data;
      expect(createData.is_shared).toBe(true);
    });

    it('maps all ExternalFileItem fields correctly on create', async () => {
      const item = makeItem('EXT-FULL', 'full-map.pdf', {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 204800,
        lastModifiedAt: '2024-06-15T12:30:00Z',
        webUrl: 'https://sharepoint.com/sites/test/full-map.pdf',
        eTag: '"abc123etag"',
      });
      mockFilesFindFirst.mockResolvedValue(null);

      await service.ingestBatch([item], defaultCtx());

      const createData = mockFilesCreate.mock.calls[0][0].data;

      expect(createData.name).toBe('full-map.pdf');
      expect(createData.mime_type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(createData.size_bytes).toBe(BigInt(204800));
      expect(createData.external_url).toBe('https://sharepoint.com/sites/test/full-map.pdf');
      expect(createData.content_hash_external).toBe('"abc123etag"');
      expect(createData.external_modified_at).toEqual(new Date('2024-06-15T12:30:00Z'));
      expect(createData.file_modified_at).toEqual(new Date('2024-06-15T12:30:00Z'));
      expect(createData.processing_retry_count).toBe(0);
      expect(createData.embedding_retry_count).toBe(0);
      expect(createData.is_favorite).toBe(false);
      expect(createData.blob_path).toBeNull();
    });

    it('passes INGESTION_TX_TIMEOUT as the transaction timeout option', async () => {
      const item = makeItem('EXT-TX', 'tx-test.pdf');

      await service.ingestBatch([item], defaultCtx());

      expect(mockTransaction).toHaveBeenCalledOnce();
      const [, opts] = mockTransaction.mock.calls[0];
      expect(opts).toEqual({ timeout: INGESTION_TX_TIMEOUT });
      expect(INGESTION_TX_TIMEOUT).toBe(60_000);
    });

    it('catches transaction timeout errors, logs them, and re-throws', async () => {
      const item = makeItem('EXT-TIMEOUT', 'timeout.pdf');
      const timeoutError = new Error('A commit cannot be executed on an expired transaction');
      mockTransaction.mockRejectedValueOnce(timeoutError);

      await expect(service.ingestBatch([item], defaultCtx())).rejects.toThrow(
        'A commit cannot be executed on an expired transaction'
      );
    });

    it('catches EREQINPROG errors and re-throws cleanly', async () => {
      const item = makeItem('EXT-EREQ', 'ereq.pdf');
      const ereqError = new Error('EREQINPROG: request in progress');
      mockTransaction.mockRejectedValueOnce(ereqError);

      await expect(service.ingestBatch([item], defaultCtx())).rejects.toThrow('EREQINPROG');
    });

    it('uses "application/octet-stream" as fallback when mimeType is null', async () => {
      const item = makeItem('EXT-NULLMIME', 'no-mime', { mimeType: null });
      mockFilesFindFirst.mockResolvedValue(null);

      await service.ingestBatch([item], defaultCtx());

      const createData = mockFilesCreate.mock.calls[0][0].data;
      expect(createData.mime_type).toBe('application/octet-stream');
    });

    it('sets external_url to null when webUrl is empty string', async () => {
      const item = makeItem('EXT-NOURL', 'no-url.pdf', { webUrl: '' });
      mockFilesFindFirst.mockResolvedValue(null);

      await service.ingestBatch([item], defaultCtx());

      const createData = mockFilesCreate.mock.calls[0][0].data;
      expect(createData.external_url).toBeNull();
    });
  });

  // ==========================================================================
  // ingestAll
  // ==========================================================================

  describe('ingestAll()', () => {
    it('splits 60 items into 3 batches of INGESTION_BATCH_SIZE (25)', async () => {
      expect(INGESTION_BATCH_SIZE).toBe(25);

      const items = Array.from({ length: 60 }, (_, i) =>
        makeItem(`EXT-${i}`, `file-${i}.pdf`)
      );

      await service.ingestAll(items, defaultCtx());

      // 25 + 25 + 10 = 3 transactions
      expect(mockTransaction).toHaveBeenCalledTimes(3);
    });

    it('calls the progress callback after each batch', async () => {
      const items = Array.from({ length: 60 }, (_, i) =>
        makeItem(`EXT-CB-${i}`, `cb-file-${i}.pdf`)
      );

      const onBatchComplete = vi.fn();

      await service.ingestAll(items, defaultCtx(), onBatchComplete);

      expect(onBatchComplete).toHaveBeenCalledTimes(3);
      expect(onBatchComplete).toHaveBeenNthCalledWith(1, 25, 60);
      expect(onBatchComplete).toHaveBeenNthCalledWith(2, 50, 60);
      expect(onBatchComplete).toHaveBeenNthCalledWith(3, 60, 60);
    });

    it('aggregates created/updated/errors across all batches', async () => {
      // 3 batches: each with 25 items — all new (findFirst returns null)
      const items = Array.from({ length: 75 }, (_, i) =>
        makeItem(`EXT-AGG-${i}`, `agg-${i}.pdf`)
      );

      mockFilesFindFirst.mockResolvedValue(null);
      mockFilesCreate.mockResolvedValue({});

      const result = await service.ingestAll(items, defaultCtx());

      expect(result.created).toBe(75);
      expect(result.updated).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('handles zero items gracefully without calling transaction', async () => {
      const result = await service.ingestAll([], defaultCtx());

      expect(result).toEqual({ created: 0, updated: 0, errors: 0 });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('handles exactly INGESTION_BATCH_SIZE items in a single batch', async () => {
      const items = Array.from({ length: INGESTION_BATCH_SIZE }, (_, i) =>
        makeItem(`EXT-EXACT-${i}`, `exact-${i}.pdf`)
      );

      await service.ingestAll(items, defaultCtx());

      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('aggregates a mix of created and updated results', async () => {
      // 50 items: first 25 are "existing" (update), second 25 are new (create)
      const items = Array.from({ length: 50 }, (_, i) =>
        makeItem(`EXT-MIX-${i}`, `mix-${i}.pdf`)
      );

      let callCount = 0;
      mockFilesFindFirst.mockImplementation(async () => {
        callCount++;
        // First 25 calls (batch 1): return existing record
        if (callCount <= 25) {
          return { id: `EXISTING-${callCount}`, pipeline_status: 'ready' };
        }
        // Next 25 calls (batch 2): return null (new)
        return null;
      });

      const result = await service.ingestAll(items, defaultCtx());

      expect(result.updated).toBe(25);
      expect(result.created).toBe(25);
      expect(result.errors).toBe(0);
    });

    it('does not call the progress callback when items are empty', async () => {
      const onBatchComplete = vi.fn();

      await service.ingestAll([], defaultCtx(), onBatchComplete);

      expect(onBatchComplete).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ingestAll() — deferred dispatch
  // ==========================================================================

  describe('ingestAll() — deferred dispatch', () => {
    it('dispatches all files AFTER all batches complete (not interleaved)', async () => {
      const items = Array.from({ length: 60 }, (_, i) =>
        makeItem(`EXT-DD-${i}`, `deferred-${i}.pdf`)
      );

      // All files are new
      mockFilesFindFirst.mockResolvedValue(null);
      mockFilesCreate.mockResolvedValue({});

      const callOrder: string[] = [];

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const result = await fn(makeTxProxy());
        callOrder.push('transaction');
        return result;
      });

      mockAddFileProcessingFlow.mockImplementation(async () => {
        callOrder.push('dispatch');
      });

      await service.ingestAll(items, defaultCtx());

      // 60 items / 25 per batch = 3 batches
      expect(mockTransaction).toHaveBeenCalledTimes(3);
      // 60 new files dispatched
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(60);

      // All 3 transactions must appear before any dispatch call
      const firstDispatchIndex = callOrder.indexOf('dispatch');
      const lastTransactionIndex = callOrder.lastIndexOf('transaction');

      expect(firstDispatchIndex).toBeGreaterThan(-1);
      expect(lastTransactionIndex).toBeGreaterThan(-1);
      expect(firstDispatchIndex).toBeGreaterThan(lastTransactionIndex);

      // Verify the exact ordering prefix: 3 transactions then all dispatches
      expect(callOrder.slice(0, 3)).toEqual(['transaction', 'transaction', 'transaction']);
      expect(callOrder.slice(3).every((entry) => entry === 'dispatch')).toBe(true);
    });

    it('ingestBatch still dispatches immediately (not deferred)', async () => {
      const items = Array.from({ length: 5 }, (_, i) =>
        makeItem(`EXT-IMM-${i}`, `immediate-${i}.pdf`)
      );

      // All files are new
      mockFilesFindFirst.mockResolvedValue(null);
      mockFilesCreate.mockResolvedValue({});

      await service.ingestBatch(items, defaultCtx());

      // ingestBatch() dispatches right after its single transaction — not deferred
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(5);
    });

    it('deferred dispatch sends correct file info for each created file', async () => {
      const items = [
        makeItem('EXT-DI-1', 'alpha.pdf', { mimeType: 'application/pdf' }),
        makeItem('EXT-DI-2', 'beta.docx', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      ];

      // Both files are new
      mockFilesFindFirst.mockResolvedValue(null);
      mockFilesCreate.mockResolvedValue({});

      await service.ingestAll(items, defaultCtx());

      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(2);

      // Each call must carry correct context fields and a valid UPPERCASE UUID
      const calls = mockAddFileProcessingFlow.mock.calls;

      expect(calls[0][0]).toMatchObject({
        fileId: expect.stringMatching(/^[A-F0-9-]+$/),
        batchId: SCOPE_ID,
        userId: USER_ID,
        mimeType: 'application/pdf',
        fileName: 'alpha.pdf',
      });

      expect(calls[1][0]).toMatchObject({
        fileId: expect.stringMatching(/^[A-F0-9-]+$/),
        batchId: SCOPE_ID,
        userId: USER_ID,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: 'beta.docx',
      });
    });
  });
});
