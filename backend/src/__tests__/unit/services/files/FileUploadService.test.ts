import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileUploadService, getFileUploadService, __resetFileUploadService } from '@services/files';

// Mock logger only
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// Mock environment with valid connection string
vi.mock('@/config/environment', () => ({
  env: {
    STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net',
    STORAGE_CONTAINER_NAME: 'test-container',
  },
}));

// DO NOT mock Azure SDK - causes memory leaks
// Tests that need Azure SDK will be skipped

describe('FileUploadService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await __resetFileUploadService();
  });

  describe('Constructor validation', () => {
    // Test for missing STORAGE_CONNECTION_STRING moved to integration tests
    // Location: src/__tests__/integration/files/FileUploadService.integration.test.ts
    // Reason: Singleton pattern + module-level mocking makes this difficult to test in unit tests

    it('should accept optional containerName and connectionString for dependency injection', () => {
      const customConnectionString = 'DefaultEndpointsProtocol=https;AccountName=custom;AccountKey=Y3VzdG9ta2V5;EndpointSuffix=core.windows.net';
      const customContainer = 'custom-container';

      const service = getFileUploadService(customContainer, customConnectionString);

      expect(service).toBeInstanceOf(FileUploadService);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { container: customContainer },
        'FileUploadService initialized'
      );
    });
  });

  describe('Singleton pattern', () => {
    it('should return same instance on multiple calls to getInstance()', () => {
      const instance1 = getFileUploadService();
      const instance2 = getFileUploadService();

      expect(instance1).toBe(instance2);
    });
  });

  describe('generateBlobPath()', () => {
    it('should generate multi-tenant path with format users/{userId}/files/{timestamp}-{filename}', () => {
      const service = getFileUploadService();
      const userId = 'user-123';
      const fileName = 'invoice.pdf';

      const blobPath = service.generateBlobPath(userId, fileName);

      expect(blobPath).toMatch(/^users\/user-123\/files\/\d+-invoice\.pdf$/);
      expect(blobPath).toContain('users/user-123/files/');
      expect(blobPath).toContain('-invoice.pdf');
    });

    it('should use Date.now() for timestamp uniqueness', () => {
      const service = getFileUploadService();
      const userId = 'user-456';
      const fileName = 'document.docx';

      const beforeTimestamp = Date.now();
      const blobPath = service.generateBlobPath(userId, fileName);
      const afterTimestamp = Date.now();

      // Extract timestamp from path
      const timestampMatch = blobPath.match(/files\/(\d+)-/);
      expect(timestampMatch).not.toBeNull();

      const extractedTimestamp = parseInt(timestampMatch![1], 10);
      expect(extractedTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(extractedTimestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    it('should sanitize filename to remove unsafe characters', () => {
      const service = getFileUploadService();
      const userId = 'user-789';

      // Test various unsafe characters
      const unsafeFileName1 = '../../../etc/passwd';
      const unsafeFileName2 = 'file<script>alert("xss")</script>.pdf';
      const unsafeFileName3 = 'file with spaces & symbols!@#$%.txt';

      const blobPath1 = service.generateBlobPath(userId, unsafeFileName1);
      const blobPath2 = service.generateBlobPath(userId, unsafeFileName2);
      const blobPath3 = service.generateBlobPath(userId, unsafeFileName3);

      // Should not contain path traversal
      expect(blobPath1).not.toContain('../');
      expect(blobPath1).not.toContain('etc/passwd');

      // Should not contain angle brackets (sanitizer preserves alphanumeric "script")
      expect(blobPath2).not.toContain('<');
      expect(blobPath2).not.toContain('>');
      expect(blobPath2).not.toContain('(');
      expect(blobPath2).not.toContain(')');
      expect(blobPath2).not.toContain('"');
      // Note: "script" and "alert" are valid alphanumeric strings, so they're preserved

      // Should replace unsafe characters with hyphens
      expect(blobPath3).toMatch(/files\/\d+-file-with-spaces/);
      expect(blobPath3).not.toContain(' ');
      expect(blobPath3).not.toContain('&');
      expect(blobPath3).not.toContain('!');
      expect(blobPath3).not.toContain('@');
      expect(blobPath3).not.toContain('#');
      expect(blobPath3).not.toContain('$');
    });

    it('should preserve file extension after sanitization', () => {
      const service = getFileUploadService();
      const userId = 'user-999';

      const fileName1 = 'unsafe@file#name.pdf';
      const fileName2 = 'another$bad%file.docx';
      const fileName3 = 'image!with&symbols.png';

      const blobPath1 = service.generateBlobPath(userId, fileName1);
      const blobPath2 = service.generateBlobPath(userId, fileName2);
      const blobPath3 = service.generateBlobPath(userId, fileName3);

      expect(blobPath1).toMatch(/\.pdf$/);
      expect(blobPath2).toMatch(/\.docx$/);
      expect(blobPath3).toMatch(/\.png$/);
    });
  });

  describe('validateFileType()', () => {
    it('should allow PDF files', () => {
      const service = getFileUploadService();

      expect(() => {
        service.validateFileType('application/pdf');
      }).not.toThrow();
    });

    it('should allow image files (JPEG, PNG, GIF, WebP, SVG)', () => {
      const service = getFileUploadService();

      expect(() => {
        service.validateFileType('image/jpeg');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('image/png');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('image/gif');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('image/webp');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('image/svg+xml');
      }).not.toThrow();
    });

    it('should allow document files (DOCX, XLSX, TXT, CSV, Markdown)', () => {
      const service = getFileUploadService();

      expect(() => {
        service.validateFileType('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('text/plain');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('text/csv');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('text/markdown');
      }).not.toThrow();
    });

    it('should allow code files (JSON, JavaScript, HTML, CSS)', () => {
      const service = getFileUploadService();

      expect(() => {
        service.validateFileType('application/json');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('text/javascript');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('text/html');
      }).not.toThrow();

      expect(() => {
        service.validateFileType('text/css');
      }).not.toThrow();
    });

    it('should throw error for disallowed MIME type', () => {
      const service = getFileUploadService();

      expect(() => {
        service.validateFileType('application/x-executable');
      }).toThrow('File type not allowed: application/x-executable');

      expect(() => {
        service.validateFileType('application/x-msdownload');
      }).toThrow('File type not allowed: application/x-msdownload');

      expect(() => {
        service.validateFileType('video/mp4');
      }).toThrow('File type not allowed: video/mp4');
    });

    it('should throw descriptive error message with the invalid MIME type', () => {
      const service = getFileUploadService();
      const invalidMimeType = 'application/x-dangerous';

      try {
        service.validateFileType(invalidMimeType);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(invalidMimeType);
        expect((error as Error).message).toContain('File type not allowed');
        expect((error as Error).message).toContain('Allowed types:');
      }
    });
  });

  describe('validateFileSize()', () => {
    it('should allow general files under 100MB', () => {
      const service = getFileUploadService();
      const size90MB = 90 * 1024 * 1024; // 90 MB
      const size100MB = 100 * 1024 * 1024; // Exactly 100 MB

      expect(() => {
        service.validateFileSize(size90MB, 'application/pdf');
      }).not.toThrow();

      expect(() => {
        service.validateFileSize(size100MB, 'text/plain');
      }).not.toThrow();
    });

    it('should allow images under 30MB', () => {
      const service = getFileUploadService();
      const size20MB = 20 * 1024 * 1024; // 20 MB
      const size30MB = 30 * 1024 * 1024; // Exactly 30 MB

      expect(() => {
        service.validateFileSize(size20MB, 'image/jpeg');
      }).not.toThrow();

      expect(() => {
        service.validateFileSize(size30MB, 'image/png');
      }).not.toThrow();
    });

    it('should throw error for general files over 100MB', () => {
      const service = getFileUploadService();
      const size101MB = 101 * 1024 * 1024; // 101 MB
      const size200MB = 200 * 1024 * 1024; // 200 MB

      expect(() => {
        service.validateFileSize(size101MB, 'application/pdf');
      }).toThrow('File size exceeds 100MB limit for files');

      expect(() => {
        service.validateFileSize(size200MB, 'text/plain');
      }).toThrow('File size exceeds 100MB limit for files');
    });

    it('should throw error for images over 30MB', () => {
      const service = getFileUploadService();
      const size31MB = 31 * 1024 * 1024; // 31 MB
      const size50MB = 50 * 1024 * 1024; // 50 MB

      expect(() => {
        service.validateFileSize(size31MB, 'image/jpeg');
      }).toThrow('File size exceeds 30MB limit for images');

      expect(() => {
        service.validateFileSize(size50MB, 'image/png');
      }).toThrow('File size exceeds 30MB limit for images');
    });

    it('should detect image MIME types correctly using startsWith("image/")', () => {
      const service = getFileUploadService();
      const size40MB = 40 * 1024 * 1024; // 40 MB (exceeds image limit but not general limit)

      // Should use image limit (30 MB) and throw
      expect(() => {
        service.validateFileSize(size40MB, 'image/jpeg');
      }).toThrow('File size exceeds 30MB limit for images');

      expect(() => {
        service.validateFileSize(size40MB, 'image/gif');
      }).toThrow('File size exceeds 30MB limit for images');

      expect(() => {
        service.validateFileSize(size40MB, 'image/webp');
      }).toThrow('File size exceeds 30MB limit for images');

      // Should use general limit (100 MB) and NOT throw
      expect(() => {
        service.validateFileSize(size40MB, 'application/pdf');
      }).not.toThrow();

      expect(() => {
        service.validateFileSize(size40MB, 'text/plain');
      }).not.toThrow();
    });
  });

  // ============================================================================
  // INTEGRATION TESTS MOVED
  // ============================================================================
  // Azure SDK integration tests have been moved to avoid memory leaks caused by
  // mocking @azure/storage-blob in Vitest. These tests now run against Azurite
  // (Azure Blob Storage emulator) for realistic testing without mocking.
  //
  // Location: src/__tests__/integration/files/FileUploadService.integration.test.ts
  //
  // Migrated test suites (17 tests):
  //   - uploadToBlob() - single-put strategy, error handling
  //   - downloadFromBlob() - buffer download, large files, error handling
  //   - deleteFromBlob() - delete success, idempotency, error handling
  //   - generateSasToken() - SAS generation, expiry, invalid credentials
  //   - blobExists() - existence checking, error handling
  //
  // Run integration tests:
  //   npm run test:integration
  // ============================================================================
});
