import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TranscriptionOptions } from '@/services/audio/SpeechToTextService';

// Mock logger before imports
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock environment
vi.mock('@/infrastructure/config/environment', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as object,
    env: {
      ...(actual as Record<string, unknown>).env,
      AZURE_AUDIO_ENDPOINT: 'https://audio.openai.azure.com',
      AZURE_AUDIO_KEY: 'test-audio-key',
    },
  };
});

// Mock models config
vi.mock('@/infrastructure/config/models', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as object,
    getAzureServiceConfig: vi.fn().mockReturnValue({
      role: 'audio_transcription',
      description: 'Convert speech audio to text using Azure OpenAI',
      modelId: 'gpt-4o-mini-transcribe',
      apiVersion: '2025-03-01-preview',
      tier: 'standard',
    }),
  };
});

import { env } from '@/infrastructure/config/environment';
import { SpeechToTextService, getSpeechToTextService, __resetSpeechToTextService } from '@/services/audio/SpeechToTextService';

// ─── Helpers ───────────────────────────────────────────────────

const EXPECTED_URL = 'https://audio.openai.azure.com/openai/deployments/gpt-4o-mini-transcribe/audio/transcriptions?api-version=2025-03-01-preview';

function createMockAudioBuffer(): Buffer {
  return Buffer.from('fake-audio-data');
}

function createSuccessResponse(overrides?: Partial<{
  text: string;
  language: string;
  duration: number;
  usage: Record<string, unknown>;
}>) {
  return {
    ok: true,
    json: async () => ({
      text: 'Hello, world!',
      language: 'en',
      duration: 2.5,
      usage: {
        type: 'audio',
        input_tokens: 150,
        input_token_details: {
          text_tokens: 10,
          audio_tokens: 140,
        },
        output_tokens: 20,
        total_tokens: 170,
      },
      ...overrides,
    }),
  };
}

