-- Migration 004 Rollback: Revert Approvals Constraints Changes
-- Date: 2025-11-10
-- Description: Rollback changes from migration 004
--
-- ⚠️ WARNING: This will:
--   1. Remove 'priority' column (data will be lost)
--   2. Revert status constraint to original 3 values
--   3. Any approvals with status='expired' will cause rollback to FAIL
--
-- Before running:
--   - Verify no approvals have status='expired'
--   - Backup 'priority' column data if needed

USE [sqldb-bcagent-dev];
GO

PRINT 'Starting Migration 004 ROLLBACK: Revert Approvals Constraints';
GO

-- =============================================================================
-- PRE-CHECK: Verify no approvals with status='expired'
-- =============================================================================

PRINT 'Pre-check: Verifying no approvals with status=expired...';

DECLARE @expiredCount INT;
SELECT @expiredCount = COUNT(*)
FROM approvals
WHERE status = 'expired';

IF @expiredCount > 0
BEGIN
    PRINT '  ❌ ERROR: Found ' + CAST(@expiredCount AS NVARCHAR(10)) + ' approvals with status=expired';
    PRINT '  Cannot rollback: First update these records to another status or delete them';
    PRINT '';
    PRINT 'Example fix:';
    PRINT '  UPDATE approvals SET status = ''rejected'' WHERE status = ''expired'';';
    RAISERROR('Rollback aborted: expired approvals exist', 16, 1);
    RETURN;
END
ELSE
BEGIN
    PRINT '  ✓ No expired approvals found';
END
GO

-- =============================================================================
-- STEP 1: Drop new constraints
-- =============================================================================

PRINT 'Step 1: Dropping constraints added in migration 004...';

-- Drop priority constraint
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'chk_approvals_priority'
    AND parent_object_id = OBJECT_ID('approvals')
)
BEGIN
    ALTER TABLE approvals DROP CONSTRAINT chk_approvals_priority;
    PRINT '  ✓ Constraint chk_approvals_priority dropped';
END

-- Drop status constraint
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'chk_approvals_status'
    AND parent_object_id = OBJECT_ID('approvals')
)
BEGIN
    ALTER TABLE approvals DROP CONSTRAINT chk_approvals_status;
    PRINT '  ✓ Constraint chk_approvals_status dropped';
END
GO

-- =============================================================================
-- STEP 2: Remove priority column
-- =============================================================================

PRINT 'Step 2: Removing priority column...';

IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'approvals'
    AND COLUMN_NAME = 'priority'
)
BEGIN
    -- Save priority data to temp table (for reference)
    SELECT id, priority
    INTO #approvals_priority_backup
    FROM approvals
    WHERE priority IS NOT NULL;

    DECLARE @backupCount INT;
    SELECT @backupCount = COUNT(*) FROM #approvals_priority_backup;

    PRINT '  ℹ Backed up priority data for ' + CAST(@backupCount AS NVARCHAR(10)) + ' records to temp table #approvals_priority_backup';

    -- Drop column
    ALTER TABLE approvals DROP COLUMN priority;

    PRINT '  ✓ Column priority removed';
    PRINT '  ⚠ Priority data has been lost (backup exists in temp table)';
END
ELSE
BEGIN
    PRINT '  ⚠ Column priority not found (already removed?)';
END
GO

-- =============================================================================
-- STEP 3: Restore original status constraint (3 values only)
-- =============================================================================

PRINT 'Step 3: Restoring original chk_approvals_status constraint...';

ALTER TABLE approvals
ADD CONSTRAINT chk_approvals_status
CHECK (status IN ('pending', 'approved', 'rejected'));

PRINT '  ✓ Constraint chk_approvals_status restored (3 values: pending, approved, rejected)';
GO

-- =============================================================================
-- VERIFICATION
-- =============================================================================

PRINT '';
PRINT '=============================================================================';
PRINT 'VERIFICATION: Checking schema after rollback...';
PRINT '=============================================================================';

PRINT '';
PRINT 'Columns in approvals table:';
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'approvals'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT 'Check constraints on approvals table:';
SELECT
    name AS ConstraintName,
    definition AS ConstraintDefinition
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('approvals')
ORDER BY name;

PRINT '';
PRINT '✅ Migration 004 rollback completed successfully!';
PRINT '';
PRINT 'Summary:';
PRINT '  - chk_approvals_status reverted to: pending, approved, rejected';
PRINT '  - priority column removed';
PRINT '  - Temp table #approvals_priority_backup contains old priority data';
PRINT '';
GO
