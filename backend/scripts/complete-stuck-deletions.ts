/**
 * Complete Stuck Deletions Script
 *
 * Completes file/folder deletions that are stuck due to OOM, crashes, or queue failures.
 * Files with deletion_status IN ('pending', 'deleting', 'failed') are:
 *   - Hidden from frontend
 *   - Not fully deleted from storage
 *
 * This script:
 * 1. Finds all files/folders with non-NULL deletion_status
 * 2. Deletes blobs from Azure Storage (if exists)
 * 3. Deletes documents from Azure AI Search (if exists)
 * 4. Deletes records from DB (CASCADE handles file_chunks)
 *
 * Usage:
 *   npx tsx scripts/complete-stuck-deletions.ts --userId <USER_ID>
 *   npx tsx scripts/complete-stuck-deletions.ts --userId <USER_ID> --dry-run
 *   npx tsx scripts/complete-stuck-deletions.ts --userId <USER_ID> --older-than 60
 *   npx tsx scripts/complete-stuck-deletions.ts --all --dry-run
 */
import 'dotenv/config';
import sql from 'mssql';
import { BlobServiceClient } from '@azure/storage-blob';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

// ============================================================================
// Configuration
// ============================================================================

const SQL_CONFIG: sql.config = {
  server: process.env.DATABASE_SERVER || '',
  database: process.env.DATABASE_NAME || '',
  user: process.env.DATABASE_USER || '',
  password: process.env.DATABASE_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

const BLOB_CONNECTION_STRING = process.env.STORAGE_CONNECTION_STRING || '';
const BLOB_CONTAINER = process.env.STORAGE_CONTAINER_NAME || 'user-files';

const SEARCH_ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT || '';
const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';
const SEARCH_INDEX = process.env.AZURE_SEARCH_INDEX_NAME || 'file-chunks-index';

// Default: only clean up deletions older than 60 minutes
const DEFAULT_OLDER_THAN_MINUTES = 60;

// ============================================================================
// Types
// ============================================================================

interface StuckFile {
  id: string;
  user_id: string;
  name: string;
  is_folder: boolean;
  blob_path: string | null;
  deletion_status: string;
  deleted_at: Date | null;
  parent_folder_id: string | null;
}

interface SearchDocument {
  chunkId: string;
  fileId: string;
  userId: string;
}

interface CleanupResult {
  fileId: string;
  fileName: string;
  isFolder: boolean;
  blobDeleted: boolean;
  searchDocsDeleted: number;
  dbRecordDeleted: boolean;
  error?: string;
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface Args {
  userId: string | null;
  all: boolean;
  dryRun: boolean;
  olderThanMinutes: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Complete Stuck Deletions Script

Completes file/folder deletions that are stuck with non-NULL deletion_status.

Usage:
  npx tsx scripts/complete-stuck-deletions.ts --userId <USER_ID>
  npx tsx scripts/complete-stuck-deletions.ts --userId <USER_ID> --dry-run
  npx tsx scripts/complete-stuck-deletions.ts --all --dry-run

Options:
  --userId <id>       Process files for specific user (required unless --all)
  --all               Process all stuck files in the system
  --dry-run           Show what would be deleted without actually deleting
  --older-than <min>  Only process deletions older than X minutes (default: ${DEFAULT_OLDER_THAN_MINUTES})

Deletion Status States:
  'pending'   - Marked for deletion, waiting for queue processing
  'deleting'  - Deletion in progress (may be stuck)
  'failed'    - Deletion failed, needs retry

Examples:
  npx tsx scripts/complete-stuck-deletions.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D --dry-run
  npx tsx scripts/complete-stuck-deletions.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D
  npx tsx scripts/complete-stuck-deletions.ts --all --older-than 120
`);
    process.exit(0);
  }

  const userIdIndex = args.indexOf('--userId');
  const userId = userIdIndex !== -1 && args[userIdIndex + 1] ? args[userIdIndex + 1] : null;

  const olderThanIndex = args.indexOf('--older-than');
  const olderThanMinutes =
    olderThanIndex !== -1 && args[olderThanIndex + 1]
      ? parseInt(args[olderThanIndex + 1], 10)
      : DEFAULT_OLDER_THAN_MINUTES;

  return {
    userId,
    all: args.includes('--all'),
    dryRun: args.includes('--dry-run'),
    olderThanMinutes,
  };
}

// ============================================================================
// Database Queries
// ============================================================================

async function getStuckFiles(
  pool: sql.ConnectionPool,
  userId: string | null,
  olderThanMinutes: number
): Promise<StuckFile[]> {
  const request = pool.request();

  let query = `
    SELECT id, user_id, name, is_folder, blob_path, deletion_status, deleted_at, parent_folder_id
    FROM files
    WHERE deletion_status IS NOT NULL
  `;

  if (userId) {
    query += ` AND user_id = @userId`;
    request.input('userId', sql.UniqueIdentifier, userId);
  }

  // Only get files stuck for more than X minutes
  query += ` AND (deleted_at IS NULL OR deleted_at < DATEADD(MINUTE, -@olderThanMinutes, GETUTCDATE()))`;
  request.input('olderThanMinutes', sql.Int, olderThanMinutes);

  query += ` ORDER BY deleted_at ASC, is_folder DESC`;

  const result = await request.query<StuckFile>(query);
  return result.recordset;
}

async function deleteFileRecord(pool: sql.ConnectionPool, fileId: string): Promise<boolean> {
  try {
    await pool.request().input('fileId', sql.UniqueIdentifier, fileId).query(`
        DELETE FROM files WHERE id = @fileId
      `);
    return true;
  } catch (error) {
    console.error(`  Failed to delete DB record: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function getChunkIdsForFile(pool: sql.ConnectionPool, fileId: string): Promise<string[]> {
  const result = await pool.request().input('fileId', sql.UniqueIdentifier, fileId).query<{ id: string }>(`
      SELECT id FROM file_chunks WHERE file_id = @fileId
    `);
  return result.recordset.map((r) => r.id);
}

// ============================================================================
// Blob Storage
// ============================================================================

async function deleteBlob(
  containerClient: ReturnType<BlobServiceClient['getContainerClient']>,
  blobPath: string
): Promise<boolean> {
  if (!blobPath) return true; // No blob to delete

  try {
    const blobClient = containerClient.getBlobClient(blobPath);
    const exists = await blobClient.exists();

    if (!exists) {
      return true; // Already deleted
    }

    await containerClient.deleteBlob(blobPath);
    return true;
  } catch (error) {
    console.error(`  Failed to delete blob: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

// ============================================================================
// AI Search
// ============================================================================

async function deleteSearchDocuments(
  searchClient: SearchClient<SearchDocument>,
  chunkIds: string[]
): Promise<number> {
  if (chunkIds.length === 0) return 0;

  const BATCH_SIZE = 100;
  let deleted = 0;

  for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
    const batch = chunkIds.slice(i, i + BATCH_SIZE);
    try {
      await searchClient.deleteDocuments('chunkId', batch);
      deleted += batch.length;
    } catch {
      // May fail if documents don't exist - that's OK
    }
  }

  return deleted;
}

// ============================================================================
// Main Cleanup Logic
// ============================================================================

async function completeStuckDeletions(
  pool: sql.ConnectionPool,
  containerClient: ReturnType<BlobServiceClient['getContainerClient']> | null,
  searchClient: SearchClient<SearchDocument> | null,
  files: StuckFile[],
  dryRun: boolean
): Promise<CleanupResult[]> {
  const results: CleanupResult[] = [];

  // Process folders first (they don't have blobs)
  const folders = files.filter((f) => f.is_folder);
  const regularFiles = files.filter((f) => !f.is_folder);

  console.log(`\nProcessing ${folders.length} folders and ${regularFiles.length} files...\n`);

  // Process files in order
  for (const file of [...folders, ...regularFiles]) {
    const icon = file.is_folder ? '[FOLDER]' : '[FILE]';
    console.log(`${icon} ${file.name.substring(0, 50)}`);
    console.log(`  ID: ${file.id}`);
    console.log(`  Status: ${file.deletion_status}`);
    console.log(`  Deleted at: ${file.deleted_at?.toISOString() || 'N/A'}`);

    const result: CleanupResult = {
      fileId: file.id,
      fileName: file.name,
      isFolder: file.is_folder,
      blobDeleted: false,
      searchDocsDeleted: 0,
      dbRecordDeleted: false,
    };

    if (dryRun) {
      console.log(`  [DRY RUN] Would delete\n`);
      results.push(result);
      continue;
    }

    // 1. Delete blob (if file, not folder)
    if (!file.is_folder && containerClient && file.blob_path) {
      result.blobDeleted = await deleteBlob(containerClient, file.blob_path);
      console.log(`  Blob: ${result.blobDeleted ? 'Deleted' : 'FAILED'}`);
    } else {
      result.blobDeleted = true; // Folders don't have blobs
    }

    // 2. Delete search documents (if searchClient available)
    if (searchClient && !file.is_folder) {
      const chunkIds = await getChunkIdsForFile(pool, file.id);
      if (chunkIds.length > 0) {
        result.searchDocsDeleted = await deleteSearchDocuments(searchClient, chunkIds);
        console.log(`  Search docs: Deleted ${result.searchDocsDeleted}/${chunkIds.length}`);
      }
    }

    // 3. Delete DB record (cascade deletes chunks)
    result.dbRecordDeleted = await deleteFileRecord(pool, file.id);
    console.log(`  DB record: ${result.dbRecordDeleted ? 'Deleted' : 'FAILED'}`);

    if (result.dbRecordDeleted) {
      console.log(`  ✓ Completed\n`);
    } else {
      result.error = 'Failed to delete DB record';
      console.log(`  ✗ Failed\n`);
    }

    results.push(result);
  }

  return results;
}

// ============================================================================
// Output
// ============================================================================

function printSummary(
  stuckFiles: StuckFile[],
  results: CleanupResult[],
  dryRun: boolean
): void {
  console.log('='.repeat(80));
  console.log('CLEANUP SUMMARY');
  console.log('='.repeat(80));

  // Group by status
  const byStatus = new Map<string, number>();
  for (const file of stuckFiles) {
    byStatus.set(file.deletion_status, (byStatus.get(file.deletion_status) || 0) + 1);
  }

  console.log('\n--- Stuck Files by Status ---');
  for (const [status, count] of byStatus) {
    console.log(`  ${status}: ${count}`);
  }

  // Count types
  const folders = stuckFiles.filter((f) => f.is_folder).length;
  const files = stuckFiles.length - folders;
  console.log('\n--- Stuck Files by Type ---');
  console.log(`  Folders: ${folders}`);
  console.log(`  Files: ${files}`);

  if (dryRun) {
    console.log('\n--- DRY RUN MODE ---');
    console.log(`  Would process ${stuckFiles.length} stuck files/folders`);
    console.log('\n  Run without --dry-run to actually delete');
  } else {
    const successful = results.filter((r) => r.dbRecordDeleted).length;
    const failed = results.filter((r) => !r.dbRecordDeleted).length;

    console.log('\n--- Results ---');
    console.log(`  Successfully deleted: ${successful}`);
    console.log(`  Failed: ${failed}`);

    if (failed > 0) {
      console.log('\n--- Failed Items ---');
      for (const r of results.filter((r) => !r.dbRecordDeleted)) {
        console.log(`  ${r.fileName}: ${r.error || 'Unknown error'}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();

  if (!args.userId && !args.all) {
    console.error('ERROR: Either --userId or --all is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  console.log('=== COMPLETE STUCK DELETIONS ===\n');
  console.log(`User ID: ${args.userId || 'ALL USERS'}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Older than: ${args.olderThanMinutes} minutes\n`);

  // Validate config
  if (!SQL_CONFIG.server) {
    console.error('ERROR: DATABASE_SERVER environment variable not set');
    process.exit(1);
  }

  // Connect to database
  const pool = await sql.connect(SQL_CONFIG);
  console.log('Database: Connected');

  // Connect to Blob Storage
  let containerClient: ReturnType<BlobServiceClient['getContainerClient']> | null = null;
  if (BLOB_CONNECTION_STRING) {
    const blobServiceClient = BlobServiceClient.fromConnectionString(BLOB_CONNECTION_STRING);
    containerClient = blobServiceClient.getContainerClient(BLOB_CONTAINER);
    console.log(`Blob Storage: Connected to container '${BLOB_CONTAINER}'`);
  } else {
    console.warn('Warning: STORAGE_CONNECTION_STRING not set, skipping blob deletion');
  }

  // Connect to AI Search
  let searchClient: SearchClient<SearchDocument> | null = null;
  if (SEARCH_ENDPOINT && SEARCH_KEY) {
    searchClient = new SearchClient<SearchDocument>(
      SEARCH_ENDPOINT,
      SEARCH_INDEX,
      new AzureKeyCredential(SEARCH_KEY)
    );
    console.log(`AI Search: Connected to index '${SEARCH_INDEX}'`);
  } else {
    console.warn('Warning: AI Search credentials not set, skipping search doc deletion');
  }

  try {
    // Get stuck files
    console.log('\nFetching stuck files...');
    const stuckFiles = await getStuckFiles(pool, args.userId, args.olderThanMinutes);

    if (stuckFiles.length === 0) {
      console.log('\n✅ No stuck deletions found!');
      process.exit(0);
    }

    console.log(`Found ${stuckFiles.length} stuck files/folders`);

    // Preview
    console.log('\n--- Stuck Files Preview ---');
    for (const file of stuckFiles.slice(0, 10)) {
      const icon = file.is_folder ? '[FOLDER]' : '[FILE]';
      console.log(`  ${icon} ${file.name.substring(0, 45).padEnd(45)} | ${file.deletion_status.padEnd(10)}`);
    }
    if (stuckFiles.length > 10) {
      console.log(`  ... and ${stuckFiles.length - 10} more`);
    }

    // Execute cleanup
    const results = await completeStuckDeletions(
      pool,
      containerClient,
      searchClient,
      stuckFiles,
      args.dryRun
    );

    // Print summary
    printSummary(stuckFiles, results, args.dryRun);

    // Exit code based on results
    if (!args.dryRun) {
      const failed = results.filter((r) => !r.dbRecordDeleted).length;
      process.exit(failed > 0 ? 1 : 0);
    }
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
