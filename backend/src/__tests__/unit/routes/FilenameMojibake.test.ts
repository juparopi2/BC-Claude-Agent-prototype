import { describe, it, expect, vi } from 'vitest';

// Mock logger before importing modules that use it
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  })),
}));

// Mock services that transitively import @/infrastructure/database/prisma
// (FileRepository imports prisma at module level which requires DB env vars)
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: { findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
  },
  disconnectPrisma: vi.fn(),
}));

vi.mock('@services/files', () => ({
  getFileService: vi.fn(() => ({
    getFile: vi.fn(),
    getFiles: vi.fn(),
    getFileCount: vi.fn(),
    createFolder: vi.fn(),
    createFileRecord: vi.fn(),
    updateFile: vi.fn(),
    deleteFile: vi.fn(),
    verifyOwnership: vi.fn(),
  })),
  getFileUploadService: vi.fn(() => ({
    validateFileType: vi.fn(),
    generateBlobPath: vi.fn(),
    uploadToBlob: vi.fn(),
    downloadFromBlob: vi.fn(),
    deleteFromBlob: vi.fn(),
    generateSasUrlForBulkUpload: vi.fn(),
  })),
}));

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: vi.fn(),
    addFileDeletionJob: vi.fn(),
  })),
}));

vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: vi.fn(),
}));

vi.mock('@services/files/operations', () => ({
  getSoftDeleteService: vi.fn(() => ({ markForDeletion: vi.fn() })),
}));

vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({ trackFileUpload: vi.fn() })),
}));

vi.mock('@/services/search/embeddings/CohereEmbeddingService', () => ({
  CohereEmbeddingService: vi.fn(() => ({ embedQuery: vi.fn() })),
}));

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: { getInstance: vi.fn(() => ({ searchImages: vi.fn() })) },
}));

vi.mock('@/domains/files/retry', () => ({
  getProcessingRetryManager: vi.fn(() => ({ executeManualRetry: vi.fn() })),
}));

import { fixFilenameMojibake } from '@/routes/files/helpers/filename.helper';

/**
 * Helper function to simulate mojibake corruption
 * This is what happens when UTF-8 bytes are interpreted as Latin-1
 */
function createMojibake(utf8String: string): string {
  const utf8Buffer = Buffer.from(utf8String, 'utf8');
  return utf8Buffer.toString('latin1');
}

describe('Filename Mojibake Fix', () => {
  it('should detect and fix mojibake in filenames', () => {
    // Create mojibake by simulating UTF-8 bytes interpreted as Latin-1
    const original = 'Order received – pro•duhk•tiv Store.pdf';
    const corrupted = createMojibake(original);
    const fixed = fixFilenameMojibake(corrupted);

    expect(fixed).toBe(original);
    expect(fixed).toContain('–');
    expect(fixed).toContain('•');
  });

  it('should preserve already-correct filenames', () => {
    const correct = 'Normal File Name.pdf';
    const result = fixFilenameMojibake(correct);

    expect(result).toBe(correct);
  });

  it('should handle Danish characters', () => {
    // Create mojibake for Danish characters
    const original = 'Test æøå.pdf';
    const corrupted = createMojibake(original);
    const fixed = fixFilenameMojibake(corrupted);

    expect(fixed).toBe(original);
  });

  it('should handle complex multi-byte characters', () => {
    // Test with French accented characters that use 2-byte UTF-8
    const original = 'Résumé Naïve Café.pdf';
    const corrupted = createMojibake(original);
    const fixed = fixFilenameMojibake(corrupted);

    expect(fixed).toBe(original);
    expect(fixed).toContain('é');
    expect(fixed).toContain('ï');
  });

  it('should not break on files without mojibake', () => {
    const normal = 'Simple-File-123.pdf';
    const result = fixFilenameMojibake(normal);

    expect(result).toBe(normal);
  });
});
