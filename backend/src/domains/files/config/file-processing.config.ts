/**
 * File Processing Configuration
 *
 * Centralized configuration for retry, cleanup, and processing parameters.
 * Single source of truth for all file processing settings.
 *
 * Configuration hierarchy:
 * 1. Environment variables (highest priority)
 * 2. Default values
 *
 * @module domains/files/config
 */

import { z } from 'zod';

/**
 * File Processing Configuration Schema
 *
 * Validates all configuration values with sensible defaults.
 */
export const FileProcessingConfigSchema = z.object({
  retry: z.object({
    /** Max processing retries (text extraction, OCR) */
    maxProcessingRetries: z.number().int().min(1).max(10).default(2),

    /** Max embedding retries (vector generation) */
    maxEmbeddingRetries: z.number().int().min(1).max(10).default(3),

    /** Base delay for exponential backoff (ms) */
    baseDelayMs: z.number().int().min(100).max(60000).default(5000),

    /** Max delay cap (ms) */
    maxDelayMs: z.number().int().min(1000).max(300000).default(60000),

    /** Backoff multiplier (delay = baseDelay * multiplier^retryCount) */
    backoffMultiplier: z.number().min(1).max(5).default(2),

    /** Jitter factor (0-1) to prevent thundering herd */
    jitterFactor: z.number().min(0).max(1).default(0.1),
  }),

  cleanup: z.object({
    /** Days to keep failed files before automatic cleanup */
    failedFileRetentionDays: z.number().int().min(1).max(365).default(30),

    /** Days to keep orphaned chunks before cleanup */
    orphanedChunkRetentionDays: z.number().int().min(1).max(30).default(7),

    /** Batch size for cleanup operations */
    cleanupBatchSize: z.number().int().min(10).max(1000).default(100),
  }),

  rateLimit: z.object({
    /** Max manual retries per user per hour */
    maxManualRetriesPerHour: z.number().int().min(1).max(100).default(10),
  }),
});

/**
 * Inferred TypeScript type from Zod schema
 */
export type FileProcessingConfig = z.infer<typeof FileProcessingConfigSchema>;

/**
 * Default configuration values
 *
 * These are the base defaults that can be overridden by environment variables.
 */
export const DEFAULT_FILE_PROCESSING_CONFIG: FileProcessingConfig = {
  retry: {
    maxProcessingRetries: 2,
    maxEmbeddingRetries: 3,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  },
  cleanup: {
    failedFileRetentionDays: 30,
    orphanedChunkRetentionDays: 7,
    cleanupBatchSize: 100,
  },
  rateLimit: {
    maxManualRetriesPerHour: 10,
  },
};

/**
 * Cached configuration instance
 */
let cachedConfig: FileProcessingConfig | null = null;

/**
 * Parse integer from environment variable with fallback
 */
function parseEnvInt(envVar: string | undefined, fallback: number): number {
  if (!envVar) return fallback;
  const parsed = parseInt(envVar, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse float from environment variable with fallback
 */
function parseEnvFloat(envVar: string | undefined, fallback: number): number {
  if (!envVar) return fallback;
  const parsed = parseFloat(envVar);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Get file processing configuration
 *
 * Merges default values with environment variable overrides.
 * Configuration is cached after first call.
 *
 * Environment variables:
 * - FILE_MAX_PROCESSING_RETRIES
 * - FILE_MAX_EMBEDDING_RETRIES
 * - FILE_RETRY_BASE_DELAY_MS
 * - FILE_RETRY_MAX_DELAY_MS
 * - FILE_RETRY_BACKOFF_MULTIPLIER
 * - FILE_RETRY_JITTER_FACTOR
 * - FILE_FAILED_RETENTION_DAYS
 * - FILE_ORPHANED_CHUNK_RETENTION_DAYS
 * - FILE_CLEANUP_BATCH_SIZE
 * - FILE_MAX_MANUAL_RETRIES_PER_HOUR
 *
 * @returns Validated file processing configuration
 */
export function getFileProcessingConfig(): FileProcessingConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const envConfig = {
    retry: {
      maxProcessingRetries: parseEnvInt(
        process.env.FILE_MAX_PROCESSING_RETRIES,
        DEFAULT_FILE_PROCESSING_CONFIG.retry.maxProcessingRetries
      ),
      maxEmbeddingRetries: parseEnvInt(
        process.env.FILE_MAX_EMBEDDING_RETRIES,
        DEFAULT_FILE_PROCESSING_CONFIG.retry.maxEmbeddingRetries
      ),
      baseDelayMs: parseEnvInt(
        process.env.FILE_RETRY_BASE_DELAY_MS,
        DEFAULT_FILE_PROCESSING_CONFIG.retry.baseDelayMs
      ),
      maxDelayMs: parseEnvInt(
        process.env.FILE_RETRY_MAX_DELAY_MS,
        DEFAULT_FILE_PROCESSING_CONFIG.retry.maxDelayMs
      ),
      backoffMultiplier: parseEnvFloat(
        process.env.FILE_RETRY_BACKOFF_MULTIPLIER,
        DEFAULT_FILE_PROCESSING_CONFIG.retry.backoffMultiplier
      ),
      jitterFactor: parseEnvFloat(
        process.env.FILE_RETRY_JITTER_FACTOR,
        DEFAULT_FILE_PROCESSING_CONFIG.retry.jitterFactor
      ),
    },
    cleanup: {
      failedFileRetentionDays: parseEnvInt(
        process.env.FILE_FAILED_RETENTION_DAYS,
        DEFAULT_FILE_PROCESSING_CONFIG.cleanup.failedFileRetentionDays
      ),
      orphanedChunkRetentionDays: parseEnvInt(
        process.env.FILE_ORPHANED_CHUNK_RETENTION_DAYS,
        DEFAULT_FILE_PROCESSING_CONFIG.cleanup.orphanedChunkRetentionDays
      ),
      cleanupBatchSize: parseEnvInt(
        process.env.FILE_CLEANUP_BATCH_SIZE,
        DEFAULT_FILE_PROCESSING_CONFIG.cleanup.cleanupBatchSize
      ),
    },
    rateLimit: {
      maxManualRetriesPerHour: parseEnvInt(
        process.env.FILE_MAX_MANUAL_RETRIES_PER_HOUR,
        DEFAULT_FILE_PROCESSING_CONFIG.rateLimit.maxManualRetriesPerHour
      ),
    },
  };

  // Validate with Zod schema
  cachedConfig = FileProcessingConfigSchema.parse(envConfig);
  return cachedConfig;
}

/**
 * Reset cached configuration (for testing)
 */
export function __resetFileProcessingConfig(): void {
  cachedConfig = null;
}
