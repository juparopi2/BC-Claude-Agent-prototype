-- ============================================================
-- Database Cleanup Script for BC Claude Agent Prototype
-- ============================================================
-- Purpose: Clean corrupted records caused by timestamp type mismatch
--          and prepare database for fixed event persistence
--
-- Run this BEFORE deploying the code fixes.
-- WARNING: This will delete all message history!
-- ============================================================
-- IMPORTANT: Delete order matters due to foreign key constraints!
-- Order: approvals -> messages -> message_events
-- ============================================================

-- Step 1: Clear approvals first (no FK dependencies)
PRINT 'Clearing approvals table...';
DELETE FROM approvals;
PRINT 'approvals cleared.';

-- Step 2: Clear materialized messages (references message_events.id via event_id FK)
PRINT 'Clearing messages table...';
DELETE FROM messages;
PRINT 'messages cleared.';

-- Step 3: Clear event sourcing log (now safe to delete after messages cleared)
PRINT 'Clearing message_events table...';
DELETE FROM message_events;
PRINT 'message_events cleared.';

-- Step 4: Optionally clear sessions to start completely fresh
-- Uncomment the following lines if you want a full reset:
-- PRINT 'Clearing sessions table...';
-- DELETE FROM sessions;
-- PRINT 'sessions cleared.';

-- Step 5: Verify cleanup
PRINT '============================================';
PRINT 'Cleanup complete. Verifying record counts:';
SELECT 'message_events' as table_name, COUNT(*) as record_count FROM message_events
UNION ALL
SELECT 'messages' as table_name, COUNT(*) as record_count FROM messages
UNION ALL
SELECT 'approvals' as table_name, COUNT(*) as record_count FROM approvals;

PRINT '============================================';
PRINT 'Database cleanup completed successfully!';
PRINT 'You can now deploy the code fixes.';
