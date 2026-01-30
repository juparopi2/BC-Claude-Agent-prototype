/**
 * Investigate deletion_status field
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

async function investigate() {
  const pool = await sql.connect(config);

  console.log('=== INVESTIGAR DELETION_STATUS ===\n');

  // 1. Contar por deletion_status
  const statusCount = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT
        deletion_status,
        COUNT(*) as count
      FROM files
      WHERE user_id = @userId
      GROUP BY deletion_status
    `);

  console.log('--- DISTRIBUCIÓN POR DELETION_STATUS ---');
  for (const r of statusCount.recordset) {
    console.log(`  ${r.deletion_status || 'NULL'}: ${r.count}`);
  }

  // 2. Archivos con deletion_status NO NULL
  const deletedFiles = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT id, name, is_folder, deletion_status, deleted_at, parent_folder_id
      FROM files
      WHERE user_id = @userId AND deletion_status IS NOT NULL
    `);

  if (deletedFiles.recordset.length > 0) {
    console.log(`\n⚠️ ARCHIVOS CON DELETION_STATUS (${deletedFiles.recordset.length}):`);
    for (const f of deletedFiles.recordset) {
      const type = f.is_folder ? '[FOLDER]' : '[FILE]';
      console.log(`  ${type} ${f.name.substring(0, 40)}`);
      console.log(`    Status: ${f.deletion_status}`);
      console.log(`    Deleted at: ${f.deleted_at}`);
    }
  } else {
    console.log('\n✅ No hay archivos con deletion_status');
  }

  // 3. Simular la query exacta del frontend para root
  console.log('\n--- SIMULAR QUERY FRONTEND (ROOT) ---');
  const rootQuery = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT id, name, is_folder, parent_folder_id
      FROM files
      WHERE user_id = @userId
        AND deletion_status IS NULL
        AND parent_folder_id IS NULL
      ORDER BY is_folder DESC, created_at DESC
    `);

  console.log(`Resultados en ROOT: ${rootQuery.recordset.length}`);
  for (const f of rootQuery.recordset) {
    const type = f.is_folder ? '[FOLDER]' : '[FILE]';
    console.log(`  ${type} ${f.name}`);
  }

  // 4. Simular query para el folder "AI Projekt Billeder Plagborg"
  const mainFolderId = 'DEE54835-9111-47F5-A3D1-969429854BBD';
  console.log(`\n--- SIMULAR QUERY FRONTEND (folder: AI Projekt...) ---`);
  const folderQuery = await pool.request()
    .input('userId', USER_ID)
    .input('folderId', mainFolderId)
    .query(`
      SELECT id, name, is_folder, parent_folder_id
      FROM files
      WHERE user_id = @userId
        AND deletion_status IS NULL
        AND parent_folder_id = @folderId
      ORDER BY is_folder DESC, created_at DESC
    `);

  console.log(`Resultados en folder: ${folderQuery.recordset.length}`);
  for (const f of folderQuery.recordset.slice(0, 10)) {
    const type = f.is_folder ? '[FOLDER]' : '[FILE]';
    console.log(`  ${type} ${f.name.substring(0, 50)}`);
  }
  if (folderQuery.recordset.length > 10) {
    console.log(`  ... y ${folderQuery.recordset.length - 10} más`);
  }

  await sql.close();
}

investigate().catch(console.error);
