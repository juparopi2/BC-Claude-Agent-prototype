/**
 * reprocess-files-for-v2.ts
 *
 * Re-processes existing files through the embedding pipeline to generate
 * Cohere Embed v4 embeddings and index them in the V2 search index.
 *
 * For each eligible file this script will:
 *   1. Update pipeline_status to 'queued' in the database.
 *   2. Enqueue a BullMQ Flow job (extract → chunk → embed → pipeline-complete).
 *
 * Eligible files: pipeline_status = 'ready', deletion_status IS NULL.
 * Optionally scoped to a single user with --user-id.
 *
 * Usage:
 *   npx tsx scripts/operations/reprocess-files-for-v2.ts
 *   npx tsx scripts/operations/reprocess-files-for-v2.ts --dry-run
 *   npx tsx scripts/operations/reprocess-files-for-v2.ts --user-id <UUID>
 *   npx tsx scripts/operations/reprocess-files-for-v2.ts --batch-size 200 --delay 3000
 *
 * Options:
 *   --batch-size <n>   Files per batch (default: 500)
 *   --delay <ms>       Pause between batches in ms (default: 5000)
 *   --dry-run          Show what would be done without making changes
 *   --user-id <UUID>   Only re-process files belonging to this user
 *
 * Exit codes:
 *   0 — Completed successfully (or dry-run finished)
 *   1 — Fatal error during execution
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { FlowProducer, type FlowJob } from 'bullmq';
import { createPrisma } from '../_shared/prisma.js';
import { getFlag, hasFlag, getNumericFlag } from '../_shared/args.js';

// ─── ANSI Colors ──────────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

// ─── Queue Constants (mirrors infrastructure/queue/constants/queue.constants.ts)
// Must stay in sync with QueueName enum and DEFAULT_BACKOFF values.
const QUEUE_PREFIX = process.env.QUEUE_NAME_PREFIX || '';

const QUEUE_NAMES = {
  FILE_EXTRACT:          'file-extract',
  FILE_CHUNK:            'file-chunk',
  FILE_EMBED:            'file-embed',
  FILE_PIPELINE_COMPLETE: 'file-pipeline-complete',
} as const;

const DEFAULT_BACKOFF = {
  FILE_EXTRACT:           { type: 'exponential' as const, delay: 5000, attempts: 3 },
  FILE_CHUNK:             { type: 'exponential' as const, delay: 3000, attempts: 3 },
  FILE_EMBED:             { type: 'exponential' as const, delay: 3000, attempts: 3 },
  FILE_PIPELINE_COMPLETE: { type: 'exponential' as const, delay: 1000, attempts: 2 },
} as const;

// ─── Redis Config (mirrors queue-status.ts and RedisConnectionManager) ────────
const REDIS_HOST     = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT_RAW = process.env.REDIS_PORT || '6379';
const REDIS_PORT     = parseInt(REDIS_PORT_RAW, 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

// Azure Redis uses TLS on port 6380; parse connection string if provided
function parseRedisConfig(): { host: string; port: number; password?: string } {
  const connStr = process.env.REDIS_CONNECTION_STRING;
  if (connStr) {
    const parts   = connStr.split(',');
    const hostPort = parts[0]?.trim() ?? '';
    const [host, portStr] = hostPort.includes(':')
      ? hostPort.split(':')
      : [hostPort, '6380'];
    const port = parseInt(portStr ?? '6380', 10);
    let password: string | undefined;
    for (const part of parts.slice(1)) {
      const trimmed = part.trim();
      if (trimmed.toLowerCase().startsWith('password=')) {
        password = trimmed.substring(9) || undefined;
        break;
      }
    }
    return { host: host ?? 'localhost', port, password };
  }
  return {
    host:     REDIS_HOST,
    port:     REDIS_PORT,
    password: REDIS_PASSWORD,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileRow {
  id:          string;
  user_id:     string;
  name:        string;
  mime_type:   string;
  blob_path:   string | null;
}

interface BatchResult {
  batchIndex:   number;
  attempted:    number;
  dbUpdated:    number;
  jobsEnqueued: number;
  errors:       string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prefixedQueueName(baseName: string): string {
  return QUEUE_PREFIX ? `${QUEUE_PREFIX}--${baseName}` : baseName;
}

/**
 * Build a BullMQ Flow tree for a single file.
 *
 * Execution order (BullMQ Flows run deepest child first):
 *   extract → chunk → embed → pipeline-complete
 *
 * Mirrors ProcessingFlowFactory.createFileFlow() exactly.
 * NOTE: BullMQ forbids ':' in custom jobIds — using '--' as separator.
 */
