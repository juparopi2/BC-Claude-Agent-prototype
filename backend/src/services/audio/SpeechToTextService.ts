/**
 * Speech-to-Text Service
 *
 * Transcribes audio using Azure OpenAI gpt-4o-mini-transcribe model.
 *
 * @module services/audio/SpeechToTextService
 */

import { createChildLogger } from '@/shared/utils/logger';
import { env } from '@/infrastructure/config/environment';

const logger = createChildLogger({ service: 'SpeechToTextService' });

/**
 * Result of audio transcription
 */
export interface TranscriptionResult {
  /** Transcribed text */
  text: string;
  /** Detected or specified language (ISO 639-1 code) */
  language?: string;
  /** Duration of the audio in seconds */
  duration?: number;
}

/**
 * Options for transcription
 */
export interface TranscriptionOptions {
  /** Language hint for transcription (ISO 639-1 code, e.g., 'en', 'es', 'fr') */
  language?: string;
  /** Original filename for the audio */
  filename?: string;
  /** Response format (default: 'json') */
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
}

/**
 * Azure OpenAI transcription response
 */
interface AzureTranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
  task?: string;
}

/**
 * SpeechToTextService provides audio transcription using Azure OpenAI.
 *
 * Uses the gpt-4o-mini-transcribe deployment for cost-effective transcription.
 *
 * @example
 * ```typescript
 * const service = getSpeechToTextService();
 * const result = await service.transcribe(audioBuffer, { language: 'en' });
 * console.log(result.text);
 * ```
 */
export class SpeechToTextService {
  private endpoint: string;
  private apiKey: string;
  private deployment = 'gpt-4o-mini-transcribe';
  private apiVersion = '2025-03-01-preview';

  constructor() {
    this.endpoint = env.AZURE_AUDIO_ENDPOINT ?? '';
    this.apiKey = env.AZURE_AUDIO_KEY ?? '';

    if (!this.endpoint || !this.apiKey) {
      logger.warn('Azure Audio credentials not configured - transcription will fail');
    } else {
      logger.info({
        endpoint: this.endpoint,
        deployment: this.deployment,
      }, 'SpeechToTextService initialized');
    }
  }

  /**
   * Transcribe audio buffer to text.
   *
   * Supported formats: wav, mp3, m4a, webm, mp4, mpga, mpeg, oga, ogg
   *
   * @param audioBuffer - Raw audio data as Buffer
   * @param options - Transcription options
   * @returns Transcription result with text, language, and duration
   *
   * @throws Error if transcription fails or credentials are missing
   */
  async transcribe(
    audioBuffer: Buffer,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    if (!this.endpoint || !this.apiKey) {
      throw new Error('Azure Audio credentials not configured. Set AZURE_AUDIO_ENDPOINT and AZURE_AUDIO_KEY.');
    }

    const url = `${this.endpoint}/openai/deployments/${this.deployment}/audio/transcriptions?api-version=${this.apiVersion}`;

    logger.debug({
      audioSize: audioBuffer.length,
      language: options?.language,
      filename: options?.filename,
    }, 'Starting transcription');

    // Build form data
    const formData = new FormData();

    // Determine filename and mime type
    const filename = options?.filename ?? 'audio.webm';
    const mimeType = this.getMimeType(filename);

    // Create blob from buffer
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', blob, filename);

    // Add optional parameters
    if (options?.language) {
      formData.append('language', options.language);
    }
    if (options?.responseFormat) {
      formData.append('response_format', options.responseFormat);
    }

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        }, 'Transcription API request failed');
        throw new Error(`Transcription failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json() as AzureTranscriptionResponse;
      const durationMs = Date.now() - startTime;

      logger.info({
        textLength: result.text?.length ?? 0,
        language: result.language,
        audioDuration: result.duration,
        requestDurationMs: durationMs,
      }, 'Transcription complete');

      return {
        text: result.text,
        language: result.language,
        duration: result.duration,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (error instanceof Error && error.message.startsWith('Transcription failed:')) {
        throw error;
      }

      logger.error({
        error: error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) },
        requestDurationMs: durationMs,
      }, 'Transcription request error');

      throw new Error(`Transcription request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if the service is configured and ready.
   */
  isConfigured(): boolean {
    return !!(this.endpoint && this.apiKey);
  }

  /**
   * Get MIME type from filename extension.
   */
  private getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop() ?? 'webm';

    const mimeTypes: Record<string, string> = {
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      m4a: 'audio/m4a',
      webm: 'audio/webm',
      mp4: 'audio/mp4',
      mpga: 'audio/mpeg',
      mpeg: 'audio/mpeg',
      oga: 'audio/ogg',
      ogg: 'audio/ogg',
    };

    return mimeTypes[ext] ?? 'audio/webm';
  }
}

// Singleton instance
let service: SpeechToTextService | null = null;

/**
 * Get singleton SpeechToTextService instance.
 */
export function getSpeechToTextService(): SpeechToTextService {
  if (!service) {
    service = new SpeechToTextService();
  }
  return service;
}

/**
 * Reset singleton for testing.
 * @internal
 */
export function __resetSpeechToTextService(): void {
  service = null;
}
