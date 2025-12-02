-- =============================================================================
-- E2E Test Data Seed Script for DEV Database
-- =============================================================================
-- Database: sqldb-bcagent-dev
-- Server: sqlsrv-bcagent-dev.database.windows.net
--
-- This script creates REAL test data in the DEV database for E2E testing.
-- Run this script once to set up the test environment.
--
-- IMPORTANT: These are fixed IDs that match e2e/fixtures/test-data.ts
-- =============================================================================

-- Required SET options for Azure SQL
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Use transaction for safety
BEGIN TRANSACTION;

PRINT 'Starting E2E test data seed...';

-- =============================================================================
-- 1. Test Users
-- =============================================================================

-- Clean up existing test users (idempotent)
DELETE FROM users WHERE id IN (
    'e2e00001-0000-0000-0000-000000000001',
    'e2e00002-0000-0000-0000-000000000002'
);

PRINT 'Inserting test users...';

-- TEST_USER - Primary E2E User (editor role)
INSERT INTO users (
    id,
    email,
    full_name,
    is_active,
    is_admin,
    role,
    microsoft_id,
    microsoft_email,
    microsoft_tenant_id,
    created_at,
    updated_at
) VALUES (
    'e2e00001-0000-0000-0000-000000000001',
    'e2e-test@bcagent.test',
    'E2E Test User',
    1,  -- is_active
    0,  -- is_admin
    'editor',
    'e2e-microsoft-id-001',
    'e2e-test@bcagent.test',
    'e2e-tenant-id',
    GETDATE(),
    GETDATE()
);

-- TEST_ADMIN_USER - Admin user for admin-specific tests
INSERT INTO users (
    id,
    email,
    full_name,
    is_active,
    is_admin,
    role,
    microsoft_id,
    microsoft_email,
    microsoft_tenant_id,
    created_at,
    updated_at
) VALUES (
    'e2e00002-0000-0000-0000-000000000002',
    'e2e-admin@bcagent.test',
    'E2E Admin User',
    1,  -- is_active
    1,  -- is_admin
    'admin',
    'e2e-microsoft-id-002',
    'e2e-admin@bcagent.test',
    'e2e-tenant-id',
    GETDATE(),
    GETDATE()
);

PRINT 'Test users inserted successfully.';

-- =============================================================================
-- 2. Test Sessions
-- =============================================================================

-- Clean up existing test sessions (cascade deletes messages, approvals, etc.)
DELETE FROM sessions WHERE id IN (
    'e2e10001-0000-0000-0000-000000000001',
    'e2e10002-0000-0000-0000-000000000002',
    'e2e10003-0000-0000-0000-000000000003',
    'e2e10004-0000-0000-0000-000000000004',
    'e2e10005-0000-0000-0000-000000000005',
    'e2e10006-0000-0000-0000-000000000006'
);

PRINT 'Inserting test sessions...';

-- Empty session - no messages
INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
VALUES (
    'e2e10001-0000-0000-0000-000000000001',
    'e2e00001-0000-0000-0000-000000000001',
    'E2E Empty Session',
    1,
    GETDATE(),
    GETDATE()
);

-- Session with conversation history
INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
VALUES (
    'e2e10002-0000-0000-0000-000000000002',
    'e2e00001-0000-0000-0000-000000000001',
    'E2E Session With History',
    1,
    GETDATE(),
    GETDATE()
);

-- Session with tool use messages
INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
VALUES (
    'e2e10003-0000-0000-0000-000000000003',
    'e2e00001-0000-0000-0000-000000000001',
    'E2E Session With Tool Use',
    1,
    GETDATE(),
    GETDATE()
);

-- Session with pending approval
INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
VALUES (
    'e2e10004-0000-0000-0000-000000000004',
    'e2e00001-0000-0000-0000-000000000001',
    'E2E Session With Approval',
    1,
    GETDATE(),
    GETDATE()
);

