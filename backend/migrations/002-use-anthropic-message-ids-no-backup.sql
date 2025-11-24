/**
 * Migration 002: Use Anthropic Message IDs (Simplified - No Backup)
 *
 * Date: 2025-11-24
 * Phase: 1B
 *
 * Description:
 * Changes messages.id from UNIQUEIDENTIFIER (UUID) to NVARCHAR(255)
 * to support Anthropic's native message ID format (msg_01...).
 *
 * ⚠️ WARNING: NO BACKUP
 * - This version does not create backup columns
 * - Existing messages will be preserved during type conversion
 * - Safe for test/development environments
 */

-- Required for Azure SQL DDL operations
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

BEGIN TRANSACTION;

PRINT '=== Migration 002: Use Anthropic Message IDs ===';
PRINT '';

PRINT 'Step 1: Verify current schema...';

-- Check current type
DECLARE @CurrentType NVARCHAR(50);
SELECT @CurrentType = t.name
FROM sys.columns c
INNER JOIN sys.types t ON c.system_type_id = t.system_type_id
WHERE c.object_id = OBJECT_ID('messages')
  AND c.name = 'id';

PRINT '  Current type: ' + @CurrentType;

IF @CurrentType = 'nvarchar'
BEGIN
    PRINT '  ⚠ messages.id is already NVARCHAR (migration already applied)';
    PRINT '  Nothing to do. Aborting.';
    COMMIT TRANSACTION;
    RETURN;
END

IF @CurrentType != 'uniqueidentifier'
BEGIN
    PRINT '  ⚠ Unexpected type: ' + @CurrentType;
    PRINT '  Expected UNIQUEIDENTIFIER or NVARCHAR';
    ROLLBACK TRANSACTION;
    RETURN;
END

PRINT 'Step 2: Drop foreign key constraints...';

-- Find and drop FKs
DECLARE @FK_Name NVARCHAR(255);
DECLARE @FK_Table NVARCHAR(255);
DECLARE @FK_Column NVARCHAR(255);
DECLARE @SQL NVARCHAR(MAX);

-- Create temp table to store FK definitions
IF OBJECT_ID('tempdb..#FK_Backup') IS NOT NULL DROP TABLE #FK_Backup;
CREATE TABLE #FK_Backup (
    FK_Name NVARCHAR(255),
    FK_Table NVARCHAR(255),
    FK_Column NVARCHAR(255)
);

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

OPEN fk_cursor;
FETCH NEXT FROM fk_cursor INTO @FK_Name, @FK_Table, @FK_Column;

WHILE @@FETCH_STATUS = 0
BEGIN
    -- Store FK definition
    INSERT INTO #FK_Backup VALUES (@FK_Name, @FK_Table, @FK_Column);

    -- Drop FK
    SET @SQL = 'ALTER TABLE ' + @FK_Table + ' DROP CONSTRAINT ' + @FK_Name;
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Dropped FK: ' + @FK_Name;

    FETCH NEXT FROM fk_cursor INTO @FK_Name, @FK_Table, @FK_Column;
END

CLOSE fk_cursor;
DEALLOCATE fk_cursor;

PRINT 'Step 3: Drop primary key...';

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

PRINT 'Step 4: Drop default constraint on id column...';

DECLARE @DF_Name NVARCHAR(255);
SELECT @DF_Name = dc.name
FROM sys.default_constraints dc
INNER JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE c.object_id = OBJECT_ID('messages') AND c.name = 'id';

IF @DF_Name IS NOT NULL
BEGIN
    SET @SQL = 'ALTER TABLE messages DROP CONSTRAINT ' + @DF_Name;
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Dropped DEFAULT constraint: ' + @DF_Name;
END
ELSE
BEGIN
    PRINT '  ℹ No DEFAULT constraint on id column';
END

PRINT 'Step 5: Change id column type...';

-- Alter column type
ALTER TABLE messages ALTER COLUMN id NVARCHAR(255) NOT NULL;
PRINT '  ✓ Changed messages.id to NVARCHAR(255)';

-- Note: SQL Server automatically converts UNIQUEIDENTIFIER values to string format
-- Existing UUIDs like '123e4567-e89b-12d3-a456-426614174000' remain in the column

PRINT 'Step 6: Recreate primary key...';

ALTER TABLE messages ADD CONSTRAINT PK_messages PRIMARY KEY CLUSTERED (id);
PRINT '  ✓ Recreated PK: PK_messages';

PRINT 'Step 7: Update foreign key columns...';

DECLARE @RefTable NVARCHAR(255);
DECLARE @RefColumn NVARCHAR(255);

DECLARE ref_cursor CURSOR FOR
SELECT DISTINCT FK_Table, FK_Column FROM #FK_Backup;

OPEN ref_cursor;
FETCH NEXT FROM ref_cursor INTO @RefTable, @RefColumn;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @SQL = 'ALTER TABLE ' + @RefTable + ' ALTER COLUMN ' + @RefColumn + ' NVARCHAR(255) NULL';
    EXEC sp_executesql @SQL;
    PRINT '  ✓ Updated ' + @RefTable + '.' + @RefColumn + ' to NVARCHAR(255)';

    FETCH NEXT FROM ref_cursor INTO @RefTable, @RefColumn;
END

CLOSE ref_cursor;
DEALLOCATE ref_cursor;

PRINT 'Step 8: Recreate foreign key constraints...';

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

DROP TABLE #FK_Backup;

PRINT 'Step 9: Verify migration...';

-- Verify final type (check user_type_id for proper type name)
SELECT @CurrentType = t.name
FROM sys.columns c
INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID('messages')
  AND c.name = 'id';

IF @CurrentType = 'nvarchar'
BEGIN
    PRINT '  ✓ Verification passed: messages.id is NVARCHAR';
END
ELSE
BEGIN
    PRINT '  ✗ Verification FAILED: messages.id is ' + @CurrentType;
    ROLLBACK TRANSACTION;
    RETURN;
END

-- Count existing messages
DECLARE @MessageCount INT = (SELECT COUNT(*) FROM messages);
PRINT '  ℹ Total messages: ' + CAST(@MessageCount AS NVARCHAR(10));

COMMIT TRANSACTION;

PRINT '';
PRINT '=== Migration 002 COMPLETED ===';
PRINT '';
PRINT 'Summary:';
PRINT '  - messages.id type changed: UNIQUEIDENTIFIER → NVARCHAR(255)';
PRINT '  - Primary key recreated: PK_messages';
PRINT '  - Foreign keys recreated';
PRINT '  - Existing messages preserved: ' + CAST(@MessageCount AS NVARCHAR(10));
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Verify application code uses Anthropic message IDs';
PRINT '  2. Run tests to ensure compatibility';
PRINT '  3. Deploy backend changes';
PRINT '';
PRINT '==========================================';
