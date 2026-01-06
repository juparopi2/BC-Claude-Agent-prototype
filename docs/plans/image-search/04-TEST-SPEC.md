# Test Specification - Semantic Image Search

**Fecha**: 2026-01-06
**Versión**: 1.0
**Metodología**: TDD (Test-Driven Development)

---

## 1. Filosofía de Testing

### 1.1 TDD Workflow

```
1. WRITE TEST (RED)    → Test falla porque funcionalidad no existe
2. WRITE CODE (GREEN)  → Implementar mínimo código para pasar test
3. REFACTOR (CLEAN)    → Mejorar código manteniendo tests verdes
```

### 1.2 Test Pyramid

```
        /\
       /E2E\        (3-5 tests)  - Flujo completo upload→search
      /------\
     /Integr. \     (10-15 tests) - DB + Azure AI Search
    /----------\
   /   Unit     \   (30-40 tests) - Lógica aislada
  /--------------\
```

### 1.3 Patrones del Proyecto

```typescript
// Patrón Singleton con reset para tests
export class MyService {
  private static instance: MyService;
  static getInstance(): MyService { ... }
  static resetInstance(): void { ... }  // Para tests
}

// Logger con servicio
private logger = createChildLogger({ service: 'MyService' });

// Multi-tenant siempre
async search(userId: string, query: string): Promise<Result[]> {
  // userId OBLIGATORIO
}
```

---

## 2. Unit Tests

### 2.1 ImageEmbeddingRepository

**Archivo**: `backend/src/__tests__/unit/repositories/ImageEmbeddingRepository.test.ts`

```typescript
import { ImageEmbeddingRepository } from '@/repositories/ImageEmbeddingRepository';

describe('ImageEmbeddingRepository', () => {
  let repository: ImageEmbeddingRepository;
  let mockExecuteQuery: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteQuery = jest.fn();
    // Mock database module
    jest.mock('@/infrastructure/database/database', () => ({
      executeQuery: mockExecuteQuery,
    }));
    repository = ImageEmbeddingRepository.getInstance();
  });

  afterEach(() => {
    ImageEmbeddingRepository.resetInstance();
  });

  describe('upsert', () => {
    it('should insert new embedding when file has no existing embedding', async () => {
      // Arrange
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [] })  // getByFileId returns null
        .mockResolvedValueOnce({ rowsAffected: [1] });  // insert succeeds

      const params = {
        fileId: 'file-123',
        userId: 'user-456',
        embedding: new Array(1024).fill(0.1),
        dimensions: 1024,
        model: 'azure-vision-vectorize-image',
        modelVersion: '2023-04-15',
      };

      // Act
      const id = await repository.upsert(params);

      // Assert
      expect(id).toBeDefined();
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
      expect(mockExecuteQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO image_embeddings'),
        expect.objectContaining({ fileId: 'file-123' })
      );
    });

    it('should update existing embedding when file already has one', async () => {
      // Arrange
      mockExecuteQuery
        .mockResolvedValueOnce({
          recordset: [{ id: 'existing-id', file_id: 'file-123' }]
        })
        .mockResolvedValueOnce({ rowsAffected: [1] });

      const params = {
        fileId: 'file-123',
        userId: 'user-456',
        embedding: new Array(1024).fill(0.2),
        dimensions: 1024,
        model: 'azure-vision-vectorize-image',
        modelVersion: '2023-04-15',
      };

      // Act
      const id = await repository.upsert(params);

      // Assert
      expect(id).toBe('existing-id');
      expect(mockExecuteQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE image_embeddings'),
        expect.any(Object)
      );
    });

    it('should throw error for invalid embedding dimensions', async () => {
      const params = {
        fileId: 'file-123',
        userId: 'user-456',
        embedding: [0.1, 0.2],  // Wrong dimensions
        dimensions: 2,
        model: 'invalid',
        modelVersion: '1.0',
      };

      await expect(repository.upsert(params))
        .rejects.toThrow('Invalid embedding dimensions');
    });
  });

  describe('getByFileId', () => {
    it('should return null when embedding does not exist', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [] });

      const result = await repository.getByFileId('nonexistent', 'user-123');

      expect(result).toBeNull();
    });

    it('should return embedding with parsed JSON array', async () => {
      mockExecuteQuery.mockResolvedValue({
        recordset: [{
          id: 'emb-123',
          file_id: 'file-123',
          user_id: 'user-456',
          embedding: '[0.1, 0.2, 0.3]',
          dimensions: 3,
          model: 'test-model',
          model_version: '1.0',
          created_at: new Date(),
        }]
      });

      const result = await repository.getByFileId('file-123', 'user-456');

      expect(result).not.toBeNull();
      expect(result!.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(Array.isArray(result!.embedding)).toBe(true);
    });

    it('should enforce multi-tenant isolation (userId filter)', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [] });

      await repository.getByFileId('file-123', 'user-456');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @userId'),
        expect.objectContaining({ userId: 'user-456' })
      );
    });
  });

  describe('deleteByFileId', () => {
    it('should return true when deletion succeeds', async () => {
      mockExecuteQuery.mockResolvedValue({ rowsAffected: [1] });

      const result = await repository.deleteByFileId('file-123', 'user-456');

      expect(result).toBe(true);
    });

    it('should return false when no rows deleted', async () => {
      mockExecuteQuery.mockResolvedValue({ rowsAffected: [0] });

      const result = await repository.deleteByFileId('nonexistent', 'user-456');

      expect(result).toBe(false);
    });
  });
});
```

