#!/usr/bin/env npx tsx
/**
 * diagnose-pipeline-enqueue.ts — Pipeline Enqueue Diagnostic
 *
 * Diagnoses WHY files are stuck in 'queued' status by testing
 * the full BullMQ FlowProducer path independently.
 *
 * Phases:
 *   1. DB Analysis: Stuck file counts, retry distribution, age distribution
 *   2. Redis Health: Connection, queue counts, FlowProducer key inspection
 *   3. FlowProducer Test: Create a real flow for 1-2 sample files and
 *      verify jobs appear in queues (opt-in with --test-enqueue)
 *   4. Reconciliation Evidence: Check if updated_at patterns indicate
 *      the health system is touching stuck files
 *
 * Usage (run from backend/ directory):
 *   npx tsx scripts/sync/diagnose-pipeline-enqueue.ts --env prod
 *   npx tsx scripts/sync/diagnose-pipeline-enqueue.ts --env prod --userId <UUID>
 *   npx tsx scripts/sync/diagnose-pipeline-enqueue.ts --env prod --test-enqueue
 *   npx tsx scripts/sync/diagnose-pipeline-enqueue.ts --env prod --test-enqueue --userId <UUID>
 *   npx tsx scripts/sync/diagnose-pipeline-enqueue.ts --env prod --json
 */

import 'dotenv/config';
import { Queue, FlowProducer } from 'bullmq';
import IORedis from 'ioredis';
import { Prisma } from '@prisma/client';
import { createPrisma } from '../_shared/prisma';
import { hasFlag, getFlag } from '../_shared/args';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

// ============================================================================
// ANSI Colors
// ============================================================================

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';

// ============================================================================
// Constants
// ============================================================================

const BULLMQ_PREFIX = 'bull';

const PIPELINE_QUEUES = [
  'file-extract',
  'file-chunk',
  'file-embed',
  'file-pipeline-complete',
] as const;

const STUCK_STATUSES = ['queued', 'extracting', 'chunking', 'embedding'] as const;

// ============================================================================
// Redis Connection (same pattern as queue-status.ts)
// ============================================================================

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
    tls: (parseInt(process.env.REDIS_PORT || '6380') === 6380) ? {} : undefined,
  };
}

// ============================================================================
// Types
// ============================================================================

interface StuckFileDistribution {
  userId: string;
  pipelineStatus: string;
  retryCount: number;
  count: number;
  oldestUpdated: Date | null;
  newestUpdated: Date | null;
  oldestCreated: Date | null;
  newestCreated: Date | null;
}

interface SampleFile {
  id: string;
  name: string;
  userId: string;
  pipelineStatus: string;
  retryCount: number;
  mimeType: string;
  blobPath: string;
  connectionScopeId: string | null;
  updatedAt: Date | null;
  createdAt: Date | null;
}

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface EnqueueTestResult {
  fileId: string;
  fileName: string;
  flowCreated: boolean;
  error: string | null;
  jobsFoundInQueues: Record<string, boolean>;
}

interface DiagnosticReport {
  generatedAt: string;
  phase1_db: {
    stuckDistribution: StuckFileDistribution[];
    totalStuck: number;
    sampleFiles: SampleFile[];
  };
  phase2_redis: {
    connected: boolean;
    redisVersion: string;
    pipelineQueueCounts: Record<string, QueueCounts>;
    flowProducerKeysFound: number;
  };
  phase3_flowTest: {
    enabled: boolean;
    results: EnqueueTestResult[];
    postEnqueueCounts: Record<string, QueueCounts> | null;
  };
  phase4_reconciliation: {
    recentlyTouchedCount: number;
    untouchedSinceCreationCount: number;
    oldestUntouched: { id: string; name: string; createdAt: string } | null;
  };
  diagnosis: string[];
}

// ============================================================================
// Phase 1: DB Analysis
// ============================================================================

