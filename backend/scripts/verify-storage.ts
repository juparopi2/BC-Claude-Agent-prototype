import 'dotenv/config';
import { createPrisma } from './_shared/prisma';
import {
  createBlobContainerClient,
  createSearchClient,
  createSearchIndexClient,
  CONTAINER_NAME,
  INDEX_NAME,
} from './_shared/azure';
import {
  getFlag,
  hasFlag,
  getPositionalArg,
} from './_shared/args';
import type { SearchClient, SearchIndexClient } from '@azure/search-documents';
import type { ContainerClient } from '@azure/storage-blob';

// ============================================================================
// Types
// ============================================================================

interface SearchDoc {
  chunkId: string;
  fileId: string;
  userId: string;
  chunkIndex: number;
  mimeType?: string;
  content?: string;
  isImage?: boolean;
  fileStatus?: string;
}

interface FileRecord {
  id: string;
  name: string;
  is_folder: boolean;
  parent_folder_id: string | null;
  blob_path: string | null;
  processing_status: string | null;
  embedding_status: string | null;
  deletion_status: string | null;
  size_bytes: bigint | null;
  mime_type: string | null;
}

interface ChunkRecord {
  id: string;
  file_id: string;
  chunk_index: number;
  search_document_id: string | null;
}

interface ImageEmbeddingRecord {
  file_id: string;
  caption: string | null;
  caption_confidence: number | null;
  dimensions: string | null;
  model: string | null;
}

interface StatusCounts {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  null: number;
}

interface VerificationResult {
  hasErrors: boolean;
  hasWarnings: boolean;
  sections: {
    sql: boolean;
    blob: boolean;
    search: boolean;
    schema: boolean;
  };
}

// ============================================================================
// CLI Help
// ============================================================================

function showHelp(): void {
  console.log(`
Storage Verification Script
===========================

Verifies consistency across SQL, Blob Storage, and AI Search for user files.

Usage:
  npx tsx backend/scripts/verify-storage.ts --userId <ID>
  npx tsx backend/scripts/verify-storage.ts --all
  npx tsx backend/scripts/verify-storage.ts --userId <ID> --section sql|blob|search|schema
  npx tsx backend/scripts/verify-storage.ts --userId <ID> --folder-tree
  npx tsx backend/scripts/verify-storage.ts --userId <ID> --check-embeddings
  npx tsx backend/scripts/verify-storage.ts --userId <ID> --report-only
  npx tsx backend/scripts/verify-storage.ts --help

Options:
  --userId <ID>         Target user ID (GUID format, uppercase recommended)
  --all                 Verify all users in the database
  --section <name>      Run only specific section: sql, blob, search, schema
  --folder-tree         Display folder hierarchy in SQL section
  --check-embeddings    Show image embedding details in SQL section
  --report-only         Skip detailed output, show only summary
  --help               Show this help message

Sections:
  SQL     - File counts, status distribution, stuck deletions, chunks
  Blob    - Blob existence, orphans, missing files
  Search  - Document counts, orphans, field coverage, mimeType population
  Schema  - Index schema validation against expected schema

Exit Codes:
  0 - All checks passed
  1 - Errors or inconsistencies found
`);
}

// ============================================================================
// Utilities
// ============================================================================

