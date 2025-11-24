-- Migration: 001-add-token-tracking.sql
-- Date: 2025-01-24
-- Purpose: Add token tracking columns to messages table
-- Phase: 1A (Token Tracking - Database + Logging)

USE [sqldb-bcagent-dev];
GO

-- Add token tracking columns to messages table
ALTER TABLE messages
ADD
    model NVARCHAR(100) NULL,
    input_tokens INT NULL,
    output_tokens INT NULL,
    total_tokens AS (ISNULL(input_tokens, 0) + ISNULL(output_tokens, 0)) PERSISTED;
GO

-- Create index for billing queries (optimizes session-based token aggregation)
CREATE NONCLUSTERED INDEX IX_messages_tokens
ON messages(session_id, created_at)
INCLUDE (input_tokens, output_tokens, model);
GO

-- Verify columns were added
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'messages'
AND COLUMN_NAME IN ('model', 'input_tokens', 'output_tokens', 'total_tokens');
GO

PRINT 'Migration 001-add-token-tracking.sql completed successfully';
GO