async function phase1_dbAnalysis(
  prisma: ReturnType<typeof createPrisma>,
  targetUserId: string | null,
): Promise<DiagnosticReport['phase1_db']> {
  console.log(`\n${BOLD}${CYAN}--- Phase 1: DB Analysis ---${RESET}`);

  // Stuck file distribution by user, status, retry count
  const baseQuery = Prisma.sql`
    SELECT
      user_id,
      pipeline_status,
      pipeline_retry_count,
      COUNT(*) AS cnt,
      MIN(updated_at) AS oldest_updated,
      MAX(updated_at) AS newest_updated,
      MIN(created_at) AS oldest_created,
      MAX(created_at) AS newest_created
    FROM files
    WHERE pipeline_status IN ('queued', 'extracting', 'chunking', 'embedding')
      AND deletion_status IS NULL
      AND is_folder = 0
  `;

  const distribution = targetUserId
    ? await prisma.$queryRaw<Array<{
        user_id: string;
        pipeline_status: string;
        pipeline_retry_count: number;
        cnt: number;
        oldest_updated: Date | null;
        newest_updated: Date | null;
        oldest_created: Date | null;
        newest_created: Date | null;
      }>>(Prisma.sql`
        ${baseQuery}
        AND user_id = ${targetUserId}
        GROUP BY user_id, pipeline_status, pipeline_retry_count
        ORDER BY user_id, pipeline_status, pipeline_retry_count
      `)
    : await prisma.$queryRaw<Array<{
        user_id: string;
        pipeline_status: string;
        pipeline_retry_count: number;
        cnt: number;
        oldest_updated: Date | null;
        newest_updated: Date | null;
        oldest_created: Date | null;
        newest_created: Date | null;
      }>>(Prisma.sql`
        ${baseQuery}
        GROUP BY user_id, pipeline_status, pipeline_retry_count
        ORDER BY user_id, pipeline_status, pipeline_retry_count
      `);

  const stuckDistribution: StuckFileDistribution[] = distribution.map(row => ({
    userId: row.user_id,
    pipelineStatus: row.pipeline_status,
    retryCount: row.pipeline_retry_count,
    count: Number(row.cnt),
    oldestUpdated: row.oldest_updated,
    newestUpdated: row.newest_updated,
    oldestCreated: row.oldest_created,
    newestCreated: row.newest_created,
  }));

  const totalStuck = stuckDistribution.reduce((sum, row) => sum + row.count, 0);

  // Print distribution
  console.log(`\n  Total stuck files: ${totalStuck === 0 ? `${GREEN}0${RESET}` : `${RED}${totalStuck}${RESET}`}`);

  for (const row of stuckDistribution) {
    const ageMin = row.oldestUpdated
      ? Math.round((Date.now() - new Date(row.oldestUpdated).getTime()) / 60_000)
      : '?';
    const ageMax = row.newestUpdated
      ? Math.round((Date.now() - new Date(row.newestUpdated).getTime()) / 60_000)
      : '?';

    console.log(
      `  ${YELLOW}user=${row.userId.substring(0, 8)}...  ` +
      `status=${row.pipelineStatus.padEnd(10)}  ` +
      `retries=${row.retryCount}  ` +
      `count=${String(row.count).padStart(4)}  ` +
      `updated_at_age=${ageMin}-${ageMax} min${RESET}`,
    );
  }

  // Sample files for Phase 3 test
  const sampleRows = await prisma.files.findMany({
    where: {
      pipeline_status: 'queued',
      deletion_status: null,
      is_folder: false,
      ...(targetUserId ? { user_id: targetUserId } : {}),
    },
    select: {
      id: true,
      name: true,
      user_id: true,
      pipeline_status: true,
      pipeline_retry_count: true,
      mime_type: true,
      blob_path: true,
      connection_scope_id: true,
      updated_at: true,
      created_at: true,
    },
    orderBy: { updated_at: 'asc' },
    take: 3,
  });

  const sampleFiles: SampleFile[] = sampleRows.map(row => ({
    id: row.id,
    name: row.name,
    userId: row.user_id,
    pipelineStatus: row.pipeline_status,
    retryCount: row.pipeline_retry_count ?? 0,
    mimeType: row.mime_type,
    blobPath: row.blob_path ?? '',
    connectionScopeId: row.connection_scope_id,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  }));

  if (sampleFiles.length > 0) {
    console.log(`\n  Sample stuck files (oldest first):`);
    for (const f of sampleFiles) {
      const age = f.updatedAt
        ? `${Math.round((Date.now() - new Date(f.updatedAt).getTime()) / 60_000)} min ago`
        : 'never';
      console.log(
        `    ${DIM}${f.id}${RESET} ${f.name}` +
        `\n      ${DIM}mime=${f.mimeType}  retries=${f.retryCount}  updated=${age}  scope=${f.connectionScopeId ?? 'none'}${RESET}`,
      );
    }
  }

  return { stuckDistribution, totalStuck, sampleFiles };
}

// ============================================================================
// Phase 2: Redis & Queue Health
// ============================================================================

