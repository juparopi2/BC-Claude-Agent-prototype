-- Rollback Migration 007: Remove message_type column
-- WARNING: This will truncate the messages table (all data lost)

-- Step 1: Truncate messages table
TRUNCATE TABLE messages;
PRINT 'Messages table truncated';

-- Step 2: Drop indexes
DROP INDEX IF EXISTS idx_messages_session_type ON messages;
DROP INDEX IF EXISTS idx_messages_type ON messages;
PRINT 'Indexes dropped';

-- Step 3: Drop CHECK constraint
ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_type;
PRINT 'Check constraint dropped';

-- Step 4: Drop message_type column
ALTER TABLE messages DROP COLUMN message_type;
PRINT 'message_type column dropped';

PRINT 'Migration 007 rolled back successfully';
PRINT 'WARNING: All messages have been deleted';
