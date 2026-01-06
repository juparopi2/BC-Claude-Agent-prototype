import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingService } from '@/services/embeddings/EmbeddingService';
import { env } from '@/infrastructure/config/environment';
import { OpenAI } from 'openai';

// Mock dependencies
vi.mock('openai', () => {
  return {
    OpenAI: class {
      embeddings = {
        create: vi.fn()
      }
    }
  };
});
vi.mock('@/infrastructure/config/environment', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as object,
    env: {
     ...actual.env,
      AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com/',
      AZURE_OPENAI_KEY: 'test-key',
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: 'test-deployment',
    }
  };
});

vi.mock('openai', () => {
    const MockOpenAI = vi.fn();
    MockOpenAI.prototype.embeddings = {
        create: vi.fn()
    };
    return { OpenAI: MockOpenAI };
});

// TODO: Re-enable tests after upgrading @azure/openai SDK
// Tests were skipped because AzureOpenAI is not exported in @azure/openai@2.0.0
describe('EmbeddingService', () => {
  const defaultEnv = { ...env };

  // Clear singleton instance before each test
  beforeEach(() => {
    // @ts-ignore - Accessing private static property for testing
    EmbeddingService.instance = undefined;
    Object.assign(env, defaultEnv);
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should throw error when AZURE_OPENAI_ENDPOINT is missing', () => {
      // @ts-ignore
      env.AZURE_OPENAI_ENDPOINT = undefined;
      
      expect(() => {
        EmbeddingService.getInstance();
      }).toThrow(/AZURE_OPENAI_ENDPOINT not configured/);
    });

    it('should throw error when AZURE_OPENAI_KEY is missing', () => {
        // @ts-ignore
        env.AZURE_OPENAI_KEY = undefined;
        
        expect(() => {
          EmbeddingService.getInstance();
        }).toThrow(/AZURE_OPENAI_KEY not configured/);
    });

    it('should create instance successfully when config exists', () => {
      const instance = EmbeddingService.getInstance();
      expect(instance).toBeInstanceOf(EmbeddingService);
    });

    it('should return same instance (singleton)', () => {
      const instance1 = EmbeddingService.getInstance();
      const instance2 = EmbeddingService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('generateTextEmbedding', () => {
    it('should generate embedding for single text', async () => {
      const service = EmbeddingService.getInstance();
      
      const mockCreate = vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }],
        usage: { total_tokens: 10 }
      });

      // Mock the instance method of the mocked class
      // @ts-ignore
      OpenAI.prototype.embeddings.create = mockCreate;

      const result = await service.generateTextEmbedding('test text', 'user-123');
      
      expect(result).toBeDefined();
      expect(result.embedding).toHaveLength(1536);
      expect(result.userId).toBe('user-123');
      expect(result.model).toContain('test-deployment');
      expect(mockCreate).toHaveBeenCalledWith({
          input: ['test text'],
          model: 'test-deployment'
      });
    });

    it('should return cached embedding if available', async () => {
      const service = EmbeddingService.getInstance();
      
      // Mock Redis behavior
      const mockResult = {
        embedding: new Array(1536).fill(0.2),
        model: 'test-deployment',
        tokenCount: 5,
        userId: 'user-123',
        createdAt: new Date() // JSON.stringify/parse might convert this to string, careful
      };
      
      const mockGet = vi.fn().mockResolvedValue(JSON.stringify({
          ...mockResult,
          createdAt: mockResult.createdAt.toISOString()
      }));
      const mockSet = vi.fn();

      // Inject mock redis
      // @ts-ignore
      service.cache = { get: mockGet, set: mockSet };
      // @ts-ignore
      service.getCacheKey = (text) => `embedding:${text}`; // simplistic mock

      // Mock OpenAI to ensure it's NOT called
      const mockCreate = vi.fn();
      // @ts-ignore
      OpenAI.prototype.embeddings.create = mockCreate;

      const result = await service.generateTextEmbedding('cached text', 'user-123');

      expect(mockGet).toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(result.embedding).toEqual(mockResult.embedding);
    });

    it('should cache new embeddings', async () => {
        const service = EmbeddingService.getInstance();
        
        // Mock Redis
        const mockGet = vi.fn().mockResolvedValue(null);
        const mockSet = vi.fn();
        // @ts-ignore
        service.cache = { get: mockGet, set: mockSet, expire: vi.fn() };
        // @ts-ignore
        service.getCacheKey = (text) => `embedding:${text}`; 

        // Mock OpenAI
        const mockCreate = vi.fn().mockResolvedValue({
            data: [{ embedding: new Array(1536).fill(0.3) }],
            usage: { total_tokens: 15 }
        });
        // @ts-ignore
        OpenAI.prototype.embeddings.create = mockCreate;

        await service.generateTextEmbedding('new text', 'user-123');

        expect(mockGet).toHaveBeenCalled();
        expect(mockCreate).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalled();
    });



    it('should propagate API errors', async () => {
      const service = EmbeddingService.getInstance();
      
      // Mock Redis miss
      // @ts-ignore
      service.cache = { get: vi.fn().mockResolvedValue(null) };
      // @ts-ignore
      service.getCacheKey = (text) => `embedding:${text}`; 

      const error = new Error('API Error');
      // @ts-ignore
      OpenAI.prototype.embeddings.create = vi.fn().mockRejectedValue(error);

      await expect(service.generateTextEmbedding('fail text', 'user-123'))
        .rejects.toThrow('API Error');
    });

    it('should retry on rate limit error (429)', async () => {
        // Since we rely on SDK retries, verifying this in unit tests without deep mocking of the SDK internals is hard.
        // Instead, we can verify that the client is initialized with maxRetries.
        // We'll inspect the private client property via @ts-ignore or check constructor args mock.
        
        // This test will verify that we are passing generic retry options to the client, 
        // OR we can simulate a retry scenario if we mock the client method to fail once then succeed?
        // But SDK handles retries internally, so our method is called once.
        // So we just verify configuration.
        
        // Reset singleton to trigger client creation
        // @ts-ignore
        EmbeddingService.instance = undefined;
        // @ts-ignore
        env.AZURE_OPENAI_ENDPOINT = 'https://retry.test';

        const service = EmbeddingService.getInstance();
        
        // Access private client creation by calling generateTextEmbedding
        const mockCreate = vi.fn().mockResolvedValue({data: [{embedding: []}], usage: {total_tokens: 0}});
         // @ts-ignore
        OpenAI.prototype.embeddings.create = mockCreate;
        // @ts-ignore
        service.getCacheKey = () => 'key';
        // @ts-ignore
        service.cache = { get: () => Promise.resolve(null), set: () => Promise.resolve() };
        
        await service.generateTextEmbedding('test', 'user');

        // Check if AzureOpenAI constructor was called with maxRetries
        // Note: constructor mock is top-level 'MockAzureOpenAI'
        // We need to access the mock class calls from the vi.mock definition
        // But standard AzureOpenAI mock in this file returns a class mock. 
        // We can verify calls to AzureOpenAI.
        // But 'AzureOpenAI' imported here IS the mock class.
        
        expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({
            maxRetries: 3 // We demand 3 retries
        }));
    });

    it('should handle empty text', async () => {
      const service = EmbeddingService.getInstance();
      await expect(service.generateTextEmbedding('', 'user-123'))
        .rejects.toThrow();
    });
  });

  describe('generateImageEmbedding', () => {
    it('should generate embedding for image buffer', async () => {
        const service = EmbeddingService.getInstance();
        const mockBuffer = Buffer.from('fake-image');

        // Mock fetch usage
        // We need to define global.fetch mock or inject it
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                vector: new Array(1024).fill(0.5),
                modelVersion: '2023-04-15'
            })
        });
        global.fetch = mockFetch;

        // @ts-ignore
        env.AZURE_VISION_ENDPOINT = 'https://vision.test';
        // @ts-ignore
        env.AZURE_VISION_KEY = 'vision-key';

        // Re-init to pick up vision config?
        // Logic might check config at call time or init.
        // If init, we need to reset instance.
        // But let's assume methods read env or config property is updatable.
        // Actually constructor reads Env.

        // Reset singleton
        // @ts-ignore
        EmbeddingService.instance = undefined;
        // @ts-ignore
        service.config = { ...service.config, visionEndpoint: 'https://vision.test', visionKey: 'vision-key' };

        // We'll trust the method implementation to handle config.
        // But for test reliability, let's create a new instance with mocks.

        const instance = EmbeddingService.getInstance();

        const result = await instance.generateImageEmbedding(mockBuffer, 'user-123');

        expect(result).toBeDefined();
        expect(result.embedding).toHaveLength(1024);
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('retrieval:vectorizeImage'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Ocp-Apim-Subscription-Key': 'vision-key',
                    'Content-Type': 'application/octet-stream'
                })
            })
        );
    });
  });

  describe('generateImageQueryEmbedding', () => {
    beforeEach(() => {
      // Reset singleton
      // @ts-ignore
      EmbeddingService.instance = undefined;
      // @ts-ignore
      env.AZURE_VISION_ENDPOINT = 'https://vision.test';
      // @ts-ignore
      env.AZURE_VISION_KEY = 'vision-key';
    });

    it('should generate 1024d embedding for text query using VectorizeText API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          vector: new Array(1024).fill(0.5),
          modelVersion: '2023-04-15'
        })
      });
      global.fetch = mockFetch;

      const service = EmbeddingService.getInstance();
      // @ts-ignore
      service.cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };

      const result = await service.generateImageQueryEmbedding('sunset over mountains', 'user-123');

      expect(result).toBeDefined();
      expect(result.embedding).toHaveLength(1024);
      expect(result.userId).toBe('user-123');
      expect(result.model).toContain('vectorize-text');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('retrieval:vectorizeText'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Ocp-Apim-Subscription-Key': 'vision-key',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ text: 'sunset over mountains' })
        })
      );
    });

    it('should return cached embedding if available', async () => {
      const mockResult = {
        embedding: new Array(1024).fill(0.3),
        model: 'vectorize-text-2023-04-15',
        imageSize: 0,
        userId: 'user-123',
        createdAt: new Date().toISOString()
      };

      const mockGet = vi.fn().mockResolvedValue(JSON.stringify(mockResult));
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const service = EmbeddingService.getInstance();
      // @ts-ignore
      service.cache = { get: mockGet, set: vi.fn() };

      const result = await service.generateImageQueryEmbedding('cached query', 'user-123');

      expect(mockGet).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.embedding).toEqual(mockResult.embedding);
    });

    it('should cache new embeddings with img-query prefix', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          vector: new Array(1024).fill(0.4),
          modelVersion: '2023-04-15'
        })
      });
      global.fetch = mockFetch;

      const mockGet = vi.fn().mockResolvedValue(null);
      const mockSet = vi.fn();

      const service = EmbeddingService.getInstance();
      // @ts-ignore
      service.cache = { get: mockGet, set: mockSet };

      await service.generateImageQueryEmbedding('new query', 'user-123');

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('img-query:'));
      expect(mockSet).toHaveBeenCalled();
    });

    it('should throw error when Azure Vision is not configured', async () => {
      // @ts-ignore
      env.AZURE_VISION_ENDPOINT = undefined;
      // @ts-ignore
      env.AZURE_VISION_KEY = undefined;
      // @ts-ignore
      EmbeddingService.instance = undefined;

      const service = EmbeddingService.getInstance();

      await expect(service.generateImageQueryEmbedding('test', 'user-123'))
        .rejects.toThrow('Azure Vision not configured');
    });

    it('should throw error for empty text', async () => {
      const service = EmbeddingService.getInstance();
      // @ts-ignore
      service.cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };

      await expect(service.generateImageQueryEmbedding('', 'user-123'))
        .rejects.toThrow('Text query cannot be empty');
    });

    it('should propagate API errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error'
      });
      global.fetch = mockFetch;

      const service = EmbeddingService.getInstance();
      // @ts-ignore
      service.cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };

      await expect(service.generateImageQueryEmbedding('test query', 'user-123'))
        .rejects.toThrow('Vision VectorizeText API Error');
    });
  });
});
