/**
 * Diagnostic: Check File Health API
 *
 * Verifies that the FileHealthService returns the expected data for a user.
 * Tests the same query the GET /api/files/health/issues endpoint would run.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/diagnostics/check-file-health-api.ts --userId <ID>
 */

import { createPrisma } from '../_shared/prisma';

const prisma = createPrisma();

const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
const MAX_RETRY_COUNT = 3;

async function main() {
  const userId = process.argv.find((_, i, arr) => arr[i - 1] === '--userId') ?? '3CA3E04F-AE0E-4EEE-9CDA-2BC77F1DC9D0';

  console.log(`\n=== File Health API Diagnostic for ${userId} ===\n`);

  // 1. Query failed files
  const failedFiles = await prisma.files.findMany({
    where: {
      user_id: userId,
      deleted_at: null,
      deletion_status: null,
      pipeline_status: 'failed',
    },
    select: {
      id: true,
      name: true,
      mime_type: true,
      source_type: true,
      pipeline_status: true,
      pipeline_retry_count: true,
      processing_retry_count: true,
      embedding_retry_count: true,
      last_processing_error: true,
      blob_path: true,
      parent_folder_id: true,
      connection_scope_id: true,
      updated_at: true,
    },
  });

  console.log(`Failed files: ${failedFiles.length}`);
  for (const f of failedFiles) {
    const isExternal = f.blob_path == null;
    const retryExhausted = f.pipeline_retry_count >= MAX_RETRY_COUNT;
    console.log(`  [${retryExhausted ? 'RETRY_EXHAUSTED' : 'FAILED_RETRIABLE'}] ${f.name}`);
    console.log(`    pipeline_retry_count: ${f.pipeline_retry_count}`);
    console.log(`    processing_retry_count: ${f.processing_retry_count}`);
    console.log(`    embedding_retry_count: ${f.embedding_retry_count}`);
    console.log(`    source: ${f.source_type}, blob: ${f.blob_path ? 'SET' : 'NULL'}, external: ${isExternal}`);
    console.log(`    error: ${f.last_processing_error ?? '(none)'}`);
    console.log();
  }

  // 2. Query stuck files
  const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuckFiles = await prisma.files.findMany({
    where: {
      user_id: userId,
      deleted_at: null,
      deletion_status: null,
      pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
      updated_at: { lt: stuckThreshold },
    },
    select: {
      id: true,
      name: true,
      pipeline_status: true,
      updated_at: true,
    },
  });

  console.log(`Stuck files (>30 min): ${stuckFiles.length}`);
  for (const f of stuckFiles) {
    const stuckMinutes = f.updated_at ? Math.round((Date.now() - f.updated_at.getTime()) / 60000) : '?';
    console.log(`  [STUCK] ${f.name} — ${f.pipeline_status} for ${stuckMinutes} min`);
  }

  // 3. Summary = what the API should return
  const retryExhausted = failedFiles.filter(f => f.pipeline_retry_count >= MAX_RETRY_COUNT);
  const blobMissing = 0; // Would need blob check, skip for now
  const failedRetriable = failedFiles.filter(f => f.pipeline_retry_count < MAX_RETRY_COUNT);

  console.log(`\n=== Expected API Response Summary ===`);
  console.log(`  retryExhausted:  ${retryExhausted.length}`);
  console.log(`  blobMissing:     ${blobMissing} (not checked — needs blob storage)`);
  console.log(`  failedRetriable: ${failedRetriable.length}`);
  console.log(`  stuckProcessing: ${stuckFiles.length}`);
  console.log(`  total:           ${retryExhausted.length + failedRetriable.length + stuckFiles.length}`);
  console.log();

  if (retryExhausted.length + failedRetriable.length + stuckFiles.length > 0) {
    console.log('✓ The FileHealthWarning icon SHOULD appear in the toolbar.');
  } else {
    console.log('✗ No issues found — the icon will NOT appear.');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Error:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
