/**
 * Check Failed Jobs in BullMQ
 * Shows details of failed jobs including error messages
 */

import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

/**
 * BullMQ default Redis key prefix is 'bull'.
 * The app's QUEUE_NAME_PREFIX is for queue NAME prefixing (e.g. 'local--file-extract'),
 * NOT for the Redis key prefix. Scripts must use 'bull' to match production queues.
 */
const BULLMQ_PREFIX = 'bull';

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

const QUEUE_NAMES = [
  'file-processing',
  'file-chunking',
  'embedding-generation',
];

async function main() {
  // Resolve remote environment if --env flag is set
  const targetEnv = getTargetEnv();
  if (targetEnv) {
    await resolveEnvironment(targetEnv, { redis: true });
  }

  const REDIS_CONFIG = buildRedisConfig();

  console.log('=== CHECKING FAILED JOBS IN BULLMQ ===\n');
  console.log(`Redis: ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`);
  console.log(`BullMQ prefix: ${BULLMQ_PREFIX}`);
  if (targetEnv) console.log(`Environment: ${targetEnv}`);
  console.log('');

  const connection = new IORedis({
    ...REDIS_CONFIG,
    maxRetriesPerRequest: null,
  });

  for (const queueName of QUEUE_NAMES) {
    console.log(`\n--- Queue: ${queueName} ---\n`);

    const queue = new Queue(queueName, { connection, prefix: BULLMQ_PREFIX });

    // Get failed jobs
    const failedJobs = await queue.getFailed(0, 20);
    console.log(`Failed jobs: ${failedJobs.length}`);

    for (const job of failedJobs) {
      console.log(`\n  Job ID: ${job.id}`);
      console.log(`  Name: ${job.name}`);
      console.log(`  Attempts: ${job.attemptsMade}`);
      console.log(`  Failed Reason: ${job.failedReason || 'Not provided'}`);
      console.log(`  Timestamp: ${new Date(job.timestamp).toISOString()}`);

      // Show job data
      console.log('  Data:');
      const data = job.data as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 50) {
          console.log(`    ${key}: ${value.substring(0, 50)}...`);
        } else {
          console.log(`    ${key}: ${JSON.stringify(value)}`);
        }
      }

      // Show stack trace if available
      if (job.stacktrace && job.stacktrace.length > 0) {
        console.log('  Stack trace:');
        for (const line of job.stacktrace.slice(0, 5)) {
          console.log(`    ${line}`);
        }
      }
    }

    // Get waiting jobs
    const waitingJobs = await queue.getWaiting(0, 10);
    console.log(`\nWaiting jobs: ${waitingJobs.length}`);

    // Get active jobs
    const activeJobs = await queue.getActive(0, 10);
    console.log(`Active jobs: ${activeJobs.length}`);

    // Get completed jobs count
    const completedCount = await queue.getCompletedCount();
    console.log(`Completed jobs: ${completedCount}`);

    await queue.close();
  }

  await connection.quit();
  console.log('\n=== DONE ===');
}

main().catch(console.error);
