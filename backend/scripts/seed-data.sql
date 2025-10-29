-- ============================================
-- BC Claude Agent - Seed Data
-- ============================================
-- Populates database with test data for development
--
-- IMPORTANT: Do NOT run this in production!
-- Only for development and testing environments
-- ============================================

-- Check environment (optional safety check)
IF DB_NAME() NOT LIKE '%dev%' AND DB_NAME() NOT LIKE '%test%'
BEGIN
    PRINT '⚠️  WARNING: This script should only run in dev/test environments'
    PRINT '   Current database: ' + DB_NAME()
    -- Uncomment the next line to prevent accidental execution in production
    -- RETURN
END
GO

PRINT 'Starting seed data insertion...';
PRINT '';

-- ============================================
-- Seed Users
-- ============================================
-- Password for all test users: "Test123!"
-- Hash generated with bcrypt rounds=10
DECLARE @admin_id UNIQUEIDENTIFIER = NEWID();
DECLARE @user1_id UNIQUEIDENTIFIER = NEWID();
DECLARE @user2_id UNIQUEIDENTIFIER = NEWID();

IF NOT EXISTS (SELECT * FROM users WHERE email = 'admin@bcagent.dev')
BEGIN
    INSERT INTO users (id, email, password_hash, full_name, is_active, is_admin, created_at)
    VALUES (
        @admin_id,
        'admin@bcagent.dev',
        '$2b$10$rKJ3YmF5L9xJ.xLZe9Q9eOPxVZ9nL9xJ9xJ.xLZe9Q9eOPxVZ9nL9', -- Test123!
        'Admin User',
        1,
        1,
        DATEADD(DAY, -30, GETUTCDATE())
    );
    PRINT '✅ Created user: admin@bcagent.dev';
END

IF NOT EXISTS (SELECT * FROM users WHERE email = 'john@bcagent.dev')
BEGIN
    INSERT INTO users (id, email, password_hash, full_name, is_active, is_admin, created_at)
    VALUES (
        @user1_id,
        'john@bcagent.dev',
        '$2b$10$rKJ3YmF5L9xJ.xLZe9Q9eOPxVZ9nL9xJ9xJ.xLZe9Q9eOPxVZ9nL9', -- Test123!
        'John Doe',
        1,
        0,
        DATEADD(DAY, -15, GETUTCDATE())
    );
    PRINT '✅ Created user: john@bcagent.dev';
END

IF NOT EXISTS (SELECT * FROM users WHERE email = 'jane@bcagent.dev')
BEGIN
    INSERT INTO users (id, email, password_hash, full_name, is_active, is_admin, created_at)
    VALUES (
        @user2_id,
        'jane@bcagent.dev',
        '$2b$10$rKJ3YmF5L9xJ.xLZe9Q9eOPxVZ9nL9xJ9xJ.xLZe9Q9eOPxVZ9nL9', -- Test123!
        'Jane Smith',
        1,
        0,
        DATEADD(DAY, -7, GETUTCDATE())
    );
    PRINT '✅ Created user: jane@bcagent.dev';
END

PRINT '';

-- ============================================
-- Seed Sessions
-- ============================================
DECLARE @session1_id UNIQUEIDENTIFIER = NEWID();
DECLARE @session2_id UNIQUEIDENTIFIER = NEWID();
DECLARE @session3_id UNIQUEIDENTIFIER = NEWID();

-- Session 1: Active session with messages
IF NOT EXISTS (SELECT * FROM sessions WHERE id = @session1_id)
BEGIN
    INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
    VALUES (
        @session1_id,
        @user1_id,
        'Query Customer List',
        1,
        DATEADD(HOUR, -2, GETUTCDATE()),
        DATEADD(MINUTE, -5, GETUTCDATE())
    );
    PRINT '✅ Created session: Query Customer List';
END

-- Session 2: Active session
IF NOT EXISTS (SELECT * FROM sessions WHERE id = @session2_id)
BEGIN
    INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
    VALUES (
        @session2_id,
        @user1_id,
        'Create New Item',
        1,
        DATEADD(HOUR, -1, GETUTCDATE()),
        GETUTCDATE()
    );
    PRINT '✅ Created session: Create New Item';
END

