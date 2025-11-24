/**
 * Migration 002: Use Anthropic Message IDs as Primary Key
 *
 * Date: 2025-11-24
 * Phase: 1B
 *
 * Description:
 * Migrates messages.id from UNIQUEIDENTIFIER (UUID) to NVARCHAR(255) to use
 * Anthropic's native message IDs (format: msg_01ABC...) as the primary key.
 *
 * Benefits:
 * - Direct correlation with Anthropic Console for debugging
 * - Simplified architecture (one ID system instead of two)
 * - Eliminates redundant anthropic_message_id column
 * - Enables audit trail from user → database → Anthropic logs
 *
 * Breaking Changes:
 * - messages.id type changes from UNIQUEIDENTIFIER to NVARCHAR(255)
 * - Foreign keys referencing messages.id must be updated
 * - Application code must pass Anthropic IDs instead of generating UUIDs
 *
 * Rollback:
 * See 002-rollback.sql for reversing this migration
 */

BEGIN TRANSACTION;

PRINT '=== Migration 002: Use Anthropic Message IDs ===';
PRINT 'Step 1: Verify current schema...';

-- Verify messages table exists
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'messages')
BEGIN
    PRINT 'ERROR: messages table does not exist!';
    ROLLBACK TRANSACTION;
    RETURN;
END

-- Verify messages.id is currently UNIQUEIDENTIFIER
IF NOT EXISTS (
    SELECT * FROM sys.columns c
    INNER JOIN sys.types t ON c.system_type_id = t.system_type_id
    WHERE c.object_id = OBJECT_ID('messages')
      AND c.name = 'id'
      AND t.name = 'uniqueidentifier'
)
BEGIN
    PRINT 'WARNING: messages.id is not UNIQUEIDENTIFIER. May have been migrated already.';
    -- Continue anyway (idempotent)
END

PRINT 'Step 2: Create temporary backup column...';

-- Add temporary column to preserve data during type change
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('messages') AND name = 'id_backup')
BEGIN
    ALTER TABLE messages ADD id_backup UNIQUEIDENTIFIER NULL;
    PRINT '  ✓ Created id_backup column';
END
ELSE
BEGIN
    PRINT '  ⚠ id_backup column already exists (idempotent)';
END

PRINT 'Step 3: Backup existing message IDs...';

-- Copy existing IDs to backup column
UPDATE messages
SET id_backup = CAST(id AS UNIQUEIDENTIFIER)
WHERE id_backup IS NULL;

DECLARE @BackupCount INT = (SELECT COUNT(*) FROM messages WHERE id_backup IS NOT NULL);
PRINT '  ✓ Backed up ' + CAST(@BackupCount AS NVARCHAR(10)) + ' message IDs';

PRINT 'Step 4: Identify and drop foreign key constraints...';

-- Find all foreign keys referencing messages.id
DECLARE @FK_Name NVARCHAR(255);
DECLARE @FK_Table NVARCHAR(255);
DECLARE @FK_Column NVARCHAR(255);
DECLARE @SQL NVARCHAR(MAX);

DECLARE fk_cursor CURSOR FOR
SELECT
    fk.name AS FK_Name,
    OBJECT_NAME(fk.parent_object_id) AS FK_Table,
    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS FK_Column
FROM sys.foreign_keys AS fk
INNER JOIN sys.foreign_key_columns AS fkc
    ON fk.object_id = fkc.constraint_object_id
WHERE fk.referenced_object_id = OBJECT_ID('messages')
  AND COL_NAME(fk.referenced_object_id, fkc.referenced_column_id) = 'id';

-- Store FK info for recreation
IF OBJECT_ID('tempdb..#FK_Backup') IS NOT NULL DROP TABLE #FK_Backup;
CREATE TABLE #FK_Backup (
    FK_Name NVARCHAR(255),
    FK_Table NVARCHAR(255),
    FK_Column NVARCHAR(255),
    FK_Definition NVARCHAR(MAX)
);

OPEN fk_cursor;
FETCH NEXT FROM fk_cursor INTO @FK_Name, @FK_Table, @FK_Column;

