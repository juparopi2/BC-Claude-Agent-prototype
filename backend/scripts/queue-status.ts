/**
 * Queue Status Script
 *
 * Displays comprehensive status of all BullMQ queues including:
 * - Job counts by state (waiting, active, completed, failed, delayed)
 * - Failed job details with error messages
 * - Rate limit status
 * - Redis memory usage
 *
 * Usage:
 *   npx tsx scripts/queue-status.ts
 *   npx tsx scripts/queue-status.ts --verbose
 *   npx tsx scripts/queue-status.ts --queue file-processing
 */

import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// ============================================================================
// Configuration
// ============================================================================

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_PORT === '6380' ? {} : undefined,
};

const QUEUE_PREFIX = process.env.QUEUE_NAME_PREFIX || 'bcagent';

// All queue names in the system
const ALL_QUEUE_NAMES = [
  'message-persistence',
  'tool-execution',
  'event-processing',
  'usage-aggregation',
  'file-processing',
  'file-chunking',
  'embedding-generation',
  'citation-persistence',
  'file-cleanup',
  'file-deletion',
  'file-bulk-upload',
];

// ============================================================================
// Types
// ============================================================================

interface QueueStatus {
  name: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  failedJobs: FailedJobInfo[];
  oldestWaiting: Date | null;
  latestActive: Date | null;
}

interface FailedJobInfo {
  id: string;
  name: string;
  failedReason: string;
  attemptsMade: number;
  timestamp: Date;
  data: Record<string, unknown>;
  stackTrace: string[];
}

