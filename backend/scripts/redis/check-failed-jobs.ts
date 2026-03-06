/**
 * Check Failed Jobs in BullMQ
 * Shows details of failed jobs including error messages
 */

import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_PORT === '6380' ? {} : undefined,
};

const QUEUE_PREFIX = process.env.QUEUE_PREFIX || 'bcagent';

const QUEUE_NAMES = [
  'file-processing',
  'file-chunking',
  'embedding-generation',
];

async function main() {
  console.log('=== CHECKING FAILED JOBS IN BULLMQ ===\n');
  console.log(`Redis: ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`);
  console.log(`Queue prefix: ${QUEUE_PREFIX}\n`);

  const connection = new IORedis({
    ...REDIS_CONFIG,
    maxRetriesPerRequest: null,
  });

  for (const queueName of QUEUE_NAMES) {
    const fullName = `${QUEUE_PREFIX}:${queueName}`;
    console.log(`\n--- Queue: ${fullName} ---\n`);

    const queue = new Queue(queueName, { connection, prefix: QUEUE_PREFIX });

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
