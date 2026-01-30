/**
 * Enhanced Orphan Cleanup Script
 *
 * Cleans up orphaned resources across all storage systems:
 * - AI Search documents (documents without corresponding DB files)
 * - Blob Storage files (blobs without corresponding DB files)
 * - File chunks (chunks with no parent file)
 *
 * Usage:
 *   npx tsx scripts/run-orphan-cleanup.ts [--userId <id>]
 *   npx tsx scripts/run-orphan-cleanup.ts --userId <id> --include-blobs
 *   npx tsx scripts/run-orphan-cleanup.ts --userId <id> --include-chunks
 *   npx tsx scripts/run-orphan-cleanup.ts --userId <id> --all
 *   npx tsx scripts/run-orphan-cleanup.ts --dry-run
 */

import 'dotenv/config';
import { BlobServiceClient } from '@azure/storage-blob';
import { initDatabase, closeDatabase, getPool } from '../src/infrastructure/database/database';
import { getOrphanCleanupJob } from '../src/jobs/OrphanCleanupJob';
import sql from 'mssql';

// ============================================================================
// Configuration
// ============================================================================

const BLOB_CONNECTION_STRING = process.env.STORAGE_CONNECTION_STRING || '';
const BLOB_CONTAINER = process.env.STORAGE_CONTAINER_NAME || 'user-files';

// ============================================================================
// Types
// ============================================================================

interface CleanupOptions {
  userId: string | undefined;
  includeBlobs: boolean;
  includeChunks: boolean;
  dryRun: boolean;
}

interface BlobCleanupResult {
  userId: string;
  orphanBlobs: string[];
  deletedBlobs: number;
  failedDeletions: number;
  errors: string[];
}

