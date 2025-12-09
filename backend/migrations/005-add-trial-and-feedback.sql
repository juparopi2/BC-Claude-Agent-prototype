-- Migration 005: Add Free Trial and User Feedback System
-- Date: 2025-12-09
-- Phase: 1.5 (Extension - Trial & Feedback)
--
-- Purpose: Add support for free trial users and feedback collection system
--
-- Design decisions:
-- 1. Add trial_started_at, trial_expires_at, trial_extended to user_quotas
-- 2. Create user_feedback table for collecting feedback to extend trials
-- 3. Support one-time trial extension in exchange for feedback
-- 4. Update plan_tier constraint to include 'free_trial' and 'unlimited'

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

PRINT '=== Migration 005: Add Free Trial and User Feedback System ===';
PRINT '';

-- =====================================================================
-- Step 1: Add trial tracking columns to user_quotas
-- =====================================================================
PRINT 'Step 1: Adding trial tracking columns to user_quotas...';

-- Add trial_started_at column
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('user_quotas')
    AND name = 'trial_started_at'
)
BEGIN
    ALTER TABLE user_quotas
    ADD trial_started_at DATETIME2 NULL;

    PRINT '  ✓ Added trial_started_at column';
END
ELSE
BEGIN
    PRINT '  ℹ trial_started_at column already exists - skipping';
END
GO

-- Add trial_expires_at column
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('user_quotas')
    AND name = 'trial_expires_at'
)
BEGIN
    ALTER TABLE user_quotas
    ADD trial_expires_at DATETIME2 NULL;

    PRINT '  ✓ Added trial_expires_at column';
END
ELSE
BEGIN
    PRINT '  ℹ trial_expires_at column already exists - skipping';
END
GO

-- Add trial_extended column (tracks if user already used extension)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('user_quotas')
    AND name = 'trial_extended'
)
BEGIN
    ALTER TABLE user_quotas
    ADD trial_extended BIT NOT NULL DEFAULT 0;

    PRINT '  ✓ Added trial_extended column';
END
ELSE
BEGIN
    PRINT '  ℹ trial_extended column already exists - skipping';
END
GO

-- =====================================================================
-- Step 2: Create user_feedback table
-- =====================================================================
PRINT '';
PRINT 'Step 2: Creating user_feedback table...';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_feedback')
BEGIN
    CREATE TABLE user_feedback (
        -- Primary key
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- User who submitted feedback
        user_id UNIQUEIDENTIFIER NOT NULL,

        -- Feedback content
        what_they_like NVARCHAR(MAX) NULL,  -- What user likes about the product
        improvement_opportunities NVARCHAR(MAX) NULL,  -- What could be improved
        needed_features NVARCHAR(MAX) NULL,  -- Features they need
        additional_comments NVARCHAR(MAX) NULL,  -- Any other feedback

        -- Metadata
        feedback_source NVARCHAR(50) NOT NULL DEFAULT 'trial_extension',  -- 'trial_extension', 'survey', 'support', etc.
        trial_extended BIT NOT NULL DEFAULT 0,  -- Whether trial was extended as result of this feedback

        -- Timestamps
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign key to users (preserve feedback even if user deleted)
        CONSTRAINT FK_user_feedback_user FOREIGN KEY (user_id) REFERENCES users(id)
    );

    PRINT '  ✓ Created user_feedback table';
END
ELSE
BEGIN
    PRINT '  ℹ user_feedback table already exists - skipping';
END
GO

-- Index for user feedback queries
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_user_feedback_user_created'
    AND object_id = OBJECT_ID('user_feedback')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_user_feedback_user_created
    ON user_feedback(user_id, created_at DESC);

    PRINT '  ✓ Created index IX_user_feedback_user_created';
END
GO

-- Index for feedback source analytics
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_user_feedback_source'
    AND object_id = OBJECT_ID('user_feedback')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_user_feedback_source
    ON user_feedback(feedback_source, created_at DESC);

    PRINT '  ✓ Created index IX_user_feedback_source';
END
GO

-- =====================================================================
-- Step 3: Update plan_tier constraint to include new tiers
-- =====================================================================
PRINT '';
PRINT 'Step 3: Updating plan_tier constraint...';

-- Note: SQL Server doesn't support ALTER CONSTRAINT directly
-- We need to drop and recreate if constraint exists
-- Check constraints are named CK_tablename_columnname by default

DECLARE @ConstraintName NVARCHAR(255);
SELECT @ConstraintName = name
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('user_quotas')
AND COL_NAME(parent_object_id, parent_column_id) = 'plan_tier';

IF @ConstraintName IS NOT NULL
BEGIN
    DECLARE @DropSQL NVARCHAR(MAX);
    SET @DropSQL = 'ALTER TABLE user_quotas DROP CONSTRAINT ' + QUOTENAME(@ConstraintName);
    EXEC sp_executesql @DropSQL;

    PRINT '  ℹ Dropped existing plan_tier constraint: ' + @ConstraintName;
