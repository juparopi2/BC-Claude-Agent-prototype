/**
 * Audio Routes
 *
 * Handles audio-related API endpoints including speech-to-text transcription.
 *
 * @module routes/audio
 */

import { Router } from 'express';
import multer from 'multer';
import { createChildLogger } from '@/shared/utils/logger';
import { getSpeechToTextService } from '@/services/audio';
import type { Request, Response, NextFunction } from 'express';

const logger = createChildLogger({ service: 'AudioRoutes' });
const router = Router();

// Configure multer for audio file uploads (memory storage for small files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max (OpenAI Whisper limit)
  },
  fileFilter: (_req, file, cb) => {
    // Allow common audio formats
    const allowedMimes = [
      'audio/wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/mp4',
      'audio/m4a',
      'audio/webm',
      'audio/ogg',
      'audio/flac',
    ];

    if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: ${file.mimetype}`));
    }
  },
});

/**
 * POST /api/audio/transcribe
 *
 * Transcribe audio file to text using Azure OpenAI.
 *
 * Request:
 * - Content-Type: multipart/form-data
 * - file: Audio file (required)
 * - language: Language hint (optional, ISO 639-1 code)
 *
 * Response:
 * - 200: { text: string, language?: string, duration?: number }
 * - 400: Invalid request
 * - 500: Transcription failed
 */
router.post(
  '/transcribe',
  upload.single('file'),
  async (req: Request, res: Response, _next: NextFunction) => {
    const startTime = Date.now();

    try {
      // Validate file was uploaded
      if (!req.file) {
        logger.warn('Transcription request missing audio file');
        res.status(400).json({
          error: 'No audio file provided',
          code: 'MISSING_FILE',
        });
        return;
      }

      const { buffer, originalname, mimetype, size } = req.file;
      const language = req.body?.language as string | undefined;

      logger.info({
        filename: originalname,
        mimetype,
        size,
        language,
      }, 'Processing transcription request');

      // Get service and check configuration
      const service = getSpeechToTextService();

      if (!service.isConfigured()) {
        logger.error('Speech-to-Text service not configured');
        res.status(503).json({
          error: 'Speech-to-Text service not configured',
          code: 'SERVICE_UNAVAILABLE',
        });
        return;
      }

      // Perform transcription
      const result = await service.transcribe(buffer, {
        language,
        filename: originalname,
      });

      const durationMs = Date.now() - startTime;

      logger.info({
        textLength: result.text.length,
        language: result.language,
        audioDuration: result.duration,
        requestDurationMs: durationMs,
      }, 'Transcription completed successfully');

      res.json({
        text: result.text,
        language: result.language,
        duration: result.duration,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;

      logger.error({
        error: error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) },
        requestDurationMs: durationMs,
      }, 'Transcription failed');

      res.status(500).json({
        error: error instanceof Error ? error.message : 'Transcription failed',
        code: 'TRANSCRIPTION_FAILED',
      });
    }
  }
);

/**
 * GET /api/audio/status
 *
 * Check if the audio service is configured and available.
 *
 * Response:
 * - 200: { configured: boolean, service: 'speech-to-text' }
 */
router.get('/status', (_req: Request, res: Response) => {
  const service = getSpeechToTextService();

  res.json({
    configured: service.isConfigured(),
    service: 'speech-to-text',
  });
});

export default router;
