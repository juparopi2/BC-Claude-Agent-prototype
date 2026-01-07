-- Migration: Fix message_citations.message_id column type
-- Purpose: Support Anthropic message IDs (not UUID format)
-- Example Anthropic ID: msg_01BRsWtSA9yhWYRX6SGB3BvC

-- Step 1: Drop the index that depends on message_id
DROP INDEX IF EXISTS IX_message_citations_message ON message_citations;
GO

-- Step 2: Change message_id from uniqueidentifier to nvarchar(255)
-- This matches the messages.id column type
ALTER TABLE message_citations
ALTER COLUMN message_id NVARCHAR(255) NOT NULL;
GO

-- Step 3: Recreate the index
CREATE INDEX IX_message_citations_message ON message_citations(message_id);
GO
