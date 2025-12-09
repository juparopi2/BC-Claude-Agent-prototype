-- Migration 004: Create Usage Tracking & Billing System Tables
-- Date: 2025-12-09
-- Phase: 1.5 (Usage Tracking & Billing System)
--
-- Purpose: Comprehensive tracking system for token usage, quotas, billing, and alerting
--
-- Design decisions:
-- 1. Event sourcing pattern - usage_events is append-only immutable log
-- 2. No CASCADE DELETE on billing tables - financial data integrity requirement
-- 3. Pre-aggregated rollups in usage_aggregates for fast dashboard queries
-- 4. Idempotent upserts via UNIQUE constraint on (user_id, period_type, period_start)
-- 5. Quota system with free plan defaults for frictionless onboarding
-- 6. Alert system to notify users before hitting quota limits

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

PRINT '=== Migration 004: Create Usage Tracking & Billing System Tables ===';
PRINT '';

-- =====================================================================
-- Table 1: usage_events (Append-only event log)
-- =====================================================================
PRINT 'Step 1: Creating usage_events table...';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'usage_events')
BEGIN
    CREATE TABLE usage_events (
        -- Primary key (auto-incrementing for chronological ordering)
        id BIGINT IDENTITY(1,1) PRIMARY KEY,

        -- User and session identifiers
        user_id UNIQUEIDENTIFIER NOT NULL,
        session_id UNIQUEIDENTIFIER NOT NULL,

        -- Event categorization
        category NVARCHAR(50) NOT NULL,  -- 'api_call', 'tool_use', 'approval', 'file_upload', etc.
        event_type NVARCHAR(100) NOT NULL,  -- Specific event (e.g., 'message_sent', 'tool_executed')

        -- Usage metrics
        quantity BIGINT NOT NULL,  -- Token count, file size, or other unit
        unit NVARCHAR(20) NOT NULL,  -- 'tokens', 'bytes', 'calls', etc.

        -- Cost calculation
        cost DECIMAL(18,8) NOT NULL DEFAULT 0.0,  -- Micro-cent precision for accurate billing

        -- Additional context (JSON metadata)
        metadata NVARCHAR(MAX) NULL,  -- { "model": "claude-4.5", "cache_hit": true, ... }

        -- Timestamps (immutable)
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign key to users (no cascade - preserve events even if user deleted)
        CONSTRAINT FK_usage_events_user FOREIGN KEY (user_id) REFERENCES users(id)
    );

    PRINT '  ✓ Created usage_events table';
END
ELSE
BEGIN
    PRINT '  ℹ usage_events table already exists - skipping';
END
GO

-- Index for user-based queries (dashboard, billing)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_usage_events_user_created' AND object_id = OBJECT_ID('usage_events'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_usage_events_user_created
    ON usage_events(user_id, created_at DESC);
    PRINT '  ✓ Created index IX_usage_events_user_created';
END
GO

-- Index for category-based analytics
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_usage_events_category' AND object_id = OBJECT_ID('usage_events'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_usage_events_category
    ON usage_events(category, created_at DESC);
    PRINT '  ✓ Created index IX_usage_events_category';
END
GO

