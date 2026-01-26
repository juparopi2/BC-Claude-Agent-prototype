/**
 * Queue Constants
 *
 * Centralized configuration for MessageQueue service.
 * Eliminates magic strings and provides single source of truth.
 *
 * @module infrastructure/queue/constants
 */

/**
 * Queue Names
 *
 * Enum of all BullMQ queue names used in the system.
 */
export enum QueueName {
  MESSAGE_PERSISTENCE = 'message-persistence',
  TOOL_EXECUTION = 'tool-execution',
  EVENT_PROCESSING = 'event-processing',
  USAGE_AGGREGATION = 'usage-aggregation',
  FILE_PROCESSING = 'file-processing',
  FILE_CHUNKING = 'file-chunking',
  EMBEDDING_GENERATION = 'embedding-generation',
  CITATION_PERSISTENCE = 'citation-persistence',
  FILE_CLEANUP = 'file-cleanup',
  FILE_DELETION = 'file-deletion',
  FILE_BULK_UPLOAD = 'file-bulk-upload',
}

/**
 * Job Names
 *
 * Standardized job names used when adding jobs to queues.
 * These appear in BullMQ UI and logs.
 */
export const JOB_NAMES = {
  MESSAGE_PERSISTENCE: 'persist-message',
  TOOL_EXECUTION: 'execute-tool',
  EVENT_PROCESSING: 'process-event',
  USAGE_AGGREGATION: {
    HOURLY: 'scheduled-hourly-aggregation',
    DAILY: 'scheduled-daily-aggregation',
    MONTHLY_INVOICES: 'scheduled-monthly-invoices',
    QUOTA_RESET: 'scheduled-quota-reset',
  },
  FILE_PROCESSING: 'process-file',
  FILE_CHUNKING: 'chunk-file',
  EMBEDDING_GENERATION: 'generate-embeddings',
  CITATION_PERSISTENCE: 'persist-citations',
  FILE_CLEANUP: {
    DAILY: 'scheduled-daily-cleanup',
  },
  FILE_DELETION: 'delete-file',
  FILE_BULK_UPLOAD: 'upload-file',
} as const;

/**
 * Cron Patterns
 *
 * Standard cron expressions for scheduled jobs.
 * All times are in UTC.
 */
export const CRON_PATTERNS = {
  /** Every hour at :05 minutes */
  HOURLY_AT_05: '5 * * * *',
  /** Every day at 00:15 UTC */
  DAILY_AT_0015: '15 0 * * *',
  /** Every day at 00:10 UTC */
  DAILY_AT_0010: '10 0 * * *',
  /** 1st of month at 00:30 UTC */
  MONTHLY_1ST_AT_0030: '30 0 1 * *',
  /** Every day at 03:00 UTC (cleanup) */
  DAILY_AT_0300: '0 3 * * *',
} as const;

/**
 * Default Concurrency Settings
 *
 * Default worker concurrency by queue type.
 * Can be overridden via environment variables.
 */
export const DEFAULT_CONCURRENCY = {
  MESSAGE_PERSISTENCE: 10,
  TOOL_EXECUTION: 5,
  EVENT_PROCESSING: 10,
  USAGE_AGGREGATION: 1,
  FILE_PROCESSING: 8, // Increased from 3 to reduce bulk upload bottleneck
  FILE_CHUNKING: 5,
  EMBEDDING_GENERATION: 5,
  CITATION_PERSISTENCE: 5,
  FILE_CLEANUP: 1,
  // FILE_DELETION and FILE_BULK_UPLOAD use values from @bc-agent/shared
} as const;

/**
 * Rate Limiting Configuration
 *
 * Note: Rate limit was increased from 100 to 1000 to support bulk uploads
 * of ~280+ files without silent job loss. See plan analysis for details.
 */
export const RATE_LIMIT = {
  /** Maximum jobs per session per hour (increased from 100 for bulk uploads) */
  MAX_JOBS_PER_SESSION: 1000,
  /** Rate limit window in seconds (1 hour) */
  WINDOW_SECONDS: 3600,
  /** Redis key prefix for rate limit counters */
  KEY_PREFIX: 'queue:ratelimit:',
} as const;

/**
 * Job Options - Default Backoff Configuration
 */
export const DEFAULT_BACKOFF = {
  MESSAGE_PERSISTENCE: { type: 'exponential' as const, delay: 1000, attempts: 3 },
  TOOL_EXECUTION: { type: 'exponential' as const, delay: 2000, attempts: 2 },
  EVENT_PROCESSING: { type: 'exponential' as const, delay: 500, attempts: 3 },
  USAGE_AGGREGATION: { type: 'exponential' as const, delay: 5000, attempts: 3 },
  FILE_PROCESSING: { type: 'exponential' as const, delay: 5000, attempts: 2 },
  FILE_CHUNKING: { type: 'exponential' as const, delay: 2000, attempts: 2 },
  EMBEDDING_GENERATION: { type: 'exponential' as const, delay: 2000, attempts: 3 },
  CITATION_PERSISTENCE: { type: 'exponential' as const, delay: 1000, attempts: 3 },
  FILE_CLEANUP: { type: 'exponential' as const, delay: 10000, attempts: 3 },
} as const;

/**
 * Job Retention Configuration
 *
 * How many completed/failed jobs to retain and for how long.
 */
export const JOB_RETENTION = {
  DEFAULT: {
    completed: { count: 100, age: 3600 }, // 1 hour
    failed: { count: 200, age: 86400 },   // 24 hours
  },
  MESSAGE_PERSISTENCE: {
    completed: { count: 100 },
    failed: { count: 500, age: 86400 },
  },
  USAGE_AGGREGATION: {
    completed: { count: 50, age: 3600 },
    failed: { count: 100, age: 86400 },
  },
  FILE_CLEANUP: {
    completed: { count: 50, age: 86400 },
    failed: { count: 100, age: 604800 }, // 7 days
  },
} as const;

/**
 * Job Priority Levels
 *
 * Lower numbers = higher priority.
 */
export const JOB_PRIORITY = {
  MESSAGE_PERSISTENCE: 1,  // Highest - user messages
  TOOL_EXECUTION: 2,
  EMBEDDING_GENERATION: 2,
  FILE_PROCESSING: 3,
  FILE_CHUNKING: 3,
  FILE_DELETION: 3,
  FILE_BULK_UPLOAD: 3,
  CITATION_PERSISTENCE: 4,
  USAGE_AGGREGATION: 5,
  FILE_CLEANUP: 10,        // Lowest - background maintenance
} as const;

/**
 * Connection Timeouts
 */
export const CONNECTION_TIMEOUTS = {
  /** Default BullMQ connection timeout in ms */
  DEFAULT: 30000,
  /** Max Redis retry attempts */
  MAX_RETRY_ATTEMPTS: 10,
  /** Max backoff delay in ms */
  MAX_BACKOFF_DELAY: 3200,
} as const;

/**
 * Phase Delays for Graceful Shutdown
 */
export const SHUTDOWN_DELAYS = {
  /** Delay between shutdown phases in ms */
  PHASE_DELAY: 100,
} as const;
