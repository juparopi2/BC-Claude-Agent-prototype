/**
 * PURGE ALL STORAGE Script
 * Deletes ALL files from SQL Server, Azure Blob Storage, and Azure AI Search
 * USE WITH CAUTION - This is irreversible!
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

async function purgeSQL(): Promise<number> {
  console.log('\n=== PURGING SQL SERVER ===\n');

  const pool = await sql.connect(SQL_CONFIG);

  // Count before deletion
  const countBefore = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM files) as files,
      (SELECT COUNT(*) FROM file_chunks) as chunks,
      (SELECT COUNT(*) FROM image_embeddings) as image_embeddings,
      (SELECT COUNT(*) FROM message_file_attachments) as attachments
  `);

  const before = countBefore.recordset[0];
  console.log('Before deletion:');
  console.log(`  Files: ${before.files}`);
  console.log(`  Chunks: ${before.chunks}`);
  console.log(`  Image embeddings: ${before.image_embeddings}`);
  console.log(`  Message attachments: ${before.attachments}`);

  // Delete in order (FK cascade should handle most, but be explicit)
  console.log('\nDeleting...');

  // The FK CASCADE should handle file_chunks, image_embeddings, and message_file_attachments
  // But let's delete message_file_attachments first to be safe
  await pool.request().query('DELETE FROM message_file_attachments');
  console.log('  ✓ Deleted message_file_attachments');

  // Delete files (CASCADE will delete file_chunks and image_embeddings)
  const deleteResult = await pool.request().query('DELETE FROM files');
  console.log(`  ✓ Deleted ${deleteResult.rowsAffected[0]} files`);

  // Verify deletion
  const countAfter = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM files) as files,
      (SELECT COUNT(*) FROM file_chunks) as chunks,
      (SELECT COUNT(*) FROM image_embeddings) as image_embeddings
  `);

  const after = countAfter.recordset[0];
  console.log('\nAfter deletion:');
  console.log(`  Files: ${after.files}`);
  console.log(`  Chunks: ${after.chunks}`);
  console.log(`  Image embeddings: ${after.image_embeddings}`);

  await pool.close();

  return before.files;
}

async function purgeBlobs(): Promise<number> {
  console.log('\n=== PURGING AZURE BLOB STORAGE ===\n');

  const blobServiceClient = BlobServiceClient.fromConnectionString(BLOB_CONNECTION_STRING);
  const containerClient = blobServiceClient.getContainerClient(BLOB_CONTAINER);

  // Collect all blob names first
  const blobNames: string[] = [];
  for await (const blob of containerClient.listBlobsFlat()) {
    blobNames.push(blob.name);
  }

  console.log(`Found ${blobNames.length} blobs to delete`);

  // Delete each blob
  let deleted = 0;
  for (const blobName of blobNames) {
    try {
      await containerClient.deleteBlob(blobName);
      console.log(`  ✓ Deleted: ${blobName}`);
      deleted++;
    } catch (error) {
      console.log(`  ✗ Failed to delete: ${blobName}`);
    }
  }

  console.log(`\nDeleted ${deleted}/${blobNames.length} blobs`);

  return deleted;
}

async function purgeAISearch(): Promise<number> {
  console.log('\n=== PURGING AZURE AI SEARCH ===\n');

  const searchClient = new SearchClient(
    SEARCH_ENDPOINT,
    SEARCH_INDEX,
    new AzureKeyCredential(SEARCH_KEY)
  );

  // Get all document IDs
  const documentIds: string[] = [];

  const searchResults = await searchClient.search('*', {
    select: ['chunkId'],
    top: 1000
  });

  for await (const result of searchResults.results) {
    const doc = result.document as any;
    if (doc.chunkId) {
      documentIds.push(doc.chunkId);
    }
  }

  console.log(`Found ${documentIds.length} documents to delete`);

  if (documentIds.length === 0) {
    console.log('No documents to delete');
    return 0;
  }

  // Delete in batches of 1000 (AI Search limit)
  const batchSize = 1000;
  let totalDeleted = 0;

  for (let i = 0; i < documentIds.length; i += batchSize) {
    const batch = documentIds.slice(i, i + batchSize);
    const deleteActions = batch.map(id => ({
      '@search.action': 'delete' as const,
      chunkId: id
    }));

    try {
      const result = await searchClient.indexDocuments({ actions: deleteActions });
      const succeeded = result.results.filter(r => r.succeeded).length;
      totalDeleted += succeeded;
      console.log(`  ✓ Batch ${Math.floor(i/batchSize) + 1}: Deleted ${succeeded}/${batch.length} documents`);
    } catch (error) {
      console.log(`  ✗ Batch ${Math.floor(i/batchSize) + 1}: Failed to delete`);
    }
  }

  console.log(`\nDeleted ${totalDeleted}/${documentIds.length} documents`);

  return totalDeleted;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           PURGE ALL STORAGE - DEVELOPMENT ONLY             ║');
  console.log('║   This will delete ALL files from SQL, Blob, and Search    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    const sqlDeleted = await purgeSQL();
    const blobsDeleted = await purgeBlobs();
    const searchDeleted = await purgeAISearch();

    console.log('\n' + '═'.repeat(60));
    console.log('PURGE COMPLETE - SUMMARY');
    console.log('═'.repeat(60));
    console.log(`SQL Server files deleted: ${sqlDeleted}`);
    console.log(`Blob Storage blobs deleted: ${blobsDeleted}`);
    console.log(`AI Search documents deleted: ${searchDeleted}`);
    console.log('═'.repeat(60));
    console.log('\n✅ All storage has been purged. Ready for fresh start.');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ PURGE FAILED:', error);
    process.exit(1);
  }
}

main();
