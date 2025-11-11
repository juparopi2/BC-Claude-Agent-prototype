-- Migration 004: Fix Approvals Table Constraints
-- Date: 2025-11-10
-- Description: Add 'expired' status to approvals and add priority column
--
-- Issues Fixed:
--   1. chk_approvals_status constraint only allowed 3 values (pending, approved, rejected)
--      but code expects 4 values including 'expired'
--   2. Missing 'priority' column that is used in ApprovalManager.ts
--
-- Breaking Changes: None (only adding values, not removing)
-- Rollback: See 004_rollback_approvals_constraints.sql

USE [sqldb-bcagent-dev];
GO

PRINT 'Starting Migration 004: Fix Approvals Constraints';
GO

-- =============================================================================
-- STEP 1: Drop old constraint (chk_approvals_status)
-- =============================================================================

PRINT 'Step 1: Dropping old constraint chk_approvals_status...';

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
ELSE
BEGIN
    PRINT '  ⚠ Constraint chk_approvals_status not found (already dropped?)';
END
GO

-- =============================================================================
-- STEP 2: Add new constraint with 4 values including 'expired'
-- =============================================================================

PRINT 'Step 2: Adding new constraint chk_approvals_status with 4 values...';

ALTER TABLE approvals
ADD CONSTRAINT chk_approvals_status
CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));

PRINT '  ✓ Constraint chk_approvals_status created (4 values: pending, approved, rejected, expired)';
GO

-- =============================================================================
-- STEP 3: Add priority column if not exists
-- =============================================================================

PRINT 'Step 3: Adding priority column...';

IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'approvals'
    AND COLUMN_NAME = 'priority'
)
BEGIN
    ALTER TABLE approvals
    ADD priority NVARCHAR(20) NOT NULL DEFAULT 'medium';

    PRINT '  ✓ Column priority added (NVARCHAR(20), default: medium)';
END
ELSE
BEGIN
    PRINT '  ⚠ Column priority already exists';
END
GO

-- =============================================================================
-- STEP 4: Add priority constraint
-- =============================================================================

PRINT 'Step 4: Adding constraint chk_approvals_priority...';

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'chk_approvals_priority'
    AND parent_object_id = OBJECT_ID('approvals')
)
BEGIN
    ALTER TABLE approvals
    ADD CONSTRAINT chk_approvals_priority
    CHECK (priority IN ('low', 'medium', 'high'));

    PRINT '  ✓ Constraint chk_approvals_priority created (3 values: low, medium, high)';
END
ELSE
BEGIN
    PRINT '  ⚠ Constraint chk_approvals_priority already exists';
END
GO

-- =============================================================================
-- VERIFICATION: Check final schema
-- =============================================================================

PRINT '';
PRINT '=============================================================================';
PRINT 'VERIFICATION: Checking final schema...';
PRINT '=============================================================================';

-- Check columns
PRINT '';
PRINT 'Columns in approvals table:';
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'approvals'
ORDER BY ORDINAL_POSITION;

-- Check constraints
PRINT '';
PRINT 'Check constraints on approvals table:';
SELECT
    name AS ConstraintName,
    definition AS ConstraintDefinition
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('approvals')
ORDER BY name;

PRINT '';
PRINT '✅ Migration 004 completed successfully!';
PRINT '';
PRINT 'Summary:';
PRINT '  - chk_approvals_status now allows: pending, approved, rejected, expired';
PRINT '  - priority column added (NVARCHAR(20), default: medium)';
PRINT '  - chk_approvals_priority added (low, medium, high)';
PRINT '';
GO