---

### 2.2 ImageSearchService

**Archivo**: `backend/src/__tests__/unit/services/search/ImageSearchService.test.ts`

```typescript
import { ImageSearchService } from '@/services/search/ImageSearchService';
import { EmbeddingService } from '@/services/embeddings/EmbeddingService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { FileService } from '@/services/files/FileService';

jest.mock('@/services/embeddings/EmbeddingService');
jest.mock('@/services/search/VectorSearchService');
jest.mock('@/services/files/FileService');

describe('ImageSearchService', () => {
  let service: ImageSearchService;
  let mockEmbeddingService: jest.Mocked<EmbeddingService>;
  let mockVectorSearchService: jest.Mocked<VectorSearchService>;
  let mockFileService: jest.Mocked<FileService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEmbeddingService = {
      generateQueryEmbedding: jest.fn(),
    } as any;

    mockVectorSearchService = {
      searchImages: jest.fn(),
    } as any;

    mockFileService = {
      getFile: jest.fn(),
    } as any;

    (EmbeddingService.getInstance as jest.Mock).mockReturnValue(mockEmbeddingService);
    (VectorSearchService.getInstance as jest.Mock).mockReturnValue(mockVectorSearchService);
    (FileService.getInstance as jest.Mock).mockReturnValue(mockFileService);

    service = ImageSearchService.getInstance();
  });

  afterEach(() => {
    ImageSearchService.resetInstance();
  });

  describe('searchByText', () => {
    it('should return enriched results with file metadata', async () => {
      // Arrange
      const queryEmbedding = new Array(1024).fill(0.1);
      mockEmbeddingService.generateQueryEmbedding.mockResolvedValue({
        embedding: queryEmbedding,
        model: 'azure-vision-vectorize-text',
      });

      mockVectorSearchService.searchImages.mockResolvedValue([
        { fileId: 'file-1', score: 0.95, content: '[Image: photo1.jpg]' },
        { fileId: 'file-2', score: 0.85, content: '[Image: photo2.jpg]' },
      ]);

      mockFileService.getFile
        .mockResolvedValueOnce({ id: 'file-1', name: 'photo1.jpg', blobPath: '/path/1' })
        .mockResolvedValueOnce({ id: 'file-2', name: 'photo2.jpg', blobPath: '/path/2' });

      // Act
      const result = await service.searchByText({
        userId: 'user-123',
        query: 'metal boxes',
        top: 10,
      });

      // Assert
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({
        fileId: 'file-1',
        fileName: 'photo1.jpg',
        score: 0.95,
        thumbnailUrl: '/path/1',
      });
      expect(result.query).toBe('metal boxes');
    });

    it('should call VectorizeText API for query embedding', async () => {
      mockEmbeddingService.generateQueryEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'test',
      });
      mockVectorSearchService.searchImages.mockResolvedValue([]);

      await service.searchByText({
        userId: 'user-123',
        query: 'test query',
      });

      expect(mockEmbeddingService.generateQueryEmbedding).toHaveBeenCalledWith(
        'test query',
        'user-123'
      );
    });

    it('should handle deleted files gracefully', async () => {
      mockEmbeddingService.generateQueryEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'test',
      });

      mockVectorSearchService.searchImages.mockResolvedValue([
        { fileId: 'deleted-file', score: 0.9, content: '[Image: deleted.jpg]' },
      ]);

      mockFileService.getFile.mockRejectedValue(new Error('File not found'));

      const result = await service.searchByText({
        userId: 'user-123',
        query: 'test',
      });

      // Should still return result with 'Unknown' filename
      expect(result.results).toHaveLength(1);
      expect(result.results[0].fileName).toBe('Unknown');
    });

    it('should respect minScore parameter', async () => {
      mockEmbeddingService.generateQueryEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'test',
      });
      mockVectorSearchService.searchImages.mockResolvedValue([]);

      await service.searchByText({
        userId: 'user-123',
        query: 'test',
        minScore: 0.8,
      });

      expect(mockVectorSearchService.searchImages).toHaveBeenCalledWith(
        expect.objectContaining({ minScore: 0.8 })
      );
    });

    it('should throw error when embedding service fails', async () => {
      mockEmbeddingService.generateQueryEmbedding.mockRejectedValue(
        new Error('Azure Vision unavailable')
      );

      await expect(service.searchByText({
        userId: 'user-123',
        query: 'test',
      })).rejects.toThrow('Azure Vision unavailable');
    });
  });
});
```