async function phase2_redisHealth(
  connection: IORedis,
): Promise<DiagnosticReport['phase2_redis']> {
  console.log(`\n${BOLD}${CYAN}--- Phase 2: Redis & Queue Health ---${RESET}`);

  // Redis version
  const info = await connection.info('server');
  const versionLine = info.split('\n').find(l => l.startsWith('redis_version:'));
  const redisVersion = versionLine ? versionLine.split(':')[1].trim() : 'unknown';
  console.log(`  Redis version: ${redisVersion}`);

  // Pipeline queue counts
  const pipelineQueueCounts: Record<string, QueueCounts> = {};

  for (const queueName of PIPELINE_QUEUES) {
    const queue = new Queue(queueName, { connection, prefix: BULLMQ_PREFIX });
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      pipelineQueueCounts[queueName] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };

      const c = pipelineQueueCounts[queueName];
      const pending = c.waiting + c.active;
      const color = pending > 0 ? GREEN : (c.failed > 0 ? RED : DIM);
      console.log(
        `  ${color}${queueName.padEnd(25)} wait=${String(c.waiting).padStart(4)}  ` +
        `active=${String(c.active).padStart(4)}  ` +
        `done=${String(c.completed).padStart(5)}  ` +
        `fail=${String(c.failed).padStart(4)}${RESET}`,
      );
    } finally {
      await queue.close();
    }
  }

  // Check for FlowProducer-related keys
  const flowKeys = await connection.keys(`${BULLMQ_PREFIX}:*:meta`);
  console.log(`  Flow/queue meta keys: ${flowKeys.length}`);

  // Check for stalled jobs (indicator of worker issues)
  let stalledTotal = 0;
  for (const queueName of PIPELINE_QUEUES) {
    const stalledKeys = await connection.keys(`${BULLMQ_PREFIX}:${queueName}:stalled`);
    if (stalledKeys.length > 0) {
      const stalledCount = await connection.scard(`${BULLMQ_PREFIX}:${queueName}:stalled`);
      if (stalledCount > 0) {
        console.log(`  ${RED}⚠ ${queueName}: ${stalledCount} stalled jobs${RESET}`);
        stalledTotal += stalledCount;
      }
    }
  }
  if (stalledTotal === 0) {
    console.log(`  ${GREEN}✓ No stalled jobs detected${RESET}`);
  }

  return {
    connected: true,
    redisVersion,
    pipelineQueueCounts,
    flowProducerKeysFound: flowKeys.length,
  };
}

// ============================================================================
// Phase 3: FlowProducer Test Enqueue
// ============================================================================

