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
 *
 * IMPORTANT: Aggressive cleanup to prevent Redis OOM on Azure Redis Basic tier.
 * The original values (100 completed, 200 failed) caused memory exhaustion
 * when processing bulk uploads of 280+ files.
 */
export const JOB_RETENTION = {
  DEFAULT: {
    completed: { count: 20, age: 900 },   // 15 minutes, 20 jobs max
    failed: { count: 20, age: 1800 },     // 30 minutes, 20 jobs max
  },
  MESSAGE_PERSISTENCE: {
    completed: { count: 20 },
    failed: { count: 50, age: 3600 },     // 1 hour
  },
  USAGE_AGGREGATION: {
    completed: { count: 20, age: 900 },   // 15 minutes
    failed: { count: 50, age: 3600 },     // 1 hour
  },
  FILE_CLEANUP: {
    completed: { count: 20, age: 3600 },  // 1 hour
    failed: { count: 50, age: 86400 },    // 1 day
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

/**
 * Lock Duration Configuration
 *
 * Determines how long a job is locked while being processed.
 * Longer durations prevent false stall detection for slow operations.
 *
 * BullMQ defaults: lockDuration=30000ms, lockRenewTime=lockDuration/2
 * Jobs that exceed lockDuration are marked as "stalled" and retried.
 */
export const LOCK_DURATION = {
  /** Short operations (< 30s typically) - BullMQ default */
  SHORT: 30000,
  /** Medium operations (30-60s typically) */
  MEDIUM: 60000,
  /** Long operations (60-90s typically) */
  LONG: 90000,
  /** Very long operations (OCR, large PDFs, slow I/O) */
  EXTRA_LONG: 120000,
  /** Ultra long operations (Azure Document Intelligence, large blob downloads) */
  ULTRA_LONG: 300000,
} as const;

/**
 * Max Stalled Count Configuration
 *
 * How many times a job can stall before being marked as permanently failed.
 * A "stall" occurs when lock expires before job completes.
 */
export const MAX_STALLED_COUNT = {
  /** Standard operations - fail quickly on repeated stalls */
  DEFAULT: 2,
  /** Operations that may intermittently stall (I/O bound) */
  TOLERANT: 3,
} as const;

/**
 * Extended lock configuration for queues that need custom renewal/stalled settings
 */
export interface ExtendedLockConfig {
  lockDuration: number;
  maxStalledCount: number;
  /** How often to renew the lock (default: lockDuration/2) */
  lockRenewTime?: number;
  /** How often to check for stalled jobs (default: 30000ms) */
  stalledInterval?: number;
}

/**
 * Lock Configuration per Queue Type
 *
 * Maps each queue to appropriate lock settings based on typical job duration.
 * File operations get longer locks due to variable processing times.
 *
 * FILE_PROCESSING uses ULTRA_LONG (5 min) because Azure Document Intelligence
 * + large blob downloads can take 180+ seconds, causing "Missing lock" errors
 * with shorter durations.
 */
/**
 * Embedding Cache Configuration
 *
 * Controls how embeddings are cached in Redis to prevent memory exhaustion.
 * Reduced from 7 days to 1 hour after OOM incident (Jan 2026).
 *
 * Key insight: Storing full API response (`raw` field) caused ~2MB per entry.
 * Now we only cache the essential fields (~50KB per entry).
 */
export const EMBEDDING_CACHE = {
  /** TTL for text embeddings in seconds (1 hour) */
  TEXT_TTL_SECONDS: 3600,
  /** TTL for image query embeddings in seconds (1 hour) */
  IMAGE_QUERY_TTL_SECONDS: 3600,
  /** Key prefix for text embeddings */
  TEXT_PREFIX: 'embedding:',
  /** Key prefix for image query embeddings */
  IMAGE_QUERY_PREFIX: 'img-query:',
} as const;

export const LOCK_CONFIG: Record<QueueName, ExtendedLockConfig> = {
  // File operations - can be slow (large PDFs, OCR, network I/O)
  [QueueName.FILE_PROCESSING]: {
    lockDuration: LOCK_DURATION.ULTRA_LONG,  // 5 minutes (was 2 min)
    maxStalledCount: MAX_STALLED_COUNT.TOLERANT,
    lockRenewTime: 60000,      // Renew every 60s (explicit)
    stalledInterval: 120000,   // Check for stalled every 2 min
  },
  [QueueName.FILE_CHUNKING]: { lockDuration: LOCK_DURATION.MEDIUM, maxStalledCount: MAX_STALLED_COUNT.TOLERANT },
  [QueueName.EMBEDDING_GENERATION]: { lockDuration: LOCK_DURATION.LONG, maxStalledCount: MAX_STALLED_COUNT.TOLERANT },
  [QueueName.FILE_BULK_UPLOAD]: { lockDuration: LOCK_DURATION.MEDIUM, maxStalledCount: MAX_STALLED_COUNT.TOLERANT },
  [QueueName.FILE_CLEANUP]: { lockDuration: LOCK_DURATION.EXTRA_LONG, maxStalledCount: MAX_STALLED_COUNT.TOLERANT },
  [QueueName.FILE_DELETION]: { lockDuration: LOCK_DURATION.MEDIUM, maxStalledCount: MAX_STALLED_COUNT.TOLERANT },

  // Standard operations - use shorter locks
  [QueueName.MESSAGE_PERSISTENCE]: { lockDuration: LOCK_DURATION.SHORT, maxStalledCount: MAX_STALLED_COUNT.DEFAULT },
  [QueueName.TOOL_EXECUTION]: { lockDuration: LOCK_DURATION.MEDIUM, maxStalledCount: MAX_STALLED_COUNT.DEFAULT },
  [QueueName.EVENT_PROCESSING]: { lockDuration: LOCK_DURATION.SHORT, maxStalledCount: MAX_STALLED_COUNT.DEFAULT },
  [QueueName.USAGE_AGGREGATION]: { lockDuration: LOCK_DURATION.MEDIUM, maxStalledCount: MAX_STALLED_COUNT.DEFAULT },
  [QueueName.CITATION_PERSISTENCE]: { lockDuration: LOCK_DURATION.SHORT, maxStalledCount: MAX_STALLED_COUNT.DEFAULT },
} as const;
