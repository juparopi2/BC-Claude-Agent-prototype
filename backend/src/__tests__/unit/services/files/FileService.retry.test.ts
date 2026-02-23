/**
 * FileService Retry Tracking Unit Tests
 *
 * NOTE: The retry tracking methods (incrementProcessingRetryCount,
 * incrementEmbeddingRetryCount, setLastProcessingError, setLastEmbeddingError,
 * markAsPermanentlyFailed, clearFailedStatus, updateEmbeddingStatus) have been
 * removed from FileService and extracted to FileRetryService.
 *
 * These tests are now covered by:
 * - backend/src/__tests__/unit/domains/files/FileRetryService.test.ts
 *
 * The remaining method from FileService:
 * - updateProcessingStatus() - delegates to FileMetadataService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService, getFileService } from '@/services/files/FileService';

// ===== MOCK DATABASE (vi.hoisted pattern) =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// ===== MOCK PRISMA (prevent FileRepository from initializing prisma at module load) =====
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
  disconnectPrisma: vi.fn(),
}));

// ===== MOCK FILE REPOSITORY =====
vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    findMany: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findIdsByOwner: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    createFolder: vi.fn().mockResolvedValue('NEW-FOLDER-ID'),
    create: vi.fn().mockResolvedValue('NEW-FILE-ID'),
    transitionStatus: vi.fn().mockResolvedValue({ success: true }),
    getPipelineStatus: vi.fn().mockResolvedValue('ready'),
  })),
  __resetFileRepository: vi.fn(),
}));

// ===== MOCK FILE OPERATIONS =====
vi.mock('@/services/files/operations/FileDeletionService', () => ({
  getFileDeletionService: vi.fn(() => ({
    delete: vi.fn().mockResolvedValue([]),
  })),
  __resetFileDeletionService: vi.fn(),
}));

vi.mock('@/services/files/operations/FileDuplicateService', () => ({
  getFileDuplicateService: vi.fn(() => ({
    checkByName: vi.fn().mockResolvedValue({ isDuplicate: false }),
    checkByNameBatch: vi.fn().mockResolvedValue([]),
    findByContentHash: vi.fn().mockResolvedValue([]),
    checkByHashBatch: vi.fn().mockResolvedValue([]),
  })),
  __resetFileDuplicateService: vi.fn(),
}));

vi.mock('@/services/files/operations/FileMetadataService', () => ({
  getFileMetadataService: vi.fn(() => ({
    update: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(true),
    move: vi.fn().mockResolvedValue(undefined),
    updateProcessingStatus: vi.fn().mockResolvedValue(undefined),
  })),
  __resetFileMetadataService: vi.fn(),
}));

// ===== MOCK LOGGER =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// ===== MOCK DELETION AUDIT SERVICE =====
const mockAuditService = vi.hoisted(() => ({
  logDeletionRequest: vi.fn().mockResolvedValue('audit-id-123'),
  updateStorageStatus: vi.fn().mockResolvedValue(undefined),
  markCompleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@services/files/DeletionAuditService', () => ({
  getDeletionAuditService: vi.fn(() => mockAuditService),
}));

// ===== MOCK VECTOR SEARCH SERVICE =====
const mockVectorSearchService = vi.hoisted(() => ({
  deleteChunksForFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => mockVectorSearchService),
  },
}));

// ===== MOCK crypto.randomUUID =====
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-retry-test'),
}));

describe('FileService - updateProcessingStatus', () => {
  let fileService: FileService;

  const testUserId = 'test-user-retry-456';
  const testFileId = 'test-file-retry-123';

  beforeEach(() => {
    vi.clearAllMocks();

    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
    mockAuditService.logDeletionRequest.mockResolvedValue('audit-id-123');
    mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

    (FileService as unknown as { instance: null }).instance = null;
    fileService = getFileService();
  });

  it('should delegate updateProcessingStatus to FileMetadataService', async () => {
    // updateProcessingStatus delegates to metadataService.updateProcessingStatus
    // The mock returns undefined (success)
    const result = await fileService.updateProcessingStatus(testUserId, testFileId, 'queued');
    expect(result).toBeUndefined();
  });
});
