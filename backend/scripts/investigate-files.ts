/**
 * Deep investigation of files table to find discrepancies
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

  console.log('=== INVESTIGACIÓN DIRECTA SQL ===');
  console.log('User ID:', USER_ID);
  console.log('Database:', process.env.DATABASE_NAME);

  // 1. Estructura de la tabla files
  console.log('\n--- ESTRUCTURA TABLA FILES ---');
  const schema = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'files'
    ORDER BY ORDINAL_POSITION
  `);
  for (const col of schema.recordset) {
    console.log(`  ${col.COLUMN_NAME}: ${col.DATA_TYPE}`);
  }

  // 2. Todos los user_id únicos en files
  console.log('\n--- USUARIOS ÚNICOS EN FILES ---');
  const users = await pool.request().query(`
    SELECT user_id, COUNT(*) as count
    FROM files
    GROUP BY user_id
  `);
  for (const u of users.recordset) {
    const match = u.user_id === USER_ID ? ' <-- TU USUARIO' : '';
    console.log(`  ${u.user_id}: ${u.count} registros${match}`);
  }

  // 2b. Verificar deletion_status
  console.log('\n--- DELETION STATUS BREAKDOWN ---');
  const deletionStatus = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT deletion_status, COUNT(*) as count
      FROM files
      WHERE user_id = @userId
      GROUP BY deletion_status
    `);
  for (const d of deletionStatus.recordset) {
    const status = d.deletion_status || 'NULL (active)';
    const warning = d.deletion_status ? ' <-- OCULTOS DEL FRONTEND' : '';
    console.log(`  ${status}: ${d.count}${warning}`);
  }

  // 3. Todos los registros del usuario con detalles
  console.log('\n--- TODOS LOS REGISTROS DEL USUARIO ---');
  const allFiles = await pool.request()
    .input('userId', USER_ID)
    .query(`
      SELECT
        id,
        name,
        is_folder,
        parent_folder_id,
        processing_status,
        embedding_status,
        blob_path,
        created_at,
        deletion_status,
        deleted_at
      FROM files
      WHERE user_id = @userId
      ORDER BY is_folder DESC, created_at DESC
    `);

  console.log(`Total registros: ${allFiles.recordset.length}`);

  // Separar folders y files
  const folders = allFiles.recordset.filter(f => f.is_folder);
  const files = allFiles.recordset.filter(f => !f.is_folder);

  console.log(`  Folders: ${folders.length}`);
  console.log(`  Files: ${files.length}`);

  // 4. Mostrar folders
  console.log('\n--- FOLDERS ---');
  for (const f of folders) {
    const deletionWarning = f.deletion_status ? ` [DELETION: ${f.deletion_status}]` : '';
    console.log(`  ID: ${f.id}${deletionWarning}`);
    console.log(`    Name: ${f.name}`);
    console.log(`    Parent: ${f.parent_folder_id || 'ROOT'}`);
    if (f.deletion_status) {
      console.log(`    ⚠️ Oculto del frontend - deletion_status: ${f.deletion_status}`);
    }
    console.log('');
  }

  // 5. Agrupar archivos por parent_folder_id
  console.log('\n--- ARCHIVOS POR UBICACIÓN ---');

  const rootFiles = files.filter(f => f.parent_folder_id === null);
  console.log(`\nEN ROOT (parent_folder_id = NULL): ${rootFiles.length} archivos`);
  for (const f of rootFiles.slice(0, 5)) {
    console.log(`  - ${f.name.substring(0, 50)} | ${f.processing_status}`);
  }
  if (rootFiles.length > 5) console.log(`  ... y ${rootFiles.length - 5} más`);

  // Archivos en cada folder
  for (const folder of folders) {
    const filesInFolder = files.filter(f => f.parent_folder_id === folder.id);
    console.log(`\nEN FOLDER "${folder.name.substring(0, 40)}": ${filesInFolder.length} archivos`);
    for (const f of filesInFolder.slice(0, 3)) {
      console.log(`  - ${f.name.substring(0, 50)} | ${f.processing_status}`);
    }
    if (filesInFolder.length > 3) console.log(`  ... y ${filesInFolder.length - 3} más`);
  }

  // 6. Verificar archivos con parent_folder_id inválido
  console.log('\n--- VERIFICAR PARENT_FOLDER_ID ---');
  const folderIds = new Set(folders.map(f => f.id));
  const orphanFiles = files.filter(f => f.parent_folder_id !== null && !folderIds.has(f.parent_folder_id));

  if (orphanFiles.length > 0) {
    console.log(`⚠️ ARCHIVOS CON PARENT_FOLDER_ID INVÁLIDO: ${orphanFiles.length}`);
    for (const f of orphanFiles) {
      console.log(`  ${f.name}`);
      console.log(`    ID: ${f.id}`);
      console.log(`    Parent ID: ${f.parent_folder_id} (NO EXISTE COMO FOLDER)`);
    }
  } else {
    console.log('✅ Todos los parent_folder_id son válidos o NULL');
  }

  // 7. Resumen final
  console.log('\n=== RESUMEN ===');
  const activeFolders = folders.filter(f => !f.deletion_status);
  const activeFiles = files.filter(f => !f.deletion_status);
  const stuckFolders = folders.filter(f => f.deletion_status);
  const stuckFiles = files.filter(f => f.deletion_status);

  console.log(`Total registros: ${allFiles.recordset.length}`);
  console.log(`  Folders activos: ${activeFolders.length}`);
  console.log(`  Files activos: ${activeFiles.length}`);
  console.log(`  Folders con deletion_status (stuck): ${stuckFolders.length}`);
  console.log(`  Files con deletion_status (stuck): ${stuckFiles.length}`);
  console.log(`  Files huérfanos (parent inválido): ${orphanFiles.length}`);

  if (stuckFolders.length > 0 || stuckFiles.length > 0) {
    console.log('\n⚠️ HAY REGISTROS CON DELETION_STATUS');
    console.log('   Estos archivos/folders están ocultos del frontend pero no eliminados.');
    console.log('   Ejecutar: npx tsx scripts/complete-stuck-deletions.ts --userId ' + USER_ID);
  }

  // 8. ¿Qué debería ver el frontend?
  console.log('\n=== LO QUE DEBERÍA VER EL FRONTEND ===');
  console.log('(Solo cuenta registros con deletion_status IS NULL)\n');
  console.log('En la vista ROOT (sin folder seleccionado):');
  const visibleRootFolders = folders.filter(f => !f.parent_folder_id && !f.deletion_status);
  const visibleRootFiles = files.filter(f => !f.parent_folder_id && !f.deletion_status);
  console.log(`  - ${visibleRootFolders.length} folders`);
  console.log(`  - ${visibleRootFiles.length} archivos`);

  for (const folder of visibleRootFolders) {
    const filesInThisFolder = files.filter(f => f.parent_folder_id === folder.id && !f.deletion_status);
    console.log(`\nDentro del folder "${folder.name.substring(0, 30)}":`);
    console.log(`  - ${filesInThisFolder.length} archivos`);
  }

  // Mostrar folders ocultos
  if (stuckFolders.length > 0) {
    console.log('\n⚠️ FOLDERS OCULTOS (deletion_status != NULL):');
    for (const f of stuckFolders) {
      console.log(`  - ${f.name.substring(0, 40)} [${f.deletion_status}]`);
    }
  }

  await sql.close();
}

investigate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
