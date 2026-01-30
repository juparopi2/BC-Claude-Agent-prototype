/**
 * Direct SQL verification - bypasses all abstractions
 */
import 'dotenv/config';
import sql from 'mssql';

const USER_ID = 'BCD5A31B-C560-40D5-972F-50E134A8389D';

const config: sql.config = {
  server: process.env.DATABASE_SERVER || '',
  database: process.env.DATABASE_NAME || '',
  user: process.env.DATABASE_USER || '',
  password: process.env.DATABASE_PASSWORD || '',
  options: { encrypt: true, trustServerCertificate: false }
};

async function main() {
  console.log('=== DIRECT SQL VERIFICATION ===\n');
  console.log('User ID:', USER_ID);
  console.log('Database:', process.env.DATABASE_NAME);
  console.log('Server:', process.env.DATABASE_SERVER);

  const pool = await sql.connect(config);
  console.log('Connected to database\n');

  // 1. Count files by type and status
  const counts = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_folder = 1 THEN 1 ELSE 0 END) as folders,
        SUM(CASE WHEN is_folder = 0 THEN 1 ELSE 0 END) as files,
        SUM(CASE WHEN processing_status = 'pending' AND is_folder = 0 THEN 1 ELSE 0 END) as pending_files,
        SUM(CASE WHEN processing_status = 'completed' AND is_folder = 0 THEN 1 ELSE 0 END) as completed_files,
        SUM(CASE WHEN blob_path IS NULL AND is_folder = 0 THEN 1 ELSE 0 END) as files_without_blob,
        SUM(CASE WHEN deletion_status IS NULL THEN 1 ELSE 0 END) as active_records,
        SUM(CASE WHEN deletion_status IS NOT NULL THEN 1 ELSE 0 END) as stuck_deletions
      FROM files
      WHERE user_id = @userId
    `);

  console.log('--- File Counts ---');
  const c = counts.recordset[0];
  console.log(`  Total records:        ${c.total}`);
  console.log(`  Active (visible):     ${c.active_records}`);
  console.log(`  Stuck deletions:      ${c.stuck_deletions}`);
  console.log(`  Folders:              ${c.folders}`);
  console.log(`  Files:                ${c.files}`);
  console.log(`  Pending files:        ${c.pending_files}`);
  console.log(`  Completed files:      ${c.completed_files}`);
  console.log(`  Files without blob:   ${c.files_without_blob}`);

  // 1b. Show deletion_status breakdown if there are stuck deletions
  if (c.stuck_deletions > 0) {
    console.log('\n--- STUCK DELETIONS WARNING ---');
    const deletionStatus = await pool.request()
      .input('userId', USER_ID)
      .query(`
        SELECT deletion_status, COUNT(*) as count
        FROM files
        WHERE user_id = @userId AND deletion_status IS NOT NULL
        GROUP BY deletion_status
      `);
    for (const d of deletionStatus.recordset) {
      console.log(`  ${d.deletion_status}: ${d.count}`);
    }
    console.log('\n  These files are hidden from frontend but not fully deleted.');
    console.log('  Run: npx tsx scripts/complete-stuck-deletions.ts --userId ' + USER_ID);
  }

  // 2. List all ACTIVE files (not folders, deletion_status IS NULL)
  const files = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT id, name, blob_path, processing_status, embedding_status, created_at, deletion_status
      FROM files
      WHERE user_id = @userId AND is_folder = 0 AND deletion_status IS NULL
      ORDER BY created_at DESC
    `);

  console.log(`\n--- Active Files (${files.recordset.length} total) ---`);
  for (const f of files.recordset.slice(0, 15)) {
    const blobStatus = f.blob_path ? 'HAS_BLOB' : 'NO_BLOB';
    console.log(`  ${f.name.substring(0, 45).padEnd(45)} | ${f.processing_status.padEnd(10)} | ${blobStatus}`);
  }
  if (files.recordset.length > 15) {
    console.log(`  ... and ${files.recordset.length - 15} more files`);
  }

  // 3. Check for problematic files
  const problems = files.recordset.filter(f => !f.blob_path || f.processing_status === 'pending');
  if (problems.length > 0) {
    console.log(`\n--- PROBLEMATIC FILES (${problems.length}) ---`);
    for (const f of problems) {
      console.log(`  ${f.id}`);
      console.log(`    Name: ${f.name}`);
      console.log(`    Status: ${f.processing_status}`);
      console.log(`    Blob: ${f.blob_path || 'NULL'}`);
    }
  } else {
    console.log('\n✅ No problematic files found');
  }

  // 4. Count chunks
  const chunks = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT COUNT(*) as total_chunks
      FROM file_chunks fc
      JOIN files f ON fc.file_id = f.id
      WHERE f.user_id = @userId
    `);

  console.log(`\n--- Chunks ---`);
  console.log(`  Total chunks: ${chunks.recordset[0].total_chunks}`);

  // 5. List active folders (deletion_status IS NULL)
  const folders = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT id, name, created_at, deletion_status
      FROM files
      WHERE user_id = @userId AND is_folder = 1 AND deletion_status IS NULL
      ORDER BY name
    `);

  console.log(`\n--- Active Folders (${folders.recordset.length}) ---`);
  for (const f of folders.recordset) {
    console.log(`  ${f.name}`);
  }

  // 6. List stuck deletion folders
  const stuckFolders = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT id, name, deletion_status, deleted_at
      FROM files
      WHERE user_id = @userId AND is_folder = 1 AND deletion_status IS NOT NULL
      ORDER BY deleted_at
    `);

  if (stuckFolders.recordset.length > 0) {
    console.log(`\n--- Stuck Deletion Folders (${stuckFolders.recordset.length}) ---`);
    for (const f of stuckFolders.recordset) {
      console.log(`  ${f.name.substring(0, 40)} | ${f.deletion_status} | ${f.deleted_at?.toISOString() || 'N/A'}`);
    }
  }

  await sql.close();
  console.log('\n✅ SQL verification complete');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
