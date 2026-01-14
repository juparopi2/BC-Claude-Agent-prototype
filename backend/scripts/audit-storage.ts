/**
 * Storage Audit Script
 * Verifies consistency between SQL Server, Azure Blob Storage, and Azure AI Search
 */

import 'dotenv/config';
import sql from 'mssql';
import { BlobServiceClient } from '@azure/storage-blob';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

// Load configuration from environment variables
const SQL_CONFIG: sql.config = {
  server: process.env.DB_SERVER || '',
  database: process.env.DB_DATABASE || '',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

const BLOB_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const BLOB_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_NAME || 'user-files';

const SEARCH_ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT || '';
const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';
const SEARCH_INDEX = process.env.AZURE_SEARCH_INDEX_NAME || 'file-chunks-index';

interface SQLFile {
  id: string;
  user_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  content_hash: string | null;
  blob_path: string;
  is_folder: boolean;
}

interface SQLChunk {
  file_id: string;
  chunk_index: number;
}

async function auditSQLServer(): Promise<{ files: SQLFile[], chunks: Map<string, number>, imageEmbeddings: Map<string, boolean> }> {
  console.log('\n=== SQL SERVER AUDIT ===\n');

  const pool = await sql.connect(SQL_CONFIG);

  // Get all files
  const filesResult = await pool.request().query<SQLFile>(`
    SELECT id, user_id, name, mime_type, size_bytes, content_hash, blob_path, is_folder
    FROM files
    ORDER BY created_at DESC
  `);

  const files = filesResult.recordset.filter(f => !f.is_folder);
  const folders = filesResult.recordset.filter(f => f.is_folder);

  console.log(`Total files: ${files.length}`);
  console.log(`Total folders: ${folders.length}`);

  // Files by user
  const userGroups = new Map<string, SQLFile[]>();
  for (const file of files) {
    const list = userGroups.get(file.user_id) || [];
    list.push(file);
    userGroups.set(file.user_id, list);
  }

  console.log('\n--- Files by User ---');
  for (const [userId, userFiles] of userGroups) {
    console.log(`User ${userId}: ${userFiles.length} files`);
  }

  // Get chunks per file
  const chunksResult = await pool.request().query<SQLChunk>(`
    SELECT file_id, chunk_index FROM file_chunks
  `);

  const chunks = new Map<string, number>();
  for (const chunk of chunksResult.recordset) {
    chunks.set(chunk.file_id, (chunks.get(chunk.file_id) || 0) + 1);
  }

  console.log('\n--- Chunks per File ---');
  for (const file of files) {
    const chunkCount = chunks.get(file.id) || 0;
    console.log(`${file.name}: ${chunkCount} chunks`);
  }

  // Get image embeddings
  const imageResult = await pool.request().query(`
    SELECT file_id FROM image_embeddings
  `);

  const imageEmbeddings = new Map<string, boolean>();
  for (const row of imageResult.recordset) {
    imageEmbeddings.set(row.file_id, true);
  }

  console.log('\n--- File Details ---');
  for (const file of files) {
    console.log(JSON.stringify({
      id: file.id,
      user_id: file.user_id,
      name: file.name,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      has_content_hash: !!file.content_hash,
      blob_path: file.blob_path,
      chunk_count: chunks.get(file.id) || 0,
      has_image_embedding: imageEmbeddings.get(file.id) || false
    }));
  }

  await pool.close();

  return { files, chunks, imageEmbeddings };
}

async function auditBlobStorage(): Promise<Map<string, { name: string, size: number }>> {
  console.log('\n=== AZURE BLOB STORAGE AUDIT ===\n');

  const blobServiceClient = BlobServiceClient.fromConnectionString(BLOB_CONNECTION_STRING);
  const containerClient = blobServiceClient.getContainerClient(BLOB_CONTAINER);

  const blobs = new Map<string, { name: string, size: number }>();
  let totalSize = 0;

  // List all blobs in container
  for await (const blob of containerClient.listBlobsFlat()) {
    blobs.set(blob.name, { name: blob.name, size: blob.properties.contentLength || 0 });
    totalSize += blob.properties.contentLength || 0;
  }

  console.log(`Total blobs: ${blobs.size}`);
  console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

  // Group by user (path format: users/{userId}/files/{fileId})
  const userBlobs = new Map<string, string[]>();
  for (const [path] of blobs) {
    const match = path.match(/^users\/([^/]+)\/files\/(.+)$/);
    if (match) {
      const userId = match[1];
      const list = userBlobs.get(userId) || [];
      list.push(path);
      userBlobs.set(userId, list);
    }
  }

  console.log('\n--- Blobs by User ---');
  for (const [userId, paths] of userBlobs) {
    console.log(`User ${userId}: ${paths.length} blobs`);
  }

  console.log('\n--- All Blob Paths ---');
  for (const [path, info] of blobs) {
    console.log(`${path} (${info.size} bytes)`);
  }

  return blobs;
}

async function auditAISearch(): Promise<Map<string, { fileId: string, userId: string, chunkIndex: number, isImage: boolean }[]>> {
  console.log('\n=== AZURE AI SEARCH AUDIT ===\n');

  const searchClient = new SearchClient(
    SEARCH_ENDPOINT,
    SEARCH_INDEX,
    new AzureKeyCredential(SEARCH_KEY)
  );

  // Search for all documents
  const documents = new Map<string, { fileId: string, userId: string, chunkIndex: number, isImage: boolean }[]>();
  let totalDocs = 0;

  // Get all documents using wildcard search
  // Schema uses 'chunkId' as key, not 'id'
  const searchResults = await searchClient.search('*', {
    select: ['chunkId', 'fileId', 'userId', 'chunkIndex', 'isImage'],
    top: 1000
  });

  for await (const result of searchResults.results) {
    const doc = result.document as any;
    const fileId = doc.fileId;
    const list = documents.get(fileId) || [];
    list.push({
      fileId: doc.fileId,
      userId: doc.userId,
      chunkIndex: doc.chunkIndex,
      isImage: doc.isImage || false
    });
    documents.set(fileId, list);
    totalDocs++;
  }

  console.log(`Total documents in index: ${totalDocs}`);
  console.log(`Unique fileIds: ${documents.size}`);

  // Group by user
  const userDocs = new Map<string, number>();
  for (const [, docs] of documents) {
    const userId = docs[0]?.userId || 'unknown';
    userDocs.set(userId, (userDocs.get(userId) || 0) + docs.length);
  }

  console.log('\n--- Documents by User ---');
  for (const [userId, count] of userDocs) {
    console.log(`User ${userId}: ${count} documents`);
  }

  console.log('\n--- Documents per FileId ---');
  for (const [fileId, docs] of documents) {
    const textDocs = docs.filter(d => !d.isImage).length;
    const imageDocs = docs.filter(d => d.isImage).length;
    console.log(`FileId ${fileId}: ${textDocs} text chunks, ${imageDocs} image embeddings (User: ${docs[0]?.userId})`);
  }

  return documents;
}

async function compareAndReport(
  sqlFiles: SQLFile[],
  sqlChunks: Map<string, number>,
  blobs: Map<string, { name: string, size: number }>,
  searchDocs: Map<string, { fileId: string, userId: string, chunkIndex: number, isImage: boolean }[]>
) {
  console.log('\n=== COMPARISON & DISCREPANCIES ===\n');

  const issues: string[] = [];

  // 1. Check: Every SQL file should have a blob
  console.log('--- Checking: SQL files have corresponding blobs ---');
  for (const file of sqlFiles) {
    if (!blobs.has(file.blob_path)) {
      issues.push(`MISSING BLOB: File "${file.name}" (${file.id}) has no blob at path: ${file.blob_path}`);
      console.log(`❌ MISSING BLOB: ${file.name} -> ${file.blob_path}`);
    } else {
      console.log(`✅ OK: ${file.name}`);
    }
  }

  // 2. Check: Every blob should have a SQL file
  console.log('\n--- Checking: Blobs have corresponding SQL files ---');
  const sqlBlobPaths = new Set(sqlFiles.map(f => f.blob_path));
  for (const [blobPath] of blobs) {
    if (!sqlBlobPaths.has(blobPath)) {
      issues.push(`ORPHAN BLOB: Blob "${blobPath}" has no corresponding SQL file`);
      console.log(`❌ ORPHAN BLOB: ${blobPath}`);
    }
  }

  // 3. Check: SQL files with chunks should have AI Search documents
  console.log('\n--- Checking: SQL chunks have corresponding AI Search documents ---');
  for (const file of sqlFiles) {
    const sqlChunkCount = sqlChunks.get(file.id) || 0;
    const searchDocsForFile = searchDocs.get(file.id) || [];
    const searchTextDocs = searchDocsForFile.filter(d => !d.isImage).length;

    if (sqlChunkCount > 0 && searchTextDocs === 0) {
      issues.push(`MISSING SEARCH DOCS: File "${file.name}" (${file.id}) has ${sqlChunkCount} SQL chunks but 0 AI Search documents`);
      console.log(`❌ MISSING: ${file.name} - SQL chunks: ${sqlChunkCount}, Search docs: ${searchTextDocs}`);
    } else if (sqlChunkCount !== searchTextDocs && sqlChunkCount > 0) {
      issues.push(`CHUNK MISMATCH: File "${file.name}" (${file.id}) - SQL: ${sqlChunkCount} chunks, AI Search: ${searchTextDocs} docs`);
      console.log(`⚠️ MISMATCH: ${file.name} - SQL: ${sqlChunkCount}, Search: ${searchTextDocs}`);
    } else if (sqlChunkCount > 0) {
      console.log(`✅ OK: ${file.name} - ${sqlChunkCount} chunks`);
    }
  }

  // 4. Check: AI Search documents should have corresponding SQL files
  console.log('\n--- Checking: AI Search documents have corresponding SQL files ---');
  const sqlFileIds = new Set(sqlFiles.map(f => f.id));
  const sqlFileIdsLower = new Set(sqlFiles.map(f => f.id.toLowerCase()));

  for (const [fileId, docs] of searchDocs) {
    const fileIdUpper = fileId.toUpperCase();
    const fileIdLower = fileId.toLowerCase();

    if (sqlFileIds.has(fileIdUpper)) {
      // Exact match (case-insensitive) - this is OK
      console.log(`✅ OK (case-matched): fileId ${fileId}`);
    } else if (sqlFileIdsLower.has(fileIdLower)) {
      // Found via lowercase match - case mismatch but not orphan
      console.log(`⚠️ CASE MISMATCH: fileId ${fileId} found in SQL but case differs`);
    } else {
      // True orphan - not found in SQL at all
      issues.push(`ORPHAN SEARCH DOCS: ${docs.length} AI Search documents for fileId "${fileId}" (User: ${docs[0]?.userId}) have no SQL file`);
      console.log(`❌ ORPHAN: fileId ${fileId} - ${docs.length} documents (User: ${docs[0]?.userId})`);
    }
  }

  // 5. Check: UserId case sensitivity
  console.log('\n--- Checking: UserId case sensitivity ---');
  const sqlUserIds = new Set(sqlFiles.map(f => f.user_id));
  const searchUserIds = new Set<string>();
  for (const [, docs] of searchDocs) {
    for (const doc of docs) {
      searchUserIds.add(doc.userId);
    }
  }

  for (const sqlUserId of sqlUserIds) {
    const upperUserId = sqlUserId.toUpperCase();
    const lowerUserId = sqlUserId.toLowerCase();

    if (searchUserIds.has(lowerUserId) && !searchUserIds.has(upperUserId)) {
      issues.push(`CASE SENSITIVITY: SQL userId "${sqlUserId}" but AI Search has lowercase "${lowerUserId}"`);
      console.log(`⚠️ CASE ISSUE: SQL: ${sqlUserId}, Search: ${lowerUserId}`);
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`SQL Files: ${sqlFiles.length}`);
  console.log(`Blob Storage Blobs: ${blobs.size}`);
  console.log(`AI Search Unique FileIds: ${searchDocs.size}`);
  console.log(`\nTotal Issues Found: ${issues.length}`);

  if (issues.length > 0) {
    console.log('\n--- All Issues ---');
    for (const issue of issues) {
      console.log(`• ${issue}`);
    }
  } else {
    console.log('\n✅ No discrepancies found! All storage systems are consistent.');
  }

  return issues;
}

async function main() {
  try {
    console.log('Starting storage audit...\n');
    console.log('=' .repeat(60));

    const { files: sqlFiles, chunks: sqlChunks, imageEmbeddings } = await auditSQLServer();
    const blobs = await auditBlobStorage();
    const searchDocs = await auditAISearch();

    const issues = await compareAndReport(sqlFiles, sqlChunks, blobs, searchDocs);

    console.log('\n' + '='.repeat(60));
    console.log('Audit complete.');

    process.exit(issues.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('Audit failed:', error);
    process.exit(1);
  }
}

main();