---

### 2.3 EmbeddingService.generateQueryEmbedding

**Archivo**: `backend/src/__tests__/unit/services/embeddings/EmbeddingService.test.ts`

**Agregar a tests existentes**:

```typescript
describe('generateQueryEmbedding', () => {
  it('should call Azure Vision VectorizeText API', async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        vector: new Array(1024).fill(0.1),
        modelVersion: '2023-04-15',
      }),
    });

    // Act
    const result = await service.generateQueryEmbedding('test query', 'user-123');

    // Assert
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/computervision/retrieval:vectorizeText'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'test query' }),
      })
    );
    expect(result.embedding).toHaveLength(1024);
  });

  it('should throw error when Azure Vision not configured', async () => {
    // Set env to undefined
    process.env.AZURE_VISION_ENDPOINT = '';

    await expect(service.generateQueryEmbedding('test', 'user'))
      .rejects.toThrow('Azure Vision not configured');
  });

  it('should track usage for billing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        vector: new Array(1024).fill(0.1),
        modelVersion: '2023-04-15',
      }),
    });

    await service.generateQueryEmbedding('test query', 'user-123');

    expect(mockUsageTrackingService.trackEmbedding).toHaveBeenCalledWith(
      'user-123',
      'query-embedding',
      1,
      'query',
      expect.objectContaining({ model: 'azure-vision-vectorize-text' })
    );
  });
});
```

---

### 2.4 VectorSearchService Image Methods

**Archivo**: `backend/src/__tests__/unit/services/search/VectorSearchService.test.ts`

**Agregar a tests existentes**:

