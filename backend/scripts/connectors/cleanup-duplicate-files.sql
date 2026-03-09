-- ============================================================
-- One-Time Cleanup: Deduplicate files Before Adding Unique Constraint
-- ============================================================
-- Purpose: Remove duplicate rows in the files table that share the
--          same (connection_id, external_id) pair, keeping the
--          newest record per group. Then add a unique constraint
--          to replace the existing regular index.
--
-- Context: IX_files_connection_external is a non-unique index.
--          Re-syncing external integrations (OneDrive, SharePoint)
--          may have inserted duplicates. This script cleans them up
--          so that UQ_files_connection_external can be created safely.
--
-- IMPORTANT: Run this script BEFORE applying the Prisma schema change
--            that adds @@unique([connection_id, external_id]).
--
-- Safe to run multiple times (idempotent after first run).
-- Always review the preview output in Section 1 before proceeding.
--
-- Azure SQL / SQL Server syntax.
-- ============================================================

-- ============================================================
-- SECTION 1: Preview Duplicates
-- ============================================================
-- Shows every (connection_id, external_id) group that has more
-- than one row. Review this output before proceeding.
-- Rows with connection_id IS NULL are excluded — a NULL connection_id
-- means a locally uploaded file (source_type = 'local') and NULL
-- does not participate in uniqueness checks.
-- ============================================================

PRINT '=== SECTION 1: Duplicate groups (preview) ===';

SELECT
    connection_id,
    external_id,
    COUNT(*)           AS duplicate_count,
    MIN(created_at)    AS oldest_created_at,
    MAX(created_at)    AS newest_created_at,
    MIN(id)            AS sample_id_oldest,
    MAX(id)            AS sample_id_newest
FROM files
WHERE
    connection_id IS NOT NULL
    AND external_id IS NOT NULL
GROUP BY
    connection_id,
    external_id
HAVING
    COUNT(*) > 1
ORDER BY
    duplicate_count DESC,
    connection_id,
    external_id;

-- Summary: how many groups and how many excess rows need deletion
SELECT
    COUNT(*)             AS duplicate_groups,
    SUM(group_count - 1) AS rows_to_delete
FROM (
    SELECT COUNT(*) AS group_count
    FROM files
    WHERE
        connection_id IS NOT NULL
        AND external_id IS NOT NULL
    GROUP BY
        connection_id,
        external_id
    HAVING
        COUNT(*) > 1
) AS dup_groups;

-- ============================================================
-- SECTION 2: Delete Duplicates — Keep Newest per Group
-- ============================================================
-- For each (connection_id, external_id) group, the row with the
-- latest created_at is kept. When created_at is equal, the row
-- with the lexicographically greatest id (GUID) is kept as a
-- deterministic tiebreaker.
--
-- The file_chunks FK is ON DELETE CASCADE, so child chunks for
-- the deleted file rows are automatically removed by the DB engine.
--
-- Wrapped in a transaction so the deletion can be rolled back if
-- something unexpected is observed in the row count.
-- ============================================================

PRINT '';
PRINT '=== SECTION 2: Deleting duplicate files (keeping newest) ===';

BEGIN TRANSACTION;

-- Identify the single "winner" id for each duplicate group.
-- ROW_NUMBER() = 1 is the row to KEEP; all others are deleted.
WITH RankedDuplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY connection_id, external_id
            ORDER BY
                created_at DESC,   -- newest first
                id         DESC    -- tiebreaker: highest GUID string
        ) AS rn
    FROM files
    WHERE
        connection_id IS NOT NULL
        AND external_id IS NOT NULL
)
DELETE FROM files
WHERE id IN (
    SELECT id
    FROM RankedDuplicates
    WHERE rn > 1   -- every row except the winner
);

-- Report how many rows were removed
PRINT CONCAT('Rows deleted: ', CAST(@@ROWCOUNT AS NVARCHAR(20)));

-- Verify no duplicate groups remain before committing
DECLARE @remaining_duplicates INT;

SELECT @remaining_duplicates = COUNT(*)
FROM (
    SELECT connection_id, external_id
    FROM files
    WHERE
        connection_id IS NOT NULL
        AND external_id IS NOT NULL
    GROUP BY
        connection_id,
        external_id
    HAVING
        COUNT(*) > 1
) AS still_duped;

IF @remaining_duplicates > 0
BEGIN
    PRINT CONCAT('ERROR: ', CAST(@remaining_duplicates AS NVARCHAR(20)),
                 ' duplicate group(s) still exist. Rolling back.');
    ROLLBACK TRANSACTION;
    RAISERROR('Duplicate removal incomplete — transaction rolled back.', 16, 1);
    RETURN;
END

PRINT 'No duplicates remain. Committing deletion.';
COMMIT TRANSACTION;

-- ============================================================
-- SECTION 3: Clean Orphaned file_chunks
-- ============================================================
-- The FK on file_chunks.file_id has ON DELETE CASCADE, meaning
-- child chunks are automatically deleted when a parent file row
-- is deleted (handled in Section 2 above).
--
-- This section is a belt-and-suspenders check for any chunks
-- whose parent file_id does not exist in the files table at all
-- — for example, chunks left behind by a previous partial manual
-- cleanup that bypassed FK enforcement, or rows inserted by a
-- script that did not respect referential integrity.
-- ============================================================

