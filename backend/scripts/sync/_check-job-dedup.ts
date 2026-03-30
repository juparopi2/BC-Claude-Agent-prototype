#!/usr/bin/env npx tsx
/**
 * Quick check: Do stuck files have old completed/failed jobs in BullMQ?
 * If so, BullMQ's jobId deduplication silently ignores new .add() calls.
 *
 * Usage: npx tsx scripts/sync/_check-job-dedup.ts --env prod
 */

import 'dotenv/config';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { createPrisma } from '../_shared/prisma';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function parseRedisConnectionString(connStr: string) {
  const parts = connStr.split(',');
  const [host, portStr] = parts[0].split(':');
  const passwordPart = parts.find(p => p.startsWith('password='));
  const password = passwordPart ? passwordPart.split('=').slice(1).join('=') : '';
  const sslPart = parts.find(p => p.toLowerCase().startsWith('ssl='));
  const tls = sslPart ? sslPart.split('=')[1].toLowerCase() === 'true' : false;
  return { host, port: parseInt(portStr) || 6380, password, tls };
}

async function main() {
  const targetEnv = getTargetEnv();
  if (targetEnv) await resolveEnvironment(targetEnv, { redis: true });

  const prisma = createPrisma();

  // Get a sample of stuck files
  const stuckFiles = await prisma.files.findMany({
    where: {
      pipeline_status: 'queued',
      deletion_status: null,
      is_folder: false,
    },
    select: { id: true, name: true, user_id: true },
    take: 10,
    orderBy: { updated_at: 'asc' },
  });

  console.log(`${BOLD}${CYAN}=== BullMQ Job Deduplication Check ===${RESET}`);
  console.log(`Checking ${stuckFiles.length} stuck files for existing jobs in BullMQ\n`);

  if (stuckFiles.length === 0) {
    console.log(`${GREEN}No stuck files found.${RESET}`);
    await prisma.$disconnect();
    return;
  }

  // Connect to Redis
  const connStr = process.env.REDIS_CONNECTION_STRING;
  if (!connStr) {
    console.error(`${RED}REDIS_CONNECTION_STRING not set${RESET}`);
    process.exit(1);
  }
  const parsed = parseRedisConnectionString(connStr);
  const connection = new IORedis({
    host: parsed.host,
    port: parsed.port,
    password: parsed.password || undefined,
    tls: parsed.tls ? {} : undefined,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  await connection.connect();

  const QUEUES = ['file-extract', 'file-chunk', 'file-embed', 'file-pipeline-complete'] as const;
  const PREFIXES = ['extract', 'chunk', 'embed', 'pipeline-complete'] as const;

  // For each stuck file, check if there are existing jobs
  let existingJobCount = 0;
  let totalChecked = 0;

  for (const file of stuckFiles) {
    console.log(`${BOLD}${file.name}${RESET} ${DIM}(${file.id})${RESET}`);

    for (let i = 0; i < QUEUES.length; i++) {
      const queue = new Queue(QUEUES[i], { connection, prefix: 'bull' });
      const jobId = `${PREFIXES[i]}--${file.id}`;

      try {
        const job = await queue.getJob(jobId);
        totalChecked++;

        if (job) {
          const state = await job.getState();
          const finished = job.finishedOn ? new Date(job.finishedOn).toISOString() : 'n/a';
          const color = state === 'completed' ? YELLOW : (state === 'failed' ? RED : GREEN);
          console.log(`  ${color}${QUEUES[i].padEnd(25)} jobId=${jobId}  state=${state}  finished=${finished}${RESET}`);
          existingJobCount++;
        } else {
          console.log(`  ${DIM}${QUEUES[i].padEnd(25)} no job found${RESET}`);
        }
      } finally {
        await queue.close();
      }
    }
    console.log('');
  }

  // Summary
  console.log(`${BOLD}--- Summary ---${RESET}`);
  console.log(`Checked: ${totalChecked} queue slots across ${stuckFiles.length} files`);

  if (existingJobCount > 0) {
    console.log(`${RED}${BOLD}Found ${existingJobCount} existing jobs!${RESET}`);
    console.log(`${YELLOW}This is the root cause: BullMQ deduplicates by jobId.${RESET}`);
    console.log(`${YELLOW}When addFileProcessingFlow() is called with the same fileId,${RESET}`);
    console.log(`${YELLOW}the FlowProducer silently skips creation because completed/failed${RESET}`);
    console.log(`${YELLOW}jobs with that jobId already exist in the queue.${RESET}`);
    console.log(`\n${CYAN}Fix: Either remove old completed/failed jobs before re-enqueue,${RESET}`);
    console.log(`${CYAN}or use unique jobIds per attempt (e.g., include timestamp or retry count).${RESET}`);
  } else {
    console.log(`${GREEN}No existing jobs found — deduplication is NOT the cause.${RESET}`);
  }

  await connection.quit();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(`${RED}Fatal: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  process.exit(1);
});