function createErrorResponse(status: number, statusText: string, body: string) {
  return {
    ok: false,
    status,
    statusText,
    text: async () => body,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('SpeechToTextService', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    __resetSpeechToTextService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ─── Initialization ────────────────────────────────────────

  describe('Initialization', () => {
    it('should initialize with valid config', () => {
      const service = new SpeechToTextService();
      expect(service).toBeInstanceOf(SpeechToTextService);
      expect(service.isConfigured()).toBe(true);
    });

    it('should warn when endpoint is missing', () => {
      const original = env.AZURE_AUDIO_ENDPOINT;
      // @ts-ignore - testing missing config
      env.AZURE_AUDIO_ENDPOINT = undefined;

      const service = new SpeechToTextService();
      expect(service.isConfigured()).toBe(false);

      env.AZURE_AUDIO_ENDPOINT = original;
    });

    it('should warn when API key is missing', () => {
      const original = env.AZURE_AUDIO_KEY;
      // @ts-ignore - testing missing config
      env.AZURE_AUDIO_KEY = undefined;

      const service = new SpeechToTextService();
      expect(service.isConfigured()).toBe(false);

      env.AZURE_AUDIO_KEY = original;
    });
  });

  // ─── Singleton ─────────────────────────────────────────────

  describe('Singleton', () => {
    it('should return same instance via getSpeechToTextService()', () => {
      const a = getSpeechToTextService();
      const b = getSpeechToTextService();
      expect(a).toBe(b);
    });

    it('should return new instance after __resetSpeechToTextService()', () => {
      const a = getSpeechToTextService();
      __resetSpeechToTextService();
      const b = getSpeechToTextService();
      expect(a).not.toBe(b);
    });
  });

  // ─── transcribe() success ─────────────────────────────────

  describe('transcribe - success', () => {
    it('should transcribe audio with default options', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse());
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      const result = await service.transcribe(createMockAudioBuffer());

      expect(result.text).toBe('Hello, world!');
      expect(result.language).toBe('en');
      expect(result.duration).toBe(2.5);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        EXPECTED_URL,
        expect.objectContaining({
          method: 'POST',
          headers: { 'api-key': 'test-audio-key' },
        }),
      );
    });

    it('should use default filename audio.webm when none provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse());
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      await service.transcribe(createMockAudioBuffer());

      // Verify FormData was sent with the default webm filename
      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as FormData;
      const file = body.get('file') as File;
      expect(file.name).toBe('audio.webm');
      expect(file.type).toBe('audio/webm');
    });

    it('should pass language hint when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse());
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      await service.transcribe(createMockAudioBuffer(), { language: 'es' });

      const body = mockFetch.mock.calls[0][1].body as FormData;
      expect(body.get('language')).toBe('es');
    });

    it('should pass response format when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse());
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      await service.transcribe(createMockAudioBuffer(), { responseFormat: 'verbose_json' });

      const body = mockFetch.mock.calls[0][1].body as FormData;
      expect(body.get('response_format')).toBe('verbose_json');
    });

    it('should not append optional params when not provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse());
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      await service.transcribe(createMockAudioBuffer());

      const body = mockFetch.mock.calls[0][1].body as FormData;
      expect(body.get('language')).toBeNull();
      expect(body.get('response_format')).toBeNull();
    });

    it('should extract usage information from response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse());
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      const result = await service.transcribe(createMockAudioBuffer());

      expect(result.usage).toEqual({
        inputTokens: 150,
        audioTokens: 140,
        outputTokens: 20,
        totalTokens: 170,
      });
    });

    it('should fallback audioTokens to inputTokens when details missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: 'test',
          usage: {
            type: 'audio',
            input_tokens: 200,
            // no input_token_details
            output_tokens: 30,
            total_tokens: 230,
          },
        }),
      });
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      const result = await service.transcribe(createMockAudioBuffer());

      expect(result.usage!.audioTokens).toBe(200); // falls back to input_tokens
    });

    it('should handle response without usage data', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: 'No usage info',
          language: 'en',
          duration: 1.0,
          // no usage field
        }),
      });
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      const result = await service.transcribe(createMockAudioBuffer());

      expect(result.text).toBe('No usage info');
      expect(result.usage).toBeUndefined();
    });

    it('should handle response without language or duration', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: 'Minimal response',
        }),
      });
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      const result = await service.transcribe(createMockAudioBuffer());

      expect(result.text).toBe('Minimal response');
      expect(result.language).toBeUndefined();
      expect(result.duration).toBeUndefined();
    });
  });

  // ─── transcribe() - file format handling ───────────────────

  describe('transcribe - file formats', () => {
    const formatCases: Array<{ filename: string; expectedMime: string }> = [
      { filename: 'recording.wav', expectedMime: 'audio/wav' },
      { filename: 'recording.mp3', expectedMime: 'audio/mpeg' },
      { filename: 'recording.m4a', expectedMime: 'audio/m4a' },
      { filename: 'recording.webm', expectedMime: 'audio/webm' },
      { filename: 'recording.mp4', expectedMime: 'audio/mp4' },
      { filename: 'recording.mpga', expectedMime: 'audio/mpeg' },
      { filename: 'recording.mpeg', expectedMime: 'audio/mpeg' },
      { filename: 'recording.oga', expectedMime: 'audio/ogg' },
      { filename: 'recording.ogg', expectedMime: 'audio/ogg' },
    ];

    it.each(formatCases)(
      'should use mime type $expectedMime for $filename',
      async ({ filename, expectedMime }) => {
        const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse());
        global.fetch = mockFetch;

        const service = new SpeechToTextService();
        await service.transcribe(createMockAudioBuffer(), { filename });

        const body = mockFetch.mock.calls[0][1].body as FormData;
        const file = body.get('file') as File;
        expect(file.type).toBe(expectedMime);
        expect(file.name).toBe(filename);
      },
    );

    it('should default to audio/webm for unknown extensions', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse());
      global.fetch = mockFetch;

      const service = new SpeechToTextService();
      await service.transcribe(createMockAudioBuffer(), { filename: 'recording.xyz' });

      const body = mockFetch.mock.calls[0][1].body as FormData;
      const file = body.get('file') as File;
      expect(file.type).toBe('audio/webm');
    });
  });

  // ─── transcribe() - errors ─────────────────────────────────

  describe('transcribe - errors', () => {
    it('should throw when credentials not configured', async () => {
      const origEndpoint = env.AZURE_AUDIO_ENDPOINT;
      const origKey = env.AZURE_AUDIO_KEY;
      // @ts-ignore
      env.AZURE_AUDIO_ENDPOINT = undefined;
      // @ts-ignore
      env.AZURE_AUDIO_KEY = undefined;

      const service = new SpeechToTextService();

      await expect(service.transcribe(createMockAudioBuffer()))
        .rejects.toThrow('Azure Audio credentials not configured');

      env.AZURE_AUDIO_ENDPOINT = origEndpoint;
      env.AZURE_AUDIO_KEY = origKey;
    });

    it('should throw on API error with status and message', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        createErrorResponse(400, 'Bad Request', 'Invalid audio format'),
      );

      const service = new SpeechToTextService();

      await expect(service.transcribe(createMockAudioBuffer()))
        .rejects.toThrow('Transcription failed: 400 Bad Request - Invalid audio format');
    });

    it('should throw on 500 server error', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        createErrorResponse(500, 'Internal Server Error', 'Service unavailable'),
      );

      const service = new SpeechToTextService();

      await expect(service.transcribe(createMockAudioBuffer()))
        .rejects.toThrow('Transcription failed: 500 Internal Server Error - Service unavailable');
    });

    it('should throw on 429 rate limit error', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        createErrorResponse(429, 'Too Many Requests', 'Rate limit exceeded'),
      );

      const service = new SpeechToTextService();

      await expect(service.transcribe(createMockAudioBuffer()))
        .rejects.toThrow('Transcription failed: 429 Too Many Requests - Rate limit exceeded');
    });

    it('should wrap network errors with descriptive message', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

      const service = new SpeechToTextService();

      await expect(service.transcribe(createMockAudioBuffer()))
        .rejects.toThrow('Transcription request failed: fetch failed');
    });

    it('should wrap non-Error thrown values', async () => {
      global.fetch = vi.fn().mockRejectedValue('network timeout');

      const service = new SpeechToTextService();

      await expect(service.transcribe(createMockAudioBuffer()))
        .rejects.toThrow('Transcription request failed: network timeout');
    });

    it('should re-throw API errors without double-wrapping', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        createErrorResponse(401, 'Unauthorized', 'Invalid API key'),
      );

      const service = new SpeechToTextService();

      try {
        await service.transcribe(createMockAudioBuffer());
        expect.fail('Should have thrown');
      } catch (error) {
        // The error message should start with "Transcription failed:" (API error),
        // NOT "Transcription request failed:" (network error wrapper)
        expect((error as Error).message).toMatch(/^Transcription failed:/);
      }
    });
  });

  // ─── isConfigured() ────────────────────────────────────────

  describe('isConfigured', () => {
    it('should return true when both endpoint and key are set', () => {
      const service = new SpeechToTextService();
      expect(service.isConfigured()).toBe(true);
    });

    it('should return false when endpoint is empty', () => {
      const original = env.AZURE_AUDIO_ENDPOINT;
      // @ts-ignore
      env.AZURE_AUDIO_ENDPOINT = '';

      const service = new SpeechToTextService();
      expect(service.isConfigured()).toBe(false);

      env.AZURE_AUDIO_ENDPOINT = original;
    });

    it('should return false when key is empty', () => {
      const original = env.AZURE_AUDIO_KEY;
      // @ts-ignore
      env.AZURE_AUDIO_KEY = '';

      const service = new SpeechToTextService();
      expect(service.isConfigured()).toBe(false);

      env.AZURE_AUDIO_KEY = original;
    });
  });
});
