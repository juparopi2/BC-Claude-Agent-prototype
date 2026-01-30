/**
 * Verify File Integrity
 *
 * Comprehensive verification of file integrity across all storage systems:
 * - SQL Database (files, file_chunks)
 * - Azure Blob Storage
 * - Azure AI Search
 *
 * Checks for:
 * 1. DB → Blob: Files in DB have corresponding blobs
 * 2. DB → AI Search: Completed embeddings have search documents
 * 3. Blob → DB: No orphan blobs without DB records
 * 4. AI Search → DB: No orphan search documents
 * 5. Stuck files: Files in processing state for too long
 * 6. Chunk integrity: file_chunks with missing parent files
 *
 * Usage:
 *   npx tsx scripts/verify-file-integrity.ts --userId <USER_ID>
 *   npx tsx scripts/verify-file-integrity.ts --userId <USER_ID> --fix-orphans
 *   npx tsx scripts/verify-file-integrity.ts --all --report-only
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
const SEARCH_KEY = process.env.AZURE_SEARCH_API_KEY || '';
const SEARCH_INDEX = process.env.AZURE_SEARCH_INDEX_NAME || 'file-chunks-index';

// Files stuck in processing for more than this duration are flagged
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// Types
// ============================================================================

interface SQLFile {
  id: string;
  user_id: string;
  name: string;
  blob_path: string;
  processing_status: string;
  embedding_status: string;
  is_folder: boolean;
  created_at: Date;
  updated_at: Date;
}

interface SQLChunk {
  id: string;
  file_id: string;
  chunk_index: number;
  search_document_id: string | null;
}

interface IntegrityIssue {
  type:
    | 'missing_blob'
    | 'orphan_blob'
    | 'missing_search_doc'
    | 'orphan_search_doc'
    | 'stuck_processing'
    | 'stuck_embedding'
    | 'orphan_chunk'
    | 'chunk_mismatch';
  severity: 'error' | 'warning';
  fileId?: string;
  fileName?: string;
  userId?: string;
  details: string;
  suggestion?: string;
}

interface IntegrityReport {
  userId: string | 'all';
  timestamp: Date;
  summary: {
    totalFiles: number;
    totalChunks: number;
    totalBlobs: number;
    totalSearchDocs: number;
    issuesFound: number;
    errorCount: number;
    warningCount: number;
  };
  issues: IntegrityIssue[];
  statusBreakdown: {
    processing: Record<string, number>;
    embedding: Record<string, number>;
  };
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface Args {
  userId: string | null;
  all: boolean;
  fixOrphans: boolean;
  reportOnly: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
File Integrity Verification Script

Usage:
  npx tsx scripts/verify-file-integrity.ts --userId <USER_ID>
  npx tsx scripts/verify-file-integrity.ts --all
  npx tsx scripts/verify-file-integrity.ts --userId <USER_ID> --fix-orphans

Options:
  --userId <id>   Verify files for specific user (required unless --all)
  --all           Verify all files in the system
  --fix-orphans   Delete orphan blobs and search documents (use with caution)
  --report-only   Only generate report, don't output detailed logs

Examples:
  npx tsx scripts/verify-file-integrity.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D
  npx tsx scripts/verify-file-integrity.ts --all --report-only
`);
    process.exit(0);
  }

  const userIdIndex = args.indexOf('--userId');
  const userId = userIdIndex !== -1 && args[userIdIndex + 1] ? args[userIdIndex + 1] : null;

  return {
    userId,
    all: args.includes('--all'),
    fixOrphans: args.includes('--fix-orphans'),
    reportOnly: args.includes('--report-only'),
  };
}

// ============================================================================
// Database Queries
// ============================================================================

async function getFilesFromDB(pool: sql.ConnectionPool, userId: string | null): Promise<SQLFile[]> {
  const request = pool.request();
  let query = `
    SELECT id, user_id, name, blob_path, processing_status, embedding_status,
           is_folder, created_at, updated_at
    FROM files
    WHERE is_folder = 0
  `;

  if (userId) {
    query += ` AND user_id = @userId`;
    request.input('userId', sql.UniqueIdentifier, userId);
  }

  query += ` ORDER BY created_at DESC`;

  const result = await request.query<SQLFile>(query);
  return result.recordset;
}

async function getChunksFromDB(
  pool: sql.ConnectionPool,
  fileIds: string[]
): Promise<Map<string, SQLChunk[]>> {
  if (fileIds.length === 0) return new Map();

  // Query in batches to avoid SQL parameter limits
  const BATCH_SIZE = 500;
  const chunks = new Map<string, SQLChunk[]>();

  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, idx) => `@id${idx}`).join(',');

    const request = pool.request();
    batch.forEach((id, idx) => {
      request.input(`id${idx}`, sql.UniqueIdentifier, id);
    });

    const result = await request.query<SQLChunk>(`
      SELECT id, file_id, chunk_index, search_document_id
      FROM file_chunks
      WHERE file_id IN (${placeholders})
      ORDER BY file_id, chunk_index
    `);

    for (const chunk of result.recordset) {
      const fileChunks = chunks.get(chunk.file_id) || [];
      fileChunks.push(chunk);
      chunks.set(chunk.file_id, fileChunks);
    }
  }

  return chunks;
}

async function getOrphanChunks(pool: sql.ConnectionPool, userId: string | null): Promise<number> {
  const request = pool.request();
  let query = `
    SELECT COUNT(*) as count
    FROM file_chunks fc
    WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id = fc.file_id)
  `;

  if (userId) {
    // Note: file_chunks doesn't have user_id, so we can't filter by user for orphan chunks
    // This query will always check all orphan chunks regardless of userId
  }

  const result = await request.query<{ count: number }>(query);
  return result.recordset[0]?.count || 0;
}

// ============================================================================
// Blob Storage
// ============================================================================

async function getBlobsForUser(
  containerClient: ReturnType<BlobServiceClient['getContainerClient']>,
  userId: string | null
): Promise<Map<string, number>> {
  const blobs = new Map<string, number>();
  const prefix = userId ? `users/${userId}/` : 'users/';

  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    blobs.set(blob.name, blob.properties.contentLength || 0);
  }

  return blobs;
}

async function deleteOrphanBlob(
  containerClient: ReturnType<BlobServiceClient['getContainerClient']>,
  blobPath: string
): Promise<boolean> {
  try {
    await containerClient.deleteBlob(blobPath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// AI Search
// ============================================================================

interface SearchDocument {
  chunkId: string;
  fileId: string;
  userId: string;
  chunkIndex: number;
}

async function getSearchDocsForUser(
  searchClient: SearchClient<SearchDocument>,
  userId: string | null
): Promise<Map<string, SearchDocument[]>> {
  const docs = new Map<string, SearchDocument[]>();

  try {
    // Search with filter if userId provided
    const filter = userId ? `userId eq '${userId}'` : undefined;
    const searchResults = await searchClient.search('*', {
      select: ['chunkId', 'fileId', 'userId', 'chunkIndex'],
      filter,
      top: 10000, // Get all results
    });

    for await (const result of searchResults.results) {
      const doc = result.document;
      const fileId = doc.fileId.toUpperCase(); // Normalize to uppercase
      const fileDocs = docs.get(fileId) || [];
      fileDocs.push(doc);
      docs.set(fileId, fileDocs);
    }
  } catch (error) {
    console.warn('Warning: Could not query AI Search. Index may not exist or credentials invalid.');
    console.warn(`  Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return docs;
}

async function deleteOrphanSearchDocs(
  searchClient: SearchClient<SearchDocument>,
  chunkIds: string[]
): Promise<number> {
  if (chunkIds.length === 0) return 0;

  let deleted = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
    const batch = chunkIds.slice(i, i + BATCH_SIZE);
    try {
      await searchClient.deleteDocuments('chunkId', batch);
      deleted += batch.length;
    } catch {
      // Continue with next batch
    }
  }

  return deleted;
}

// ============================================================================
// Verification Logic
// ============================================================================

async function verifyIntegrity(
  pool: sql.ConnectionPool,
  containerClient: ReturnType<BlobServiceClient['getContainerClient']> | null,
  searchClient: SearchClient<SearchDocument> | null,
  userId: string | null,
  options: { fixOrphans: boolean; reportOnly: boolean }
): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];
  const now = new Date();

  // 1. Get files from database
  console.log('Fetching files from database...');
  const files = await getFilesFromDB(pool, userId);
  console.log(`  Found ${files.length} files in database`);

  // 2. Get chunks from database
  const fileIds = files.map((f) => f.id);
  console.log('Fetching chunks from database...');
  const chunks = await getChunksFromDB(pool, fileIds);
  const totalChunks = Array.from(chunks.values()).reduce((sum, c) => sum + c.length, 0);
  console.log(`  Found ${totalChunks} chunks for ${chunks.size} files`);

  // 3. Get blobs from storage
  let blobs = new Map<string, number>();
  if (containerClient) {
    console.log('Fetching blobs from Azure Blob Storage...');
    blobs = await getBlobsForUser(containerClient, userId);
    console.log(`  Found ${blobs.size} blobs`);
  }

  // 4. Get search documents
  let searchDocs = new Map<string, SearchDocument[]>();
  if (searchClient) {
    console.log('Fetching documents from Azure AI Search...');
    searchDocs = await getSearchDocsForUser(searchClient, userId);
    const totalSearchDocs = Array.from(searchDocs.values()).reduce((sum, d) => sum + d.length, 0);
    console.log(`  Found ${totalSearchDocs} search documents for ${searchDocs.size} files`);
  }

  // 5. Check orphan chunks
  console.log('Checking for orphan chunks...');
  const orphanChunkCount = await getOrphanChunks(pool, userId);
  if (orphanChunkCount > 0) {
    issues.push({
      type: 'orphan_chunk',
      severity: 'error',
      details: `Found ${orphanChunkCount} chunks with no parent file`,
      suggestion: 'Run cleanup to remove orphan chunks',
    });
  }

  // Status breakdown
  const statusBreakdown = {
    processing: {} as Record<string, number>,
    embedding: {} as Record<string, number>,
  };

  // 6. Verify each file
  console.log('\nVerifying file integrity...\n');
  const dbBlobPaths = new Set<string>();

  for (const file of files) {
    dbBlobPaths.add(file.blob_path);

    // Count status breakdown
    statusBreakdown.processing[file.processing_status] =
      (statusBreakdown.processing[file.processing_status] || 0) + 1;
    statusBreakdown.embedding[file.embedding_status] =
      (statusBreakdown.embedding[file.embedding_status] || 0) + 1;

    // Check: File has blob
    if (containerClient && !blobs.has(file.blob_path)) {
      issues.push({
        type: 'missing_blob',
        severity: 'error',
        fileId: file.id,
        fileName: file.name,
        userId: file.user_id,
        details: `Blob not found at path: ${file.blob_path}`,
        suggestion: 'File may need to be re-uploaded or marked as failed',
      });
    }

    // Check: Stuck in processing
    if (file.processing_status === 'processing') {
      const updatedAt = new Date(file.updated_at);
      if (now.getTime() - updatedAt.getTime() > STUCK_THRESHOLD_MS) {
        issues.push({
          type: 'stuck_processing',
          severity: 'warning',
          fileId: file.id,
          fileName: file.name,
          userId: file.user_id,
          details: `File stuck in 'processing' since ${updatedAt.toISOString()}`,
          suggestion: 'Reset to pending or mark as failed',
        });
      }
    }

    // Check: Stuck in embedding processing
    if (file.embedding_status === 'processing') {
      const updatedAt = new Date(file.updated_at);
      if (now.getTime() - updatedAt.getTime() > STUCK_THRESHOLD_MS) {
        issues.push({
          type: 'stuck_embedding',
          severity: 'warning',
          fileId: file.id,
          fileName: file.name,
          userId: file.user_id,
          details: `File stuck in embedding 'processing' since ${updatedAt.toISOString()}`,
          suggestion: 'Reset embedding status to pending or queued',
        });
      }
    }

    // Check: Completed embeddings have search documents
    if (file.embedding_status === 'completed') {
      const fileChunks = chunks.get(file.id) || [];
      const fileSearchDocs = searchDocs.get(file.id) || [];

      if (fileChunks.length > 0 && fileSearchDocs.length === 0) {
        issues.push({
          type: 'missing_search_doc',
          severity: 'error',
          fileId: file.id,
          fileName: file.name,
          userId: file.user_id,
          details: `File has ${fileChunks.length} chunks but no AI Search documents`,
          suggestion: 'Re-queue for embedding generation',
        });
      } else if (fileChunks.length !== fileSearchDocs.length && fileChunks.length > 0) {
        issues.push({
          type: 'chunk_mismatch',
          severity: 'warning',
          fileId: file.id,
          fileName: file.name,
          userId: file.user_id,
          details: `Chunk count mismatch: DB has ${fileChunks.length}, AI Search has ${fileSearchDocs.length}`,
          suggestion: 'May need to re-index this file',
        });
      }
    }
  }

  // 7. Check for orphan blobs
  if (containerClient) {
    console.log('Checking for orphan blobs...');
    const orphanBlobs: string[] = [];

    for (const [blobPath] of blobs) {
      // Only check blobs in the user files directory
      if (blobPath.startsWith('users/') && blobPath.includes('/files/')) {
        if (!dbBlobPaths.has(blobPath)) {
          orphanBlobs.push(blobPath);
          issues.push({
            type: 'orphan_blob',
            severity: 'warning',
            details: `Orphan blob: ${blobPath}`,
            suggestion: 'Can be safely deleted',
          });
        }
      }
    }

    if (options.fixOrphans && orphanBlobs.length > 0) {
      console.log(`  Deleting ${orphanBlobs.length} orphan blobs...`);
      let deleted = 0;
      for (const blobPath of orphanBlobs) {
        if (await deleteOrphanBlob(containerClient, blobPath)) {
          deleted++;
        }
      }
      console.log(`  Deleted ${deleted}/${orphanBlobs.length} orphan blobs`);
    }
  }

  // 8. Check for orphan search documents
  if (searchClient) {
    console.log('Checking for orphan search documents...');
    const dbFileIds = new Set(files.map((f) => f.id.toUpperCase()));
    const orphanChunkIds: string[] = [];

    for (const [fileId, docs] of searchDocs) {
      if (!dbFileIds.has(fileId.toUpperCase())) {
        for (const doc of docs) {
          orphanChunkIds.push(doc.chunkId);
        }
        issues.push({
          type: 'orphan_search_doc',
          severity: 'warning',
          fileId,
          userId: docs[0]?.userId,
          details: `${docs.length} search documents for non-existent file`,
          suggestion: 'Can be safely deleted from AI Search',
        });
      }
    }

    if (options.fixOrphans && orphanChunkIds.length > 0) {
      console.log(`  Deleting ${orphanChunkIds.length} orphan search documents...`);
      const deleted = await deleteOrphanSearchDocs(searchClient, orphanChunkIds);
      console.log(`  Deleted ${deleted}/${orphanChunkIds.length} orphan search documents`);
    }
  }

  // Build report
  const totalSearchDocs = Array.from(searchDocs.values()).reduce((sum, d) => sum + d.length, 0);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    userId: userId || 'all',
    timestamp: now,
    summary: {
      totalFiles: files.length,
      totalChunks,
      totalBlobs: blobs.size,
      totalSearchDocs,
      issuesFound: issues.length,
      errorCount,
      warningCount,
    },
    issues,
    statusBreakdown,
  };
}

// ============================================================================
// Output
// ============================================================================

function printReport(report: IntegrityReport, reportOnly: boolean): void {
  console.log('\n' + '='.repeat(80));
  console.log('FILE INTEGRITY REPORT');
  console.log('='.repeat(80));

  console.log(`\nUser ID:    ${report.userId}`);
  console.log(`Timestamp:  ${report.timestamp.toISOString()}`);

  console.log('\n--- Summary ---');
  console.log(`Total Files:           ${report.summary.totalFiles}`);
  console.log(`Total Chunks:          ${report.summary.totalChunks}`);
  console.log(`Total Blobs:           ${report.summary.totalBlobs}`);
  console.log(`Total Search Docs:     ${report.summary.totalSearchDocs}`);
  console.log(`Issues Found:          ${report.summary.issuesFound}`);
  console.log(`  Errors:              ${report.summary.errorCount}`);
  console.log(`  Warnings:            ${report.summary.warningCount}`);

  console.log('\n--- Processing Status Breakdown ---');
  for (const [status, count] of Object.entries(report.statusBreakdown.processing)) {
    console.log(`  ${status}: ${count}`);
  }

  console.log('\n--- Embedding Status Breakdown ---');
  for (const [status, count] of Object.entries(report.statusBreakdown.embedding)) {
    console.log(`  ${status}: ${count}`);
  }

  if (!reportOnly && report.issues.length > 0) {
    console.log('\n--- Issues ---\n');

    // Group by type
    const byType = new Map<string, IntegrityIssue[]>();
    for (const issue of report.issues) {
      const list = byType.get(issue.type) || [];
      list.push(issue);
      byType.set(issue.type, list);
    }

    for (const [type, issues] of byType) {
      const icon = issues[0].severity === 'error' ? '❌' : '⚠️';
      console.log(`${icon} ${type.toUpperCase()} (${issues.length}):`);

      for (const issue of issues.slice(0, 10)) {
        // Limit to 10 per type
        if (issue.fileName) {
          console.log(`   - ${issue.fileName} (${issue.fileId})`);
        }
        console.log(`     ${issue.details}`);
        if (issue.suggestion) {
          console.log(`     → ${issue.suggestion}`);
        }
      }

      if (issues.length > 10) {
        console.log(`   ... and ${issues.length - 10} more`);
      }
      console.log('');
    }
  }

  console.log('='.repeat(80));

  if (report.summary.issuesFound === 0) {
    console.log('\n✅ No integrity issues found!');
  } else if (report.summary.errorCount > 0) {
    console.log(`\n❌ Found ${report.summary.errorCount} errors that need attention.`);
  } else {
    console.log(`\n⚠️ Found ${report.summary.warningCount} warnings.`);
  }
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

  console.log('=== FILE INTEGRITY VERIFICATION ===\n');
  console.log(`User ID: ${args.userId || 'ALL USERS'}`);
  console.log(`Fix orphans: ${args.fixOrphans}`);
  console.log(`Report only: ${args.reportOnly}\n`);

  // Connect to database
  if (!SQL_CONFIG.server) {
    console.error('ERROR: DATABASE_SERVER environment variable not set');
    process.exit(1);
  }

  const pool = await sql.connect(SQL_CONFIG);

  // Connect to Blob Storage
  let containerClient: ReturnType<BlobServiceClient['getContainerClient']> | null = null;
  if (BLOB_CONNECTION_STRING) {
    const blobServiceClient = BlobServiceClient.fromConnectionString(BLOB_CONNECTION_STRING);
    containerClient = blobServiceClient.getContainerClient(BLOB_CONTAINER);
    console.log(`Blob Storage: Connected to container '${BLOB_CONTAINER}'`);
  } else {
    console.warn('Warning: STORAGE_CONNECTION_STRING not set, skipping blob verification');
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
    console.warn('Warning: AI Search credentials not set, skipping search verification');
  }

  try {
    const report = await verifyIntegrity(pool, containerClient, searchClient, args.userId, {
      fixOrphans: args.fixOrphans,
      reportOnly: args.reportOnly,
    });

    printReport(report, args.reportOnly);

    // Exit with error code if there are errors
    process.exit(report.summary.errorCount > 0 ? 1 : 0);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
