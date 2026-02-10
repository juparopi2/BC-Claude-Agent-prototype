/**
 * Redis Cleanup Script
 *
 * Cleans up BullMQ queues and Redis memory for fresh testing.
 * Also absorbs functionality from flush-redis-bullmq.ts (use --flush-history).
 *
 * Usage:
 *   npx tsx scripts/redis-cleanup.ts --stats          # Show stats only
 *   npx tsx scripts/redis-cleanup.ts --dry-run        # Preview cleanup
 *   npx tsx scripts/redis-cleanup.ts                  # Clean file queues
 *   npx tsx scripts/redis-cleanup.ts --all            # Clean all queues
 *   npx tsx scripts/redis-cleanup.ts --flush-history  # Nuclear: delete ALL BullMQ data + caches
 *
 * Options:
 *   --dry-run         Show what would be deleted without actually deleting
 *   --stats           Show memory stats only
 *   --all             Clean all queues (default: only file-related queues)
 *   --flush-history   Delete ALL BullMQ data, embedding cache, rate limiters, etc.
 */

import Redis from 'ioredis';
import { config } from 'dotenv';

// Load environment variables
config();

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  totalKeys: number;
  memoryBytes: number;
}

// Queue names (with optional prefix)
const QUEUE_PREFIX = process.env.QUEUE_NAME_PREFIX || 'local';
const FILE_QUEUES = [
  'file-processing',
  'file-chunking',
  'embedding-generation',
  'file-bulk-upload',
  'file-deletion',
  'file-cleanup',
];

const ALL_QUEUES = [
  ...FILE_QUEUES,
  'message-persistence',
  'tool-execution',
  'event-processing',
  'usage-aggregation',
  'citation-persistence',
];

