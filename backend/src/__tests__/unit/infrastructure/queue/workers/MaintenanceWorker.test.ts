import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// Mock dynamic imports — use singleton getter functions (not class constructors)
vi.mock('@/domains/files/recovery/StuckFileRecoveryService', () => ({
  getStuckFileRecoveryService: vi.fn(),
}));

vi.mock('@/domains/files/cleanup/OrphanCleanupService', () => ({
  getOrphanCleanupService: vi.fn(),
}));

vi.mock('@/domains/files/cleanup/BatchTimeoutService', () => ({
  getBatchTimeoutService: vi.fn(),
}));

vi.mock('@/services/sync/health/SyncHealthCheckService', () => ({
  getSyncHealthCheckService: vi.fn(),
}));

vi.mock('@/services/sync/health/SyncReconciliationService', () => ({
  getSyncReconciliationService: vi.fn(),
}));

vi.mock('@/infrastructure/queue/constants', () => ({
  JOB_NAMES: {
    FILE_MAINTENANCE: {
      STUCK_FILE_RECOVERY: 'v2-stuck-file-recovery',
      ORPHAN_CLEANUP: 'v2-orphan-cleanup',
      BATCH_TIMEOUT: 'v2-batch-timeout',
      SYNC_HEALTH_CHECK: 'sync-health-check',
      SYNC_RECONCILIATION: 'sync-reconciliation',
    },
  },
}));

