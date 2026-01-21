/**
 * FileMetadataService Unit Tests
 *
 * Tests for file metadata update operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FileMetadataService,
  getFileMetadataService,
  __resetFileMetadataService,
} from '@/services/files/operations/FileMetadataService';
import { FileFixture } from '@/__tests__/fixtures/FileFixture';

// ===== MOCK REPOSITORY (vi.hoisted pattern) =====
const mockRepository = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  updateProcessingStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => mockRepository),
}));

// ===== MOCK LOGGER (vi.hoisted pattern) =====
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

describe('FileMetadataService', () => {
  let service: FileMetadataService;

  const testUserId = 'TEST-USER-META-123';
  const testFileId = 'TEST-FILE-META-456';

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository.findById.mockResolvedValue(null);
    mockRepository.update.mockResolvedValue(undefined);
    mockRepository.updateProcessingStatus.mockResolvedValue(undefined);

    __resetFileMetadataService();
    service = getFileMetadataService();
  });

  // ========================================================================
  // SINGLETON PATTERN
  // ========================================================================
  describe('Singleton Pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = getFileMetadataService();
      const instance2 = getFileMetadataService();

      expect(instance1).toBe(instance2);
    });
  });

  // ========================================================================
  // update()
  // ========================================================================
  describe('update()', () => {
    it('returns void on success', async () => {
      const result = await service.update(testUserId, testFileId, { name: 'renamed.pdf' });

      expect(result).toBeUndefined();
    });

    it('delegates to repository.update', async () => {
      await service.update(testUserId, testFileId, { name: 'new-name.pdf' });

      expect(mockRepository.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { name: 'new-name.pdf' }
      );
    });

    it('passes parentFolderId update', async () => {
      await service.update(testUserId, testFileId, { parentFolderId: 'new-parent' });

      expect(mockRepository.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { parentFolderId: 'new-parent' }
      );
    });

    it('passes isFavorite update', async () => {
      await service.update(testUserId, testFileId, { isFavorite: true });

      expect(mockRepository.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { isFavorite: true }
      );
    });

    it('passes multiple updates', async () => {
      await service.update(testUserId, testFileId, {
        name: 'renamed.pdf',
        parentFolderId: 'folder-id',
        isFavorite: true,
      });

      expect(mockRepository.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        {
          name: 'renamed.pdf',
          parentFolderId: 'folder-id',
          isFavorite: true,
        }
      );
    });
  });

  // ========================================================================
  // toggleFavorite()
  // ========================================================================
  describe('toggleFavorite()', () => {
    it('toggles from false to true', async () => {
      const mockFile = FileFixture.createParsedFile({
        id: testFileId,
        userId: testUserId,
        isFavorite: false,
      });
      mockRepository.findById.mockResolvedValueOnce(mockFile);

      const newStatus = await service.toggleFavorite(testUserId, testFileId);

      expect(newStatus).toBe(true);
      expect(mockRepository.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { isFavorite: true }
      );
    });

    it('toggles from true to false', async () => {
      const mockFile = FileFixture.createParsedFile({
        id: testFileId,
        userId: testUserId,
        isFavorite: true,
      });
      mockRepository.findById.mockResolvedValueOnce(mockFile);

      const newStatus = await service.toggleFavorite(testUserId, testFileId);

      expect(newStatus).toBe(false);
      expect(mockRepository.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { isFavorite: false }
      );
    });

    it('throws when file not found', async () => {
      mockRepository.findById.mockResolvedValueOnce(null);

      await expect(
        service.toggleFavorite(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========================================================================
  // move()
  // ========================================================================
  describe('move()', () => {
    it('returns void on success', async () => {
      const result = await service.move(testUserId, testFileId, 'new-folder-id');

      expect(result).toBeUndefined();
    });

    it('delegates to repository.update with parentFolderId', async () => {
      await service.move(testUserId, testFileId, 'folder-123');

      expect(mockRepository.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { parentFolderId: 'folder-123' }
      );
    });

    it('accepts null for moving to root', async () => {
      await service.move(testUserId, testFileId, null);

      expect(mockRepository.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { parentFolderId: null }
      );
    });
  });

  // ========================================================================
  // updateProcessingStatus()
  // ========================================================================
  describe('updateProcessingStatus()', () => {
    it('returns void on success', async () => {
      const result = await service.updateProcessingStatus(testUserId, testFileId, 'completed');

      expect(result).toBeUndefined();
    });

    it('delegates to repository.updateProcessingStatus', async () => {
      await service.updateProcessingStatus(testUserId, testFileId, 'completed');

      expect(mockRepository.updateProcessingStatus).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        'completed',
        undefined
      );
    });

    it('passes extractedText when provided', async () => {
      await service.updateProcessingStatus(
        testUserId,
        testFileId,
        'completed',
        'Extracted content'
      );

      expect(mockRepository.updateProcessingStatus).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        'completed',
        'Extracted content'
      );
    });

    it('handles all processing statuses', async () => {
      const statuses: Array<'pending' | 'processing' | 'completed' | 'failed'> = [
        'pending', 'processing', 'completed', 'failed'
      ];

      for (const status of statuses) {
        mockRepository.updateProcessingStatus.mockClear();
        await service.updateProcessingStatus(testUserId, testFileId, status);

        expect(mockRepository.updateProcessingStatus).toHaveBeenCalledWith(
          testUserId,
          testFileId,
          status,
          undefined
        );
      }
    });
  });

  // ========================================================================
  // ERROR HANDLING
  // ========================================================================
  describe('Error Handling', () => {
    it('throws and logs on update error', async () => {
      const updateError = new Error('DB connection failed');
      mockRepository.update.mockRejectedValueOnce(updateError);

      await expect(
        service.update(testUserId, testFileId, { name: 'test.pdf' })
      ).rejects.toThrow('DB connection failed');

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('throws and logs on toggleFavorite error', async () => {
      const mockFile = FileFixture.createParsedFile({ id: testFileId, userId: testUserId });
      mockRepository.findById.mockResolvedValueOnce(mockFile);
      mockRepository.update.mockRejectedValueOnce(new Error('Update failed'));

      await expect(
        service.toggleFavorite(testUserId, testFileId)
      ).rejects.toThrow('Update failed');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
