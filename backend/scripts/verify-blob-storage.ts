/**
 * Verify Blob Storage files for a specific user
 * Usage: npx ts-node -r tsconfig-paths/register scripts/verify-blob-storage.ts [userId]
 */

import 'dotenv/config';
import { BlobServiceClient } from '@azure/storage-blob';
import sql from 'mssql';

// Database config
const SQL_CONFIG: sql.config = {
  server: process.env.DATABASE_SERVER || '',
  database: process.env.DATABASE_NAME || '',
  user: process.env.DATABASE_USER || '',
  password: process.env.DATABASE_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

// Blob Storage config
const BLOB_CONNECTION_STRING = process.env.STORAGE_CONNECTION_STRING || '';
const BLOB_CONTAINER = process.env.STORAGE_CONTAINER_NAME || 'agent-files';

interface SQLFile {
  id: string;
  name: string;
  blob_path: string;
  processing_status: string;
  size_bytes: number;
}

async function main() {
  const userId = process.argv[2] || 'BCD5A31B-C560-40D5-972F-50E134A8389D';

  console.log('=== VERIFYING BLOB STORAGE FILES ===\n');
  console.log(`User ID: ${userId}`);
  console.log(`Container: ${BLOB_CONTAINER}\n`);

  // 1. Get files from SQL
  console.log('--- Querying SQL Database ---\n');

  const pool = await sql.connect(SQL_CONFIG);
  const result = await pool.request()
    .input('userId', sql.UniqueIdentifier, userId)
    .query<SQLFile>(`
      SELECT id, name, blob_path, processing_status, size_bytes
      FROM files
      WHERE user_id = @userId AND is_folder = 0
      ORDER BY created_at DESC
    `);

  const files = result.recordset;
  console.log(`Found ${files.length} files in database\n`);

  if (files.length === 0) {
    console.log('No files found for user');
    await pool.close();
    return;
  }

  // 2. Check Blob Storage
  console.log('--- Checking Blob Storage ---\n');

  if (!BLOB_CONNECTION_STRING) {
    console.error('ERROR: STORAGE_CONNECTION_STRING not set');
    console.log('\nListing files from SQL only:');
    for (const file of files) {
      console.log(`  ${file.name}`);
      console.log(`    ID: ${file.id}`);
      console.log(`    Status: ${file.processing_status}`);
      console.log(`    Blob path: ${file.blob_path}`);
      console.log(`    Size: ${file.size_bytes} bytes`);
      console.log('');
    }
    await pool.close();
    return;
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(BLOB_CONNECTION_STRING);
  const containerClient = blobServiceClient.getContainerClient(BLOB_CONTAINER);

  let existsCount = 0;
  let missingCount = 0;

  for (const file of files) {
    const blobClient = containerClient.getBlobClient(file.blob_path);
    const exists = await blobClient.exists();

    const status = exists ? '✓' : '✗';
    console.log(`[${status}] ${file.name}`);
    console.log(`    ID: ${file.id}`);
    console.log(`    Processing: ${file.processing_status}`);
    console.log(`    Blob path: ${file.blob_path}`);
    console.log(`    Size: ${file.size_bytes} bytes`);
    console.log(`    Blob exists: ${exists ? 'YES' : 'NO'}`);
    console.log('');

    if (exists) {
      existsCount++;
    } else {
      missingCount++;
    }
  }

  console.log('=== SUMMARY ===\n');
  console.log(`Files in database: ${files.length}`);
  console.log(`Files in Blob Storage: ${existsCount}`);
  console.log(`Missing from Blob Storage: ${missingCount}`);

  // 3. Check for orphaned blobs (blobs without DB record)
  console.log('\n--- Checking for Orphaned Blobs ---\n');

  const userPrefix = `users/${userId}/`;
  const dbBlobPaths = new Set(files.map(f => f.blob_path));

  let orphanCount = 0;
  for await (const blob of containerClient.listBlobsFlat({ prefix: userPrefix })) {
    if (!dbBlobPaths.has(blob.name)) {
      console.log(`Orphaned: ${blob.name}`);
      orphanCount++;
    }
  }

  if (orphanCount === 0) {
    console.log('No orphaned blobs found ✓');
  } else {
    console.log(`\nTotal orphaned blobs: ${orphanCount}`);
  }

  await pool.close();
}

main().catch(console.error);
