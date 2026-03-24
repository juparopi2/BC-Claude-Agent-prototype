import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import {
  createBlobContainerClient,
  createSearchClient,
  createSearchIndexClient,
  CONTAINER_NAME,
  INDEX_NAME,
  INDEX_NAME_V2,
  getActiveIndexName,
} from '../_shared/azure';
import {
  getFlag,
  hasFlag,
  getPositionalArg,
} from '../_shared/args';
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
  siteId?: string;
  sourceType?: string;
  parentFolderId?: string;
  // Vector fields - populated via getDocument() calls, not in search select
  contentVector?: number[];
  imageVector?: number[];
}

interface FileRecord {
  id: string;
  name: string;
  is_folder: boolean;
  parent_folder_id: string | null;
  blob_path: string | null;
  pipeline_status: string;
  pipeline_retry_count: number;
  deletion_status: string | null;
  size_bytes: bigint | null;
  mime_type: string | null;
  batch_id: string | null;
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
  --check-embeddings    Show image embedding details in SQL + vector coverage in Search
  --report-only         Skip detailed output, show only summary
  --help               Show this help message

Sections:
  SQL     - File counts, status distribution, stuck deletions, chunks
  Blob    - Blob existence, orphans, missing files
  Search  - Document counts, orphans, field coverage, vector field coverage (with --check-embeddings)
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
      pipeline_status: true,
      pipeline_retry_count: true,
      deletion_status: true,
      size_bytes: true,
      mime_type: true,
      batch_id: true,
    },
  });

  const regularFiles = files.filter((f) => !f.is_folder);
  const folders = files.filter((f) => f.is_folder);

  printSubsection('File Counts');
  printStatus('Total entries', files.length);
  printStatus('Files', regularFiles.length);
  printStatus('Folders', folders.length);

  // Pipeline status breakdown
  printSubsection('Pipeline Status Distribution');
  const pipelineStates = ['registered', 'uploaded', 'queued', 'extracting', 'chunking', 'embedding', 'ready', 'failed'] as const;
  const pipelineCounts: Record<string, number> = {};

  for (const state of pipelineStates) {
    pipelineCounts[state] = 0;
  }

  // Count pipeline_status for ALL files (not just regularFiles, since V2 includes folders too)
  const allUserFiles = await prisma.files.findMany({
    where: { user_id: userId, is_folder: false, deletion_status: null },
    select: { pipeline_status: true },
  });

  allUserFiles.forEach((f) => {
    const status = f.pipeline_status.toLowerCase();
    if (status in pipelineCounts) {
      pipelineCounts[status]++;
    } else {
      pipelineCounts[f.pipeline_status] = (pipelineCounts[f.pipeline_status] || 0) + 1;
    }
  });

  const stuckV2States = ['registered', 'uploaded', 'queued', 'extracting', 'chunking', 'embedding'];
  let stuckV2Count = 0;

  for (const state of pipelineStates) {
    const count = pipelineCounts[state];
    let severity: 'ok' | 'warn' | 'error' | undefined;
    if (state === 'ready' && count > 0) severity = 'ok';
    if (state === 'failed' && count > 0) severity = 'error';
    if (stuckV2States.includes(state) && count > 0) {
      severity = 'warn';
      stuckV2Count += count;
    }
    printStatus(state.charAt(0).toUpperCase() + state.slice(1), String(count).padStart(6), severity);
  }

  if (pipelineCounts['failed'] > 0) {
    hasErrors = true;
  }
  if (stuckV2Count > 0) {
    hasWarnings = true;
    printStatus('Stuck in non-terminal V2 state', stuckV2Count, 'warn');
  }

  // Upload batches
  printSubsection('Upload Batches (V2)');
  const batches = await prisma.upload_batches.findMany({
    where: { user_id: userId },
    select: { id: true, status: true, total_files: true, confirmed_count: true, processed_count: true, created_at: true, expires_at: true },
    orderBy: { created_at: 'desc' },
  });

  const batchStatusCounts: Record<string, number> = { active: 0, completed: 0, expired: 0, cancelled: 0 };
  batches.forEach((b) => {
    const s = b.status.toLowerCase();
    batchStatusCounts[s] = (batchStatusCounts[s] || 0) + 1;
  });

  printStatus('Total batches', batches.length);
  printStatus('Active', String(batchStatusCounts.active).padStart(6), batchStatusCounts.active > 0 ? 'warn' : undefined);
  printStatus('Completed', String(batchStatusCounts.completed).padStart(6), batchStatusCounts.completed > 0 ? 'ok' : undefined);
  printStatus('Expired', String(batchStatusCounts.expired).padStart(6), batchStatusCounts.expired > 0 ? 'warn' : undefined);
  printStatus('Cancelled', String(batchStatusCounts.cancelled).padStart(6));

  if (batchStatusCounts.expired > 0) {
    hasWarnings = true;
    if (!options.reportOnly) {
      const expiredBatches = batches.filter((b) => b.status === 'expired');
      expiredBatches.forEach((b) => {
        console.log(`    - Batch ${b.id.substring(0, 8)}... (${b.confirmed_count}/${b.total_files} confirmed, expired ${b.expires_at.toISOString()})`);
      });
    }
  }

  if (batchStatusCounts.active > 0) {
    hasWarnings = true;
    if (!options.reportOnly) {
      const activeBatches = batches.filter((b) => b.status === 'active');
      activeBatches.forEach((b) => {
        const isExpired = b.expires_at < new Date();
        console.log(`    - Batch ${b.id.substring(0, 8)}... (${b.confirmed_count}/${b.total_files} confirmed${isExpired ? ', PAST EXPIRY' : ''})`);
      });
    }
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

    const withCaption = embeddings.filter((e) => e.caption !== null && e.caption !== '');
    const withoutCaption = embeddings.filter((e) => e.caption === null || e.caption === '');
    const captionPercent = embeddings.length > 0 ? ((withCaption.length / embeddings.length) * 100).toFixed(1) : '0.0';

    printStatus('Total image embeddings', embeddings.length);
    printStatus('With captions', `${withCaption.length} / ${embeddings.length} (${captionPercent}%)`, withCaption.length === embeddings.length ? 'ok' : 'warn');

    if (withoutCaption.length > 0) {
      hasWarnings = true;
      printStatus('Missing captions', withoutCaption.length, 'warn');
      if (!options.reportOnly) {
        // Look up file names for images missing captions
        const missingCaptionFileIds = withoutCaption.map((e) => e.file_id);
        const missingCaptionFiles = await prisma.files.findMany({
          where: { id: { in: missingCaptionFileIds } },
          select: { id: true, name: true },
        });
        const fileNameMap = new Map(missingCaptionFiles.map((f) => [f.id, f.name]));
        withoutCaption.forEach((emb) => {
          const name = fileNameMap.get(emb.file_id) || emb.file_id.substring(0, 8) + '...';
          console.log(`    ⚠ ${name} - no caption`);
        });
      }
    }

    if (embeddings.length > 0 && !options.reportOnly) {
      // Show all embeddings with their caption status
      const allFileIds = embeddings.map((e) => e.file_id);
      const allFiles = await prisma.files.findMany({
        where: { id: { in: allFileIds } },
        select: { id: true, name: true },
      });
      const allFileNameMap = new Map(allFiles.map((f) => [f.id, f.name]));

      console.log('\n  All image embeddings:');
      embeddings.forEach((emb) => {
        const name = allFileNameMap.get(emb.file_id) || emb.file_id.substring(0, 8) + '...';
        const confidence = emb.caption_confidence !== null ? (emb.caption_confidence * 100).toFixed(1) : 'N/A';
        const captionPreview = emb.caption
          ? emb.caption.length > 80 ? emb.caption.substring(0, 77) + '...' : emb.caption
          : '(no caption)';
        const icon = emb.caption ? '✓' : '⚠';
        console.log(`    ${icon} ${name}`);
        console.log(`      Caption: ${captionPreview}`);
        console.log(`      Confidence: ${confidence}% | Dims: ${emb.dimensions || 'N/A'} | Model: ${emb.model || 'N/A'}`);
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
    const displayStatus = file.pipeline_status;
    const status = displayStatus ? ` [${displayStatus}]` : '';
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
  options: { checkEmbeddings: boolean; reportOnly: boolean }
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

  // Fetch all search documents for user using paginated search
  const searchDocs: SearchDoc[] = [];
  try {
    const PAGE_SIZE = 500;
    let skip = 0;

    while (true) {
      const results = await searchClient.search('*', {
        select: ['chunkId', 'fileId', 'userId', 'chunkIndex', 'mimeType', 'content', 'isImage', 'fileStatus', 'siteId', 'sourceType', 'parentFolderId'],
        filter: `userId eq '${userId}'`,
        top: PAGE_SIZE,
        skip,
        includeTotalCount: skip === 0,
      });

      if (skip === 0 && results.count !== undefined) {
        console.log(`  Scanning search index (${results.count} documents)...`);
      }

      let batchCount = 0;
      for await (const result of results.results) {
        if (result.document) {
          searchDocs.push(result.document);
          batchCount++;
        }
      }

      if (batchCount < PAGE_SIZE) break;
      skip += PAGE_SIZE;
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

  // Field coverage analysis with image/text breakdown
  printSubsection('Field Coverage');

  // Split docs into image and text categories
  const imageDocs = searchDocs.filter((d) => d.isImage === true || d.chunkId.startsWith('img_'));
  const textDocs = searchDocs.filter((d) => d.isImage !== true && !d.chunkId.startsWith('img_'));
  const totalDocs = searchDocs.length;

  printStatus('Total search documents', totalDocs);
  printStatus('  Image documents', imageDocs.length);
  printStatus('  Text chunk documents', textDocs.length);

  // Helper to report field coverage with severity
  function reportFieldCoverage(fieldName: string, populated: number, total: number, expectedPercent: number = 100): void {
    if (total === 0) {
      printStatus(`${fieldName}`, `0 / 0 (N/A)`);
      return;
    }
    const percent = ((populated / total) * 100).toFixed(1);
    const severity = parseFloat(percent) >= expectedPercent ? 'ok' : parseFloat(percent) === 0 ? 'error' : 'warn';
    printStatus(`${fieldName}`, `${populated} / ${total} (${percent}%)`, severity);
    if (severity === 'error') {
      hasErrors = true;
    } else if (severity === 'warn') {
      hasWarnings = true;
    }
  }

  console.log('\n  Overall field coverage:');
  const docsWithMimeType = searchDocs.filter((d) => d.mimeType !== undefined && d.mimeType !== null).length;
  reportFieldCoverage('  mimeType', docsWithMimeType, totalDocs);

  const docsWithContent = searchDocs.filter((d) => d.content !== undefined && d.content !== null && d.content.length > 0).length;
  reportFieldCoverage('  content', docsWithContent, totalDocs);

  const docsWithIsImage = searchDocs.filter((d) => d.isImage !== undefined && d.isImage !== null).length;
  reportFieldCoverage('  isImage', docsWithIsImage, totalDocs);

  const docsWithFileStatus = searchDocs.filter((d) => d.fileStatus !== undefined && d.fileStatus !== null).length;
  reportFieldCoverage('  fileStatus', docsWithFileStatus, totalDocs);

  const docsWithSiteId = searchDocs.filter((d) => d.siteId !== undefined && d.siteId !== null).length;
  reportFieldCoverage('  siteId', docsWithSiteId, totalDocs);

  const docsWithSourceType = searchDocs.filter((d) => d.sourceType !== undefined && d.sourceType !== null).length;
  reportFieldCoverage('  sourceType', docsWithSourceType, totalDocs);

  const docsWithParentFolderId = searchDocs.filter((d) => d.parentFolderId !== undefined && d.parentFolderId !== null).length;
  reportFieldCoverage('  parentFolderId', docsWithParentFolderId, totalDocs);

  // Breakdown by category
  if (imageDocs.length > 0) {
    console.log('\n  Image document field coverage:');
    const imgWithMime = imageDocs.filter((d) => d.mimeType !== undefined && d.mimeType !== null).length;
    reportFieldCoverage('    mimeType', imgWithMime, imageDocs.length);
    const imgWithContent = imageDocs.filter((d) => d.content !== undefined && d.content !== null && d.content.length > 0).length;
    reportFieldCoverage('    content', imgWithContent, imageDocs.length);
    const imgWithStatus = imageDocs.filter((d) => d.fileStatus !== undefined && d.fileStatus !== null).length;
    reportFieldCoverage('    fileStatus', imgWithStatus, imageDocs.length);
    const imgWithSiteId = imageDocs.filter((d) => d.siteId !== undefined && d.siteId !== null).length;
    reportFieldCoverage('    siteId', imgWithSiteId, imageDocs.length);
    const imgWithSourceType = imageDocs.filter((d) => d.sourceType !== undefined && d.sourceType !== null).length;
    reportFieldCoverage('    sourceType', imgWithSourceType, imageDocs.length);
    const imgWithParentFolderId = imageDocs.filter((d) => d.parentFolderId !== undefined && d.parentFolderId !== null).length;
    reportFieldCoverage('    parentFolderId', imgWithParentFolderId, imageDocs.length);
  }

  if (textDocs.length > 0) {
    console.log('\n  Text chunk field coverage:');
    const txtWithMime = textDocs.filter((d) => d.mimeType !== undefined && d.mimeType !== null).length;
    reportFieldCoverage('    mimeType', txtWithMime, textDocs.length);
    const txtWithContent = textDocs.filter((d) => d.content !== undefined && d.content !== null && d.content.length > 0).length;
    reportFieldCoverage('    content', txtWithContent, textDocs.length);
    const txtWithIsImage = textDocs.filter((d) => d.isImage !== undefined && d.isImage !== null).length;
    reportFieldCoverage('    isImage', txtWithIsImage, textDocs.length);
    const txtWithStatus = textDocs.filter((d) => d.fileStatus !== undefined && d.fileStatus !== null).length;
    reportFieldCoverage('    fileStatus', txtWithStatus, textDocs.length);
    const txtWithSiteId = textDocs.filter((d) => d.siteId !== undefined && d.siteId !== null).length;
    reportFieldCoverage('    siteId', txtWithSiteId, textDocs.length);
    const txtWithSourceType = textDocs.filter((d) => d.sourceType !== undefined && d.sourceType !== null).length;
    reportFieldCoverage('    sourceType', txtWithSourceType, textDocs.length);
    const txtWithParentFolderId = textDocs.filter((d) => d.parentFolderId !== undefined && d.parentFolderId !== null).length;
    reportFieldCoverage('    parentFolderId', txtWithParentFolderId, textDocs.length);
  }

  // Image Vector Coverage - checks contentVector (1536d) and imageVector (1024d) via getDocument
  // This is gated behind --check-embeddings because it fetches full documents including large vector arrays
  if (options.checkEmbeddings && imageDocs.length > 0) {
    printSubsection('Image Vector Coverage');
    console.log('  (Fetching full documents to inspect vector fields...)\n');

    let withContent = 0;
    let withContentVector = 0;
    let withImageVector = 0;

    // Build file name lookup from DB
    const imageFileIds = [...new Set(imageDocs.map((d) => d.fileId))];
    const imageFiles = imageFileIds.length > 0
      ? await prisma.files.findMany({
          where: { id: { in: imageFileIds } },
          select: { id: true, name: true },
        })
      : [];
    const imageFileNameMap = new Map(imageFiles.map((f) => [f.id, f.name]));

    for (const doc of imageDocs) {
      try {
        const fullDoc = await searchClient!.getDocument(doc.chunkId);
        const hasContent = !!fullDoc.content && fullDoc.content.length > 0;
        const hasContentVec = !!fullDoc.contentVector && fullDoc.contentVector.length > 0;
        const hasImageVec = !!fullDoc.imageVector && fullDoc.imageVector.length > 0;

        if (hasContent) withContent++;
        if (hasContentVec) withContentVector++;
        if (hasImageVec) withImageVector++;

        if (!options.reportOnly) {
          const fileName = imageFileNameMap.get(doc.fileId) || doc.fileId.substring(0, 8) + '...';
          const contentPreview = fullDoc.content
            ? fullDoc.content.length > 70 ? fullDoc.content.substring(0, 67) + '...' : fullDoc.content
            : '(empty)';

          console.log(`  ${doc.chunkId}:`);
          console.log(`    File:          ${fileName}`);
          console.log(`    Content:       ${contentPreview}`);
          console.log(`    imageVector:   ${hasImageVec ? `${fullDoc.imageVector!.length}d` : 'MISSING'} ${hasImageVec ? '✓' : '✗'}`);
          console.log(`    contentVector: ${hasContentVec ? `${fullDoc.contentVector!.length}d` : 'MISSING'} ${hasContentVec ? '✓' : '✗'}`);
          console.log();
        }
      } catch (error) {
        const errorInfo = error instanceof Error ? error.message : String(error);
        console.log(`  ✗ Failed to fetch ${doc.chunkId}: ${errorInfo}`);
        hasErrors = true;
      }
    }

    console.log('  Summary:');
    reportFieldCoverage('  content (caption)', withContent, imageDocs.length);
    reportFieldCoverage('  imageVector (1024d)', withImageVector, imageDocs.length);
    // contentVector may be absent for captionless images - 80% threshold allows graceful degradation
    reportFieldCoverage('  contentVector (1536d)', withContentVector, imageDocs.length, 80);
  }

  // Compare chunk counts: DB vs Search
  // Images go directly to AI Search without creating file_chunks DB records,
  // so we need to account for that: image files have expected search count = 1, DB chunks = 0
  printSubsection('Chunk Count Comparison');
  const fileIds = dbFiles.map((f) => f.id);
  const dbChunks = fileIds.length > 0
    ? await prisma.file_chunks.findMany({
        where: { file_id: { in: fileIds } },
        select: { file_id: true },
      })
    : [];

  // Fetch image_embeddings to identify image files
  const imageEmbeddings = fileIds.length > 0
    ? await prisma.image_embeddings.findMany({
        where: { file_id: { in: fileIds } },
        select: { file_id: true },
      })
    : [];
  const imageFileIds = new Set(imageEmbeddings.map((ie) => ie.file_id));

  const dbChunksByFile = new Map<string, number>();
  dbChunks.forEach((chunk) => {
    dbChunksByFile.set(chunk.file_id, (dbChunksByFile.get(chunk.file_id) || 0) + 1);
  });

  let mismatchCount = 0;
  const mismatches: Array<{ fileId: string; fileName: string; expectedCount: number; searchCount: number; isImage: boolean }> = [];

  // Build case-insensitive map for search docs
  const docsByFileUpper = new Map<string, SearchDoc[]>();
  docsByFile.forEach((docs, fileId) => {
    docsByFileUpper.set(fileId.toUpperCase(), docs);
  });

  dbFiles.forEach((file) => {
    const isImage = imageFileIds.has(file.id);
    const dbChunkCount = dbChunksByFile.get(file.id) || 0;
    const searchCount = docsByFileUpper.get(file.id.toUpperCase())?.length || 0;

    // For images: expected search count = 1 (single image doc), DB chunks = 0
    // For text/PDF: expected search count = DB chunk count
    const expectedCount = isImage ? 1 : dbChunkCount;

    if (expectedCount !== searchCount) {
      mismatchCount++;
      mismatches.push({ fileId: file.id, fileName: file.name, expectedCount, searchCount, isImage });
    }
  });

  const imageFileCount = imageFileIds.size;
  const textFileCount = dbFiles.length - imageFileCount;
  printStatus('Image files (expected 1 search doc each)', imageFileCount);
  printStatus('Text/PDF files (expected DB chunk count each)', textFileCount);

  if (mismatchCount > 0) {
    printStatus('Files with chunk count mismatch', mismatchCount, 'warn');
    hasWarnings = true;
    if (!options.reportOnly) {
      mismatches.slice(0, 10).forEach((m) => {
        const type = m.isImage ? '[IMAGE]' : '[TEXT]';
        console.log(`    - ${type} ${m.fileName} (${m.fileId.substring(0, 8)}...): expected=${m.expectedCount}, search=${m.searchCount}`);
      });
      if (mismatches.length > 10) {
        console.log(`    ... and ${mismatches.length - 10} more`);
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

  const activeIndexName = getActiveIndexName();
  const useV2 = activeIndexName === INDEX_NAME_V2;

  // Import expected schema (V2 or V1 based on USE_UNIFIED_INDEX)
  let expectedSchema;
  try {
    if (useV2) {
      const schemaModule = await import('../../src/services/search/schema-v2');
      expectedSchema = schemaModule.indexSchemaV2;
    } else {
      const schemaModule = await import('../../src/services/search/schema');
      expectedSchema = schemaModule.indexSchema;
    }
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
    currentIndex = await searchIndexClient.getIndex(activeIndexName);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    console.log(`✗ Failed to fetch index: ${errorInfo.message}`);
    hasErrors = true;
    return { hasErrors, hasWarnings };
  }

  printSubsection('Schema Comparison');
  printStatus('Index name', activeIndexName);
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
        const result = await verifySearchSection(currentUserId, prisma, searchClient, { checkEmbeddings, reportOnly });
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
