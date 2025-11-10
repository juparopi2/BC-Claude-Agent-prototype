/**
 * Add Missing Columns - Simple Approach
 *
 * Executes ALTER TABLE statements one by one to add missing columns.
 */

import { initDatabase, getPool, closeDatabase } from '../src/config/database';

async function addMissingColumns(): Promise<void> {
  console.log('🔧 Adding missing columns to database tables...\n');

  try {
    await initDatabase();
    const pool = getPool();

    // ========== TABLE: todos ==========
    console.log('📋 Processing todos table...');

    // Add 'content' column
    try {
      console.log('  Adding column: content');
      await pool.request().query(`
        ALTER TABLE todos ADD content NVARCHAR(500) NULL
      `);
      console.log('  ✅ Column content added');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message?.includes('already exists')) {
        console.log('  ℹ️  Column content already exists');
      } else {
        console.error('  ❌ Error adding content:', err.message);
      }
    }

    // Copy data from description to content
    try {
      console.log('  Copying data from description to content');
      await pool.request().query(`
        UPDATE todos SET content = description WHERE content IS NULL
      `);
      console.log('  ✅ Data copied');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error copying data:', err.message);
    }

    // Make content NOT NULL
    try {
      console.log('  Setting content to NOT NULL');
      await pool.request().query(`
        ALTER TABLE todos ALTER COLUMN content NVARCHAR(500) NOT NULL
      `);
      console.log('  ✅ Column content set to NOT NULL');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    // Add 'activeForm' column
    try {
      console.log('  Adding column: activeForm');
      await pool.request().query(`
        ALTER TABLE todos ADD activeForm NVARCHAR(500) NULL
      `);
      console.log('  ✅ Column activeForm added');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message?.includes('already exists')) {
        console.log('  ℹ️  Column activeForm already exists');
      } else {
        console.error('  ❌ Error adding activeForm:', err.message);
      }
    }

    // Set default activeForm values
    try {
      console.log('  Setting default activeForm values');
      await pool.request().query(`
        UPDATE todos
        SET activeForm = CASE
          WHEN description LIKE 'Create %' THEN REPLACE(description, 'Create', 'Creating')
          WHEN description LIKE 'Update %' THEN REPLACE(description, 'Update', 'Updating')
          WHEN description LIKE 'Delete %' THEN REPLACE(description, 'Delete', 'Deleting')
          WHEN description LIKE 'Query %' THEN REPLACE(description, 'Query', 'Querying')
          ELSE description + '...'
        END
        WHERE activeForm IS NULL
      `);
      console.log('  ✅ Default values set');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    // Make activeForm NOT NULL
    try {
      console.log('  Setting activeForm to NOT NULL');
      await pool.request().query(`
        ALTER TABLE todos ALTER COLUMN activeForm NVARCHAR(500) NOT NULL
      `);
      console.log('  ✅ Column activeForm set to NOT NULL');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    // Add 'order' column (note: order is a reserved word, use brackets)
    try {
      console.log('  Adding column: order');
      await pool.request().query(`
        ALTER TABLE todos ADD [order] INT NULL
      `);
      console.log('  ✅ Column order added');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message?.includes('already exists')) {
        console.log('  ℹ️  Column order already exists');
      } else {
        console.error('  ❌ Error adding order:', err.message);
      }
    }

    // Copy data from order_index to order
    try {
      console.log('  Copying data from order_index to order');
      await pool.request().query(`
        UPDATE todos SET [order] = order_index WHERE [order] IS NULL
      `);
      console.log('  ✅ Data copied');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error copying data:', err.message);
    }

    // Make order NOT NULL
    try {
      console.log('  Setting order to NOT NULL');
      await pool.request().query(`
        ALTER TABLE todos ALTER COLUMN [order] INT NOT NULL
      `);
      console.log('  ✅ Column order set to NOT NULL');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    console.log('✅ todos table processed\n');

    // ========== TABLE: approvals ==========
    console.log('📋 Processing approvals table...');

    // Add 'tool_name' column
    try {
      console.log('  Adding column: tool_name');
      await pool.request().query(`
        ALTER TABLE approvals ADD tool_name NVARCHAR(100) NULL
      `);
      console.log('  ✅ Column tool_name added');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message?.includes('already exists')) {
        console.log('  ℹ️  Column tool_name already exists');
      } else {
        console.error('  ❌ Error adding tool_name:', err.message);
      }
    }

    // Copy data
    try {
      console.log('  Copying data from action_type to tool_name');
      await pool.request().query(`
        UPDATE approvals SET tool_name = action_type WHERE tool_name IS NULL
      `);
      console.log('  ✅ Data copied');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    // Make NOT NULL
    try {
      console.log('  Setting tool_name to NOT NULL');
      await pool.request().query(`
        ALTER TABLE approvals ALTER COLUMN tool_name NVARCHAR(100) NOT NULL
      `);
      console.log('  ✅ Column tool_name set to NOT NULL');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    // Add 'tool_args' column
    try {
      console.log('  Adding column: tool_args');
      await pool.request().query(`
        ALTER TABLE approvals ADD tool_args NVARCHAR(MAX) NULL
      `);
      console.log('  ✅ Column tool_args added');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message?.includes('already exists')) {
        console.log('  ℹ️  Column tool_args already exists');
      } else {
        console.error('  ❌ Error adding tool_args:', err.message);
      }
    }

    // Copy data
    try {
      console.log('  Copying data from action_data to tool_args');
      await pool.request().query(`
        UPDATE approvals SET tool_args = action_data WHERE tool_args IS NULL
      `);
      console.log('  ✅ Data copied');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    // Add 'expires_at' column
    try {
      console.log('  Adding column: expires_at');
      await pool.request().query(`
        ALTER TABLE approvals ADD expires_at DATETIME2(7) NULL
      `);
      console.log('  ✅ Column expires_at added');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message?.includes('already exists')) {
        console.log('  ℹ️  Column expires_at already exists');
      } else {
        console.error('  ❌ Error adding expires_at:', err.message);
      }
    }

    // Set default expiration
    try {
      console.log('  Setting default expires_at values');
      await pool.request().query(`
        UPDATE approvals
        SET expires_at = DATEADD(MINUTE, 30, created_at)
        WHERE expires_at IS NULL
      `);
      console.log('  ✅ Default values set');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    console.log('✅ approvals table processed\n');

    // ========== TABLE: audit_log ==========
    console.log('📋 Processing audit_log table...');

    // Add 'event_type' column
    try {
      console.log('  Adding column: event_type');
      await pool.request().query(`
        ALTER TABLE audit_log ADD event_type NVARCHAR(100) NULL
      `);
      console.log('  ✅ Column event_type added');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message?.includes('already exists')) {
        console.log('  ℹ️  Column event_type already exists');
      } else {
        console.error('  ❌ Error adding event_type:', err.message);
      }
    }

    // Copy data
    try {
      console.log('  Copying data from action to event_type');
      await pool.request().query(`
        UPDATE audit_log SET event_type = action WHERE event_type IS NULL
      `);
      console.log('  ✅ Data copied');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    // Make NOT NULL
    try {
      console.log('  Setting event_type to NOT NULL');
      await pool.request().query(`
        ALTER TABLE audit_log ALTER COLUMN event_type NVARCHAR(100) NOT NULL
      `);
      console.log('  ✅ Column event_type set to NOT NULL');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    // Add 'event_data' column
    try {
      console.log('  Adding column: event_data');
      await pool.request().query(`
        ALTER TABLE audit_log ADD event_data NVARCHAR(MAX) NULL
      `);
      console.log('  ✅ Column event_data added');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message?.includes('already exists')) {
        console.log('  ℹ️  Column event_data already exists');
      } else {
        console.error('  ❌ Error adding event_data:', err.message);
      }
    }

    // Copy data
    try {
      console.log('  Copying data from details to event_data');
      await pool.request().query(`
        UPDATE audit_log SET event_data = details WHERE event_data IS NULL
      `);
      console.log('  ✅ Data copied');
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('  ❌ Error:', err.message);
    }

    console.log('✅ audit_log table processed\n');

    console.log('✅ All columns added successfully!');
    console.log('\n📝 Next: Restart backend server and re-run tests');

  } catch (error) {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
    console.log('\n📦 Database connection closed');
  }
}

addMissingColumns();
