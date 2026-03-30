/**
 * Flush Redis BullMQ Data
 *
 * Safely removes all BullMQ-related data from Redis to free memory.
 * This includes completed jobs, failed jobs, and queue metadata.
 *
 * WARNING: This will remove all job history. Use with caution.
 *
 * Usage:
 *   npx tsx scripts/flush-redis-bullmq.ts --dry-run    # Preview what will be deleted
 *   npx tsx scripts/flush-redis-bullmq.ts              # Execute deletion
 *   npx tsx scripts/flush-redis-bullmq.ts --all        # Delete ALL Redis keys (nuclear option)
 *   npx tsx scripts/flush-redis-bullmq.ts --env prod   # Connect to production Redis
 */

import 'dotenv/config';
import Redis from 'ioredis';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

// ============================================================================
// Configuration
// ============================================================================

/**
 * BullMQ default Redis key prefix is 'bull'.
 * The app's QUEUE_NAME_PREFIX is for queue NAME prefixing (e.g. 'local--file-extract'),
 * NOT for the Redis key prefix. Scripts must use 'bull' to match production queues.
 */
const BULLMQ_PREFIX = 'bull';

// ============================================================================
// Redis Connection
// ============================================================================

/**
 * Parse Azure Redis connection string format:
 * hostname:port,password=xxx,ssl=True,abortConnect=False
 */
function parseRedisConnectionString(connStr: string): {
  host: string; port: number; password: string; tls: boolean;
} {
  const parts = connStr.split(',');
  const [hostPort] = parts;
  const [host, portStr] = hostPort.split(':');
  const passwordPart = parts.find(p => p.startsWith('password='));
  const password = passwordPart ? passwordPart.split('=').slice(1).join('=') : '';
  const sslPart = parts.find(p => p.toLowerCase().startsWith('ssl='));
  const tls = sslPart ? sslPart.split('=')[1].toLowerCase() === 'true' : false;

  return { host, port: parseInt(portStr) || 6380, password, tls };
}