function parseArgs(): { dryRun: boolean; statsOnly: boolean; allQueues: boolean; flushHistory: boolean } {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Redis Cleanup Script

Usage:
  npx tsx scripts/redis-cleanup.ts [options]

Options:
  --stats           Show memory stats only (no cleanup)
  --dry-run         Preview what would be deleted
  --all             Clean all queues (default: file-related only)
  --flush-history   Nuclear: delete ALL BullMQ data, caches, rate limiters

Examples:
  npx tsx scripts/redis-cleanup.ts --stats
  npx tsx scripts/redis-cleanup.ts --dry-run
  npx tsx scripts/redis-cleanup.ts --all
  npx tsx scripts/redis-cleanup.ts --flush-history --dry-run
`);
    process.exit(0);
  }

  return {
    dryRun: args.includes('--dry-run'),
    statsOnly: args.includes('--stats'),
    allQueues: args.includes('--all'),
    flushHistory: args.includes('--flush-history'),
  };
}

function getRedisConfig(): { host: string; port: number; password?: string; tls?: object } {
  const connectionString = process.env.REDIS_CONNECTION_STRING;

  if (connectionString) {
    // Parse Azure Redis connection string
    const parts = connectionString.split(',');
    const hostPort = parts[0]!.trim();
    const [host, portStr] = hostPort.includes(':')
      ? hostPort.split(':')
      : [hostPort, '6380'];

    let password = '';
    for (const part of parts.slice(1)) {
      const trimmed = part.trim();
      if (trimmed.toLowerCase().startsWith('password=')) {
        password = trimmed.substring(9);
        break;
      }
    }

    const port = parseInt(portStr ?? '6380', 10);
    return {
      host: host!,
      port,
      password: password || undefined,
      ...(port === 6380 ? { tls: {} } : {}),
    };
  }

  // Fall back to individual params
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port,
    password: process.env.REDIS_PASSWORD || undefined,
    // Azure Redis uses TLS on port 6380
    ...(port === 6380 ? { tls: {} } : {}),
  };
}

async function getQueueStats(redis: Redis, queueName: string): Promise<QueueStats> {
  const fullName = QUEUE_PREFIX ? `${QUEUE_PREFIX}--${queueName}` : queueName;
  const keyPattern = `bull:${fullName}:*`;

  // Get all keys for this queue
  const keys = await redis.keys(keyPattern);

  // Count by type
  let waiting = 0;
  let active = 0;
  let completed = 0;
  let failed = 0;
  let delayed = 0;
  let memoryBytes = 0;

  for (const key of keys) {
    if (key.includes(':wait')) waiting = await redis.llen(key);
    if (key.includes(':active')) active = await redis.llen(key);
    if (key.includes(':completed')) completed = await redis.zcard(key);
    if (key.includes(':failed')) failed = await redis.zcard(key);
    if (key.includes(':delayed')) delayed = await redis.zcard(key);

    // Get memory usage for each key
    try {
      const mem = await redis.memory('USAGE', key);
      if (typeof mem === 'number') memoryBytes += mem;
    } catch {
      // MEMORY USAGE not supported in all Redis versions
    }
  }

  return {
    name: fullName,
    waiting,
    active,
    completed,
    failed,
    delayed,
    totalKeys: keys.length,
    memoryBytes,
  };
}

async function cleanQueue(redis: Redis, queueName: string, dryRun: boolean): Promise<number> {
  const fullName = QUEUE_PREFIX ? `${QUEUE_PREFIX}--${queueName}` : queueName;
  const keyPattern = `bull:${fullName}:*`;

  const keys = await redis.keys(keyPattern);

  if (dryRun) {
    console.log(`  [DRY RUN] Would delete ${keys.length} keys for queue: ${fullName}`);
    return keys.length;
  }

  if (keys.length > 0) {
    // Delete in batches to avoid blocking
    const batchSize = 100;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      await redis.del(...batch);
    }
    console.log(`  Deleted ${keys.length} keys for queue: ${fullName}`);
  }

  return keys.length;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function main() {
  const { dryRun, statsOnly, allQueues, flushHistory } = parseArgs();
  const queues = allQueues || flushHistory ? ALL_QUEUES : FILE_QUEUES;

  console.log('='.repeat(60));
  console.log('Redis Cleanup Script');
  console.log('='.repeat(60));
  const mode = statsOnly ? 'Stats Only' : dryRun ? 'Dry Run' : flushHistory ? 'FLUSH HISTORY (nuclear)' : 'LIVE CLEANUP';
  console.log(`Mode: ${mode}`);
  console.log(`Queues: ${allQueues || flushHistory ? 'All' : 'File-related only'}`);
  console.log(`Queue prefix: ${QUEUE_PREFIX || '(none)'}`);
  console.log('');

  const config = getRedisConfig();
  console.log(`Connecting to Redis: ${config.host}:${config.port}`);

  const redis = new Redis({
    ...config,
    maxRetriesPerRequest: null, // Required for long operations
    lazyConnect: true,
    connectTimeout: 30000,
    commandTimeout: 30000,
    retryStrategy: (times: number) => {
      if (times > 5) {
        console.error(`Redis connection failed after ${times} attempts`);
        return null;
      }
      const delay = Math.min(times * 1000, 5000);
      console.log(`Retrying Redis connection in ${delay}ms (attempt ${times})...`);
      return delay;
    },
  });

  try {
    // Connect explicitly (lazyConnect: true)
    console.log('Attempting connection...');
    await redis.connect();
    await redis.ping();
    console.log('Connected to Redis successfully!\n');

    // Get overall Redis memory info
    const info = await redis.info('memory');
    const usedMemoryMatch = info.match(/used_memory:(\d+)/);
    const maxMemoryMatch = info.match(/maxmemory:(\d+)/);
    const usedMemory = usedMemoryMatch ? parseInt(usedMemoryMatch[1]!, 10) : 0;
    const maxMemory = maxMemoryMatch ? parseInt(maxMemoryMatch[1]!, 10) : 0;

    console.log('Redis Memory Status:');
    console.log(`  Used: ${formatBytes(usedMemory)}`);
    console.log(`  Max:  ${maxMemory > 0 ? formatBytes(maxMemory) : 'Not configured'}`);
    if (maxMemory > 0) {
      const usagePercent = ((usedMemory / maxMemory) * 100).toFixed(1);
      console.log(`  Usage: ${usagePercent}%`);
    }
    console.log('');

    // Get stats for each queue
    console.log('Queue Statistics:');
    console.log('-'.repeat(60));

    let totalKeys = 0;
    let totalMemory = 0;

    for (const queue of queues) {
      const stats = await getQueueStats(redis, queue);
      totalKeys += stats.totalKeys;
      totalMemory += stats.memoryBytes;

      console.log(`\n${stats.name}:`);
      console.log(`  Waiting:   ${stats.waiting}`);
      console.log(`  Active:    ${stats.active}`);
      console.log(`  Completed: ${stats.completed}`);
      console.log(`  Failed:    ${stats.failed}`);
      console.log(`  Delayed:   ${stats.delayed}`);
      console.log(`  Keys:      ${stats.totalKeys}`);
      console.log(`  Memory:    ${formatBytes(stats.memoryBytes)}`);
    }

    console.log('\n' + '-'.repeat(60));
    console.log(`Total keys across queues: ${totalKeys}`);
    console.log(`Total memory for queues: ${formatBytes(totalMemory)}`);
    console.log('');

    if (statsOnly) {
      console.log('Stats only mode - no cleanup performed.');
      return;
    }

    // Cleanup
    console.log(dryRun ? '\nDry run - showing what would be deleted:' : '\nStarting cleanup...');

    let deletedTotal = 0;
    for (const queue of queues) {
      deletedTotal += await cleanQueue(redis, queue, dryRun);
    }

    // Also clean rate limiter keys
    const rateLimitPattern = 'queue:ratelimit:*';
    const rateLimitKeys = await redis.keys(rateLimitPattern);
    if (rateLimitKeys.length > 0) {
      if (dryRun) {
        console.log(`  [DRY RUN] Would delete ${rateLimitKeys.length} rate limiter keys`);
      } else {
        await redis.del(...rateLimitKeys);
        console.log(`  Deleted ${rateLimitKeys.length} rate limiter keys`);
      }
      deletedTotal += rateLimitKeys.length;
    }

    // Flush history mode (absorbed from flush-redis-bullmq.ts)
    // Deletes additional patterns: embedding cache, upload sessions, event store, etc.
    if (flushHistory) {
      console.log('\n--- Flush History: Additional Patterns ---\n');
      const extraPatterns = [
        'embedding:*',
        'ratelimit:*',
        'usage:*',
        'upload-session:*',
        'sess:*',
        'event-store:*',
        'local:*',
      ];

      for (const pattern of extraPatterns) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          if (dryRun) {
            console.log(`  [DRY RUN] ${pattern}: ${keys.length} keys`);
          } else {
            for (let i = 0; i < keys.length; i += 1000) {
              const batch = keys.slice(i, i + 1000);
              await redis.del(...batch);
            }
            console.log(`  ${pattern}: deleted ${keys.length} keys`);
          }
          deletedTotal += dryRun ? 0 : keys.length;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`${dryRun ? 'Would delete' : 'Deleted'} ${deletedTotal} total keys`);

    if (!dryRun) {
      // Show new memory status
      const newInfo = await redis.info('memory');
      const newUsedMatch = newInfo.match(/used_memory:(\d+)/);
      const newUsed = newUsedMatch ? parseInt(newUsedMatch[1]!, 10) : 0;
      console.log(`\nMemory after cleanup: ${formatBytes(newUsed)}`);
      console.log(`Memory freed: ${formatBytes(usedMemory - newUsed)}`);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await redis.quit();
    console.log('\nDone.');
  }
}

main();
