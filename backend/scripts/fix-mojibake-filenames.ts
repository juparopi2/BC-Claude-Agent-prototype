import { executeQuery, initDatabase, closeDatabase } from '../src/config/database';

interface FileRecord {
  id: string;
  name: string;
}

async function fixAllMojibakeFilenames() {
  try {
    await initDatabase();
    console.log('✅ Database connected\n');

    // Get all files with mojibake
    const files = await executeQuery<FileRecord>(`
      SELECT id, name
      FROM files
      WHERE name LIKE '%â%'
         OR name LIKE '%€%'
         OR name LIKE '%¢%'
         OR name LIKE '%Ã%'
    `, {});

    console.log(`Found ${files.recordset.length} files with mojibake\n`);

    if (files.recordset.length === 0) {
      console.log('✨ No files to fix!');
      await closeDatabase();
      return;
    }

    for (const file of files.recordset) {
      const latin1Buffer = Buffer.from(file.name, 'latin1');
      const fixedName = latin1Buffer.toString('utf8');

      await executeQuery(`
        UPDATE files
        SET name = @name, updated_at = GETUTCDATE()
        WHERE id = @id
      `, {
        id: file.id,
        name: fixedName
      });

      console.log(`Fixed: ${file.name} → ${fixedName}`);
    }

    console.log(`\n✨ All ${files.recordset.length} files fixed!`);
    await closeDatabase();
  } catch (error) {
    console.error('Error:', error);
    await closeDatabase();
    process.exit(1);
  }
}

fixAllMojibakeFilenames();