-- =====================================================================
-- Table 2: user_quotas (Per-user quota limits and reset tracking)
-- =====================================================================
PRINT '';
PRINT 'Step 2: Creating user_quotas table...';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_quotas')
BEGIN
    CREATE TABLE user_quotas (
        -- Primary key (one quota record per user)
        user_id UNIQUEIDENTIFIER PRIMARY KEY,

        -- Plan tier
        plan_tier NVARCHAR(20) NOT NULL DEFAULT 'free',  -- 'free', 'pro', 'enterprise'

        -- Token quotas (monthly limits)
        monthly_token_limit BIGINT NOT NULL DEFAULT 100000,  -- Free plan: 100K tokens/month
        current_token_usage BIGINT NOT NULL DEFAULT 0,

        -- API call quotas
        monthly_api_call_limit INT NOT NULL DEFAULT 500,  -- Free plan: 500 calls/month
        current_api_call_usage INT NOT NULL DEFAULT 0,

        -- Storage quotas
        storage_limit_bytes BIGINT NOT NULL DEFAULT 10485760,  -- Free plan: 10MB storage
        current_storage_usage BIGINT NOT NULL DEFAULT 0,

        -- Reset tracking
        quota_reset_at DATETIME2 NOT NULL DEFAULT DATEADD(MONTH, 1, GETUTCDATE()),
        last_reset_at DATETIME2 NULL,

        -- Overage handling
        allow_overage BIT NOT NULL DEFAULT 0,  -- Enterprise feature
        overage_rate DECIMAL(18,8) NULL,  -- Cost per unit over quota

        -- Audit
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign key to users
        CONSTRAINT FK_user_quotas_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    PRINT '  ✓ Created user_quotas table';
END
ELSE
BEGIN
    PRINT '  ℹ user_quotas table already exists - skipping';
END
GO

-- =====================================================================
-- Table 3: usage_aggregates (Pre-computed rollups for fast dashboards)
-- =====================================================================
PRINT '';
PRINT 'Step 3: Creating usage_aggregates table...';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'usage_aggregates')
BEGIN
    CREATE TABLE usage_aggregates (
        -- Primary key
        id BIGINT IDENTITY(1,1) PRIMARY KEY,

        -- User and time period
        user_id UNIQUEIDENTIFIER NOT NULL,
        period_type NVARCHAR(20) NOT NULL,  -- 'hourly', 'daily', 'weekly', 'monthly'
        period_start DATETIME2 NOT NULL,  -- Start of aggregation period

        -- Aggregated metrics
        total_events BIGINT NOT NULL DEFAULT 0,
        total_tokens BIGINT NOT NULL DEFAULT 0,
        total_api_calls INT NOT NULL DEFAULT 0,
        total_cost DECIMAL(18,8) NOT NULL DEFAULT 0.0,

        -- Category breakdown (stored as JSON for flexibility)
        category_breakdown NVARCHAR(MAX) NULL,  -- { "api_call": 50000, "tool_use": 10000, ... }

        -- Audit
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign key to users
        CONSTRAINT FK_usage_aggregates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

        -- Unique constraint for idempotent upserts (prevents duplicate aggregates)
        CONSTRAINT UQ_usage_aggregates_period UNIQUE (user_id, period_type, period_start)
    );

    PRINT '  ✓ Created usage_aggregates table';
END
ELSE
BEGIN
    PRINT '  ℹ usage_aggregates table already exists - skipping';
END
GO

-- Index for time-series queries (dashboard charts)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_usage_aggregates_user_period' AND object_id = OBJECT_ID('usage_aggregates'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_usage_aggregates_user_period
    ON usage_aggregates(user_id, period_type, period_start DESC);
    PRINT '  ✓ Created index IX_usage_aggregates_user_period';
END
GO

-- =====================================================================
-- Table 4: billing_records (Monthly invoices and payment tracking)
-- =====================================================================
PRINT '';
PRINT 'Step 4: Creating billing_records table...';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'billing_records')
BEGIN
    CREATE TABLE billing_records (
        -- Primary key
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- User and billing period
        user_id UNIQUEIDENTIFIER NOT NULL,
        billing_period_start DATETIME2 NOT NULL,
        billing_period_end DATETIME2 NOT NULL,

        -- Usage summary
        total_tokens BIGINT NOT NULL DEFAULT 0,
        total_api_calls INT NOT NULL DEFAULT 0,
        total_storage_bytes BIGINT NOT NULL DEFAULT 0,

        -- Cost breakdown
        base_cost DECIMAL(18,8) NOT NULL DEFAULT 0.0,  -- Plan subscription cost
        usage_cost DECIMAL(18,8) NOT NULL DEFAULT 0.0,  -- Pay-as-you-go usage
        overage_cost DECIMAL(18,8) NOT NULL DEFAULT 0.0,  -- Over-quota charges
        total_cost DECIMAL(18,8) NOT NULL DEFAULT 0.0,  -- Sum of all costs

        -- Payment status
        status NVARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'paid', 'failed', 'refunded'
        payment_method NVARCHAR(50) NULL,  -- 'stripe', 'invoice', 'credit_card', etc.
        paid_at DATETIME2 NULL,

        -- Audit
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign key to users (NO CASCADE DELETE - financial records must be preserved)
        CONSTRAINT FK_billing_records_user FOREIGN KEY (user_id) REFERENCES users(id)
    );

    PRINT '  ✓ Created billing_records table';