```typescript
describe('indexImageEmbedding', () => {
  it('should upload document with imageVector field', async () => {
    mockSearchClient.uploadDocuments.mockResolvedValue({
      results: [{ key: 'img_file-123', succeeded: true }],
    });

    await service.indexImageEmbedding({
      fileId: 'file-123',
      userId: 'user-456',
      embedding: new Array(1024).fill(0.1),
      fileName: 'test.jpg',
    });

    expect(mockSearchClient.uploadDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        chunkId: 'img_file-123',
        imageVector: expect.any(Array),
        contentVector: null,
        isImage: true,
      }),
    ]);
  });

  it('should throw error on indexing failure', async () => {
    mockSearchClient.uploadDocuments.mockResolvedValue({
      results: [{ key: 'img_file-123', succeeded: false, errorMessage: 'Index full' }],
    });

    await expect(service.indexImageEmbedding({
      fileId: 'file-123',
      userId: 'user-456',
      embedding: new Array(1024).fill(0.1),
      fileName: 'test.jpg',
    })).rejects.toThrow('Failed to index image embedding');
  });
});

describe('searchImages', () => {
  it('should search only imageVector field with isImage filter', async () => {
    mockSearchClient.search.mockReturnValue({
      results: createAsyncIterator([
        { document: { fileId: 'file-1' }, score: 0.9 },
      ]),
    });

    await service.searchImages({
      queryEmbedding: new Array(1024).fill(0.1),
      userId: 'user-123',
      top: 10,
    });

    expect(mockSearchClient.search).toHaveBeenCalledWith(
      '*',
      expect.objectContaining({
        filter: expect.stringContaining('isImage eq true'),
        vectorSearchOptions: expect.objectContaining({
          queries: [
            expect.objectContaining({
              fields: ['imageVector'],
            }),
          ],
        }),
      })
    );
  });

  it('should filter results by minScore', async () => {
    mockSearchClient.search.mockReturnValue({
      results: createAsyncIterator([
        { document: { fileId: 'file-1' }, score: 0.9 },
        { document: { fileId: 'file-2' }, score: 0.4 },  // Below threshold
      ]),
    });

    const results = await service.searchImages({
      queryEmbedding: new Array(1024).fill(0.1),
      userId: 'user-123',
      minScore: 0.5,
    });

    expect(results).toHaveLength(1);
    expect(results[0].fileId).toBe('file-1');
  });

  it('should always enforce userId filter (multi-tenant)', async () => {
    mockSearchClient.search.mockReturnValue({
      results: createAsyncIterator([]),
    });

    await service.searchImages({
      queryEmbedding: new Array(1024).fill(0.1),
      userId: 'user-123',
    });

    expect(mockSearchClient.search).toHaveBeenCalledWith(
      '*',
      expect.objectContaining({
        filter: expect.stringContaining("userId eq 'user-123'"),
      })
    );
  });
});
```

---

## 3. Integration Tests

### 3.1 ImageSearchService Integration

**Archivo**: `backend/src/__tests__/integration/search/ImageSearchService.integration.test.ts`

```typescript
import { ImageSearchService } from '@/services/search/ImageSearchService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { EmbeddingService } from '@/services/embeddings/EmbeddingService';

// Skip if Azure Vision not configured
const hasAzureVision = process.env.AZURE_VISION_ENDPOINT && process.env.AZURE_VISION_KEY;
const describeOrSkip = hasAzureVision ? describe : describe.skip;

describeOrSkip('ImageSearchService Integration', () => {
  const TEST_USER_ID = 'test-user-integration';
  let imageSearchService: ImageSearchService;
  let vectorSearchService: VectorSearchService;

  beforeAll(async () => {
    imageSearchService = ImageSearchService.getInstance();
    vectorSearchService = VectorSearchService.getInstance();
    await vectorSearchService.ensureIndexExists();
  });

  afterAll(async () => {
    // Cleanup test documents
    await vectorSearchService.deleteChunksForUser(TEST_USER_ID);
  });

  it('should index image and find it via text search', async () => {
    // 1. Generate real image embedding
    const embeddingService = EmbeddingService.getInstance();
    const testImageBuffer = Buffer.from('fake-image-data');  // Use real image in actual test

    // Note: This would need a real image for actual integration test
    // For now, we'll use a mock embedding
    const imageEmbedding = new Array(1024).fill(0.5);

    // 2. Index the image
    await vectorSearchService.indexImageEmbedding({
      fileId: 'integration-test-file',
      userId: TEST_USER_ID,
      embedding: imageEmbedding,
      fileName: 'test-product.jpg',
    });

    // 3. Wait for indexing (Azure Search is eventually consistent)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 4. Search for the image
    const results = await imageSearchService.searchByText({
      userId: TEST_USER_ID,
      query: 'product photo',
      top: 5,
    });

    // 5. Verify
    expect(results.results.length).toBeGreaterThanOrEqual(1);
    expect(results.results[0].fileId).toBe('integration-test-file');
  });

  it('should not return images from other users', async () => {
    // Index image for different user
    await vectorSearchService.indexImageEmbedding({
      fileId: 'other-user-file',
      userId: 'other-user',
      embedding: new Array(1024).fill(0.5),
      fileName: 'other.jpg',
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Search as TEST_USER_ID
    const results = await imageSearchService.searchByText({
      userId: TEST_USER_ID,
      query: 'any query',
      top: 100,
    });

    // Should not find other user's images
    const otherUserFiles = results.results.filter(r => r.fileId === 'other-user-file');
    expect(otherUserFiles).toHaveLength(0);
  });
});
```

