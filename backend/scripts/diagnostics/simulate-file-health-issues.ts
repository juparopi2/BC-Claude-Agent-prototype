/**
 * Simulate File Health Issues — Cross-System (DEV ONLY)
 *
 * Creates REAL errors across DB + Azure Blob Storage + AI Search to trigger
 * all 4 issue types detected by the FileHealthWarning UI:
 *
 *   1. retry_exhausted       — DB: failed/retry=3, deletes file_chunks + AI Search docs
 *   2. blob_missing          — DB: failed, BACKS UP then DELETES the actual blob from Azure
 *   3. failed_retriable      — DB: failed/retry=1, deletes AI Search docs only
 *   4. stuck_processing      — DB: chunking + updated_at 2h ago, deletes file_chunks + AI Search docs
 *   5. soft_deleted_scope_root — DB: soft-deletes a folder scope's root folder (tests reconciliation restore)
 *
 * When "Retry" is clicked, the full BullMQ pipeline (extract → chunk → embed) executes
 * and the file genuinely returns to `ready`.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/diagnostics/simulate-file-health-issues.ts --userId <ID> --confirm-dev
 *   npx tsx scripts/diagnostics/simulate-file-health-issues.ts --userId <ID> --revert --confirm-dev
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { FlowProducer, type FlowJob } from 'bullmq';
import { createPrisma } from '../_shared/prisma';
import { createBlobContainerClient, createSearchClient } from '../_shared/azure';
import { hasFlag, getFlag } from '../_shared/args';
import type { ContainerClient } from '@azure/storage-blob';
import type { SearchClient } from '@azure/search-documents';

// ─── Queue Constants (mirrors audit-file-health.ts) ───────────────────────────
const QUEUE_PREFIX = process.env.QUEUE_NAME_PREFIX || '';

const QUEUE_NAMES = {
  FILE_EXTRACT:           'file-extract',
  FILE_CHUNK:             'file-chunk',
  FILE_EMBED:             'file-embed',
  FILE_PIPELINE_COMPLETE: 'file-pipeline-complete',
} as const;

const DEFAULT_BACKOFF = {
  FILE_EXTRACT:           { type: 'exponential' as const, delay: 5000, attempts: 3 },
  FILE_CHUNK:             { type: 'exponential' as const, delay: 3000, attempts: 3 },
  FILE_EMBED:             { type: 'exponential' as const, delay: 3000, attempts: 3 },
  FILE_PIPELINE_COMPLETE: { type: 'exponential' as const, delay: 1000, attempts: 2 },
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────────
interface SearchDoc {
  chunkId: string;
  fileId: string;
  userId: string;
}

interface SavedFile {
  id: string;
  name: string;
  mimeType: string;
  blobPath: string | null;
  scenario: 'retry_exhausted' | 'blob_missing' | 'failed_retriable' | 'stuck_processing' | 'soft_deleted_scope_root';
  originalDb: {
    pipeline_status: string;
    pipeline_retry_count: number;
    last_processing_error: string | null;
    blob_path: string | null;
    extracted_text_length: number | null;
    updated_at: Date | null;
  };
  originalExternal: {
    fileChunkCount: number;
    searchDocCount: number;
    blobBackupPath: string | null;
    blobOriginalPath: string | null;
  };
}

// ─── CLI Args ──────────────────────────────────────────────────────────────────
const TARGET_USER = getFlag('--userId') ?? '';
const REVERT      = hasFlag('--revert');
const CONFIRM_DEV = hasFlag('--confirm-dev');

const REVERT_FILE = path.join(__dirname, '.simulate-revert-data.json');

// ─── Queue Helpers ─────────────────────────────────────────────────────────────
function prefixedQueueName(baseName: string): string {
  return QUEUE_PREFIX ? `${QUEUE_PREFIX}--${baseName}` : baseName;
}

function parseRedisConfig(): { host: string; port: number; password?: string; tls?: boolean } {
  const connStr = process.env.REDIS_CONNECTION_STRING;
  if (connStr) {
    const parts    = connStr.split(',');
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
    return { host: host ?? 'localhost', port, password, tls: port === 6380 };
  }
  return {
    host:     process.env.REDIS_HOST || 'localhost',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

function buildFileFlow(params: {
  fileId:   string;
  userId:   string;
  mimeType: string;
  blobPath: string;
  fileName: string;
}): FlowJob {
  const { fileId, userId, mimeType, blobPath, fileName } = params;
  const batchId = randomUUID().toUpperCase();

  return {
    name:      `pipeline-complete--${fileId}`,
    queueName: prefixedQueueName(QUEUE_NAMES.FILE_PIPELINE_COMPLETE),
    data:      { fileId, batchId, userId },
    opts: {
      jobId:    `pipeline-complete--${fileId}`,
      attempts: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.attempts,
      backoff:  { type: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.type, delay: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.delay },
    },
    children: [
      {
        name:      `embed--${fileId}`,
        queueName: prefixedQueueName(QUEUE_NAMES.FILE_EMBED),
        data:      { fileId, batchId, userId },
        opts: {
          jobId:    `embed--${fileId}`,
          attempts: DEFAULT_BACKOFF.FILE_EMBED.attempts,
          backoff:  { type: DEFAULT_BACKOFF.FILE_EMBED.type, delay: DEFAULT_BACKOFF.FILE_EMBED.delay },
        },
        children: [
          {
            name:      `chunk--${fileId}`,
            queueName: prefixedQueueName(QUEUE_NAMES.FILE_CHUNK),
            data:      { fileId, batchId, userId, mimeType },
            opts: {
              jobId:    `chunk--${fileId}`,
              attempts: DEFAULT_BACKOFF.FILE_CHUNK.attempts,
              backoff:  { type: DEFAULT_BACKOFF.FILE_CHUNK.type, delay: DEFAULT_BACKOFF.FILE_CHUNK.delay },
            },
            children: [
              {
                name:      `extract--${fileId}`,
                queueName: prefixedQueueName(QUEUE_NAMES.FILE_EXTRACT),
                data:      { fileId, batchId, userId, mimeType, blobPath, fileName },
                opts: {
                  jobId:    `extract--${fileId}`,
                  attempts: DEFAULT_BACKOFF.FILE_EXTRACT.attempts,
                  backoff:  { type: DEFAULT_BACKOFF.FILE_EXTRACT.type, delay: DEFAULT_BACKOFF.FILE_EXTRACT.delay },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

// ─── Azure Helpers ─────────────────────────────────────────────────────────────
async function getSearchDocIds(
  searchClient: SearchClient<SearchDoc>,
  fileId: string,
): Promise<string[]> {
  const idUpper = fileId.toUpperCase();
  const idLower = fileId.toLowerCase();
  const results = await searchClient.search('*', {
    filter: `fileId eq '${idUpper}' or fileId eq '${idLower}'`,
    select: ['chunkId'],
    top: 1000,
  });
  const ids: string[] = [];
  for await (const r of results.results) {
    ids.push(r.document.chunkId);
  }
  return ids;
}

async function deleteSearchDocs(
  searchClient: SearchClient<SearchDoc>,
  chunkIds: string[],
): Promise<number> {
  if (chunkIds.length === 0) return 0;
  const BATCH_SIZE = 1000;
  let deleted = 0;
  for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
    const batch = chunkIds.slice(i, i + BATCH_SIZE);
    try {
      await searchClient.deleteDocuments('chunkId', batch);
      deleted += batch.length;
    } catch (err) {
      console.log(`    Warning: Failed to delete search docs batch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return deleted;
}

async function backupBlob(
  containerClient: ContainerClient,
  blobPath: string,
  userId: string,
): Promise<string> {
  const originalFilename = path.basename(blobPath);
  const backupPath = `_sim-backup/${userId}/${Date.now()}-${originalFilename}`;

  const sourceClient = containerClient.getBlockBlobClient(blobPath);
  const downloadResponse = await sourceClient.download();

  if (!downloadResponse.readableStreamBody) {
    throw new Error(`Failed to download blob: no readable stream for ${blobPath}`);
  }

  // Read stream into buffer
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = downloadResponse.readableStreamBody as NodeJS.ReadableStream;
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const buffer = Buffer.concat(chunks);

  const destClient = containerClient.getBlockBlobClient(backupPath);
  await destClient.upload(buffer, buffer.length);

  return backupPath;
}

async function restoreBlob(
  containerClient: ContainerClient,
  backupPath: string,
  originalPath: string,
): Promise<void> {
  const backupClient   = containerClient.getBlockBlobClient(backupPath);
  const originalClient = containerClient.getBlockBlobClient(originalPath);

  const downloadResponse = await backupClient.download();
  if (!downloadResponse.readableStreamBody) {
    throw new Error(`Failed to download backup blob: no readable stream for ${backupPath}`);
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = downloadResponse.readableStreamBody as NodeJS.ReadableStream;
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const buffer = Buffer.concat(chunks);

  await originalClient.upload(buffer, buffer.length);
  await backupClient.deleteIfExists();
}

// ─── Safety Gates ──────────────────────────────────────────────────────────────
function checkSafety(): void {
  if (!CONFIRM_DEV) {
    console.error('\nERROR: This script modifies real data across DB + Azure Blob + AI Search.');
    console.error('       Add --confirm-dev to confirm you are running in a development environment.\n');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL ?? process.env.DATABASE_SERVER ?? '';
  if (dbUrl && !dbUrl.toLowerCase().includes('dev')) {
    console.error('\nERROR: DATABASE_URL does not contain "dev" substring.');
    console.error('       This script refuses to run against production databases.\n');
    process.exit(1);
  }

  if (!TARGET_USER) {
    console.error('\nERROR: --userId is required.\n');
    console.error('Usage:');
    console.error('  npx tsx scripts/diagnostics/simulate-file-health-issues.ts --userId <ID> --confirm-dev');
    console.error('  npx tsx scripts/diagnostics/simulate-file-health-issues.ts --userId <ID> --revert --confirm-dev\n');
    process.exit(1);
  }
}

// ─── Simulate ──────────────────────────────────────────────────────────────────
async function simulate(): Promise<void> {
  const prisma          = createPrisma();
  const containerClient = createBlobContainerClient();
  const searchClient    = createSearchClient<SearchDoc>();

  if (!containerClient) {
    console.error('\nERROR: STORAGE_CONNECTION_STRING not set. Azure Blob operations required for blob_missing scenario.\n');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!searchClient) {
    console.error('\nERROR: AZURE_SEARCH_ENDPOINT or AZURE_SEARCH_KEY not set. AI Search operations required.\n');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n=== Simulating File Health Issues (Cross-System) ===`);
  console.log(`User: ${TARGET_USER}\n`);

  // ─── File Selection ─────────────────────────────────────────────────────────
  // Query local and external files separately to guarantee local files
  // are included even if they fall outside the first N alphabetical results.
  const readyWhere = {
    user_id:         TARGET_USER,
    deleted_at:      null as null,
    deletion_status: null as null,
    pipeline_status: 'ready',
  };

  const selectFields = {
    id:                    true,
    name:                  true,
    mime_type:             true,
    source_type:           true,
    pipeline_status:       true,
    pipeline_retry_count:  true,
    last_processing_error: true,
    blob_path:             true,
    extracted_text:        true,
    updated_at:            true,
    parent_folder_id:      true,
  } as const;

  const [localFiles, externalFiles] = await Promise.all([
    prisma.files.findMany({
      where:   { ...readyWhere, NOT: { blob_path: null } },
      select:  selectFields,
      take:    10,
      orderBy: { name: 'asc' },
    }),
    prisma.files.findMany({
      where:   { ...readyWhere, blob_path: null },
      select:  selectFields,
      take:    40,
      orderBy: { name: 'asc' },
    }),
  ]);

  const readyFiles = [...localFiles, ...externalFiles];
  console.log(`Found ${readyFiles.length} ready files (${localFiles.length} local, ${externalFiles.length} external)`);

  if (readyFiles.length < 8) {
    console.error(`\nERROR: Need at least 8 ready files, found ${readyFiles.length}.`);
    console.error('       Upload more files and ensure they have completed processing before running this script.\n');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (localFiles.length < 1) {
    console.error(`\nERROR: Need at least 1 local file (blob_path != null) for the blob_missing scenario.`);
    console.error('       Upload at least one file directly (not via SharePoint/OneDrive).\n');
    await prisma.$disconnect();
    process.exit(1);
  }

  const saved: SavedFile[] = [];
  const usedIds = new Set<string>();

  // Helper: pick N files not yet used, preferring a pool
  function pickFiles(
    pool: typeof readyFiles,
    count: number,
    fallback?: typeof readyFiles,
  ): typeof readyFiles {
    const candidates = pool.filter(f => !usedIds.has(f.id));
    const picked = candidates.slice(0, count);
    if (picked.length < count && fallback) {
      const extra = fallback.filter(f => !usedIds.has(f.id) && !picked.some(p => p.id === f.id));
      picked.push(...extra.slice(0, count - picked.length));
    }
    picked.forEach(f => usedIds.add(f.id));
    return picked;
  }

  // ─── Scenario 1: retry_exhausted (2 files) ──────────────────────────────────
  console.log('\n--- Scenario 1: retry_exhausted (2 files) ---');
  const retryExhaustedFiles = pickFiles(readyFiles, 2);

  for (const f of retryExhaustedFiles) {
    try {
      // Save original state
      const chunkIds   = await getSearchDocIds(searchClient, f.id);
      const chunkCount = await prisma.file_chunks.count({ where: { file_id: f.id } });

      saved.push({
        id:       f.id,
        name:     f.name,
        mimeType: f.mime_type,
        blobPath: f.blob_path,
        scenario: 'retry_exhausted',
        originalDb: {
          pipeline_status:       f.pipeline_status,
          pipeline_retry_count:  f.pipeline_retry_count,
          last_processing_error: f.last_processing_error,
          blob_path:             f.blob_path,
          extracted_text_length: f.extracted_text != null ? f.extracted_text.length : null,
          updated_at:            f.updated_at,
        },
        originalExternal: {
          fileChunkCount:  chunkCount,
          searchDocCount:  chunkIds.length,
          blobBackupPath:  null,
          blobOriginalPath: null,
        },
      });

      // DB: set failed + exhausted retries + clear extracted_text
      await prisma.files.update({
        where: { id: f.id },
        data: {
          pipeline_status:       'failed',
          pipeline_retry_count:  3,
          last_processing_error: '[SIMULATED] Pipeline failed after 3 retries — text extraction timeout',
          extracted_text:        null,
        },
      });

      // External: delete file_chunks from DB
      await prisma.file_chunks.deleteMany({ where: { file_id: f.id } });

      // External: delete all AI Search docs
      const deletedSearch = await deleteSearchDocs(searchClient, chunkIds);

      console.log(`  [retry_exhausted]  "${f.name}" — DB: failed, retry=3 | Deleted: ${chunkCount} chunks, ${deletedSearch} search docs, cleared text`);
    } catch (err) {
      console.error(`  [retry_exhausted]  "${f.name}" FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Scenario 2: blob_missing (1 local file) ────────────────────────────────
  console.log('\n--- Scenario 2: blob_missing (1 local file) ---');
  const blobMissingFiles = pickFiles(localFiles, 1);

  for (const f of blobMissingFiles) {
    if (!f.blob_path) {
      console.log(`  [blob_missing]     SKIPPED — no blob_path on file "${f.name}"`);
      continue;
    }
    try {
      const chunkCount = await prisma.file_chunks.count({ where: { file_id: f.id } });
      const chunkIds   = await getSearchDocIds(searchClient, f.id);

      // Backup then delete the blob
      const backupPath = await backupBlob(containerClient, f.blob_path, TARGET_USER);
      await containerClient.getBlockBlobClient(f.blob_path).deleteIfExists();

      saved.push({
        id:       f.id,
        name:     f.name,
        mimeType: f.mime_type,
        blobPath: f.blob_path,
        scenario: 'blob_missing',
        originalDb: {
          pipeline_status:       f.pipeline_status,
          pipeline_retry_count:  f.pipeline_retry_count,
          last_processing_error: f.last_processing_error,
          blob_path:             f.blob_path,
          extracted_text_length: f.extracted_text != null ? f.extracted_text.length : null,
          updated_at:            f.updated_at,
        },
        originalExternal: {
          fileChunkCount:  chunkCount,
          searchDocCount:  chunkIds.length,
          blobBackupPath:  backupPath,
          blobOriginalPath: f.blob_path,
        },
      });

      // DB: set failed (keep blob_path intact so classifier sees blob_path != null + blob missing)
      await prisma.files.update({
        where: { id: f.id },
        data: {
          pipeline_status:       'failed',
          pipeline_retry_count:  0,
          last_processing_error: '[SIMULATED] The specified blob does not exist. StorageError: BlobNotFound',
        },
      });

      console.log(`  [blob_missing]     "${f.name}" — DB: failed | Blob: DELETED, backup at ${backupPath}`);
    } catch (err) {
      console.error(`  [blob_missing]     "${f.name}" FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (blobMissingFiles.length === 0) {
    console.log('  [blob_missing]     SKIPPED — no unused local files available');
  }

  // ─── Scenario 3: failed_retriable (3 files) ─────────────────────────────────
  console.log('\n--- Scenario 3: failed_retriable (3 files) ---');
  const retriableFiles = pickFiles(readyFiles, 3);

  for (const f of retriableFiles) {
    try {
      const chunkIds = await getSearchDocIds(searchClient, f.id);
      const chunkCount = await prisma.file_chunks.count({ where: { file_id: f.id } });

      saved.push({
        id:       f.id,
        name:     f.name,
        mimeType: f.mime_type,
        blobPath: f.blob_path,
        scenario: 'failed_retriable',
        originalDb: {
          pipeline_status:       f.pipeline_status,
          pipeline_retry_count:  f.pipeline_retry_count,
          last_processing_error: f.last_processing_error,
          blob_path:             f.blob_path,
          extracted_text_length: f.extracted_text != null ? f.extracted_text.length : null,
          updated_at:            f.updated_at,
        },
        originalExternal: {
          fileChunkCount:  chunkCount,
          searchDocCount:  chunkIds.length,
          blobBackupPath:  null,
          blobOriginalPath: null,
        },
      });

      // DB: set failed + retriable retry count (keep extracted_text + file_chunks)
      await prisma.files.update({
        where: { id: f.id },
        data: {
          pipeline_status:       'failed',
          pipeline_retry_count:  1,
          last_processing_error: '[SIMULATED] Cohere embedding service returned 503 — transient error during embedding generation',
        },
      });

      // External: delete AI Search docs only (keep file_chunks and extracted_text)
      const deletedSearch = await deleteSearchDocs(searchClient, chunkIds);

      console.log(`  [failed_retriable] "${f.name}" — DB: failed, retry=1 | Deleted: ${deletedSearch} search docs (kept ${chunkCount} chunks + text)`);
    } catch (err) {
      console.error(`  [failed_retriable] "${f.name}" FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Scenario 4: stuck_processing (2 files) ─────────────────────────────────
  console.log('\n--- Scenario 4: stuck_processing (2 files) ---');
  const stuckFiles   = pickFiles(readyFiles, 2);
  const twoHoursAgo  = new Date(Date.now() - 2 * 60 * 60 * 1000);

  for (const f of stuckFiles) {
    try {
      const chunkIds   = await getSearchDocIds(searchClient, f.id);
      const chunkCount = await prisma.file_chunks.count({ where: { file_id: f.id } });

      saved.push({
        id:       f.id,
        name:     f.name,
        mimeType: f.mime_type,
        blobPath: f.blob_path,
        scenario: 'stuck_processing',
        originalDb: {
          pipeline_status:       f.pipeline_status,
          pipeline_retry_count:  f.pipeline_retry_count,
          last_processing_error: f.last_processing_error,
          blob_path:             f.blob_path,
          extracted_text_length: f.extracted_text != null ? f.extracted_text.length : null,
          updated_at:            f.updated_at,
        },
        originalExternal: {
          fileChunkCount:  chunkCount,
          searchDocCount:  chunkIds.length,
          blobBackupPath:  null,
          blobOriginalPath: null,
        },
      });

      // DB: set intermediate status + old updated_at (leave other fields unchanged)
      await prisma.files.update({
        where: { id: f.id },
        data: {
          pipeline_status: 'chunking',
          updated_at:      twoHoursAgo,
        },
      });

      // External: delete file_chunks from DB + AI Search docs
      await prisma.file_chunks.deleteMany({ where: { file_id: f.id } });
      const deletedSearch = await deleteSearchDocs(searchClient, chunkIds);

      console.log(`  [stuck_processing] "${f.name}" — DB: chunking, 2h ago | Deleted: ${chunkCount} chunks, ${deletedSearch} search docs`);
    } catch (err) {
      console.error(`  [stuck_processing] "${f.name}" FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Scenario 5: soft_deleted_scope_root (1 folder scope) ──────────────────
  console.log('\n--- Scenario 5: soft_deleted_scope_root (1 folder scope root) ---');
  {
    // Find a folder-type scope whose root folder exists and is alive
    const folderScopes = await prisma.connection_scopes.findMany({
      where: {
        connections: { user_id: TARGET_USER, status: 'connected' },
        scope_type: 'folder',
        scope_resource_id: { not: null },
      },
      select: { id: true, scope_resource_id: true, connection_id: true, scope_display_name: true },
      take: 5,
    });

    let simulated = false;
    for (const scope of folderScopes) {
      if (!scope.scope_resource_id) continue;

      const rootFolder = await prisma.files.findFirst({
        where: {
          connection_id: scope.connection_id,
          external_id: scope.scope_resource_id,
          is_folder: true,
          deletion_status: null,
        },
        select: {
          id: true,
          name: true,
          mime_type: true,
          blob_path: true,
          pipeline_status: true,
          pipeline_retry_count: true,
          last_processing_error: true,
          extracted_text: true,
          updated_at: true,
          deleted_at: true,
          deletion_status: true,
        },
      });

      if (!rootFolder) continue;

      saved.push({
        id:       rootFolder.id,
        name:     rootFolder.name,
        mimeType: rootFolder.mime_type,
        blobPath: rootFolder.blob_path,
        scenario: 'soft_deleted_scope_root',
        originalDb: {
          pipeline_status:       rootFolder.pipeline_status,
          pipeline_retry_count:  rootFolder.pipeline_retry_count,
          last_processing_error: rootFolder.last_processing_error,
          blob_path:             rootFolder.blob_path,
          extracted_text_length: rootFolder.extracted_text != null ? rootFolder.extracted_text.length : null,
          updated_at:            rootFolder.updated_at,
        },
        originalExternal: {
          fileChunkCount:   0,
          searchDocCount:   0,
          blobBackupPath:   null,
          blobOriginalPath: null,
        },
      });

      // Soft-delete the scope root folder (simulates disconnect/reconnect race)
      await prisma.files.update({
        where: { id: rootFolder.id },
        data: {
          deleted_at: new Date(),
          deletion_status: 'pending',
        },
      });

      console.log(`  [soft_deleted_scope_root] "${rootFolder.name}" (scope ${scope.id.substring(0, 8)}…) — soft-deleted`);
      console.log(`    → Reconciliation should detect this via missing scope root check`);
      console.log(`    → ensureScopeRootFolder should restore it (un-delete)`);
      simulated = true;
      break; // Only need one
    }

    if (!simulated) {
      console.log('  [soft_deleted_scope_root] SKIPPED — no folder scopes with alive root folder found');
    }
  }

  // ─── Save Revert Data ────────────────────────────────────────────────────────
  fs.writeFileSync(REVERT_FILE, JSON.stringify(saved, null, 2), 'utf-8');

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log('\n=== Simulation Summary ===');
  for (const s of saved) {
    const ext = s.originalExternal;
    if (s.scenario === 'retry_exhausted') {
      console.log(`  [retry_exhausted]  "${s.name}" — DB: failed, retry=3 | Deleted: ${ext.fileChunkCount} chunks, ${ext.searchDocCount} search docs, cleared text`);
    } else if (s.scenario === 'blob_missing') {
      console.log(`  [blob_missing]     "${s.name}" — DB: failed | Blob: DELETED, backup at ${ext.blobBackupPath}`);
    } else if (s.scenario === 'failed_retriable') {
      console.log(`  [failed_retriable] "${s.name}" — DB: failed, retry=1 | Deleted: ${ext.searchDocCount} search docs (kept chunks+text)`);
    } else if (s.scenario === 'stuck_processing') {
      console.log(`  [stuck_processing] "${s.name}" — DB: chunking, 2h ago | Deleted: ${ext.fileChunkCount} chunks, ${ext.searchDocCount} search docs`);
    } else if (s.scenario === 'soft_deleted_scope_root') {
      console.log(`  [scope_root_deleted] "${s.name}" — DB: soft-deleted (deletion_status='pending')`);
    }
  }

  console.log('\n=== How to Verify ===');
  console.log('  1. Open browser → FileHealthWarning icon should appear');
  console.log('  2. Click → 4 issue types visible');
  console.log('  3. Retry a failed_retriable → should succeed (check pipeline logs)');
  console.log('  4. blob_missing shows "Accept" not "Retry"');
  console.log('  5. stuck_processing auto-recovers within 15 min (StuckFileRecoveryService)');
  console.log('  6. soft_deleted_scope_root auto-recovers on next reconciliation (login or cron)');
  console.log('     → Check: POST /api/sync/health/reconcile → folderHierarchy.scopeRootsRecreated > 0');
  console.log('\n=== To Revert ===');
  console.log(`  npx tsx scripts/diagnostics/simulate-file-health-issues.ts --userId ${TARGET_USER} --revert --confirm-dev\n`);
  console.log(`Revert data saved to ${REVERT_FILE}`);

  await prisma.$disconnect();
}

// ─── Revert ────────────────────────────────────────────────────────────────────
async function revert(): Promise<void> {
  const prisma          = createPrisma();
  const containerClient = createBlobContainerClient();

  console.log(`\n=== Reverting Simulated Issues ===`);
  console.log(`User: ${TARGET_USER}\n`);

  if (!fs.existsSync(REVERT_FILE)) {
    console.error(`ERROR: No revert data found at ${REVERT_FILE}`);
    console.error('       Run simulate first.\n');
    await prisma.$disconnect();
    process.exit(1);
  }

  const saved: SavedFile[] = JSON.parse(fs.readFileSync(REVERT_FILE, 'utf-8'));

  // Parse dates that JSON.parse returns as strings
  for (const entry of saved) {
    if (entry.originalDb.updated_at && typeof entry.originalDb.updated_at === 'string') {
      entry.originalDb.updated_at = new Date(entry.originalDb.updated_at);
    }
  }

  // Collect files that need re-queuing (chunks/search were deleted)
  const toRequeue: SavedFile[] = [];
  let reverted = 0;
  let skipped  = 0;

  for (const entry of saved) {
    // Check if file still exists
    const file = await prisma.files.findUnique({
      where:  { id: entry.id },
      select: { id: true, pipeline_status: true, blob_path: true },
    });

    if (!file) {
      console.log(`  [SKIP]    "${entry.name}" — file no longer exists (may have been deleted via Accept)`);
      skipped++;
      continue;
    }

    if (file.pipeline_status === 'ready') {
      console.log(`  [SKIP]    "${entry.name}" — already ready (user retried successfully)`);
      skipped++;
      continue;
    }

    // For soft_deleted_scope_root: just un-delete and restore original status
    if (entry.scenario === 'soft_deleted_scope_root') {
      await prisma.files.update({
        where: { id: entry.id },
        data: {
          deleted_at: null,
          deletion_status: null,
          pipeline_status: entry.originalDb.pipeline_status,
          pipeline_retry_count: entry.originalDb.pipeline_retry_count,
          last_processing_error: entry.originalDb.last_processing_error,
        },
      });
      console.log(`  [REVERTED] "${entry.name}" (soft_deleted_scope_root) — un-deleted`);
      reverted++;
      continue;
    }

    // For blob_missing: restore blob from backup first
    if (entry.scenario === 'blob_missing') {
      const backupPath   = entry.originalExternal.blobBackupPath;
      const originalPath = entry.originalExternal.blobOriginalPath ?? entry.originalDb.blob_path;

      if (backupPath && originalPath) {
        if (!containerClient) {
          console.error(`  [ERROR]   "${entry.name}" — STORAGE_CONNECTION_STRING not set, cannot restore blob`);
          continue;
        }
        try {
          await restoreBlob(containerClient, backupPath, originalPath);
          console.log(`  [BLOB]    "${entry.name}" — blob restored from backup`);
        } catch (err) {
          console.error(`  [ERROR]   "${entry.name}" — blob restore failed: ${err instanceof Error ? err.message : String(err)}`);
          // Still attempt DB restore
        }
      }
    }

    // Restore DB fields
    await prisma.files.update({
      where: { id: entry.id },
      data: {
        pipeline_status:       entry.originalDb.pipeline_status,
        pipeline_retry_count:  entry.originalDb.pipeline_retry_count,
        last_processing_error: entry.originalDb.last_processing_error,
        blob_path:             entry.originalDb.blob_path,
        updated_at:            entry.originalDb.updated_at,
      },
    });

    // For scenarios where chunks + search docs were deleted: re-enqueue full pipeline
    const needsRequeue =
      entry.scenario === 'retry_exhausted' ||
      entry.scenario === 'failed_retriable' ||
      entry.scenario === 'stuck_processing';

    if (needsRequeue) {
      toRequeue.push(entry);
    }

    console.log(`  [REVERTED] "${entry.name}" (${entry.scenario}) — DB restored to ${entry.originalDb.pipeline_status}`);
    reverted++;
  }

  // Re-enqueue files via BullMQ FlowProducer
  if (toRequeue.length > 0) {
    console.log(`\nRe-queuing ${toRequeue.length} file(s) through the full pipeline...`);
    try {
      const redisConfig   = parseRedisConfig();
      const flowProducer  = new FlowProducer({
        connection: {
          host:                 redisConfig.host,
          port:                 redisConfig.port,
          password:             redisConfig.password,
          maxRetriesPerRequest: null,
          tls:                  redisConfig.tls ? {} : undefined,
        },
      });

      for (const entry of toRequeue) {
        // Use current blob_path (restored from originalDb) for external files or blob_path
        const blobPath = entry.originalDb.blob_path ?? entry.blobPath ?? '';
        if (!blobPath && entry.scenario !== 'retry_exhausted') {
          // External files can still re-queue without blobPath (GraphApiContentProvider handles it)
        }

        try {
          // Set pipeline_status to 'queued' so the pipeline picks it up
          await prisma.files.update({
            where: { id: entry.id },
            data:  { pipeline_status: 'queued' },
          });

          await flowProducer.add(buildFileFlow({
            fileId:   entry.id,
            userId:   TARGET_USER,
            mimeType: entry.mimeType,
            blobPath: blobPath,
            fileName: entry.name,
          }));
          console.log(`  [QUEUED]  "${entry.name}" — enqueued for full pipeline re-run`);
        } catch (queueErr) {
          console.error(`  [ERROR]   "${entry.name}" — failed to enqueue: ${queueErr instanceof Error ? queueErr.message : String(queueErr)}`);
          // Fall back: restore original status so file isn't stuck in wrong state
          await prisma.files.update({
            where: { id: entry.id },
            data:  { pipeline_status: entry.originalDb.pipeline_status },
          });
        }
      }

      await flowProducer.close();
    } catch (redisErr) {
      console.error(`\nWARNING: Could not connect to Redis for re-queuing: ${redisErr instanceof Error ? redisErr.message : String(redisErr)}`);
      console.error('         Files have been restored in DB. Trigger re-processing manually via the UI.\n');
    }
  }

  // Remove revert file
  fs.unlinkSync(REVERT_FILE);

  console.log(`\n✓ Reverted ${reverted} files (${skipped} skipped). Refresh the browser — warning icon should disappear.\n`);

  await prisma.$disconnect();
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  checkSafety();

  if (REVERT) {
    await revert();
  } else {
    await simulate();
  }
}

main().catch((err: unknown) => {
  console.error('\nFatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