interface RedisInfo {
  usedMemory: string;
  usedMemoryPeak: string;
  connectedClients: number;
  totalConnectionsReceived: number;
  uptimeInDays: number;
  version: string;
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface Args {
  verbose: boolean;
  queue: string | null;
  showFailed: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Queue Status Script

Usage:
  npx tsx scripts/queue-status.ts [options]

Options:
  --verbose            Show detailed information including job data
  --queue <name>       Only show status for specific queue
  --show-failed <n>    Show up to N failed jobs per queue (default: 5)

Examples:
  npx tsx scripts/queue-status.ts
  npx tsx scripts/queue-status.ts --verbose
  npx tsx scripts/queue-status.ts --queue file-processing
  npx tsx scripts/queue-status.ts --show-failed 10
`);
    process.exit(0);
  }

  const queueIndex = args.indexOf('--queue');
  const showFailedIndex = args.indexOf('--show-failed');

  return {
    verbose: args.includes('--verbose'),
    queue: queueIndex !== -1 && args[queueIndex + 1] ? args[queueIndex + 1] : null,
    showFailed: showFailedIndex !== -1 && args[showFailedIndex + 1]
      ? parseInt(args[showFailedIndex + 1]) || 5
      : 5,
  };
}

// ============================================================================
// Redis Info
// ============================================================================

async function getRedisInfo(connection: IORedis): Promise<RedisInfo> {
  const info = await connection.info();
  const lines = info.split('\n');

  const getValue = (key: string): string => {
    const line = lines.find((l) => l.startsWith(`${key}:`));
    return line ? line.split(':')[1].trim() : 'unknown';
  };

  return {
    usedMemory: getValue('used_memory_human'),
    usedMemoryPeak: getValue('used_memory_peak_human'),
    connectedClients: parseInt(getValue('connected_clients')) || 0,
    totalConnectionsReceived: parseInt(getValue('total_connections_received')) || 0,
    uptimeInDays: parseInt(getValue('uptime_in_days')) || 0,
    version: getValue('redis_version'),
  };
}

async function getQueueKeyCount(connection: IORedis, queueName: string): Promise<number> {
  const pattern = `${QUEUE_PREFIX}:${queueName}:*`;
  const keys = await connection.keys(pattern);
  return keys.length;
}

// ============================================================================
// Queue Status
// ============================================================================

async function getQueueStatus(
  connection: IORedis,
  queueName: string,
  showFailedCount: number
): Promise<QueueStatus> {
  const queue = new Queue(queueName, { connection, prefix: QUEUE_PREFIX });

  try {
    // Get job counts
    const jobCounts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    const { waiting, active, completed, failed, delayed, paused } = jobCounts;

    // Get failed jobs with details
    const failedJobs = await queue.getFailed(0, showFailedCount);
    const failedJobsInfo: FailedJobInfo[] = failedJobs.map((job) => ({
      id: job.id || 'unknown',
      name: job.name,
      failedReason: job.failedReason || 'Unknown reason',
      attemptsMade: job.attemptsMade,
      timestamp: new Date(job.timestamp),
      data: job.data as Record<string, unknown>,
      stackTrace: job.stacktrace || [],
    }));

    // Get oldest waiting job timestamp
    const waitingJobs = await queue.getWaiting(0, 1);
    const oldestWaiting = waitingJobs.length > 0 ? new Date(waitingJobs[0].timestamp) : null;

    // Get latest active job timestamp
    const activeJobs = await queue.getActive(0, 1);
    const latestActive = activeJobs.length > 0 ? new Date(activeJobs[0].timestamp) : null;

    return {
      name: queueName,
      counts: { waiting, active, completed, failed, delayed, paused },
      failedJobs: failedJobsInfo,
      oldestWaiting,
      latestActive,
    };
  } finally {
    await queue.close();
  }
}

// ============================================================================
// Output
// ============================================================================

function printRedisInfo(info: RedisInfo): void {
  console.log('=== REDIS STATUS ===\n');
  console.log(`Version:              ${info.version}`);
  console.log(`Memory Used:          ${info.usedMemory}`);
  console.log(`Memory Peak:          ${info.usedMemoryPeak}`);
  console.log(`Connected Clients:    ${info.connectedClients}`);
  console.log(`Total Connections:    ${info.totalConnectionsReceived}`);
  console.log(`Uptime:               ${info.uptimeInDays} days`);
}

function printQueueStatus(status: QueueStatus, verbose: boolean): void {
  const { counts } = status;
  const total = counts.waiting + counts.active + counts.delayed;

  console.log(`\n--- ${status.name} ---`);
  console.log(`  Waiting:    ${counts.waiting.toString().padStart(6)}`);
  console.log(`  Active:     ${counts.active.toString().padStart(6)}`);
  console.log(`  Delayed:    ${counts.delayed.toString().padStart(6)}`);
  console.log(`  Completed:  ${counts.completed.toString().padStart(6)}`);
  console.log(`  Failed:     ${counts.failed.toString().padStart(6)}`);

  if (counts.paused > 0) {
    console.log(`  Paused:     ${counts.paused.toString().padStart(6)}`);
  }

  console.log(`  ─────────────────`);
  console.log(`  Pending:    ${total.toString().padStart(6)}`);

  if (status.oldestWaiting) {
    const waitTime = Math.floor((Date.now() - status.oldestWaiting.getTime()) / 1000);
    console.log(`  Oldest waiting: ${formatDuration(waitTime)}`);
  }

  // Print failed jobs if any
  if (status.failedJobs.length > 0) {
    console.log(`\n  Failed Jobs:`);
    for (const job of status.failedJobs) {
      console.log(`    [${job.id}] ${job.name}`);
      console.log(`      Reason: ${truncate(job.failedReason, 80)}`);
      console.log(`      Attempts: ${job.attemptsMade}`);
      console.log(`      Time: ${job.timestamp.toISOString()}`);

      if (verbose) {
        console.log(`      Data: ${JSON.stringify(job.data, null, 2).substring(0, 200)}...`);
        if (job.stackTrace.length > 0) {
          console.log(`      Stack: ${job.stackTrace[0]}`);
        }
      }
    }
  }
}

function printSummary(statuses: QueueStatus[]): void {
  console.log('\n=== SUMMARY ===\n');

  let totalWaiting = 0;
  let totalActive = 0;
  let totalFailed = 0;
  let totalCompleted = 0;

  const tableRows: string[] = [];
  tableRows.push('Queue                    | Wait | Actv | Fail | Done');
  tableRows.push('─────────────────────────┼──────┼──────┼──────┼──────');

  for (const status of statuses) {
    totalWaiting += status.counts.waiting;
    totalActive += status.counts.active;
    totalFailed += status.counts.failed;
    totalCompleted += status.counts.completed;

    const name = status.name.padEnd(24);
    const wait = status.counts.waiting.toString().padStart(4);
    const actv = status.counts.active.toString().padStart(4);
    const fail = status.counts.failed.toString().padStart(4);
    const done = status.counts.completed.toString().padStart(4);

    tableRows.push(`${name} | ${wait} | ${actv} | ${fail} | ${done}`);
  }

  tableRows.push('─────────────────────────┼──────┼──────┼──────┼──────');
  const name = 'TOTAL'.padEnd(24);
  const wait = totalWaiting.toString().padStart(4);
  const actv = totalActive.toString().padStart(4);
  const fail = totalFailed.toString().padStart(4);
  const done = totalCompleted.toString().padStart(4);
  tableRows.push(`${name} | ${wait} | ${actv} | ${fail} | ${done}`);

  for (const row of tableRows) {
    console.log(row);
  }

  // Health assessment
  console.log('\n--- Health Assessment ---');

  if (totalFailed > 0) {
    console.log(`⚠️  ${totalFailed} failed jobs need attention`);
  }

  if (totalWaiting > 100) {
    console.log(`⚠️  High backlog: ${totalWaiting} jobs waiting`);
  }

  const queuesWithHighWait = statuses.filter((s) => {
    if (s.oldestWaiting) {
      const waitSeconds = (Date.now() - s.oldestWaiting.getTime()) / 1000;
      return waitSeconds > 300; // More than 5 minutes
    }
    return false;
  });

  if (queuesWithHighWait.length > 0) {
    console.log(`⚠️  Long wait times in: ${queuesWithHighWait.map((q) => q.name).join(', ')}`);
  }

  if (totalFailed === 0 && totalWaiting < 100 && queuesWithHighWait.length === 0) {
    console.log('✅ All queues healthy');
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();

  console.log('=== BULLMQ QUEUE STATUS ===\n');
  console.log(`Redis: ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`);
  console.log(`Queue prefix: ${QUEUE_PREFIX}`);

  const connection = new IORedis({
    ...REDIS_CONFIG,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  try {
    await connection.connect();
    console.log('Connected to Redis\n');

    // Get Redis info
    const redisInfo = await getRedisInfo(connection);
    printRedisInfo(redisInfo);

    // Determine which queues to check
    const queueNames = args.queue ? [args.queue] : ALL_QUEUE_NAMES;

    // Get status for each queue
    const statuses: QueueStatus[] = [];
    for (const queueName of queueNames) {
      try {
        const status = await getQueueStatus(connection, queueName, args.showFailed);
        statuses.push(status);
        printQueueStatus(status, args.verbose);
      } catch (error) {
        console.log(`\n--- ${queueName} ---`);
        console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Print summary
    if (!args.queue) {
      printSummary(statuses);
    }

    // Print Redis key counts
    console.log('\n--- Redis Keys per Queue ---');
    for (const queueName of queueNames) {
      const keyCount = await getQueueKeyCount(connection, queueName);
      console.log(`  ${queueName}: ${keyCount} keys`);
    }

  } finally {
    await connection.quit();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