---

### 3.2 Database Repository Integration

**Archivo**: `backend/src/__tests__/integration/repositories/ImageEmbeddingRepository.integration.test.ts`

```typescript
import { ImageEmbeddingRepository } from '@/repositories/ImageEmbeddingRepository';
import { executeQuery } from '@/infrastructure/database/database';

describe('ImageEmbeddingRepository Integration', () => {
  const TEST_USER_ID = 'e2e00001-0000-0000-0000-000000000001';
  const TEST_FILE_ID = 'e2e10001-0000-0000-0000-000000000001';
  let repository: ImageEmbeddingRepository;

  beforeAll(async () => {
    repository = ImageEmbeddingRepository.getInstance();

    // Ensure test user and file exist
    await executeQuery(`
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = @userId)
      INSERT INTO users (id, email, name) VALUES (@userId, 'test@test.com', 'Test')
    `, { userId: TEST_USER_ID });

    await executeQuery(`
      IF NOT EXISTS (SELECT 1 FROM files WHERE id = @fileId)
      INSERT INTO files (id, user_id, name, mime_type, size_bytes, blob_path)
      VALUES (@fileId, @userId, 'test.jpg', 'image/jpeg', 1000, '/test/path')
    `, { fileId: TEST_FILE_ID, userId: TEST_USER_ID });
  });

  afterAll(async () => {
    // Cleanup
    await executeQuery('DELETE FROM image_embeddings WHERE user_id = @userId', { userId: TEST_USER_ID });
  });

  it('should insert and retrieve embedding', async () => {
    const embedding = new Array(1024).fill(0.123);

    const id = await repository.upsert({
      fileId: TEST_FILE_ID,
      userId: TEST_USER_ID,
      embedding,
      dimensions: 1024,
      model: 'test-model',
      modelVersion: '1.0',
    });

    expect(id).toBeDefined();

    const retrieved = await repository.getByFileId(TEST_FILE_ID, TEST_USER_ID);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.embedding).toHaveLength(1024);
    expect(retrieved!.embedding[0]).toBeCloseTo(0.123, 5);
  });

  it('should cascade delete when file is deleted', async () => {
    // Insert embedding
    await repository.upsert({
      fileId: TEST_FILE_ID,
      userId: TEST_USER_ID,
      embedding: new Array(1024).fill(0.1),
      dimensions: 1024,
      model: 'test',
      modelVersion: '1.0',
    });

    // Delete the file
    await executeQuery('DELETE FROM files WHERE id = @fileId', { fileId: TEST_FILE_ID });

    // Embedding should be gone (cascade)
    const retrieved = await repository.getByFileId(TEST_FILE_ID, TEST_USER_ID);
    expect(retrieved).toBeNull();
  });
});
```

---

## 4. E2E Tests

### 4.1 Image Search API

**Archivo**: `backend/src/__tests__/e2e/api/image-search.api.test.ts`