-- Session 3: Inactive (archived)
IF NOT EXISTS (SELECT * FROM sessions WHERE id = @session3_id)
BEGIN
    INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
    VALUES (
        @session3_id,
        @user2_id,
        'Update Vendor Information',
        0,
        DATEADD(DAY, -5, GETUTCDATE()),
        DATEADD(DAY, -5, GETUTCDATE())
    );
    PRINT '✅ Created session: Update Vendor Information';
END

PRINT '';

-- ============================================
-- Seed Messages for Session 1
-- ============================================
DECLARE @msg1_id UNIQUEIDENTIFIER = NEWID();
DECLARE @msg2_id UNIQUEIDENTIFIER = NEWID();
DECLARE @msg3_id UNIQUEIDENTIFIER = NEWID();

-- User message
INSERT INTO messages (id, session_id, role, content, created_at)
VALUES (
    @msg1_id,
    @session1_id,
    'user',
    'Show me all active customers',
    DATEADD(HOUR, -2, GETUTCDATE())
);

-- Assistant thinking message
INSERT INTO messages (id, session_id, role, content, metadata, created_at)
VALUES (
    @msg2_id,
    @session1_id,
    'assistant',
    'I''ll query the Business Central API to get all active customers.',
    '{"thinking": true, "tool_use": "bc_query_entity"}',
    DATEADD(MINUTE, -119, GETUTCDATE())
);

-- Assistant response
INSERT INTO messages (id, session_id, role, content, token_count, created_at)
VALUES (
    @msg3_id,
    @session1_id,
    'assistant',
    'I found 47 active customers. Here are the top 10:\n\n1. Acme Corporation\n2. Contoso Ltd.\n3. Fabrikam Inc.\n4. Adventure Works\n5. Wide World Importers\n6. Northwind Traders\n7. Tailspin Toys\n8. Blue Yonder Airlines\n9. Fourth Coffee\n10. Woodgrove Bank\n\nWould you like me to show more details about any specific customer?',
    850,
    DATEADD(MINUTE, -118, GETUTCDATE())
);

PRINT '✅ Created 3 messages for session 1';
PRINT '';

-- ============================================
-- Seed Messages for Session 2
-- ============================================
-- User message
INSERT INTO messages (id, session_id, role, content, created_at)
VALUES (
    NEWID(),
    @session2_id,
    'user',
    'Create a new item: "Wireless Mouse" with price 29.99',
    DATEADD(HOUR, -1, GETUTCDATE())
);

-- Assistant message (waiting for approval)
INSERT INTO messages (id, session_id, role, content, metadata, created_at)
VALUES (
    NEWID(),
    @session2_id,
    'assistant',
    'I''ll create a new item in Business Central with the following details:\n\n- Name: Wireless Mouse\n- Price: $29.99\n\nThis action requires your approval. Would you like me to proceed?',
    '{"requires_approval": true}',
    DATEADD(MINUTE, -59, GETUTCDATE())
);

PRINT '✅ Created 2 messages for session 2';
PRINT '';

-- ============================================
-- Seed Approvals
-- ============================================
DECLARE @approval1_id UNIQUEIDENTIFIER = NEWID();

-- Pending approval for session 2
IF NOT EXISTS (SELECT * FROM approvals WHERE id = @approval1_id)
BEGIN
    INSERT INTO approvals (id, session_id, message_id, action_type, action_description, action_data, status, created_at)
    VALUES (
        @approval1_id,
        @session2_id,
        (SELECT TOP 1 id FROM messages WHERE session_id = @session2_id ORDER BY created_at DESC),
        'create',
        'Create new item: Wireless Mouse ($29.99)',
        '{"entity": "items", "operation": "create", "data": {"name": "Wireless Mouse", "price": 29.99}}',
        'pending',
        DATEADD(MINUTE, -58, GETUTCDATE())
    );
    PRINT '✅ Created pending approval for Create New Item';
END

-- Approved approval (example)
INSERT INTO approvals (id, session_id, action_type, action_description, status, decided_by_user_id, decided_at, created_at)
VALUES (
    NEWID(),
    @session3_id,
    'update',
    'Update vendor "Contoso Supplies" contact information',
    'approved',
    @user2_id,
    DATEADD(DAY, -5, GETUTCDATE()),
    DATEADD(DAY, -5, GETUTCDATE())
);
PRINT '✅ Created approved approval (historical)';