END
ELSE
BEGIN
    PRINT '  ℹ billing_records table already exists - skipping';
END
GO

-- Index for user billing history queries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_billing_records_user_period' AND object_id = OBJECT_ID('billing_records'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_billing_records_user_period
    ON billing_records(user_id, billing_period_start DESC);
    PRINT '  ✓ Created index IX_billing_records_user_period';
END
GO

-- Index for payment status queries (admin dashboard)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_billing_records_status' AND object_id = OBJECT_ID('billing_records'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_billing_records_status
    ON billing_records(status, created_at DESC);
    PRINT '  ✓ Created index IX_billing_records_status';
END
GO

-- =====================================================================
-- Table 5: quota_alerts (Threshold-based notifications)
-- =====================================================================
PRINT '';
PRINT 'Step 5: Creating quota_alerts table...';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'quota_alerts')
BEGIN
    CREATE TABLE quota_alerts (
        -- Primary key
        id BIGINT IDENTITY(1,1) PRIMARY KEY,

        -- User and quota type
        user_id UNIQUEIDENTIFIER NOT NULL,
        quota_type NVARCHAR(50) NOT NULL,  -- 'tokens', 'api_calls', 'storage'

        -- Threshold configuration
        threshold_percent INT NOT NULL,  -- Alert at 50%, 80%, 90%, 100%
        threshold_value BIGINT NOT NULL,  -- Actual value when alert triggered

        -- Alert status
        alerted_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        acknowledged_at DATETIME2 NULL,

        -- Foreign key to users
        CONSTRAINT FK_quota_alerts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    PRINT '  ✓ Created quota_alerts table';
END
ELSE
BEGIN
    PRINT '  ℹ quota_alerts table already exists - skipping';
END
GO

-- Index for user alert queries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_quota_alerts_user_alerted' AND object_id = OBJECT_ID('quota_alerts'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_quota_alerts_user_alerted
    ON quota_alerts(user_id, alerted_at DESC);
    PRINT '  ✓ Created index IX_quota_alerts_user_alerted';
END
GO

-- =====================================================================
-- Verification
-- =====================================================================
PRINT '';
PRINT 'Step 6: Verifying table creation...';

DECLARE @TableCount INT;
SELECT @TableCount = COUNT(*)
FROM sys.tables
WHERE name IN ('usage_events', 'user_quotas', 'usage_aggregates', 'billing_records', 'quota_alerts');

IF @TableCount = 5
BEGIN
    PRINT '  ✓ All 5 tables verified';
END
ELSE
BEGIN
    PRINT '  ✗ ERROR: Only ' + CAST(@TableCount AS NVARCHAR(10)) + ' of 5 tables created';
    RAISERROR('Migration verification failed', 16, 1);
END

-- Verify index count
DECLARE @IndexCount INT;
SELECT @IndexCount = COUNT(*)
FROM sys.indexes
WHERE object_id IN (
    OBJECT_ID('usage_events'),
    OBJECT_ID('usage_aggregates'),
    OBJECT_ID('billing_records'),
    OBJECT_ID('quota_alerts')
)
AND name LIKE 'IX_%';

PRINT '  ℹ Total indexes created: ' + CAST(@IndexCount AS NVARCHAR(10));

GO

PRINT '';
PRINT '=== Migration 004 COMPLETED ===';
PRINT '';
PRINT 'Summary:';
PRINT '  - usage_events: Append-only event log with 10+ columns';
PRINT '  - user_quotas: Per-user quota limits with 12+ columns';
PRINT '  - usage_aggregates: Pre-aggregated rollups with 10+ columns';
PRINT '  - billing_records: Monthly invoices with 13+ columns';
PRINT '  - quota_alerts: Threshold alerts with 8+ columns';
PRINT '  - Total indexes: 7+ for optimized queries';
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Create UsageEventService for logging events';
PRINT '  2. Create QuotaManager for quota enforcement';
PRINT '  3. Create aggregation job for usage_aggregates';
PRINT '  4. Create billing job for monthly invoice generation';
PRINT '  5. Integrate alert system with WebSocket notifications';
PRINT '';
PRINT '==========================================';
GO