-- Inactive (deleted) session
INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
VALUES (
    'e2e10005-0000-0000-0000-000000000005',
    'e2e00001-0000-0000-0000-000000000001',
    'E2E Deleted Session',
    0,  -- is_active = false (soft deleted)
    GETDATE(),
    GETDATE()
);

-- Admin user's session (for isolation tests)
INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
VALUES (
    'e2e10006-0000-0000-0000-000000000006',
    'e2e00002-0000-0000-0000-000000000002',
    'E2E Admin Session',
    1,
    GETDATE(),
    GETDATE()
);

PRINT 'Test sessions inserted successfully.';

-- =============================================================================
-- 3. Test Messages (for session with history)
-- =============================================================================

PRINT 'Inserting test messages...';

-- Messages for session "withHistory" (e2e10002)
INSERT INTO messages (id, session_id, role, content, metadata, message_type, sequence_number, created_at)
VALUES (
    'msg_e2e_user_0001',
    'e2e10002-0000-0000-0000-000000000002',
    'user',
    'Hello, what can you help me with?',
    '{}',
    'text',
    0,
    GETDATE()
);

INSERT INTO messages (id, session_id, role, content, metadata, message_type, sequence_number, model, input_tokens, output_tokens, stop_reason, created_at)
VALUES (
    'msg_e2e_asst_0001',
    'e2e10002-0000-0000-0000-000000000002',
    'assistant',
    'Hello! I can help you interact with Business Central. I can query customers, sales orders, items, and more. What would you like to do?',
    '{}',
    'text',
    1,
    'claude-sonnet-4-5-20250929',
    150,
    45,
    'end_turn',
    GETDATE()
);

INSERT INTO messages (id, session_id, role, content, metadata, message_type, sequence_number, created_at)
VALUES (
    'msg_e2e_user_0002',
    'e2e10002-0000-0000-0000-000000000002',
    'user',
    'Show me the list of available entities',
    '{}',
    'text',
    2,
    GETDATE()
);

INSERT INTO messages (id, session_id, role, content, metadata, message_type, sequence_number, model, input_tokens, output_tokens, stop_reason, created_at)
VALUES (
    'msg_e2e_asst_0002',
    'e2e10002-0000-0000-0000-000000000002',
    'assistant',
    'Here are the available Business Central entities you can work with:

1. Customers
2. Vendors
3. Items
4. Sales Orders
5. Purchase Orders

Which one would you like to explore?',
    '{}',
    'text',
    3,
    'claude-sonnet-4-5-20250929',
    200,
    80,
    'end_turn',
    GETDATE()
);

-- Messages for session "withToolUse" (e2e10003)
INSERT INTO messages (id, session_id, role, content, metadata, message_type, sequence_number, created_at)
VALUES (
    'msg_e2e_user_0010',
    'e2e10003-0000-0000-0000-000000000003',
    'user',
    'List all available BC entities',
    '{}',
    'text',
    0,
    GETDATE()
);

INSERT INTO messages (id, session_id, role, content, metadata, message_type, sequence_number, tool_use_id, model, input_tokens, output_tokens, stop_reason, created_at)
VALUES (
    'msg_e2e_asst_0010',
    'e2e10003-0000-0000-0000-000000000003',
    'assistant',
    '',
    '{"tool_name": "list_all_entities", "tool_args": {}, "tool_use_id": "toolu_e2e_0001", "status": "success"}',
    'tool_use',
    1,
    'toolu_e2e_0001',
    'claude-sonnet-4-5-20250929',
    180,
    50,
    'tool_use',
    GETDATE()
);

INSERT INTO messages (id, session_id, role, content, metadata, message_type, sequence_number, tool_use_id, created_at)
VALUES (
    'msg_e2e_asst_0011',
    'e2e10003-0000-0000-0000-000000000003',
    'assistant',
    '',
    '{"tool_name": "list_all_entities", "tool_args": {}, "tool_use_id": "toolu_e2e_0001", "status": "success", "tool_result": {"entities": ["customers", "vendors", "items", "salesOrders", "purchaseOrders"], "count": 5}}',
    'tool_result',
    2,
    'toolu_e2e_0001',
    GETDATE()
);

