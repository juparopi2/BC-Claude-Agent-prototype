/**
 * Migration 002 ROLLBACK: Revert to UUID Message IDs
 *
 * Date: 2025-11-24
 * Phase: 1B
 *
 * Description:
 * Reverts messages.id from NVARCHAR(255) back to UNIQUEIDENTIFIER (UUID).
 *
 * ⚠️ WARNING: DATA LOSS RISK
 * - Any messages created with Anthropic IDs (msg_01...) CANNOT be converted back to UUIDs
 * - Only messages with existing UUID format (xxxxxxxx-xxxx-...) will be preserved
 * - This rollback should ONLY be used if migration failed during testing
 * - DO NOT use in production if new Anthropic-format messages exist
 *
 * Use Cases:
 * - Migration failed during execution → Safe to rollback
 * - Migration completed but bugs found in code → Review data first
 * - Need to revert architecture decision → Plan data migration strategy
 */

BEGIN TRANSACTION;

PRINT '=== Migration 002 ROLLBACK: Revert to UUID ===';
PRINT '⚠️ WARNING: This will lose messages with Anthropic ID format';
PRINT '';

PRINT 'Step 1: Verify current schema...';

-- Verify messages.id is NVARCHAR
DECLARE @CurrentType NVARCHAR(50);
SELECT @CurrentType = t.name
FROM sys.columns c
INNER JOIN sys.types t ON c.system_type_id = t.system_type_id
WHERE c.object_id = OBJECT_ID('messages')
  AND c.name = 'id';

IF @CurrentType != 'nvarchar'
BEGIN
    PRINT '  ⚠ messages.id is already ' + @CurrentType + ' (not NVARCHAR)';
    PRINT '  Nothing to rollback. Aborting.';
    ROLLBACK TRANSACTION;
    RETURN;
END

PRINT '  ✓ Current type: NVARCHAR';

PRINT 'Step 2: Analyze data before rollback...';

-- Count total messages
DECLARE @TotalMessages INT = (SELECT COUNT(*) FROM messages);
PRINT '  Total messages: ' + CAST(@TotalMessages AS NVARCHAR(10));

-- Count UUID-format messages (can be preserved)
DECLARE @UuidMessages INT = (
    SELECT COUNT(*)
    FROM messages
    WHERE id LIKE '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]%'
       OR TRY_CAST(id AS UNIQUEIDENTIFIER) IS NOT NULL
);
PRINT '  UUID-format messages (will be preserved): ' + CAST(@UuidMessages AS NVARCHAR(10));

-- Count Anthropic-format messages (will be LOST)
DECLARE @AnthropicMessages INT = (
    SELECT COUNT(*)
    FROM messages
    WHERE id LIKE 'msg_%'
);
PRINT '  Anthropic-format messages (WILL BE LOST): ' + CAST(@AnthropicMessages AS NVARCHAR(10));

-- Abort if Anthropic messages exist (safety check)
IF @AnthropicMessages > 0
BEGIN
    PRINT '';
    PRINT '  ✗ ERROR: Found ' + CAST(@AnthropicMessages AS NVARCHAR(10)) + ' messages with Anthropic IDs!';
    PRINT '  Rollback would LOSE these messages.';
    PRINT '';
    PRINT '  Options:';
    PRINT '    1. Keep migration 002 (recommended if code works)';
    PRINT '    2. Manually migrate Anthropic IDs to UUIDs before rollback';
    PRINT '    3. Accept data loss and force rollback (set @Force = 1 below)';
    PRINT '';

    -- Safety switch (set to 1 to force rollback despite data loss)
    DECLARE @Force BIT = 0;

    IF @Force = 0
    BEGIN
        PRINT '  Aborting rollback to prevent data loss.';
        ROLLBACK TRANSACTION;
        RETURN;
    END
    ELSE
    BEGIN
        PRINT '  ⚠️ FORCE MODE: Proceeding with rollback (data loss accepted)';
    END
END

PRINT 'Step 3: Create temporary backup column...';

-- Add backup column for NVARCHAR IDs
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('messages') AND name = 'id_nvarchar_backup')
BEGIN
    ALTER TABLE messages ADD id_nvarchar_backup NVARCHAR(255) NULL;
    PRINT '  ✓ Created id_nvarchar_backup column';
END

-- Copy current IDs
UPDATE messages SET id_nvarchar_backup = id WHERE id_nvarchar_backup IS NULL;

PRINT 'Step 4: Drop foreign key constraints...';

-- Find and drop FKs
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

IF OBJECT_ID('tempdb..#FK_Backup') IS NOT NULL DROP TABLE #FK_Backup;
CREATE TABLE #FK_Backup (
    FK_Name NVARCHAR(255),
    FK_Table NVARCHAR(255),
    FK_Column NVARCHAR(255)
);

OPEN fk_cursor;
FETCH NEXT FROM fk_cursor INTO @FK_Name, @FK_Table, @FK_Column;

WHILE @@FETCH_STATUS = 0
BEGIN
    INSERT INTO #FK_Backup VALUES (@FK_Name, @FK_Table, @FK_Column);

    SET @SQL = 'ALTER TABLE ' + @FK_Table + ' DROP CONSTRAINT ' + @FK_Name;
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Dropped FK: ' + @FK_Name;

    FETCH NEXT FROM fk_cursor INTO @FK_Name, @FK_Table, @FK_Column;
END

CLOSE fk_cursor;
DEALLOCATE fk_cursor;

PRINT 'Step 5: Drop primary key...';

DECLARE @PK_Name NVARCHAR(255);
SELECT @PK_Name = name
FROM sys.key_constraints
WHERE type = 'PK' AND parent_object_id = OBJECT_ID('messages');