describe('MaintenanceWorker', () => {
  let MaintenanceWorker: typeof import('@/infrastructure/queue/workers/MaintenanceWorker').MaintenanceWorker;
  let mockStuckService: { run: ReturnType<typeof vi.fn> };
  let mockOrphanService: { run: ReturnType<typeof vi.fn> };
  let mockBatchService: { run: ReturnType<typeof vi.fn> };
  let mockHealthService: { run: ReturnType<typeof vi.fn> };
  let mockReconciliationService: { run: ReturnType<typeof vi.fn> };
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    child: ReturnType<typeof vi.fn>;
  };

  function makeJob(name: string, data: Record<string, unknown> = {}): Job {
    return {
      id: 'TEST-JOB-0000-0000-000000000001',
      name,
      data,
    } as unknown as Job;
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock services
    mockStuckService = { run: vi.fn().mockResolvedValue({ totalStuck: 0, reEnqueued: 0, permanentlyFailed: 0, byStatus: {} }) };
    mockOrphanService = { run: vi.fn().mockResolvedValue({ orphanBlobs: 0, abandonedUploads: 0, oldFailures: 0 }) };
    mockBatchService = { run: vi.fn().mockResolvedValue({ expiredBatches: 0, deletedFiles: 0 }) };
    mockHealthService = { run: vi.fn().mockResolvedValue({ scopesChecked: 0, stuckDetected: 0, recovered: 0 }) };
    mockReconciliationService = { run: vi.fn().mockResolvedValue([]) };

    const stuckMod = await import('@/domains/files/recovery/StuckFileRecoveryService');
    vi.mocked(stuckMod.getStuckFileRecoveryService).mockReturnValue(mockStuckService as never);

    const orphanMod = await import('@/domains/files/cleanup/OrphanCleanupService');
    vi.mocked(orphanMod.getOrphanCleanupService).mockReturnValue(mockOrphanService as never);

    const batchMod = await import('@/domains/files/cleanup/BatchTimeoutService');
    vi.mocked(batchMod.getBatchTimeoutService).mockReturnValue(mockBatchService as never);

    const healthMod = await import('@/services/sync/health/SyncHealthCheckService');
    vi.mocked(healthMod.getSyncHealthCheckService).mockReturnValue(mockHealthService as never);

    const reconciliationMod = await import('@/services/sync/health/SyncReconciliationService');
    vi.mocked(reconciliationMod.getSyncReconciliationService).mockReturnValue(mockReconciliationService as never);

    // Mock logger with child() returning itself
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    mockLogger.child.mockReturnValue(mockLogger);

    const mod = await import('@/infrastructure/queue/workers/MaintenanceWorker');
    MaintenanceWorker = mod.MaintenanceWorker;
  });

  it('should route stuck-file-recovery job to StuckFileRecoveryService', async () => {
    const job = makeJob('v2-stuck-file-recovery', { type: 'stuck-file-recovery' });

    const worker = new MaintenanceWorker({ logger: mockLogger });
    await worker.process(job);

    expect(mockStuckService.run).toHaveBeenCalledOnce();
    expect(mockOrphanService.run).not.toHaveBeenCalled();
    expect(mockBatchService.run).not.toHaveBeenCalled();
  });

  it('should route orphan-cleanup job to OrphanCleanupService', async () => {
    const job = makeJob('v2-orphan-cleanup', { type: 'orphan-cleanup' });

    const worker = new MaintenanceWorker({ logger: mockLogger });
    await worker.process(job);

    expect(mockOrphanService.run).toHaveBeenCalledOnce();
    expect(mockStuckService.run).not.toHaveBeenCalled();
    expect(mockBatchService.run).not.toHaveBeenCalled();
  });

  it('should route batch-timeout job to BatchTimeoutService', async () => {
    const job = makeJob('v2-batch-timeout', { type: 'batch-timeout' });

    const worker = new MaintenanceWorker({ logger: mockLogger });
    await worker.process(job);

    expect(mockBatchService.run).toHaveBeenCalledOnce();
    expect(mockStuckService.run).not.toHaveBeenCalled();
    expect(mockOrphanService.run).not.toHaveBeenCalled();
  });

  it('should route sync-health-check job to SyncHealthCheckService', async () => {
    const job = makeJob('sync-health-check', { type: 'sync-health-check' });

    const worker = new MaintenanceWorker({ logger: mockLogger });
    await worker.process(job);

    expect(mockHealthService.run).toHaveBeenCalledOnce();
    expect(mockStuckService.run).not.toHaveBeenCalled();
    expect(mockOrphanService.run).not.toHaveBeenCalled();
    expect(mockBatchService.run).not.toHaveBeenCalled();
    expect(mockReconciliationService.run).not.toHaveBeenCalled();
  });

  it('should route sync-reconciliation job to SyncReconciliationService', async () => {
    const job = makeJob('sync-reconciliation', { type: 'sync-reconciliation' });

    const worker = new MaintenanceWorker({ logger: mockLogger });
    await worker.process(job);

    expect(mockReconciliationService.run).toHaveBeenCalledOnce();
    expect(mockStuckService.run).not.toHaveBeenCalled();
    expect(mockOrphanService.run).not.toHaveBeenCalled();
    expect(mockBatchService.run).not.toHaveBeenCalled();
    expect(mockHealthService.run).not.toHaveBeenCalled();
  });

  it('should log warning for unknown job type without throwing', async () => {
    const job = makeJob('unknown-job-type', { type: 'unknown' });

    const worker = new MaintenanceWorker({ logger: mockLogger });
    await worker.process(job);

    // No service called
    expect(mockStuckService.run).not.toHaveBeenCalled();
    expect(mockOrphanService.run).not.toHaveBeenCalled();
    expect(mockBatchService.run).not.toHaveBeenCalled();

    // Warning logged via child logger
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { jobName: 'unknown-job-type' },
      'Unknown maintenance job type',
    );
  });

  it('should propagate service errors (no internal catch)', async () => {
    const job = makeJob('v2-stuck-file-recovery', { type: 'stuck-file-recovery' });
    mockStuckService.run.mockRejectedValue(new Error('Service failure'));

    const worker = new MaintenanceWorker({ logger: mockLogger });

    await expect(worker.process(job)).rejects.toThrow('Service failure');
    expect(mockStuckService.run).toHaveBeenCalledOnce();
  });
});