function buildRedisConfig(): { host: string; port: number; password?: string; tls?: Record<string, never> } {
  const connStr = process.env.REDIS_CONNECTION_STRING;
  if (connStr) {
    const parsed = parseRedisConnectionString(connStr);
    return {
      host: parsed.host,
      port: parsed.port,
      password: parsed.password || undefined,
      tls: parsed.tls ? {} : undefined,
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6380'),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_PORT === '6380' ? {} : undefined,
  };
}

// ============================================================================
// Types
// ============================================================================

interface FlushResult {
  pattern: string;
  keysFound: number;
  keysDeleted: number;
  bytesFreed: number;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): { dryRun: boolean; deleteAll: boolean } {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Flush Redis BullMQ Data

Usage:
  npx tsx scripts/flush-redis-bullmq.ts [options]

Options:
  --dry-run          Show what would be deleted without actually deleting
  --all              Delete ALL Redis keys (nuclear option - use carefully!)
  --env dev|prod     Connect to remote environment via Azure Key Vault

Examples:
  npx tsx scripts/flush-redis-bullmq.ts --dry-run
  npx tsx scripts/flush-redis-bullmq.ts
  npx tsx scripts/flush-redis-bullmq.ts --all
  npx tsx scripts/flush-redis-bullmq.ts --env prod --dry-run
`);
    process.exit(0);
  }

  return {
    dryRun: args.includes('--dry-run'),
    deleteAll: args.includes('--all'),
  };
}

// ============================================================================
// Redis Operations
// ============================================================================

async function getKeysByPattern(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';

  do {
    const [newCursor, foundKeys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    cursor = newCursor;
    keys.push(...foundKeys);
  } while (cursor !== '0');

  return keys;
}

async function getKeySize(redis: Redis, key: string): Promise<number> {
  try {
    const debug = await redis.debug('OBJECT', key);
    const match = debug.match(/serializedlength:(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    // MEMORY USAGE fallback
    try {
      const size = await redis.memory('USAGE', key);
      return size || 0;
    } catch {
      return 0;
    }
  }
}

async function flushPattern(
  redis: Redis,
  pattern: string,
  dryRun: boolean
): Promise<FlushResult> {
  const keys = await getKeysByPattern(redis, pattern);
  let bytesFreed = 0;

  // Estimate size of keys
  for (const key of keys.slice(0, 100)) { // Sample first 100 for performance
    bytesFreed += await getKeySize(redis, key);
  }

  // Extrapolate if we sampled
  if (keys.length > 100) {
    bytesFreed = Math.round((bytesFreed / 100) * keys.length);
  }

  if (!dryRun && keys.length > 0) {
    // Delete in batches of 1000
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await redis.del(...batch);
    }
  }

  return {
    pattern,
    keysFound: keys.length,
    keysDeleted: dryRun ? 0 : keys.length,
    bytesFreed,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Resolve remote environment if --env flag is set
  const targetEnv = getTargetEnv();
  if (targetEnv) {
    await resolveEnvironment(targetEnv, { redis: true });
  }

  const REDIS_CONFIG = buildRedisConfig();
  const { dryRun, deleteAll } = parseArgs();

  console.log('=== FLUSH REDIS BULLMQ DATA ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no actual deletions)' : 'LIVE'}`);
  console.log(`Redis: ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`);
  console.log(`BullMQ prefix: ${BULLMQ_PREFIX}`);
  if (targetEnv) console.log(`Environment: ${targetEnv}`);
  console.log('');

  // Connect to Redis
  const redis = new Redis({
    ...REDIS_CONFIG,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  // Get memory before
  const infoBefore = await redis.info('memory');
  const usedMemoryBefore = parseInt(infoBefore.match(/used_memory:(\d+)/)?.[1] || '0', 10);

  console.log(`Memory before: ${(usedMemoryBefore / 1024 / 1024).toFixed(2)} MB\n`);

  // Patterns to flush (BullMQ uses these patterns)
  const patterns = deleteAll
    ? ['*'] // Nuclear option
    : [
        // BullMQ queue data (main pattern)
        `${BULLMQ_PREFIX}:*`,

        // Embedding cache/state
        'embedding:*',

        // Rate limiters
        'queue:ratelimit:*',
        'ratelimit:*',

        // Usage tracking
        'usage:*',

        // Upload sessions (can be safely cleared)
        'upload-session:*',

        // Session data
        'sess:*',

        // Event store sequences
        'event-store:*',

        // Any local: prefixed keys (development)
        'local:*',
      ];

  console.log('--- Patterns to flush ---\n');

  const results: FlushResult[] = [];

  for (const pattern of patterns) {
    const result = await flushPattern(redis, pattern, dryRun);
    results.push(result);

    if (result.keysFound > 0) {
      console.log(`${pattern}`);
      console.log(`  Keys: ${result.keysFound}`);
      console.log(`  Size: ~${(result.bytesFreed / 1024).toFixed(2)} KB`);
      console.log(`  ${dryRun ? 'Would delete' : 'Deleted'}: ${dryRun ? result.keysFound : result.keysDeleted}`);
      console.log('');
    }
  }

  // Summary
  const totalKeys = results.reduce((sum, r) => sum + r.keysFound, 0);
  const totalDeleted = results.reduce((sum, r) => sum + r.keysDeleted, 0);
  const totalBytes = results.reduce((sum, r) => sum + r.bytesFreed, 0);

  console.log('--- Summary ---\n');
  console.log(`Total keys found: ${totalKeys}`);
  console.log(`Total ${dryRun ? 'would delete' : 'deleted'}: ${dryRun ? totalKeys : totalDeleted}`);
  console.log(`Estimated space freed: ~${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (!dryRun) {
    // Get memory after
    const infoAfter = await redis.info('memory');
    const usedMemoryAfter = parseInt(infoAfter.match(/used_memory:(\d+)/)?.[1] || '0', 10);

    console.log(`\nMemory after: ${(usedMemoryAfter / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Actual freed: ${((usedMemoryBefore - usedMemoryAfter) / 1024 / 1024).toFixed(2)} MB`);
  }

  if (dryRun) {
    console.log('\n💡 Run without --dry-run to actually delete keys');
  }

  await redis.quit();
  console.log('\n✅ Done!');
}

main().catch((error) => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});