END

-- Add new constraint with all 5 plan tiers
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('user_quotas')
    AND definition LIKE '%free_trial%'
)
BEGIN
    ALTER TABLE user_quotas
    ADD CONSTRAINT CK_user_quotas_plan_tier
    CHECK (plan_tier IN ('free', 'free_trial', 'pro', 'enterprise', 'unlimited'));

    PRINT '  ✓ Created updated plan_tier constraint with 5 tiers';
END
ELSE
BEGIN
    PRINT '  ℹ plan_tier constraint already includes new tiers - skipping';
END
GO

-- =====================================================================
-- Step 4: Add helpful view for trial status
-- =====================================================================
PRINT '';
PRINT 'Step 4: Creating trial status view...';

IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'v_trial_status')
BEGIN
    DROP VIEW v_trial_status;
    PRINT '  ℹ Dropped existing v_trial_status view';
END
GO

CREATE VIEW v_trial_status AS
SELECT
    uq.user_id,
    u.email,
    uq.plan_tier,
    uq.trial_started_at,
    uq.trial_expires_at,
    uq.trial_extended,
    CASE
        WHEN uq.plan_tier != 'free_trial' THEN 'not_trial'
        WHEN uq.trial_expires_at IS NULL THEN 'no_expiry_set'
        WHEN GETUTCDATE() > uq.trial_expires_at THEN 'expired'
        WHEN DATEDIFF(DAY, GETUTCDATE(), uq.trial_expires_at) <= 3 THEN 'expiring_soon'
        ELSE 'active'
    END AS trial_status,
    DATEDIFF(DAY, GETUTCDATE(), uq.trial_expires_at) AS days_remaining,
    CASE
        WHEN uq.trial_extended = 1 THEN 0
        ELSE 1
    END AS can_extend_trial,
    (SELECT COUNT(*) FROM user_feedback WHERE user_id = uq.user_id AND feedback_source = 'trial_extension') AS feedback_submissions
FROM user_quotas uq
INNER JOIN users u ON uq.user_id = u.id
WHERE uq.plan_tier = 'free_trial';
GO

PRINT '  ✓ Created v_trial_status view';
GO

-- =====================================================================
-- Verification
-- =====================================================================
PRINT '';
PRINT 'Step 5: Verifying migration...';

-- Check columns added
DECLARE @ColumnCount INT;
SELECT @ColumnCount = COUNT(*)
FROM sys.columns
WHERE object_id = OBJECT_ID('user_quotas')
AND name IN ('trial_started_at', 'trial_expires_at', 'trial_extended');

IF @ColumnCount = 3
BEGIN
    PRINT '  ✓ All 3 trial columns verified in user_quotas';
END
ELSE
BEGIN
    PRINT '  ✗ ERROR: Only ' + CAST(@ColumnCount AS NVARCHAR(10)) + ' of 3 columns added';
    RAISERROR('Migration verification failed - columns missing', 16, 1);
END

-- Check table created
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_feedback')
BEGIN
    PRINT '  ✓ user_feedback table verified';
END
ELSE
BEGIN
    PRINT '  ✗ ERROR: user_feedback table not created';
    RAISERROR('Migration verification failed - table missing', 16, 1);
END

-- Check constraint updated
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('user_quotas')
    AND definition LIKE '%free_trial%'
    AND definition LIKE '%unlimited%'
)
BEGIN
    PRINT '  ✓ plan_tier constraint verified';
END
ELSE
BEGIN
    PRINT '  ✗ WARNING: plan_tier constraint may not include all tiers';
END

-- Check view created
IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'v_trial_status')
BEGIN
    PRINT '  ✓ v_trial_status view verified';
END
ELSE
BEGIN
    PRINT '  ✗ ERROR: v_trial_status view not created';
    RAISERROR('Migration verification failed - view missing', 16, 1);
END

GO

PRINT '';
PRINT '=== Migration 005 COMPLETED ===';
PRINT '';
PRINT 'Summary:';
PRINT '  - Added 3 columns to user_quotas (trial_started_at, trial_expires_at, trial_extended)';
PRINT '  - Created user_feedback table with 4 feedback fields';
PRINT '  - Updated plan_tier constraint to support 5 tiers (free, free_trial, pro, enterprise, unlimited)';
PRINT '  - Created v_trial_status view for monitoring trial users';
PRINT '  - Added 2 indexes on user_feedback table';
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Update QuotaValidatorService.validateQuota() to check trial expiration';
PRINT '  2. Add POST /api/usage/feedback endpoint for submitting feedback';
PRINT '  3. Add trial extension logic (max 1 extension per user)';
PRINT '  4. Update frontend to show trial status and feedback form';
PRINT '  5. Add automated job to notify users 3 days before trial expiration';
PRINT '';
PRINT '==========================================';
GO
