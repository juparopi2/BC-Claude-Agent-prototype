/**
 * Cleanup Ghost Records Script
 *
 * Removes database records for files that have no corresponding blob in Azure Storage.
 * These "ghost records" are created when the blob upload fails but the DB record persists.
 *
 * Usage:
 *   npx tsx scripts/cleanup-ghost-records.ts --userId <USER_ID>
 *   npx tsx scripts/cleanup-ghost-records.ts --userId <USER_ID> --dry-run
 */
import 'dotenv/config';
import sql from 'mssql';
import { BlobServiceClient } from '@azure/storage-blob';

// Configuration (matching verify-file-integrity.ts)
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

interface GhostRecord {
  id: string;
  name: string;
  blob_path: string;
  processing_status: string;
  created_at: Date;
  is_folder: boolean;
  deletion_status: string | null;
  parent_folder_id: string | null;
}

interface VisualOrphan {
  id: string;
  name: string;
  parent_folder_id: string;
  parent_folder_name: string;
  parent_deletion_status: string;
}

async function main() {
  const args = process.argv.slice(2);
  const userIdIndex = args.indexOf('--userId');
  const dryRun = args.includes('--dry-run');

  if (userIdIndex === -1 || !args[userIdIndex + 1]) {
    console.log('Usage: npx tsx scripts/cleanup-ghost-records.ts --userId <USER_ID> [--dry-run]');
    process.exit(1);
  }

  const userId = args[userIdIndex + 1];
  console.log('=== GHOST RECORD CLEANUP ===\n');
  console.log(`User ID: ${userId}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  // Connect to blob storage
  const connectionString = BLOB_CONNECTION_STRING;
  const containerName = BLOB_CONTAINER;

  if (!connectionString) {
    console.error('AZURE_STORAGE_CONNECTION_STRING not set');
    process.exit(1);
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  console.log(`\nBlob Storage: Connected to container '${containerName}'`);

  // Get database connection
  const pool = await sql.connect(SQL_CONFIG);
  console.log('Database: Connected');

  // Check for files with deletion_status first
  const stuckDeletions = await pool.request()
    .input('userId', userId)
    .query<{ count: number }>(`
      SELECT COUNT(*) as count FROM files
      WHERE user_id = @userId AND deletion_status IS NOT NULL
    `);

  if (stuckDeletions.recordset[0].count > 0) {
    console.log(`\n  Found ${stuckDeletions.recordset[0].count} files with deletion_status (stuck deletions)`);
    console.log('  These are hidden from frontend. Run complete-stuck-deletions.ts to clean them up.');
    console.log('  This script will skip them.\n');
  }

  // Fetch all ACTIVE files for user (excluding folders and files pending deletion)
  const filesResult = await pool.request()
    .input('userId', userId)
    .query<GhostRecord>(`
      SELECT id, name, blob_path, processing_status, created_at, is_folder, deletion_status, parent_folder_id
      FROM files
      WHERE user_id = @userId AND is_folder = 0 AND deletion_status IS NULL
      ORDER BY created_at DESC
    `);

  const files = filesResult.recordset;
  console.log(`Found ${files.length} active files in database (excluding folders and stuck deletions)`);

  // Check each file for blob existence
  const ghostRecords: GhostRecord[] = [];

  for (const file of files) {
    // Skip folders (they don't have blobs)
    if (file.is_folder) {
      continue;
    }

    if (!file.blob_path) {
      ghostRecords.push(file);
      continue;
    }

    const blobClient = containerClient.getBlobClient(file.blob_path);
    const exists = await blobClient.exists();

    if (!exists) {
      ghostRecords.push(file);
    }
  }

  console.log(`Found ${ghostRecords.length} ghost records (DB entry without blob)\n`);

  // Check for visual orphans - files whose parent folder has deletion_status
  console.log('Checking for visual orphans (files in folders pending deletion)...');
  const visualOrphans = await pool.request()
    .input('userId', userId)
    .query<VisualOrphan>(`
      SELECT
        f.id,
        f.name,
        f.parent_folder_id,
        pf.name as parent_folder_name,
        pf.deletion_status as parent_deletion_status
      FROM files f
      JOIN files pf ON f.parent_folder_id = pf.id
      WHERE f.user_id = @userId
        AND f.deletion_status IS NULL
        AND pf.deletion_status IS NOT NULL
    `);

  if (visualOrphans.recordset.length > 0) {
    console.log(`\n⚠️  VISUAL ORPHANS: ${visualOrphans.recordset.length} files in folders pending deletion`);
    console.log('   These files are technically active but their parent folder is being deleted.');
    console.log('   They will be hidden from frontend.\n');

    for (const vo of visualOrphans.recordset.slice(0, 5)) {
      console.log(`   - ${vo.name.substring(0, 40)}`);
      console.log(`     Parent: ${vo.parent_folder_name} (${vo.parent_deletion_status})`);
    }
    if (visualOrphans.recordset.length > 5) {
      console.log(`   ... and ${visualOrphans.recordset.length - 5} more`);
    }
    console.log('\n   Run complete-stuck-deletions.ts to clean up parent folders.\n');
  }

  if (ghostRecords.length === 0) {
    console.log('✅ No ghost records found!');
    await pool.close();
    return;
  }

  // Show ghost records
  console.log('--- Ghost Records ---');
  for (const record of ghostRecords) {
    console.log(`  ${record.name}`);
    console.log(`    ID: ${record.id}`);
    console.log(`    Status: ${record.processing_status}`);
    console.log(`    Path: ${record.blob_path || '(no path)'}`);
    console.log(`    Created: ${record.created_at.toISOString()}`);
  }

  if (dryRun) {
    console.log(`\n💡 Dry run - would delete ${ghostRecords.length} ghost records`);
    console.log('   Run without --dry-run to actually delete');
    await pool.close();
    return;
  }

  // Delete ghost records (cascade will delete chunks too)
  console.log(`\n--- Deleting ${ghostRecords.length} ghost records ---`);

  let deleted = 0;
  for (const record of ghostRecords) {
    try {
      // Delete file (cascades to chunks)
      await pool.request()
        .input('fileId', record.id)
        .query('DELETE FROM files WHERE id = @fileId');

      deleted++;
      console.log(`  ✓ Deleted: ${record.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to delete ${record.name}:`, error);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total ghost records: ${ghostRecords.length}`);
  console.log(`Successfully deleted: ${deleted}`);
  console.log(`Failed: ${ghostRecords.length - deleted}`);

  await sql.close();
  console.log('\n✅ Done!');
}

main().catch(console.error);