PRINT '';
PRINT '=== SECTION 3: Cleaning orphaned file_chunks ===';

-- Preview orphans before deletion
SELECT COUNT(*) AS orphaned_chunk_count
FROM file_chunks fc
WHERE NOT EXISTS (
    SELECT 1
    FROM files f
    WHERE f.id = fc.file_id
);

-- Delete true orphans (FK CASCADE should have already handled most)
DELETE FROM file_chunks
WHERE NOT EXISTS (
    SELECT 1
    FROM files f
    WHERE f.id = file_chunks.file_id
);

PRINT CONCAT('Orphaned chunks deleted: ', CAST(@@ROWCOUNT AS NVARCHAR(20)));

-- ============================================================
-- SECTION 4: Verify — Confirm Zero Duplicates Remain
-- ============================================================

PRINT '';
PRINT '=== SECTION 4: Verification ===';

DECLARE @dup_count INT;

SELECT @dup_count = COUNT(*)
FROM (
    SELECT connection_id, external_id
    FROM files
    WHERE
        connection_id IS NOT NULL
        AND external_id IS NOT NULL
    GROUP BY
        connection_id,
        external_id
    HAVING
        COUNT(*) > 1
) AS final_check;

IF @dup_count = 0
BEGIN
    PRINT 'PASS: Zero duplicate (connection_id, external_id) groups remain.';
END
ELSE
BEGIN
    PRINT CONCAT('FAIL: ', CAST(@dup_count AS NVARCHAR(20)),
                 ' duplicate group(s) still exist. Do NOT proceed to Section 5.');
    RAISERROR('Cannot add unique constraint while duplicates exist.', 16, 1);
    RETURN;
END

-- Show remaining orphaned chunks (should be 0)
SELECT COUNT(*) AS remaining_orphaned_chunks
FROM file_chunks fc
WHERE NOT EXISTS (
    SELECT 1 FROM files f WHERE f.id = fc.file_id
);

-- Final row counts for sanity check
SELECT
    'files'       AS table_name,
    COUNT(*)      AS total_rows
FROM files
UNION ALL
SELECT
    'file_chunks' AS table_name,
    COUNT(*)      AS total_rows
FROM file_chunks;

-- ============================================================
-- SECTION 5: Drop Old Index and Add Unique Constraint
-- ============================================================
-- Only run this section after Section 4 confirms zero duplicates.
--
-- IX_files_connection_external is the existing non-unique index.
-- UQ_files_connection_external replaces it as a unique constraint,
-- which SQL Server implements as a unique index internally.
--
-- After running this, update schema.prisma:
--   Replace:  @@index([connection_id, external_id], map: "IX_files_connection_external")
--   With:     @@unique([connection_id, external_id], map: "UQ_files_connection_external")
-- Then run: npx prisma generate
-- ============================================================

PRINT '';
PRINT '=== SECTION 5: Replacing index with unique constraint ===';

-- Drop the existing non-unique index
IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE
        object_id = OBJECT_ID('dbo.files')
        AND name = 'IX_files_connection_external'
)
BEGIN
    DROP INDEX IX_files_connection_external ON files;
    PRINT 'Dropped index: IX_files_connection_external';
END
ELSE
BEGIN
    PRINT 'Index IX_files_connection_external not found — already dropped or renamed.';
END

-- Add the unique constraint
-- NOTE: connection_id and external_id are both nullable.
-- SQL Server treats each NULL as distinct, so two rows where
-- connection_id IS NULL do NOT violate this constraint.
-- This is the correct behaviour for local (non-integrated) files.
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE
        object_id = OBJECT_ID('dbo.files')
        AND name = 'UQ_files_connection_external'
)
BEGIN
    ALTER TABLE files
        ADD CONSTRAINT UQ_files_connection_external
        UNIQUE (connection_id, external_id);
    PRINT 'Added unique constraint: UQ_files_connection_external';
END
ELSE
BEGIN
    PRINT 'Unique constraint UQ_files_connection_external already exists — skipping.';
END

-- Confirm the constraint is in place
SELECT
    i.name             AS constraint_name,
    i.type_desc        AS index_type,
    i.is_unique        AS is_unique,
    COL_NAME(ic.object_id, ic.column_id) AS column_name,
    ic.key_ordinal     AS key_position
FROM
    sys.indexes         i
    JOIN sys.index_columns ic
        ON ic.object_id = i.object_id
        AND ic.index_id = i.index_id
WHERE
    i.object_id = OBJECT_ID('dbo.files')
    AND i.name   = 'UQ_files_connection_external'
ORDER BY
    ic.key_ordinal;

PRINT '';
PRINT '=== Cleanup complete ===';
PRINT 'Next steps:';
PRINT '  1. Update schema.prisma: replace @@index with @@unique for [connection_id, external_id]';
PRINT '  2. Run: npx prisma generate';
PRINT '  3. Commit schema.prisma';