```typescript
import request from 'supertest';
import { app } from '@/server';
import { createTestUser, deleteTestUser, getAuthToken } from '../helpers/auth';

describe('GET /api/files/search/images', () => {
  let authToken: string;
  const testUserId = 'e2e00001-image-search-test';

  beforeAll(async () => {
    await createTestUser(testUserId);
    authToken = await getAuthToken(testUserId);
  });

  afterAll(async () => {
    await deleteTestUser(testUserId);
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .get('/api/files/search/images')
      .query({ q: 'test' });

    expect(response.status).toBe(401);
  });

  it('should return 400 without query parameter', async () => {
    const response = await request(app)
      .get('/api/files/search/images')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Query parameter q is required');
  });

  it('should return empty results for new user', async () => {
    const response = await request(app)
      .get('/api/files/search/images')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ q: 'metal boxes' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.results).toEqual([]);
  });

  it('should respect top parameter limit', async () => {
    const response = await request(app)
      .get('/api/files/search/images')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ q: 'test', top: '100' });  // Exceeds max

    expect(response.status).toBe(200);
    // Should be capped at 50
    expect(response.body.data.results.length).toBeLessThanOrEqual(50);
  });
});
```

---

## 5. Security Tests

### 5.1 Multi-Tenant Isolation

**Archivo**: `backend/src/__tests__/unit/security/image-search-multi-tenant.test.ts`

```typescript
describe('Image Search Multi-Tenant Security', () => {
  it('should always include userId in search filter', async () => {
    const searchSpy = jest.spyOn(mockSearchClient, 'search');

    await vectorSearchService.searchImages({
      queryEmbedding: new Array(1024).fill(0.1),
      userId: 'user-123',
    });

    const [, options] = searchSpy.mock.calls[0];
    expect(options.filter).toMatch(/userId eq 'user-123'/);
  });

  it('should reject search without userId', async () => {
    await expect(vectorSearchService.searchImages({
      queryEmbedding: new Array(1024).fill(0.1),
      userId: '',  // Empty
    })).rejects.toThrow('userId is required');
  });

  it('should not allow SQL injection in userId filter', async () => {
    const maliciousUserId = "user-123' OR '1'='1";

    await vectorSearchService.searchImages({
      queryEmbedding: new Array(1024).fill(0.1),
      userId: maliciousUserId,
    });

    // Filter should be properly escaped
    expect(mockSearchClient.search).toHaveBeenCalledWith(
      '*',
      expect.objectContaining({
        filter: expect.not.stringContaining("OR '1'='1'"),
      })
    );
  });
});
```

---

## 6. Test Data Factories

### 6.1 Image Embedding Factory

**Archivo**: `backend/src/__tests__/factories/imageEmbedding.factory.ts`

```typescript
export interface ImageEmbeddingFactoryOptions {
  fileId?: string;
  userId?: string;
  dimensions?: number;
  model?: string;
}

export function createMockImageEmbedding(options: ImageEmbeddingFactoryOptions = {}) {
  const {
    fileId = `file-${Date.now()}`,
    userId = `user-${Date.now()}`,
    dimensions = 1024,
    model = 'azure-vision-vectorize-image',
  } = options;

  return {
    id: `emb-${Date.now()}`,
    fileId,
    userId,
    embedding: new Array(dimensions).fill(Math.random()),
    dimensions,
    model,
    modelVersion: '2023-04-15',
    createdAt: new Date(),
  };
}

export function createMockQueryEmbedding(text: string) {
  return {
    embedding: new Array(1024).fill(Math.random()),
    model: 'azure-vision-vectorize-text',
    text,
  };
}

export function createMockSearchResult(options: { fileId?: string; score?: number } = {}) {
  return {
    fileId: options.fileId || `file-${Date.now()}`,
    score: options.score || Math.random(),
    content: '[Image: test.jpg]',
  };
}
```

---

## 7. Coverage Requirements

| Component | Minimum Coverage |
|-----------|-----------------|
| `ImageEmbeddingRepository` | 95% |
| `ImageSearchService` | 90% |
| `VectorSearchService` (image methods) | 90% |
| `EmbeddingService.generateQueryEmbedding` | 90% |
| API Routes | 85% |

**Command**:
```bash
npm run test:unit -- --coverage --collectCoverageFrom="src/services/search/**/*.ts"
```

---

## 8. Test Execution Checklist

- [ ] Unit tests pass locally
- [ ] Integration tests pass with real Azure services
- [ ] E2E tests pass with seeded data
- [ ] Coverage meets requirements
- [ ] No flaky tests (run 5x)
- [ ] Tests run in CI pipeline
- [ ] Security tests pass
- [ ] Multi-tenant isolation verified
