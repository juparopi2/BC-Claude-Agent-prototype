import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dynamic imports
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    upload_batches: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    files: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(),
}));

describe('BatchTimeoutService', () => {
  let BatchTimeoutService: typeof import('@/domains/files/cleanup/BatchTimeoutService').BatchTimeoutService;
  let mockPrisma: {
    upload_batches: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    files: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  };
  let mockUploadService: { deleteFromBlob: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();

    const prismaModule = await import('@/infrastructure/database/prisma');
    mockPrisma = prismaModule.prisma as unknown as typeof mockPrisma;

    mockUploadService = { deleteFromBlob: vi.fn().mockResolvedValue(undefined) };
    const fileServiceModule = await import('@/services/files/FileUploadService');
    vi.mocked(fileServiceModule.getFileUploadService).mockReturnValue(mockUploadService as never);

    const mod = await import('@/domains/files/cleanup/BatchTimeoutService');
    BatchTimeoutService = mod.BatchTimeoutService;
  });

  it('should return zero metrics when no expired batches exist', async () => {
    vi.mocked(mockPrisma.upload_batches.findMany).mockResolvedValue([]);

    const service = new BatchTimeoutService();
    const result = await service.run();

    expect(result).toEqual({ expiredBatches: 0, deletedFiles: 0 });
    expect(mockPrisma.upload_batches.findMany).toHaveBeenCalledWith({
      where: {
        status: 'active',
        expires_at: { lt: expect.any(Date) },
      },
      select: { id: true, user_id: true, total_files: true },
      take: 100,
    });
    expect(mockPrisma.upload_batches.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.files.findMany).not.toHaveBeenCalled();
  });

  it('should expire a single batch and delete unconfirmed files', async () => {
    const BATCH_ID = 'BATCH001-0000-0000-0000-000000000001';
    const USER_ID = 'USER0001-0000-0000-0000-000000000001';
    const FILE_1 = 'FILE0001-0000-0000-0000-000000000001';
    const FILE_2 = 'FILE0002-0000-0000-0000-000000000002';

    vi.mocked(mockPrisma.upload_batches.findMany).mockResolvedValue([
      { id: BATCH_ID, user_id: USER_ID, total_files: 2 },
    ]);
    vi.mocked(mockPrisma.upload_batches.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(mockPrisma.files.findMany).mockResolvedValue([
      { id: FILE_1, blob_path: 'users/U1/files/blob1.pdf' },
      { id: FILE_2, blob_path: 'users/U1/files/blob2.pdf' },
    ]);
    vi.mocked(mockPrisma.files.deleteMany).mockResolvedValue({ count: 1 });

    const service = new BatchTimeoutService();
    const result = await service.run();

    expect(result).toEqual({ expiredBatches: 1, deletedFiles: 2 });

    // Batch marked expired individually
    expect(mockPrisma.upload_batches.updateMany).toHaveBeenCalledWith({
      where: { id: BATCH_ID, status: 'active' },
      data: { status: 'expired', updated_at: expect.any(Date) },
    });

    // Unconfirmed files queried per-batch
    expect(mockPrisma.files.findMany).toHaveBeenCalledWith({
      where: {
        batch_id: BATCH_ID,
        user_id: USER_ID,
        pipeline_status: 'registered',
        deletion_status: null,
      },
      select: { id: true, blob_path: true },
    });

    // Each file blob deleted individually
    expect(mockUploadService.deleteFromBlob).toHaveBeenCalledTimes(2);
    expect(mockUploadService.deleteFromBlob).toHaveBeenCalledWith('users/U1/files/blob1.pdf');
    expect(mockUploadService.deleteFromBlob).toHaveBeenCalledWith('users/U1/files/blob2.pdf');

    // Each file deleted individually with user_id
    expect(mockPrisma.files.deleteMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.files.deleteMany).toHaveBeenCalledWith({
      where: { id: FILE_1, user_id: USER_ID },
    });
    expect(mockPrisma.files.deleteMany).toHaveBeenCalledWith({
      where: { id: FILE_2, user_id: USER_ID },
    });
  });

  it('should handle files with no blob_path (skip blob delete)', async () => {
    const BATCH_ID = 'BATCH001-0000-0000-0000-000000000001';
    const USER_ID = 'USER0001-0000-0000-0000-000000000001';
    const FILE_1 = 'FILE0001-0000-0000-0000-000000000001';

    vi.mocked(mockPrisma.upload_batches.findMany).mockResolvedValue([
      { id: BATCH_ID, user_id: USER_ID, total_files: 1 },
    ]);
    vi.mocked(mockPrisma.upload_batches.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(mockPrisma.files.findMany).mockResolvedValue([
      { id: FILE_1, blob_path: null },
    ]);
    vi.mocked(mockPrisma.files.deleteMany).mockResolvedValue({ count: 1 });

    const service = new BatchTimeoutService();
    const result = await service.run();

    expect(result).toEqual({ expiredBatches: 1, deletedFiles: 1 });
    expect(mockUploadService.deleteFromBlob).not.toHaveBeenCalled();
    expect(mockPrisma.files.deleteMany).toHaveBeenCalledOnce();
  });

  it('should handle multiple expired batches independently', async () => {
    const BATCH_1 = 'BATCH001-0000-0000-0000-000000000001';
    const BATCH_2 = 'BATCH002-0000-0000-0000-000000000002';
    const USER_1 = 'USER0001-0000-0000-0000-000000000001';
    const USER_2 = 'USER0002-0000-0000-0000-000000000002';

    vi.mocked(mockPrisma.upload_batches.findMany).mockResolvedValue([
      { id: BATCH_1, user_id: USER_1, total_files: 1 },
      { id: BATCH_2, user_id: USER_2, total_files: 2 },
    ]);
    vi.mocked(mockPrisma.upload_batches.updateMany).mockResolvedValue({ count: 1 });

    // First batch: 1 unconfirmed file; second batch: 0
    vi.mocked(mockPrisma.files.findMany)
      .mockResolvedValueOnce([{ id: 'F1', blob_path: 'blob1' }])
      .mockResolvedValueOnce([]);
    vi.mocked(mockPrisma.files.deleteMany).mockResolvedValue({ count: 1 });

    const service = new BatchTimeoutService();
    const result = await service.run();

    expect(result).toEqual({ expiredBatches: 2, deletedFiles: 1 });
    expect(mockPrisma.upload_batches.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.files.findMany).toHaveBeenCalledTimes(2);
  });

  it('should continue processing batches when one file deletion fails', async () => {
    const BATCH_ID = 'BATCH001-0000-0000-0000-000000000001';
    const USER_ID = 'USER0001-0000-0000-0000-000000000001';

    vi.mocked(mockPrisma.upload_batches.findMany).mockResolvedValue([
      { id: BATCH_ID, user_id: USER_ID, total_files: 2 },
    ]);
    vi.mocked(mockPrisma.upload_batches.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(mockPrisma.files.findMany).mockResolvedValue([
      { id: 'F1', blob_path: 'blob1' },
      { id: 'F2', blob_path: 'blob2' },
    ]);

    // First blob delete fails, second succeeds
    mockUploadService.deleteFromBlob
      .mockRejectedValueOnce(new Error('Blob not found'))
      .mockResolvedValueOnce(undefined);
    vi.mocked(mockPrisma.files.deleteMany).mockResolvedValue({ count: 1 });

    const service = new BatchTimeoutService();
    const result = await service.run();

    // First file: blob delete failed → entire file try/catch catches it, deletedFiles not incremented
    // Second file: succeeds → deletedFiles incremented
    expect(result).toEqual({ expiredBatches: 1, deletedFiles: 1 });
    expect(mockUploadService.deleteFromBlob).toHaveBeenCalledTimes(2);
  });

  it('should not throw when batch update fails (outer try/catch)', async () => {
    vi.mocked(mockPrisma.upload_batches.findMany).mockRejectedValue(
      new Error('Database connection failed'),
    );

    const service = new BatchTimeoutService();
    const result = await service.run();

    // Outer catch returns zero metrics, doesn't throw
    expect(result).toEqual({ expiredBatches: 0, deletedFiles: 0 });
  });
});