function buildFileFlow(params: {
  fileId:   string;
  userId:   string;
  mimeType: string;
  blobPath: string;
  fileName: string;
}): FlowJob {
  const { fileId, userId, mimeType, blobPath, fileName } = params;
  // batchId must be a valid UUID — FilePipelineCompleteWorker uses it in
  // a raw SQL query against upload_batches.id (UniqueIdentifier column).
  // Using a random UUID that won't match any real batch is safe — the
  // UPDATE simply affects 0 rows.
  const batchId = randomUUID().toUpperCase();

  return {
    name:      `pipeline-complete--${fileId}`,
    queueName: prefixedQueueName(QUEUE_NAMES.FILE_PIPELINE_COMPLETE),
    data:      { fileId, batchId, userId },
    opts: {
      jobId:    `pipeline-complete--${fileId}`,
      attempts: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.attempts,
      backoff:  {
        type:  DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.type,
        delay: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.delay,
      },
    },
    children: [
      {
        name:      `embed--${fileId}`,
        queueName: prefixedQueueName(QUEUE_NAMES.FILE_EMBED),
        data:      { fileId, batchId, userId },
        opts: {
          jobId:    `embed--${fileId}`,
          attempts: DEFAULT_BACKOFF.FILE_EMBED.attempts,
          backoff:  {
            type:  DEFAULT_BACKOFF.FILE_EMBED.type,
            delay: DEFAULT_BACKOFF.FILE_EMBED.delay,
          },
        },
        children: [
          {
            name:      `chunk--${fileId}`,
            queueName: prefixedQueueName(QUEUE_NAMES.FILE_CHUNK),
            data:      { fileId, batchId, userId, mimeType },
            opts: {
              jobId:    `chunk--${fileId}`,
              attempts: DEFAULT_BACKOFF.FILE_CHUNK.attempts,
              backoff:  {
                type:  DEFAULT_BACKOFF.FILE_CHUNK.type,
                delay: DEFAULT_BACKOFF.FILE_CHUNK.delay,
              },
            },
            children: [
              {
                name:      `extract--${fileId}`,
                queueName: prefixedQueueName(QUEUE_NAMES.FILE_EXTRACT),
                data:      { fileId, batchId, userId, mimeType, blobPath, fileName },
                opts: {
                  jobId:    `extract--${fileId}`,
                  attempts: DEFAULT_BACKOFF.FILE_EXTRACT.attempts,
                  backoff:  {
                    type:  DEFAULT_BACKOFF.FILE_EXTRACT.type,
                    delay: DEFAULT_BACKOFF.FILE_EXTRACT.delay,
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const secs  = Math.floor(ms / 1000);
  const mins  = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m ${secs % 60}s`;
  if (mins  > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Count total eligible files (pipeline_status = 'ready', not deleted).
 */
async function countEligibleFiles(
  prisma: ReturnType<typeof createPrisma>,
  userId?: string,
): Promise<number> {
  const where: Record<string, unknown> = {
    pipeline_status: 'ready',
    deletion_status: null,
    is_folder:       false,
  };
  if (userId) where['user_id'] = userId;

  return prisma.files.count({ where });
}

/**
 * Fetch one page of eligible files ordered by created_at ASC.
 * Includes mime_type and blob_path for flow job construction.
 */
async function fetchBatch(
  prisma: ReturnType<typeof createPrisma>,
  limit:  number,
  userId?: string,
): Promise<FileRow[]> {
  const where: Record<string, unknown> = {
    pipeline_status: 'ready',
    deletion_status: null,
    is_folder:       false,
  };
  if (userId) where['user_id'] = userId;

  const rows = await prisma.files.findMany({
    where,
    select: {
      id:        true,
      user_id:   true,
      name:      true,
      mime_type: true,
      blob_path: true,
    },
    orderBy: { created_at: 'asc' },
    take:    limit,
  });

  return rows as FileRow[];
}

/**
 * Bulk-update pipeline_status to 'queued' for the given file IDs.
 * Only touches files still in 'ready' status (defensive guard).
 */
async function markBatchQueued(
  prisma:  ReturnType<typeof createPrisma>,
  fileIds: string[],
): Promise<number> {
  const result = await prisma.files.updateMany({
    where: {
      id:              { in: fileIds },
      pipeline_status: 'ready',
      deletion_status: null,
    },
    data: {
      pipeline_status: 'queued',
      updated_at:      new Date(),
    },
  });
  return result.count;
}

/**
 * Process a single batch: update DB + enqueue BullMQ flows.
 */
async function processBatch(
  prisma:       ReturnType<typeof createPrisma>,
  flowProducer: FlowProducer,
  files:        FileRow[],
  batchIndex:   number,
  dryRun:       boolean,
): Promise<BatchResult> {
  const result: BatchResult = {
    batchIndex,
    attempted:    files.length,
    dbUpdated:    0,
    jobsEnqueued: 0,
    errors:       [],
  };

  if (dryRun) {
    // In dry-run mode just report what would happen
    result.dbUpdated    = files.length;
    result.jobsEnqueued = files.length;
    return result;
  }

  // Phase 1: update pipeline_status → 'queued'
  try {
    const updated = await markBatchQueued(prisma, files.map((f) => f.id));
    result.dbUpdated = updated;
    if (updated < files.length) {
      console.warn(
        `${YELLOW}  Warning: only ${updated}/${files.length} files updated (some may have changed status)${RESET}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`DB update failed: ${msg}`);
    // Cannot safely enqueue if DB update failed — skip flow creation
    return result;
  }

  // Phase 2: enqueue BullMQ flow jobs for each file
  for (const file of files) {
    try {
      const flow = buildFileFlow({
        fileId:   file.id,
        userId:   file.user_id,
        mimeType: file.mime_type,
        blobPath: file.blob_path ?? '',
        fileName: file.name,
      });
      await flowProducer.add(flow);
      result.jobsEnqueued++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Flow enqueue failed for ${file.id}: ${msg}`);
    }
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const batchSize = getNumericFlag('--batch-size', 500);
  const delay     = getNumericFlag('--delay', 5000);
  const dryRun    = hasFlag('--dry-run');
  const userId    = getFlag('--user-id')?.toUpperCase() ?? undefined;

  console.log(`${BOLD}${CYAN}=== Reprocess Files for V2 (Cohere Embed v4) ===${RESET}`);
  console.log(`${DIM}Re-enqueues 'ready' files through extract → chunk → embed → complete${RESET}\n`);

  if (dryRun) {
    console.log(`${YELLOW}DRY RUN MODE — no changes will be made${RESET}\n`);
  }

  console.log(`Configuration:`);
  console.log(`  Batch size:   ${batchSize}`);
  console.log(`  Batch delay:  ${delay}ms`);
  console.log(`  Dry run:      ${dryRun}`);
  console.log(`  User filter:  ${userId ?? '(all users)'}`);
  console.log(`  Queue prefix: ${QUEUE_PREFIX || '(none)'}`);
  console.log('');

  // ── Connect Prisma ──────────────────────────────────────────────────────────
  const prisma = createPrisma();

  // ── Connect Redis / FlowProducer ────────────────────────────────────────────
  const redisConfig = parseRedisConfig();
  console.log(`Connecting to Redis at ${redisConfig.host}:${redisConfig.port}...`);

  const flowProducer = new FlowProducer({
    connection: {
      host:                 redisConfig.host,
      port:                 redisConfig.port,
      password:             redisConfig.password,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck:     true,
      tls: redisConfig.port === 6380 ? { rejectUnauthorized: true } : undefined,
    },
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  let shutdownRequested = false;
  process.on('SIGINT', () => {
    console.log(`\n${YELLOW}Shutdown requested — finishing current batch then stopping...${RESET}`);
    shutdownRequested = true;
  });

  // ── Count eligible files ────────────────────────────────────────────────────
  const totalEligible = await countEligibleFiles(prisma, userId);
  const estimatedBatches = Math.ceil(totalEligible / batchSize);
  const estimatedDuration = estimatedBatches > 0
    ? formatDuration((estimatedBatches - 1) * delay)
    : '0s';

  console.log(`Found ${BOLD}${totalEligible}${RESET} eligible files (pipeline_status = 'ready')`);
  console.log(`Estimated: ${estimatedBatches} batches, ~${estimatedDuration} minimum (excluding processing time)\n`);

  if (totalEligible === 0) {
    console.log(`${GREEN}Nothing to do — no eligible files found.${RESET}`);
    await cleanup(prisma, flowProducer);
    return;
  }

  // ── Batch processing loop ───────────────────────────────────────────────────
  const startTime    = Date.now();
  let processedTotal = 0;
  let enqueuedTotal  = 0;
  let batchIndex     = 0;
  const allErrors:   string[] = [];

  while (!shutdownRequested) {
    const files = await fetchBatch(prisma, batchSize, userId);
    if (files.length === 0) break;

    batchIndex++;
    const remaining = totalEligible - processedTotal;
    const elapsedMs = Date.now() - startTime;
    const ratePerMs = processedTotal > 0 ? processedTotal / elapsedMs : 0;
    const etaMs     = ratePerMs > 0 ? remaining / ratePerMs : 0;

    console.log(
      `${DIM}[Batch ${batchIndex}/${estimatedBatches}]${RESET} ` +
      `Processing ${files.length} files... ` +
      `(${processedTotal} done, ~${remaining} remaining` +
      (etaMs > 0 ? `, ETA ${formatDuration(etaMs)}` : '') +
      ')',
    );

    const result = await processBatch(prisma, flowProducer, files, batchIndex, dryRun);

    processedTotal += result.attempted;
    enqueuedTotal  += result.jobsEnqueued;

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.error(`  ${RED}Error: ${err}${RESET}`);
        allErrors.push(err);
      }
    }

    const indicator = result.errors.length === 0 ? `${GREEN}OK${RESET}` : `${YELLOW}PARTIAL${RESET}`;
    console.log(
      `  ${indicator} — DB updated: ${result.dbUpdated}, jobs enqueued: ${result.jobsEnqueued}` +
      (result.errors.length > 0 ? `, errors: ${result.errors.length}` : ''),
    );

    // If fewer files than batch size, this was the last batch
    if (files.length < batchSize) break;

    // Pause between batches to avoid overwhelming the queue and DB
    if (!shutdownRequested) {
      console.log(`  ${DIM}Waiting ${delay}ms before next batch...${RESET}`);
      await sleep(delay);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const elapsed = Date.now() - startTime;
  console.log('');
  console.log(`${BOLD}=== Summary ===${RESET}`);
  console.log(`  Status:         ${shutdownRequested ? `${YELLOW}INTERRUPTED${RESET}` : `${GREEN}COMPLETE${RESET}`}`);
  console.log(`  Mode:           ${dryRun ? 'dry-run' : 'live'}`);
  console.log(`  Batches run:    ${batchIndex}`);
  console.log(`  Files touched:  ${processedTotal}`);
  console.log(`  Jobs enqueued:  ${enqueuedTotal}`);
  console.log(`  Elapsed:        ${formatDuration(elapsed)}`);

  if (allErrors.length > 0) {
    console.log(`  ${RED}Errors: ${allErrors.length}${RESET}`);
    for (const err of allErrors.slice(0, 10)) {
      console.log(`    - ${err}`);
    }
    if (allErrors.length > 10) {
      console.log(`    ... and ${allErrors.length - 10} more`);
    }
  } else {
    console.log(`  Errors:         0`);
  }

  if (!dryRun && processedTotal > 0) {
    console.log('');
    console.log(`${DIM}Files are now queued — workers will begin extracting, chunking, and embedding.${RESET}`);
    console.log(`${DIM}Monitor progress with: npx tsx scripts/redis/queue-status.ts --verbose${RESET}`);
  }

  await cleanup(prisma, flowProducer);
  process.exit(allErrors.length > 0 ? 1 : 0);
}

async function cleanup(
  prisma:       ReturnType<typeof createPrisma>,
  flowProducer: FlowProducer,
): Promise<void> {
  try {
    await flowProducer.close();
  } catch {
    // Ignore close errors
  }
  try {
    await prisma.$disconnect();
  } catch {
    // Ignore disconnect errors
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