IF @PK_Name IS NOT NULL
BEGIN
    SET @SQL = 'ALTER TABLE messages DROP CONSTRAINT ' + @PK_Name;
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Dropped PK: ' + @PK_Name;
END

PRINT 'Step 6: Delete messages that cannot be converted to UUID...';

-- Delete Anthropic-format messages (cannot convert to UUID)
DELETE FROM messages WHERE id LIKE 'msg_%';

DECLARE @DeletedCount INT = @@ROWCOUNT;
IF @DeletedCount > 0
BEGIN
    PRINT '  ⚠️ Deleted ' + CAST(@DeletedCount AS NVARCHAR(10)) + ' messages with Anthropic IDs';
END

PRINT 'Step 7: Change id column type back to UNIQUEIDENTIFIER...';

-- Alter column back to UUID type
ALTER TABLE messages ALTER COLUMN id UNIQUEIDENTIFIER NOT NULL;
PRINT '  ✓ Changed messages.id to UNIQUEIDENTIFIER';

PRINT 'Step 8: Convert string UUIDs to UNIQUEIDENTIFIER format...';

-- Convert UUID strings back to proper UUID type
-- (SQL Server will handle the conversion automatically)
UPDATE messages
SET id = CAST(id_nvarchar_backup AS UNIQUEIDENTIFIER)
WHERE TRY_CAST(id_nvarchar_backup AS UNIQUEIDENTIFIER) IS NOT NULL;

DECLARE @ConvertedCount INT = @@ROWCOUNT;
PRINT '  ✓ Converted ' + CAST(@ConvertedCount AS NVARCHAR(10)) + ' IDs back to UUID format';

PRINT 'Step 9: Recreate primary key...';

ALTER TABLE messages ADD CONSTRAINT PK_messages PRIMARY KEY CLUSTERED (id);
PRINT '  ✓ Recreated PK: PK_messages';

PRINT 'Step 10: Update foreign key columns back to UNIQUEIDENTIFIER...';

DECLARE @RefTable NVARCHAR(255);
DECLARE @RefColumn NVARCHAR(255);

DECLARE ref_cursor CURSOR FOR
SELECT DISTINCT FK_Table, FK_Column FROM #FK_Backup;

OPEN ref_cursor;
FETCH NEXT FROM ref_cursor INTO @RefTable, @RefColumn;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @SQL = 'ALTER TABLE ' + @RefTable + ' ALTER COLUMN ' + @RefColumn + ' UNIQUEIDENTIFIER NULL';
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Updated ' + @RefTable + '.' + @RefColumn + ' to UNIQUEIDENTIFIER';

    FETCH NEXT FROM ref_cursor INTO @RefTable, @RefColumn;
END

CLOSE ref_cursor;
DEALLOCATE ref_cursor;

PRINT 'Step 11: Recreate foreign key constraints...';

DECLARE fk_recreate_cursor CURSOR FOR
SELECT FK_Name, FK_Table, FK_Column FROM #FK_Backup;

OPEN fk_recreate_cursor;
FETCH NEXT FROM fk_recreate_cursor INTO @FK_Name, @FK_Table, @FK_Column;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @SQL = 'ALTER TABLE ' + @FK_Table + ' ADD CONSTRAINT ' + @FK_Name +
               ' FOREIGN KEY (' + @FK_Column + ') REFERENCES messages(id)';
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Recreated FK: ' + @FK_Name;

    FETCH NEXT FROM fk_recreate_cursor INTO @FK_Name, @FK_Table, @FK_Column;
END

CLOSE fk_recreate_cursor;
DEALLOCATE fk_recreate_cursor;

PRINT 'Step 12: Drop backup column...';

ALTER TABLE messages DROP COLUMN id_nvarchar_backup;
PRINT '  ✓ Dropped id_nvarchar_backup column';

DROP TABLE #FK_Backup;

PRINT 'Step 13: Verify rollback...';

-- Verify final type
SELECT @CurrentType = t.name
FROM sys.columns c
INNER JOIN sys.types t ON c.system_type_id = t.system_type_id
WHERE c.object_id = OBJECT_ID('messages')
  AND c.name = 'id';

IF @CurrentType = 'uniqueidentifier'
BEGIN
    PRINT '  ✓ Verification passed: messages.id is UNIQUEIDENTIFIER';
END
ELSE
BEGIN
    PRINT '  ✗ Verification FAILED: messages.id is ' + @CurrentType;
    ROLLBACK TRANSACTION;
    RETURN;
END

-- Count remaining messages
DECLARE @RemainingMessages INT = (SELECT COUNT(*) FROM messages);
PRINT '  ℹ Remaining messages: ' + CAST(@RemainingMessages AS NVARCHAR(10));

COMMIT TRANSACTION;

PRINT '';
PRINT '=== Migration 002 ROLLBACK COMPLETED ===';
PRINT '';
PRINT 'Summary:';
PRINT '  - messages.id type reverted: NVARCHAR(255) → UNIQUEIDENTIFIER';
PRINT '  - Primary key recreated: PK_messages';
PRINT '  - Foreign keys recreated';
PRINT '  - Messages preserved: ' + CAST(@RemainingMessages AS NVARCHAR(10)) + ' / ' + CAST(@TotalMessages AS NVARCHAR(10));
IF @DeletedCount > 0
BEGIN
    PRINT '  - Messages LOST: ' + CAST(@DeletedCount AS NVARCHAR(10)) + ' (Anthropic ID format)';
END
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Revert backend code changes';
PRINT '  2. Deploy previous version';
PRINT '  3. Verify application functionality';
PRINT '';
PRINT '==========================================';