async function phase3_flowTest(
  connection: IORedis,
  sampleFiles: SampleFile[],
  enabled: boolean,
): Promise<DiagnosticReport['phase3_flowTest']> {
  console.log(`\n${BOLD}${CYAN}--- Phase 3: FlowProducer Test Enqueue ---${RESET}`);

  if (!enabled) {
    console.log(`  ${DIM}Skipped (use --test-enqueue to enable)${RESET}`);
    console.log(`  ${DIM}This would pick 1 sample file and attempt to create a BullMQ Flow${RESET}`);
    return { enabled: false, results: [], postEnqueueCounts: null };
  }

  if (sampleFiles.length === 0) {
    console.log(`  ${GREEN}No stuck files to test with${RESET}`);
    return { enabled: true, results: [], postEnqueueCounts: null };
  }

  // Pick only the FIRST sample file
  const testFile = sampleFiles[0];
  console.log(`\n  Testing with: ${BOLD}${testFile.name}${RESET} (${testFile.id})`);
  console.log(`  ${DIM}mime=${testFile.mimeType}  user=${testFile.userId}  scope=${testFile.connectionScopeId}${RESET}`);

  const redisConfig = buildRedisConfig();
  const results: EnqueueTestResult[] = [];

  // Create a standalone FlowProducer (same as the app does)
  const flowProducer = new FlowProducer({
    connection: redisConfig,
  });

  try {
    const batchId = testFile.connectionScopeId ?? testFile.id;
    const flowTree = {
      name: `pipeline-complete--${testFile.id}`,
      queueName: 'file-pipeline-complete',
      data: { fileId: testFile.id, batchId, userId: testFile.userId },
      opts: {
        jobId: `pipeline-complete--${testFile.id}`,
        attempts: 2,
        backoff: { type: 'exponential' as const, delay: 1000 },
      },
      children: [
        {
          name: `embed--${testFile.id}`,
          queueName: 'file-embed',
          data: { fileId: testFile.id, batchId, userId: testFile.userId },
          opts: {
            jobId: `embed--${testFile.id}`,
            attempts: 3,
            backoff: { type: 'exponential' as const, delay: 3000 },
          },
          children: [
            {
              name: `chunk--${testFile.id}`,
              queueName: 'file-chunk',
              data: { fileId: testFile.id, batchId, userId: testFile.userId, mimeType: testFile.mimeType },
              opts: {
                jobId: `chunk--${testFile.id}`,
                attempts: 3,
                backoff: { type: 'exponential' as const, delay: 3000 },
              },
              children: [
                {
                  name: `extract--${testFile.id}`,
                  queueName: 'file-extract',
                  data: {
                    fileId: testFile.id,
                    batchId,
                    userId: testFile.userId,
                    mimeType: testFile.mimeType,
                    blobPath: testFile.blobPath,
                    fileName: testFile.name,
                  },
                  opts: {
                    jobId: `extract--${testFile.id}`,
                    attempts: 3,
                    backoff: { type: 'exponential' as const, delay: 5000 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    console.log(`\n  Attempting FlowProducer.add()...`);

    try {
      const result = await flowProducer.add(flowTree);
      console.log(`  ${GREEN}✓ FlowProducer.add() SUCCEEDED${RESET}`);
      console.log(`  ${DIM}  Root job: ${result.job?.id ?? 'unknown'}${RESET}`);

      // Wait a moment for Redis to propagate
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify jobs appear in queues
      const jobsFound: Record<string, boolean> = {};
      for (const queueName of PIPELINE_QUEUES) {
        const queue = new Queue(queueName, { connection, prefix: BULLMQ_PREFIX });
        try {
          const jobId = `${queueName === 'file-extract' ? 'extract' : queueName === 'file-chunk' ? 'chunk' : queueName === 'file-embed' ? 'embed' : 'pipeline-complete'}--${testFile.id}`;
          const job = await queue.getJob(jobId);
          jobsFound[queueName] = job !== undefined;
          const status = job ? `${GREEN}✓ found (state: ${await job.getState()})${RESET}` : `${RED}✗ NOT found${RESET}`;
          console.log(`    ${queueName}: ${status}`);
        } finally {
          await queue.close();
        }
      }

      results.push({
        fileId: testFile.id,
        fileName: testFile.name,
        flowCreated: true,
        error: null,
        jobsFoundInQueues: jobsFound,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`  ${RED}✗ FlowProducer.add() FAILED: ${errMsg}${RESET}`);
      if (err instanceof Error && err.stack) {
        console.log(`  ${DIM}${err.stack.split('\n').slice(0, 3).join('\n  ')}${RESET}`);
      }
      results.push({
        fileId: testFile.id,
        fileName: testFile.name,
        flowCreated: false,
        error: errMsg,
        jobsFoundInQueues: {},
      });
    }
  } finally {
    await flowProducer.close();
  }

  // Post-enqueue queue counts
  const postEnqueueCounts: Record<string, QueueCounts> = {};
  for (const queueName of PIPELINE_QUEUES) {
    const queue = new Queue(queueName, { connection, prefix: BULLMQ_PREFIX });
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      postEnqueueCounts[queueName] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    } finally {
      await queue.close();
    }
  }

  console.log(`\n  Post-enqueue queue state:`);
  for (const [queueName, c] of Object.entries(postEnqueueCounts)) {
    const pending = c.waiting + c.active;
    const color = pending > 0 ? GREEN : DIM;
    console.log(
      `  ${color}${queueName.padEnd(25)} wait=${String(c.waiting).padStart(4)}  ` +
      `active=${String(c.active).padStart(4)}${RESET}`,
    );
  }

  return { enabled: true, results, postEnqueueCounts };
}

// ============================================================================
// Phase 4: Reconciliation Evidence
// ============================================================================

async function phase4_reconciliation(
  prisma: ReturnType<typeof createPrisma>,
  targetUserId: string | null,
): Promise<DiagnosticReport['phase4_reconciliation']> {
  console.log(`\n${BOLD}${CYAN}--- Phase 4: Reconciliation Evidence ---${RESET}`);

  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);

  // Count files whose updated_at was recently touched (within 30 min)
  // — this means the reconciliation repairer is running and resetting updated_at
  const recentlyTouched = await prisma.files.count({
    where: {
      pipeline_status: { in: [...STUCK_STATUSES] },
      deletion_status: null,
      is_folder: false,
      updated_at: { gte: thirtyMinAgo },
      ...(targetUserId ? { user_id: targetUserId } : {}),
    },
  });

  // Count files whose updated_at matches created_at (never touched by reconciliation)
  // Using raw query since Prisma doesn't support column-to-column comparison
  const untouchedResult = targetUserId
    ? await prisma.$queryRaw<Array<{ cnt: number }>>(Prisma.sql`
        SELECT COUNT(*) AS cnt
        FROM files
        WHERE pipeline_status IN ('queued', 'extracting', 'chunking', 'embedding')
          AND deletion_status IS NULL
          AND is_folder = 0
          AND updated_at = created_at
          AND user_id = ${targetUserId}
      `)
    : await prisma.$queryRaw<Array<{ cnt: number }>>(Prisma.sql`
        SELECT COUNT(*) AS cnt
        FROM files
        WHERE pipeline_status IN ('queued', 'extracting', 'chunking', 'embedding')
          AND deletion_status IS NULL
          AND is_folder = 0
          AND updated_at = created_at
      `);
  const untouchedSinceCreation = Number(untouchedResult[0]?.cnt ?? 0);

  // Find the oldest untouched file
  const oldestUntouched = await prisma.files.findFirst({
    where: {
      pipeline_status: { in: [...STUCK_STATUSES] },
      deletion_status: null,
      is_folder: false,
      ...(targetUserId ? { user_id: targetUserId } : {}),
    },
    orderBy: { updated_at: 'asc' },
    select: { id: true, name: true, created_at: true, updated_at: true },
  });

  const recentColor = recentlyTouched > 0 ? YELLOW : DIM;
  console.log(`  ${recentColor}Files with updated_at < 30 min ago: ${recentlyTouched}${RESET}`);
  console.log(`  ${DIM}  (These are being touched by the reconciliation repairer)${RESET}`);

  const untouchedColor = untouchedSinceCreation > 0 ? RED : GREEN;
  console.log(`  ${untouchedColor}Files never touched (updated_at = created_at): ${untouchedSinceCreation}${RESET}`);

  if (oldestUntouched) {
    const age = oldestUntouched.updated_at
      ? Math.round((Date.now() - new Date(oldestUntouched.updated_at).getTime()) / 60_000)
      : '?';
    console.log(`  Oldest stuck file: ${oldestUntouched.name} (updated ${age} min ago)`);
  }

  // Interpretation
  if (recentlyTouched > 0 && untouchedSinceCreation === 0) {
    console.log(`\n  ${YELLOW}⚠ Reconciliation IS running and touching files,${RESET}`);
    console.log(`  ${YELLOW}  but files remain stuck → addFileProcessingFlow() likely fails silently${RESET}`);
  } else if (untouchedSinceCreation > 0) {
    console.log(`\n  ${RED}✗ ${untouchedSinceCreation} files were NEVER touched by reconciliation${RESET}`);
    console.log(`  ${RED}  → Reconciliation may not be detecting them${RESET}`);
  }

  return {
    recentlyTouchedCount: recentlyTouched,
    untouchedSinceCreationCount: untouchedSinceCreation,
    oldestUntouched: oldestUntouched
      ? {
          id: oldestUntouched.id,
          name: oldestUntouched.name,
          createdAt: oldestUntouched.created_at?.toISOString() ?? 'unknown',
        }
      : null,
  };
}

// ============================================================================
// Diagnosis Engine
// ============================================================================

function generateDiagnosis(report: DiagnosticReport): string[] {
  const diagnosis: string[] = [];

  // Check: Files stuck with retry=0
  const allRetryZero = report.phase1_db.stuckDistribution.every(d => d.retryCount === 0);
  if (report.phase1_db.totalStuck > 0 && allRetryZero) {
    diagnosis.push(
      'ALL stuck files have pipeline_retry_count=0 — files have NEVER entered the pipeline workers. ' +
      'The extract worker increments retry count on failure, so retry=0 means the BullMQ jobs were never created or never picked up.',
    );
  }

  // Check: Queues empty
  const allQueuesEmpty = Object.values(report.phase2_redis.pipelineQueueCounts).every(
    c => c.waiting === 0 && c.active === 0,
  );
  if (report.phase1_db.totalStuck > 0 && allQueuesEmpty) {
    diagnosis.push(
      'All pipeline queues show 0 waiting and 0 active jobs, yet DB has stuck files. ' +
      'This confirms a disconnect between DB state and BullMQ queue state.',
    );
  }

  // Check: Reconciliation touching files but not fixing them
  if (report.phase4_reconciliation.recentlyTouchedCount > 0 && report.phase1_db.totalStuck > 0) {
    diagnosis.push(
      `Reconciliation IS running (${report.phase4_reconciliation.recentlyTouchedCount} files touched recently). ` +
      'But files remain stuck, meaning addFileProcessingFlow() is called but BullMQ flows are not being created.',
    );
  }

  // Check: FlowProducer test results
  if (report.phase3_flowTest.enabled) {
    for (const result of report.phase3_flowTest.results) {
      if (result.flowCreated) {
        const allFound = Object.values(result.jobsFoundInQueues).every(Boolean);
        if (allFound) {
          diagnosis.push(
            `FlowProducer test SUCCEEDED for ${result.fileName} — jobs appeared in all queues. ` +
            'The FlowProducer itself works from outside the app. Issue may be in the app\'s FlowProducer instance (connection state, initialization order).',
          );
        } else {
          const missing = Object.entries(result.jobsFoundInQueues)
            .filter(([, found]) => !found)
            .map(([q]) => q);
          diagnosis.push(
            `FlowProducer test PARTIAL for ${result.fileName} — jobs missing from: ${missing.join(', ')}. ` +
            'BullMQ Flow creation has a partial failure mode.',
          );
        }
      } else {
        diagnosis.push(
          `FlowProducer test FAILED for ${result.fileName}: ${result.error}. ` +
          'This confirms the FlowProducer cannot create flows — likely a Redis connectivity issue.',
        );
      }
    }
  }

  // Check: pipeline-complete failures
  const completeQueue = report.phase2_redis.pipelineQueueCounts['file-pipeline-complete'];
  if (completeQueue && completeQueue.failed > 0) {
    diagnosis.push(
      `file-pipeline-complete has ${completeQueue.failed} failed jobs. ` +
      'Check batchId handling — known issue with empty string batchId causing SQL UUID conversion errors.',
    );
  }

  if (diagnosis.length === 0) {
    diagnosis.push('No issues detected.');
  }

  return diagnosis;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const targetEnv = getTargetEnv();
  if (targetEnv) await resolveEnvironment(targetEnv, { redis: true });

  const jsonOutput = hasFlag('--json');
  const testEnqueue = hasFlag('--test-enqueue');
  const targetUserId = getFlag('--userId')?.toUpperCase() ?? null;

  console.log(`${BOLD}${CYAN}=== Pipeline Enqueue Diagnostic ===${RESET}`);
  console.log(`${DIM}Generated: ${new Date().toISOString()}${RESET}`);
  if (targetUserId) console.log(`${DIM}Filtering by user: ${targetUserId}${RESET}`);
  if (testEnqueue) console.log(`${YELLOW}Test enqueue enabled — will attempt to create 1 real BullMQ flow${RESET}`);

  const prisma = createPrisma();
  const redisConfig = buildRedisConfig();

  console.log(`\nRedis: ${redisConfig.host}:${redisConfig.port}`);

  const connection = new IORedis({
    ...redisConfig,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  try {
    await connection.connect();
    console.log(`${GREEN}Connected to Redis${RESET}`);

    // Run phases
    const phase1 = await phase1_dbAnalysis(prisma, targetUserId);
    const phase2 = await phase2_redisHealth(connection);
    const phase3 = await phase3_flowTest(connection, phase1.sampleFiles, testEnqueue);
    const phase4 = await phase4_reconciliation(prisma, targetUserId);

    // Build report
    const report: DiagnosticReport = {
      generatedAt: new Date().toISOString(),
      phase1_db: phase1,
      phase2_redis: phase2,
      phase3_flowTest: phase3,
      phase4_reconciliation: phase4,
      diagnosis: [],
    };

    report.diagnosis = generateDiagnosis(report);

    // Output
    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n${BOLD}${CYAN}=== DIAGNOSIS ===${RESET}`);
      for (let i = 0; i < report.diagnosis.length; i++) {
        console.log(`\n  ${YELLOW}${i + 1}. ${report.diagnosis[i]}${RESET}`);
      }
      console.log('');
    }
  } finally {
    await connection.quit();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`${RED}Fatal error: ${errMsg}${RESET}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