interface ChunkCleanupResult {
  orphanChunks: number;
  deletedChunks: number;
  errors: string[];
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Enhanced Orphan Cleanup Script

Usage:
  npx tsx scripts/run-orphan-cleanup.ts [options]

Options:
  --userId <id>      Clean orphans for specific user only
  --include-blobs    Also clean orphan blobs from Azure Storage
  --include-chunks   Also clean orphan file_chunks from database
  --all              Clean all types of orphans (blobs + chunks + AI Search)
  --dry-run          Show what would be deleted without actually deleting

Examples:
  npx tsx scripts/run-orphan-cleanup.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D
  npx tsx scripts/run-orphan-cleanup.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D --include-blobs
  npx tsx scripts/run-orphan-cleanup.ts --all --dry-run
`);
    process.exit(0);
  }

  const userIdIndex = args.indexOf('--userId');
  const includeAll = args.includes('--all');

  return {
    userId: userIdIndex !== -1 && args[userIdIndex + 1] ? args[userIdIndex + 1] : undefined,
    includeBlobs: includeAll || args.includes('--include-blobs'),
    includeChunks: includeAll || args.includes('--include-chunks'),
    dryRun: args.includes('--dry-run'),
  };
}

// ============================================================================
// Blob Orphan Cleanup
// ============================================================================

async function getDbBlobPathsForUser(pool: sql.ConnectionPool, userId: string): Promise<Set<string>> {
  const result = await pool
    .request()
    .input('userId', sql.UniqueIdentifier, userId)
    .query<{ blob_path: string }>(`
      SELECT blob_path FROM files
      WHERE user_id = @userId AND is_folder = 0 AND blob_path IS NOT NULL
    `);

  return new Set(result.recordset.map((r) => r.blob_path));
}

async function cleanOrphanBlobs(
  userId: string,
  dryRun: boolean
): Promise<BlobCleanupResult> {
  const result: BlobCleanupResult = {
    userId,
    orphanBlobs: [],
    deletedBlobs: 0,
    failedDeletions: 0,
    errors: [],
  };

  if (!BLOB_CONNECTION_STRING) {
    result.errors.push('STORAGE_CONNECTION_STRING not configured');
    return result;
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(BLOB_CONNECTION_STRING);
    const containerClient = blobServiceClient.getContainerClient(BLOB_CONTAINER);
    const pool = getPool();

    // Get blob paths from database for this user
    const dbBlobPaths = await getDbBlobPathsForUser(pool, userId);
    console.log(`  Found ${dbBlobPaths.size} file records in database`);

    // List all blobs for this user
    const userPrefix = `users/${userId}/files/`;
    let blobCount = 0;

    for await (const blob of containerClient.listBlobsFlat({ prefix: userPrefix })) {
      blobCount++;
      if (!dbBlobPaths.has(blob.name)) {
        result.orphanBlobs.push(blob.name);
      }
    }

    console.log(`  Found ${blobCount} blobs in storage`);
    console.log(`  Found ${result.orphanBlobs.length} orphan blobs`);

    if (result.orphanBlobs.length === 0) {
      return result;
    }

    // Delete orphan blobs
    for (const blobPath of result.orphanBlobs) {
      if (dryRun) {
        console.log(`    [DRY RUN] Would delete: ${blobPath}`);
        result.deletedBlobs++;
      } else {
        try {
          await containerClient.deleteBlob(blobPath);
          result.deletedBlobs++;
          console.log(`    Deleted: ${blobPath}`);
        } catch (error) {
          result.failedDeletions++;
          const msg = error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to delete ${blobPath}: ${msg}`);
        }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Blob cleanup failed: ${msg}`);
  }

  return result;
}

// ============================================================================
// Chunk Orphan Cleanup
// ============================================================================

async function cleanOrphanChunks(dryRun: boolean): Promise<ChunkCleanupResult> {
  const result: ChunkCleanupResult = {
    orphanChunks: 0,
    deletedChunks: 0,
    errors: [],
  };

  try {
    const pool = getPool();

    // Count orphan chunks (chunks with no parent file)
    const countResult = await pool.request().query<{ count: number }>(`
      SELECT COUNT(*) as count
      FROM file_chunks fc
      WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id = fc.file_id)
    `);

    result.orphanChunks = countResult.recordset[0]?.count || 0;
    console.log(`  Found ${result.orphanChunks} orphan chunks`);

    if (result.orphanChunks === 0) {
      return result;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would delete ${result.orphanChunks} orphan chunks`);
      result.deletedChunks = result.orphanChunks;
    } else {
      // Delete orphan chunks
      const deleteResult = await pool.request().query(`
        DELETE FROM file_chunks
        WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id = file_chunks.file_id)
      `);

      result.deletedChunks = deleteResult.rowsAffected[0] || 0;
      console.log(`  Deleted ${result.deletedChunks} orphan chunks`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Chunk cleanup failed: ${msg}`);
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const options = parseArgs();

  console.log('=== ENHANCED ORPHAN CLEANUP ===\n');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN (no actual deletions)' : 'LIVE'}`);
  console.log(`User: ${options.userId || 'ALL USERS'}`);
  console.log(`Include blobs: ${options.includeBlobs}`);
  console.log(`Include chunks: ${options.includeChunks}`);
  console.log('');

  // Initialize database connection
  console.log('📡 Connecting to database...');
  await initDatabase();
  console.log('✅ Database connected\n');

  const job = getOrphanCleanupJob();

  try {
    // 1. AI Search orphan cleanup (always run)
    console.log('--- AI Search Orphan Cleanup ---\n');
    if (options.userId) {
      console.log(`Running AI Search cleanup for user: ${options.userId}`);
      const result = await job.cleanOrphansForUser(options.userId);
      console.log(`  Found ${result.totalOrphans} orphan documents`);
      console.log(`  Deleted: ${result.deletedOrphans}`);
      console.log(`  Failed: ${result.failedDeletions}`);
      console.log(`  Duration: ${result.durationMs}ms`);
      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.join(', ')}`);
      }
    } else {
      console.log('Running AI Search cleanup for all users...');
      const summary = await job.runFullCleanup();
      console.log(`  Users processed: ${summary.totalUsers}`);
      console.log(`  Orphans found: ${summary.totalOrphans}`);
      console.log(`  Deleted: ${summary.totalDeleted}`);
      console.log(`  Failed: ${summary.totalFailed}`);
      console.log(`  Duration: ${summary.completedAt.getTime() - summary.startedAt.getTime()}ms`);
    }

    // 2. Blob orphan cleanup (optional)
    if (options.includeBlobs) {
      console.log('\n--- Blob Storage Orphan Cleanup ---\n');
      if (options.userId) {
        console.log(`Cleaning orphan blobs for user: ${options.userId}`);
        const blobResult = await cleanOrphanBlobs(options.userId, options.dryRun);
        console.log(`  Orphan blobs: ${blobResult.orphanBlobs.length}`);
        console.log(`  Deleted: ${blobResult.deletedBlobs}`);
        console.log(`  Failed: ${blobResult.failedDeletions}`);
        if (blobResult.errors.length > 0) {
          console.log(`  Errors: ${blobResult.errors.join(', ')}`);
        }
      } else {
        // Get all users and clean their blobs
        const pool = getPool();
        const usersResult = await pool.request().query<{ user_id: string }>(`
          SELECT DISTINCT user_id FROM files WHERE is_folder = 0
        `);
        const users = usersResult.recordset.map((r) => r.user_id);

        let totalOrphanBlobs = 0;
        let totalDeletedBlobs = 0;
        let totalFailedBlobs = 0;

        for (const userId of users) {
          console.log(`Cleaning orphan blobs for user: ${userId}`);
          const blobResult = await cleanOrphanBlobs(userId, options.dryRun);
          totalOrphanBlobs += blobResult.orphanBlobs.length;
          totalDeletedBlobs += blobResult.deletedBlobs;
          totalFailedBlobs += blobResult.failedDeletions;
        }

        console.log(`\n  Total orphan blobs: ${totalOrphanBlobs}`);
        console.log(`  Total deleted: ${totalDeletedBlobs}`);
        console.log(`  Total failed: ${totalFailedBlobs}`);
      }
    }

    // 3. Chunk orphan cleanup (optional)
    if (options.includeChunks) {
      console.log('\n--- Database Chunk Orphan Cleanup ---\n');
      const chunkResult = await cleanOrphanChunks(options.dryRun);
      console.log(`  Orphan chunks: ${chunkResult.orphanChunks}`);
      console.log(`  Deleted: ${chunkResult.deletedChunks}`);
      if (chunkResult.errors.length > 0) {
        console.log(`  Errors: ${chunkResult.errors.join(', ')}`);
      }
    }

    console.log('\n✅ Orphan cleanup completed!');
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Orphan cleanup failed:', error);
    await closeDatabase();
    process.exit(1);
  }
}

main();