WHILE @@FETCH_STATUS = 0
BEGIN
    PRINT '  Found FK: ' + @FK_Name + ' (' + @FK_Table + '.' + @FK_Column + ')';

    -- Store FK definition
    INSERT INTO #FK_Backup (FK_Name, FK_Table, FK_Column, FK_Definition)
    VALUES (
        @FK_Name,
        @FK_Table,
        @FK_Column,
        'ALTER TABLE ' + @FK_Table + ' ADD CONSTRAINT ' + @FK_Name +
        ' FOREIGN KEY (' + @FK_Column + ') REFERENCES messages(id)'
    );

    -- Drop FK
    SET @SQL = 'ALTER TABLE ' + @FK_Table + ' DROP CONSTRAINT ' + @FK_Name;
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Dropped FK: ' + @FK_Name;

    FETCH NEXT FROM fk_cursor INTO @FK_Name, @FK_Table, @FK_Column;
END

CLOSE fk_cursor;
DEALLOCATE fk_cursor;

PRINT 'Step 5: Drop existing primary key constraint...';

-- Drop PK constraint on messages.id
DECLARE @PK_Name NVARCHAR(255);
SELECT @PK_Name = name
FROM sys.key_constraints
WHERE type = 'PK'
  AND parent_object_id = OBJECT_ID('messages');

IF @PK_Name IS NOT NULL
BEGIN
    SET @SQL = 'ALTER TABLE messages DROP CONSTRAINT ' + @PK_Name;
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Dropped PK: ' + @PK_Name;
END
ELSE
BEGIN
    PRINT '  ⚠ No PK found on messages table';
END

PRINT 'Step 6: Change id column type to NVARCHAR(255)...';

-- Alter column type (data is preserved in id_backup)
-- Note: This will fail if there are still FKs or PKs (which we just dropped)
ALTER TABLE messages ALTER COLUMN id NVARCHAR(255) NOT NULL;
PRINT '  ✓ Changed messages.id to NVARCHAR(255)';

PRINT 'Step 7: Restore data from backup...';

-- Convert UUIDs to string format for existing data
-- NOTE: This converts UUIDs to lowercase string format (8-4-4-4-12)
-- New Anthropic IDs will be in format msg_01ABC... (added by application)
UPDATE messages
SET id = LOWER(CAST(id_backup AS NVARCHAR(255)))
WHERE id_backup IS NOT NULL;

DECLARE @RestoreCount INT = (SELECT COUNT(*) FROM messages WHERE LEN(id) = 36);
PRINT '  ✓ Restored ' + CAST(@RestoreCount AS NVARCHAR(10)) + ' message IDs (UUID format)';

PRINT 'Step 8: Recreate primary key constraint...';

-- Add PK back with new column type
ALTER TABLE messages ADD CONSTRAINT PK_messages PRIMARY KEY CLUSTERED (id);
PRINT '  ✓ Recreated PK: PK_messages';

PRINT 'Step 9: Update foreign key referencing columns to NVARCHAR...';

-- Update FK columns in referencing tables to match new type
-- Example: approvals.message_id must also be NVARCHAR(255)
DECLARE @RefTable NVARCHAR(255);
DECLARE @RefColumn NVARCHAR(255);

DECLARE ref_cursor CURSOR FOR
SELECT DISTINCT FK_Table, FK_Column FROM #FK_Backup;

OPEN ref_cursor;
FETCH NEXT FROM ref_cursor INTO @RefTable, @RefColumn;

WHILE @@FETCH_STATUS = 0
BEGIN
    PRINT '  Updating ' + @RefTable + '.' + @RefColumn + ' to NVARCHAR(255)...';

    -- Check current type
    DECLARE @CurrentType NVARCHAR(50);
    SELECT @CurrentType = t.name
    FROM sys.columns c
    INNER JOIN sys.types t ON c.system_type_id = t.system_type_id
    WHERE c.object_id = OBJECT_ID(@RefTable)
      AND c.name = @RefColumn;

    IF @CurrentType = 'uniqueidentifier'
    BEGIN
        SET @SQL = 'ALTER TABLE ' + @RefTable + ' ALTER COLUMN ' + @RefColumn + ' NVARCHAR(255) NULL';
        EXEC sp_executesql @SQL;
        PRINT '    ✓ Updated ' + @RefTable + '.' + @RefColumn;
    END
    ELSE
    BEGIN
        PRINT '    ⚠ ' + @RefTable + '.' + @RefColumn + ' already NVARCHAR (idempotent)';
    END

    FETCH NEXT FROM ref_cursor INTO @RefTable, @RefColumn;