function formatBytes(bytes: bigint | number | null): string {
  if (bytes === null) return '0 B';
  const num = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  if (num === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(num) / Math.log(1024));
  return `${(num / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function printSeparator(char: string = '='): void {
  console.log(char.repeat(80));
}

function printSubsection(title: string): void {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printStatus(label: string, value: string | number, status?: 'ok' | 'warn' | 'error'): void {
  const icon = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : status === 'error' ? '✗' : ' ';
  console.log(`  ${icon} ${label}: ${value}`);
}

// ============================================================================
// SQL Section
// ============================================================================

async function verifySQLSection(
  userId: string,
  prisma: ReturnType<typeof createPrisma>,
  options: { folderTree: boolean; checkEmbeddings: boolean; reportOnly: boolean }
): Promise<{ hasErrors: boolean; hasWarnings: boolean }> {
  let hasErrors = false;
  let hasWarnings = false;

  printSeparator();
  console.log('SQL DATABASE VERIFICATION');
  printSeparator();

  // Fetch all files for user
  const files = await prisma.files.findMany({
    where: { user_id: userId, deletion_status: null },
    select: {
      id: true,
      name: true,
      is_folder: true,
      parent_folder_id: true,
      blob_path: true,
      processing_status: true,
      embedding_status: true,
      deletion_status: true,
      size_bytes: true,
      mime_type: true,
    },
  });

  const regularFiles = files.filter((f) => !f.is_folder);
  const folders = files.filter((f) => f.is_folder);

  printSubsection('File Counts');
  printStatus('Total entries', files.length);
  printStatus('Files', regularFiles.length);
  printStatus('Folders', folders.length);

  // Processing status breakdown
  printSubsection('Processing Status Distribution');
  const processingCounts: StatusCounts = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    null: 0,
  };

  regularFiles.forEach((f) => {
    const status = f.processing_status?.toLowerCase() as keyof StatusCounts | undefined;
    if (status && status in processingCounts) {
      processingCounts[status]++;
    } else {
      processingCounts.null++;
    }
  });

  printStatus('Pending', String(processingCounts.pending).padStart(6));
  printStatus('Processing', String(processingCounts.processing).padStart(6));
  printStatus('Completed', String(processingCounts.completed).padStart(6), processingCounts.completed > 0 ? 'ok' : undefined);
  printStatus('Failed', String(processingCounts.failed).padStart(6), processingCounts.failed > 0 ? 'error' : undefined);
  printStatus('Null/Unknown', String(processingCounts.null).padStart(6), processingCounts.null > 0 ? 'warn' : undefined);

  if (processingCounts.failed > 0) {
    hasErrors = true;
  }
  if (processingCounts.null > 0) {
    hasWarnings = true;
  }

  // Embedding status breakdown
  printSubsection('Embedding Status Distribution');
  const embeddingCounts: StatusCounts = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    null: 0,
  };

  regularFiles.forEach((f) => {
    const status = f.embedding_status?.toLowerCase() as keyof StatusCounts | undefined;
    if (status && status in embeddingCounts) {
      embeddingCounts[status]++;
    } else {
      embeddingCounts.null++;
    }
  });

  printStatus('Pending', String(embeddingCounts.pending).padStart(6));
  printStatus('Processing', String(embeddingCounts.processing).padStart(6));
  printStatus('Completed', String(embeddingCounts.completed).padStart(6), embeddingCounts.completed > 0 ? 'ok' : undefined);
  printStatus('Failed', String(embeddingCounts.failed).padStart(6), embeddingCounts.failed > 0 ? 'error' : undefined);
  printStatus('Null/Unknown', String(embeddingCounts.null).padStart(6), embeddingCounts.null > 0 ? 'warn' : undefined);

  if (embeddingCounts.failed > 0) {
    hasErrors = true;
  }

  // Stuck deletions
  printSubsection('Deletion Status');
  const stuckDeletions = await prisma.files.findMany({
    where: { user_id: userId, deletion_status: { not: null } },
    select: { id: true, name: true, deletion_status: true, is_folder: true },
  });

  if (stuckDeletions.length > 0) {
    printStatus('Stuck deletions', stuckDeletions.length, 'error');
    hasErrors = true;
    if (!options.reportOnly) {
      stuckDeletions.forEach((f) => {
        console.log(`    - ${f.is_folder ? '[FOLDER]' : '[FILE]'} ${f.name} (${f.deletion_status})`);
      });
    }
  } else {
    printStatus('Stuck deletions', 0, 'ok');
  }

  // File chunks analysis
  printSubsection('File Chunks');
  const fileIds = regularFiles.map((f) => f.id);
  const chunks = fileIds.length > 0
    ? await prisma.file_chunks.findMany({
        where: { file_id: { in: fileIds } },
        select: { id: true, file_id: true, chunk_index: true, search_document_id: true },
      })
    : [];

  const chunksWithSearchId = chunks.filter((c) => c.search_document_id !== null).length;
  const coveragePercent = chunks.length > 0 ? ((chunksWithSearchId / chunks.length) * 100).toFixed(1) : '0.0';

  printStatus('Total chunks', chunks.length);
  printStatus('Chunks with search_document_id', `${chunksWithSearchId} (${coveragePercent}%)`);

  if (chunks.length > 0 && chunksWithSearchId < chunks.length) {
    hasWarnings = true;
    printStatus('Missing search_document_id', chunks.length - chunksWithSearchId, 'warn');
  }

  // Image embeddings
  if (options.checkEmbeddings) {
    printSubsection('Image Embeddings');
    const embeddings = await prisma.image_embeddings.findMany({
      where: { user_id: userId },
      select: {
        file_id: true,
        caption: true,
        caption_confidence: true,
        dimensions: true,
        model: true,
      },
    });

    printStatus('Total image embeddings', embeddings.length);

    if (embeddings.length > 0 && !options.reportOnly) {
      console.log('\n  Sample embeddings:');
      embeddings.slice(0, 5).forEach((emb) => {
        const confidence = emb.caption_confidence !== null ? (emb.caption_confidence * 100).toFixed(1) : 'N/A';
        console.log(`    - File: ${emb.file_id.substring(0, 8)}...`);
        console.log(`      Caption: ${emb.caption || 'N/A'}`);
        console.log(`      Confidence: ${confidence}%`);
        console.log(`      Dimensions: ${emb.dimensions || 'N/A'}`);
        console.log(`      Model: ${emb.model || 'N/A'}`);
      });
    }
  }

  // Folder tree
  if (options.folderTree && !options.reportOnly) {
    printSubsection('Folder Tree');
    const tree = buildFolderTree(files);
    console.log(tree);
  }

  return { hasErrors, hasWarnings };
}

function buildFolderTree(files: FileRecord[]): string {
  const fileMap = new Map<string, FileRecord>();
  files.forEach((f) => fileMap.set(f.id, f));

  const rootItems = files.filter((f) => f.parent_folder_id === null);

  function renderNode(file: FileRecord, prefix: string, isLast: boolean): string {
    const connector = isLast ? '└── ' : '├── ';
    const icon = file.is_folder ? '📁' : '📄';
    const status = file.processing_status ? ` [${file.processing_status}]` : '';
    const size = file.size_bytes !== null && !file.is_folder ? ` (${formatBytes(file.size_bytes)})` : '';
    let result = `${prefix}${connector}${icon} ${file.name}${status}${size}\n`;

    if (file.is_folder) {
      const children = files.filter((f) => f.parent_folder_id === file.id);
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      children.forEach((child, idx) => {
        result += renderNode(child, childPrefix, idx === children.length - 1);
      });
    }

    return result;
  }

  let tree = '\n';
  rootItems.forEach((item, idx) => {
    tree += renderNode(item, '  ', idx === rootItems.length - 1);
  });

  return tree;
}

// ============================================================================
// Blob Section
// ============================================================================

async function verifyBlobSection(
  userId: string,
  prisma: ReturnType<typeof createPrisma>,
  containerClient: ContainerClient | null,
  options: { reportOnly: boolean }
): Promise<{ hasErrors: boolean; hasWarnings: boolean }> {
  let hasErrors = false;
  let hasWarnings = false;

  printSeparator();
  console.log('BLOB STORAGE VERIFICATION');
  printSeparator();

  if (!containerClient) {
    console.log('⚠ Blob storage not configured (missing environment variables)');
    return { hasErrors: false, hasWarnings: true };
  }

  // Fetch files with blob paths
  const filesWithBlobs = await prisma.files.findMany({
    where: {
      user_id: userId,
      is_folder: false,
      deletion_status: null,
    },
    select: { id: true, name: true, blob_path: true },
  });

  printSubsection('Blob Inventory');
  printStatus('Files with blob_path in DB', filesWithBlobs.length);

  // List actual blobs
  const userPrefix = `users/${userId}/`;
  const blobNames = new Set<string>();

  try {
    const iterator = containerClient.listBlobsFlat({ prefix: userPrefix });
    for await (const blob of iterator) {
      blobNames.add(blob.name);
    }
    printStatus('Actual blobs in storage', blobNames.size);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    console.log(`✗ Failed to list blobs: ${errorInfo.message}`);
    hasErrors = true;
    return { hasErrors, hasWarnings };
  }

  // Cross-reference: DB records with missing blobs
  const missingBlobs: string[] = [];
  filesWithBlobs.forEach((f) => {
    if (f.blob_path && !blobNames.has(f.blob_path)) {
      missingBlobs.push(f.name);
    }
  });

  if (missingBlobs.length > 0) {
    printStatus('Missing blobs (DB record but no blob)', missingBlobs.length, 'error');
    hasErrors = true;
    if (!options.reportOnly) {
      missingBlobs.slice(0, 10).forEach((name) => {
        console.log(`    - ${name}`);
      });
      if (missingBlobs.length > 10) {
        console.log(`    ... and ${missingBlobs.length - 10} more`);
      }
    }
  } else {
    printStatus('Missing blobs', 0, 'ok');
  }

  // Cross-reference: Orphan blobs (blob exists but no DB record)
  const dbBlobPaths = new Set(filesWithBlobs.map((f) => f.blob_path).filter((p): p is string => p !== null));
  const orphanBlobs: string[] = [];
  blobNames.forEach((blobName) => {
    if (!dbBlobPaths.has(blobName)) {
      orphanBlobs.push(blobName);
    }
  });

  if (orphanBlobs.length > 0) {
    printStatus('Orphan blobs (blob exists but no DB record)', orphanBlobs.length, 'warn');
    hasWarnings = true;
    if (!options.reportOnly) {
      orphanBlobs.slice(0, 10).forEach((name) => {
        console.log(`    - ${name}`);
      });
      if (orphanBlobs.length > 10) {
        console.log(`    ... and ${orphanBlobs.length - 10} more`);
      }
    }
  } else {
    printStatus('Orphan blobs', 0, 'ok');
  }

  return { hasErrors, hasWarnings };
}

// ============================================================================
// Search Section
// ============================================================================

async function verifySearchSection(
  userId: string,
  prisma: ReturnType<typeof createPrisma>,
  searchClient: SearchClient<SearchDoc> | null,
  options: { reportOnly: boolean }
): Promise<{ hasErrors: boolean; hasWarnings: boolean }> {
  let hasErrors = false;
  let hasWarnings = false;

  printSeparator();
  console.log('AI SEARCH VERIFICATION');
  printSeparator();

  if (!searchClient) {
    console.log('⚠ AI Search not configured (missing environment variables)');
    return { hasErrors: false, hasWarnings: true };
  }

  // Fetch all search documents for user
  const searchDocs: SearchDoc[] = [];
  try {
    const results = await searchClient.search('*', {
      select: ['chunkId', 'fileId', 'userId', 'chunkIndex', 'mimeType', 'content', 'isImage', 'fileStatus'],
      filter: `userId eq '${userId}'`,
      top: 10000,
    });

    for await (const result of results.results) {
      if (result.document) {
        searchDocs.push(result.document);
      }
    }
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    console.log(`✗ Failed to query search index: ${errorInfo.message}`);
    hasErrors = true;
    return { hasErrors, hasWarnings };
  }

  printSubsection('Search Document Inventory');
  printStatus('Total search documents', searchDocs.length);

  // Group by fileId
  const docsByFile = new Map<string, SearchDoc[]>();
  searchDocs.forEach((doc) => {
    if (!docsByFile.has(doc.fileId)) {
      docsByFile.set(doc.fileId, []);
    }
    docsByFile.get(doc.fileId)!.push(doc);
  });

  printStatus('Unique files in search index', docsByFile.size);

  // Cross-reference with DB
  const dbFiles = await prisma.files.findMany({
    where: { user_id: userId, is_folder: false, deletion_status: null },
    select: { id: true, name: true, mime_type: true },
  });

  const dbFileIds = new Set(dbFiles.map((f) => f.id.toUpperCase()));
  const orphanFileIds: string[] = [];

  docsByFile.forEach((docs, fileId) => {
    if (!dbFileIds.has(fileId.toUpperCase())) {
      orphanFileIds.push(fileId);
    }
  });

  if (orphanFileIds.length > 0) {
    printStatus('Orphan search docs (no DB record)', orphanFileIds.length, 'warn');
    hasWarnings = true;
    if (!options.reportOnly) {
      orphanFileIds.slice(0, 5).forEach((id) => {
        const count = docsByFile.get(id)?.length || 0;
        console.log(`    - File ID: ${id.substring(0, 8)}... (${count} documents)`);
      });
      if (orphanFileIds.length > 5) {
        console.log(`    ... and ${orphanFileIds.length - 5} more`);
      }
    }
  } else {
    printStatus('Orphan search documents', 0, 'ok');
  }

  // mimeType field population
  printSubsection('Field Coverage');
  const docsWithMimeType = searchDocs.filter((d) => d.mimeType !== undefined && d.mimeType !== null).length;
  const mimeTypePercent = searchDocs.length > 0 ? ((docsWithMimeType / searchDocs.length) * 100).toFixed(1) : '0.0';
  printStatus('Documents with mimeType', `${docsWithMimeType} / ${searchDocs.length} (${mimeTypePercent}%)`);

  const docsWithContent = searchDocs.filter((d) => d.content !== undefined && d.content !== null && d.content.length > 0).length;
  const contentPercent = searchDocs.length > 0 ? ((docsWithContent / searchDocs.length) * 100).toFixed(1) : '0.0';
  printStatus('Documents with content', `${docsWithContent} / ${searchDocs.length} (${contentPercent}%)`);

  const docsWithIsImage = searchDocs.filter((d) => d.isImage !== undefined && d.isImage !== null).length;
  const isImagePercent = searchDocs.length > 0 ? ((docsWithIsImage / searchDocs.length) * 100).toFixed(1) : '0.0';
  printStatus('Documents with isImage', `${docsWithIsImage} / ${searchDocs.length} (${isImagePercent}%)`);

  const docsWithFileStatus = searchDocs.filter((d) => d.fileStatus !== undefined && d.fileStatus !== null).length;
  const fileStatusPercent = searchDocs.length > 0 ? ((docsWithFileStatus / searchDocs.length) * 100).toFixed(1) : '0.0';
  printStatus('Documents with fileStatus', `${docsWithFileStatus} / ${searchDocs.length} (${fileStatusPercent}%)`);

  // Compare chunk counts: DB vs Search
  printSubsection('Chunk Count Comparison');
  const fileIds = dbFiles.map((f) => f.id);
  const dbChunks = fileIds.length > 0
    ? await prisma.file_chunks.findMany({
        where: { file_id: { in: fileIds } },
        select: { file_id: true },
      })
    : [];

  const dbChunksByFile = new Map<string, number>();
  dbChunks.forEach((chunk) => {
    dbChunksByFile.set(chunk.file_id, (dbChunksByFile.get(chunk.file_id) || 0) + 1);
  });

  let mismatchCount = 0;
  const mismatches: Array<{ fileId: string; dbCount: number; searchCount: number }> = [];

  // Build case-insensitive map for search docs
  const docsByFileUpper = new Map<string, SearchDoc[]>();
  docsByFile.forEach((docs, fileId) => {
    docsByFileUpper.set(fileId.toUpperCase(), docs);
  });

  dbFiles.forEach((file) => {
    const dbCount = dbChunksByFile.get(file.id) || 0;
    const searchCount = docsByFileUpper.get(file.id.toUpperCase())?.length || 0;
    if (dbCount !== searchCount) {
      mismatchCount++;
      mismatches.push({ fileId: file.id, dbCount, searchCount });
    }
  });

  if (mismatchCount > 0) {
    printStatus('Files with chunk count mismatch', mismatchCount, 'warn');
    hasWarnings = true;
    if (!options.reportOnly) {
      mismatches.slice(0, 5).forEach((m) => {
        console.log(`    - File ${m.fileId.substring(0, 8)}...: DB=${m.dbCount}, Search=${m.searchCount}`);
      });
      if (mismatches.length > 5) {
        console.log(`    ... and ${mismatches.length - 5} more`);
      }
    }
  } else {
    printStatus('Chunk count mismatches', 0, 'ok');
  }

  return { hasErrors, hasWarnings };
}

// ============================================================================
// Schema Section
// ============================================================================

async function verifySchemaSection(
  searchIndexClient: SearchIndexClient | null,
  options: { reportOnly: boolean }
): Promise<{ hasErrors: boolean; hasWarnings: boolean }> {
  let hasErrors = false;
  let hasWarnings = false;

  printSeparator();
  console.log('SEARCH INDEX SCHEMA VERIFICATION');
  printSeparator();

  if (!searchIndexClient) {
    console.log('⚠ Search Index Client not configured (missing environment variables)');
    return { hasErrors: false, hasWarnings: true };
  }

  // Import expected schema
  let expectedSchema;
  try {
    const schemaModule = await import('../src/services/search/schema');
    expectedSchema = schemaModule.indexSchema;
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    console.log(`✗ Failed to import schema: ${errorInfo.message}`);
    hasErrors = true;
    return { hasErrors, hasWarnings };
  }

  // Fetch current index
  let currentIndex;
  try {
    currentIndex = await searchIndexClient.getIndex(INDEX_NAME);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    console.log(`✗ Failed to fetch index: ${errorInfo.message}`);
    hasErrors = true;
    return { hasErrors, hasWarnings };
  }

  printSubsection('Schema Comparison');
  printStatus('Index name', INDEX_NAME);
  printStatus('Expected fields', expectedSchema.fields.length);
  printStatus('Actual fields', currentIndex.fields.length);

  // Build maps for comparison
  const expectedFieldMap = new Map(expectedSchema.fields.map((f: { name: string }) => [f.name, f]));
  const actualFieldMap = new Map(currentIndex.fields.map((f: { name: string }) => [f.name, f]));

  // Missing fields
  const missingFields: string[] = [];
  expectedFieldMap.forEach((field, name) => {
    if (!actualFieldMap.has(name)) {
      missingFields.push(name);
    }
  });

  if (missingFields.length > 0) {
    printStatus('Missing fields', missingFields.length, 'error');
    hasErrors = true;
    if (!options.reportOnly) {
      missingFields.forEach((name) => {
        console.log(`    - ${name}`);
      });
    }
  } else {
    printStatus('Missing fields', 0, 'ok');
  }

  // Extra fields
  const extraFields: string[] = [];
  actualFieldMap.forEach((field, name) => {
    if (!expectedFieldMap.has(name)) {
      extraFields.push(name);
    }
  });

  if (extraFields.length > 0) {
    printStatus('Extra fields', extraFields.length, 'warn');
    hasWarnings = true;
    if (!options.reportOnly) {
      extraFields.forEach((name) => {
        console.log(`    - ${name}`);
      });
    }
  } else {
    printStatus('Extra fields', 0, 'ok');
  }

  // Type mismatches
  const typeMismatches: Array<{ name: string; expected: string; actual: string }> = [];
  expectedFieldMap.forEach((expectedField: { name: string; type: string }, name) => {
    const actualField = actualFieldMap.get(name);
    if (actualField && (actualField as { type: string }).type !== expectedField.type) {
      typeMismatches.push({
        name,
        expected: expectedField.type,
        actual: (actualField as { type: string }).type,
      });
    }
  });

  if (typeMismatches.length > 0) {
    printStatus('Type mismatches', typeMismatches.length, 'error');
    hasErrors = true;
    if (!options.reportOnly) {
      typeMismatches.forEach((m) => {
        console.log(`    - ${m.name}: expected ${m.expected}, got ${m.actual}`);
      });
    }
  } else {
    printStatus('Type mismatches', 0, 'ok');
  }

  return { hasErrors, hasWarnings };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Parse arguments
  const userId = getFlag('--userId')?.toUpperCase();
  const all = hasFlag('--all');
  const section = getFlag('--section')?.toLowerCase();
  const folderTree = hasFlag('--folder-tree');
  const checkEmbeddings = hasFlag('--check-embeddings');
  const reportOnly = hasFlag('--report-only');
  const help = hasFlag('--help');

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (!userId && !all) {
    console.error('Error: --userId <ID> or --all is required');
    showHelp();
    process.exit(1);
  }

  if (section && !['sql', 'blob', 'search', 'schema'].includes(section)) {
    console.error('Error: --section must be one of: sql, blob, search, schema');
    process.exit(1);
  }

  // Initialize clients
  const prisma = createPrisma();
  const containerClient = createBlobContainerClient();
  const searchClient = createSearchClient<SearchDoc>();
  const searchIndexClient = createSearchIndexClient();

  try {
    let userIds: string[];

    if (all) {
      // Fetch all user IDs from database
      const users = await prisma.users.findMany({
        select: { id: true },
      });
      userIds = users.map((u) => u.id);

      if (userIds.length === 0) {
        console.log('No users found in database.');
        process.exit(0);
      }

      console.log(`Found ${userIds.length} user(s) in database.\n`);
    } else {
      userIds = [userId!];
    }

    const globalResult: VerificationResult = {
      hasErrors: false,
      hasWarnings: false,
      sections: {
        sql: false,
        blob: false,
        search: false,
        schema: false,
      },
    };

    for (const currentUserId of userIds) {
      if (userIds.length > 1) {
        printSeparator('=');
        console.log(`USER: ${currentUserId}`);
        printSeparator('=');
      }

      const options = { folderTree, checkEmbeddings, reportOnly };

      // Run sections
      if (!section || section === 'sql') {
        const result = await verifySQLSection(currentUserId, prisma, options);
        globalResult.hasErrors = globalResult.hasErrors || result.hasErrors;
        globalResult.hasWarnings = globalResult.hasWarnings || result.hasWarnings;
        globalResult.sections.sql = true;
      }

      if (!section || section === 'blob') {
        const result = await verifyBlobSection(currentUserId, prisma, containerClient, options);
        globalResult.hasErrors = globalResult.hasErrors || result.hasErrors;
        globalResult.hasWarnings = globalResult.hasWarnings || result.hasWarnings;
        globalResult.sections.blob = true;
      }

      if (!section || section === 'search') {
        const result = await verifySearchSection(currentUserId, prisma, searchClient, options);
        globalResult.hasErrors = globalResult.hasErrors || result.hasErrors;
        globalResult.hasWarnings = globalResult.hasWarnings || result.hasWarnings;
        globalResult.sections.search = true;
      }

      if (userIds.length > 1) {
        console.log('\n');
      }
    }

    // Schema section runs once (not per user)
    if (!section || section === 'schema') {
      const result = await verifySchemaSection(searchIndexClient, { reportOnly });
      globalResult.hasErrors = globalResult.hasErrors || result.hasErrors;
      globalResult.hasWarnings = globalResult.hasWarnings || result.hasWarnings;
      globalResult.sections.schema = true;
    }

    // Final summary
    printSeparator();
    console.log('VERIFICATION SUMMARY');
    printSeparator();

    const sectionsRun = Object.entries(globalResult.sections)
      .filter(([, ran]) => ran)
      .map(([name]) => name)
      .join(', ');

    console.log(`Sections verified: ${sectionsRun}`);
    console.log(`User(s) checked: ${userIds.length === 1 ? userIds[0] : `${userIds.length} users`}`);

    if (globalResult.hasErrors) {
      console.log('\n✗ VERIFICATION FAILED - Errors detected');
      process.exit(1);
    } else if (globalResult.hasWarnings) {
      console.log('\n⚠ VERIFICATION COMPLETED - Warnings detected');
      process.exit(0);
    } else {
      console.log('\n✓ VERIFICATION PASSED - All checks OK');
      process.exit(0);
    }
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name, cause: error.cause }
      : { value: String(error) };
    console.error('Fatal error during verification:');
    console.error(errorInfo);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