INSERT INTO messages (id, session_id, role, content, metadata, message_type, sequence_number, model, input_tokens, output_tokens, stop_reason, created_at)
VALUES (
    'msg_e2e_asst_0012',
    'e2e10003-0000-0000-0000-000000000003',
    'assistant',
    'I found 5 Business Central entities available: customers, vendors, items, salesOrders, and purchaseOrders.',
    '{}',
    'text',
    3,
    'claude-sonnet-4-5-20250929',
    250,
    35,
    'end_turn',
    GETDATE()
);

PRINT 'Test messages inserted successfully.';

-- =============================================================================
-- 4. Test Approvals
-- =============================================================================

PRINT 'Inserting test approvals...';

-- Pending approval (expires in 5 minutes)
INSERT INTO approvals (
    id,
    session_id,
    tool_name,
    tool_args,
    action_type,
    action_description,
    status,
    priority,
    expires_at,
    created_at
) VALUES (
    'e2e30001-0000-0000-0000-000000000001',
    'e2e10004-0000-0000-0000-000000000004',
    'bc_create_customer',
    '{"name": "Test Customer Corp", "email": "test@customer.com"}',
    'create',
    'Create new customer: Test Customer Corp',
    'pending',
    'high',
    DATEADD(minute, 5, GETDATE()),
    GETDATE()
);

-- Approved approval (historical)
INSERT INTO approvals (
    id,
    session_id,
    tool_name,
    tool_args,
    action_type,
    action_description,
    status,
    priority,
    decided_by_user_id,
    decided_at,
    created_at
) VALUES (
    'e2e30002-0000-0000-0000-000000000002',
    'e2e10004-0000-0000-0000-000000000004',
    'bc_update_item',
    '{"itemId": "ITEM001", "unitPrice": 99.99}',
    'update',
    'Update item price: ITEM001',
    'approved',
    'medium',
    'e2e00001-0000-0000-0000-000000000001',
    GETDATE(),
    DATEADD(minute, -10, GETDATE())
);

-- Rejected approval (historical)
INSERT INTO approvals (
    id,
    session_id,
    tool_name,
    tool_args,
    action_type,
    action_description,
    status,
    priority,
    decided_by_user_id,
    rejection_reason,
    decided_at,
    created_at
) VALUES (
    'e2e30003-0000-0000-0000-000000000003',
    'e2e10004-0000-0000-0000-000000000004',
    'bc_delete_customer',
    '{"customerId": "CUST001"}',
    'delete',
    'Delete customer: CUST001',
    'rejected',
    'high',
    'e2e00001-0000-0000-0000-000000000001',
    'Operation not authorized for this customer',
    GETDATE(),
    DATEADD(minute, -15, GETDATE())
);

PRINT 'Test approvals inserted successfully.';

-- =============================================================================
-- Commit Transaction
-- =============================================================================

COMMIT TRANSACTION;

PRINT '';
PRINT '============================================';
PRINT 'E2E Test Data Seed Completed Successfully!';
PRINT '============================================';
PRINT '';
PRINT 'Test Users:';
PRINT '  - e2e00001-...: E2E Test User (editor)';
PRINT '  - e2e00002-...: E2E Admin User (admin)';
PRINT '';
PRINT 'Test Sessions:';
PRINT '  - e2e10001-...: Empty Session';
PRINT '  - e2e10002-...: Session With History (4 messages)';
PRINT '  - e2e10003-...: Session With Tool Use (4 messages)';
PRINT '  - e2e10004-...: Session With Approval (3 approvals)';
PRINT '  - e2e10005-...: Deleted Session (inactive)';
PRINT '  - e2e10006-...: Admin Session';
PRINT '';
PRINT 'Test Approvals:';
PRINT '  - e2e30001-...: Pending approval (create customer)';
PRINT '  - e2e30002-...: Approved (update item)';
PRINT '  - e2e30003-...: Rejected (delete customer)';
PRINT '';