END

CLOSE ref_cursor;
DEALLOCATE ref_cursor;

PRINT 'Step 10: Recreate foreign key constraints...';

-- Recreate FKs with new column types
DECLARE @FK_Definition NVARCHAR(MAX);

DECLARE fk_recreate_cursor CURSOR FOR
SELECT FK_Definition FROM #FK_Backup;

OPEN fk_recreate_cursor;
FETCH NEXT FROM fk_recreate_cursor INTO @FK_Definition;

WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC sp_executesql @FK_Definition;
    PRINT '  ✓ Recreated FK: ' + @FK_Definition;

    FETCH NEXT FROM fk_recreate_cursor INTO @FK_Definition;
END

CLOSE fk_recreate_cursor;
DEALLOCATE fk_recreate_cursor;

PRINT 'Step 11: Drop temporary backup column...';

-- Drop backup column (data is now in messages.id with new type)
ALTER TABLE messages DROP COLUMN id_backup;
PRINT '  ✓ Dropped id_backup column';

-- Clean up temp table
DROP TABLE #FK_Backup;

PRINT 'Step 12: Verify migration...';

-- Verify final schema
DECLARE @FinalType NVARCHAR(50);
DECLARE @FinalMaxLength INT;

SELECT
    @FinalType = t.name,
    @FinalMaxLength = c.max_length
FROM sys.columns c
INNER JOIN sys.types t ON c.system_type_id = t.system_type_id
WHERE c.object_id = OBJECT_ID('messages')
  AND c.name = 'id';

IF @FinalType = 'nvarchar' AND @FinalMaxLength >= 510 -- (255 * 2 bytes for nvarchar)
BEGIN
    PRINT '  ✓ Verification passed: messages.id is NVARCHAR(255)';
END
ELSE
BEGIN
    PRINT '  ✗ Verification FAILED: messages.id type is ' + @FinalType;
    ROLLBACK TRANSACTION;
    RETURN;
END

-- Verify PK exists
IF EXISTS (
    SELECT * FROM sys.key_constraints
    WHERE type = 'PK'
      AND parent_object_id = OBJECT_ID('messages')
      AND name = 'PK_messages'
)
BEGIN
    PRINT '  ✓ Verification passed: PK_messages exists';
END
ELSE
BEGIN
    PRINT '  ✗ Verification FAILED: PK_messages not found';
    ROLLBACK TRANSACTION;
    RETURN;
END

-- Count messages
DECLARE @TotalMessages INT = (SELECT COUNT(*) FROM messages);
PRINT '  ℹ Total messages in table: ' + CAST(@TotalMessages AS NVARCHAR(10));

COMMIT TRANSACTION;

PRINT '';
PRINT '=== Migration 002 COMPLETED SUCCESSFULLY ===';
PRINT '';
PRINT 'Summary:';
PRINT '  - messages.id type changed: UNIQUEIDENTIFIER → NVARCHAR(255)';
PRINT '  - Primary key recreated: PK_messages';
PRINT '  - Foreign keys updated and recreated';
PRINT '  - Existing data preserved (UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)';
PRINT '  - Ready for Anthropic message IDs (format: msg_01ABC...)';
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Deploy backend code changes (DirectAgentService, MessageService)';
PRINT '  2. Verify new messages use Anthropic ID format in logs';
PRINT '  3. Monitor query performance';
PRINT '  4. Update documentation';
PRINT '';
PRINT 'Rollback: Execute 002-rollback.sql if issues occur';
PRINT '==========================================';