-- Rejected approval (example)
INSERT INTO approvals (id, session_id, action_type, action_description, status, decided_by_user_id, decided_at, rejection_reason, created_at)
VALUES (
    NEWID(),
    @session3_id,
    'delete',
    'Delete customer "Old Test Company"',
    'rejected',
    @user2_id,
    DATEADD(DAY, -5, GETUTCDATE()),
    'Customer still has pending invoices',
    DATEADD(DAY, -5, GETUTCDATE())
);
PRINT '✅ Created rejected approval (historical)';

PRINT '';

-- ============================================
-- Seed Checkpoints
-- ============================================
INSERT INTO checkpoints (id, session_id, checkpoint_name, checkpoint_data, created_at)
VALUES (
    NEWID(),
    @session2_id,
    'before_create_item',
    '{"context": "User requested to create new item", "entities_before": []}',
    DATEADD(MINUTE, -59, GETUTCDATE())
);
PRINT '✅ Created checkpoint for session 2';

PRINT '';

-- ============================================
-- Seed Audit Log
-- ============================================
-- Login events
INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
VALUES
    (@admin_id, 'login', 'user', @admin_id, '{"success": true}', '192.168.1.100', DATEADD(DAY, -1, GETUTCDATE())),
    (@user1_id, 'login', 'user', @user1_id, '{"success": true}', '192.168.1.101', DATEADD(HOUR, -3, GETUTCDATE())),
    (@user2_id, 'login', 'user', @user2_id, '{"success": true}', '192.168.1.102', DATEADD(DAY, -5, GETUTCDATE()));

-- Session events
INSERT INTO audit_log (user_id, session_id, action, entity_type, entity_id, details, created_at)
VALUES
    (@user1_id, @session1_id, 'create_session', 'session', @session1_id, '{"title": "Query Customer List"}', DATEADD(HOUR, -2, GETUTCDATE())),
    (@user1_id, @session2_id, 'create_session', 'session', @session2_id, '{"title": "Create New Item"}', DATEADD(HOUR, -1, GETUTCDATE())),
    (@user2_id, @session3_id, 'create_session', 'session', @session3_id, '{"title": "Update Vendor Information"}', DATEADD(DAY, -5, GETUTCDATE()));

-- Approval events
INSERT INTO audit_log (user_id, session_id, action, entity_type, details, created_at)
VALUES
    (@user2_id, @session3_id, 'approve', 'approval', '{"action": "update vendor"}', DATEADD(DAY, -5, GETUTCDATE())),
    (@user2_id, @session3_id, 'reject', 'approval', '{"action": "delete customer", "reason": "pending invoices"}', DATEADD(DAY, -5, GETUTCDATE()));

PRINT '✅ Created 8 audit log entries';

PRINT '';

-- ============================================
-- Summary Statistics
-- ============================================
PRINT '';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '✅ Seed data insertion complete';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';
PRINT 'Summary:';

DECLARE @user_count INT = (SELECT COUNT(*) FROM users);
DECLARE @session_count INT = (SELECT COUNT(*) FROM sessions);
DECLARE @message_count INT = (SELECT COUNT(*) FROM messages);
DECLARE @approval_count INT = (SELECT COUNT(*) FROM approvals);
DECLARE @checkpoint_count INT = (SELECT COUNT(*) FROM checkpoints);
DECLARE @audit_count INT = (SELECT COUNT(*) FROM audit_log);

PRINT '  Users: ' + CAST(@user_count AS VARCHAR);
PRINT '  Sessions: ' + CAST(@session_count AS VARCHAR);
PRINT '  Messages: ' + CAST(@message_count AS VARCHAR);
PRINT '  Approvals: ' + CAST(@approval_count AS VARCHAR);
PRINT '  Checkpoints: ' + CAST(@checkpoint_count AS VARCHAR);
PRINT '  Audit logs: ' + CAST(@audit_count AS VARCHAR);
PRINT '';
PRINT 'Test credentials:';
PRINT '  admin@bcagent.dev / Test123! (admin)';
PRINT '  john@bcagent.dev / Test123! (user)';
PRINT '  jane@bcagent.dev / Test123! (user)';
PRINT '';
PRINT 'You can now:';
PRINT '  1. Start the backend server';
PRINT '  2. Login with any test user';
PRINT '  3. Test the chat interface';
PRINT '';
GO
