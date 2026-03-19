-- ============================================================
-- ROLLBACK: 20260317162456_initial_schema
-- ============================================================
-- Date created: 2026-03-19
-- Original migration: prisma/migrations/20260317162456_initial_schema/migration.sql
--
-- PURPOSE: Nuclear rollback — drops ALL application tables.
-- Only use in catastrophic scenarios (e.g., fresh environment rebuild).
-- This will destroy ALL data.
--
-- INSTRUCTIONS:
--   1. BACKUP THE DATABASE FIRST
--   2. Run against the target database via sqlcmd or Azure Data Studio
--   3. After execution, drop the migration history:
--      DROP TABLE IF EXISTS _prisma_migrations;
--   4. The database will be empty — redeploy from scratch with:
--      npx prisma migrate deploy
-- ============================================================

-- Drop tables in reverse dependency order (children before parents)

-- Junction/leaf tables (no dependents)
IF OBJECT_ID('[dbo].[message_chat_attachments]', 'U') IS NOT NULL DROP TABLE [dbo].[message_chat_attachments];
IF OBJECT_ID('[dbo].[message_citations]', 'U') IS NOT NULL DROP TABLE [dbo].[message_citations];
IF OBJECT_ID('[dbo].[message_file_attachments]', 'U') IS NOT NULL DROP TABLE [dbo].[message_file_attachments];
IF OBJECT_ID('[dbo].[image_embeddings]', 'U') IS NOT NULL DROP TABLE [dbo].[image_embeddings];
IF OBJECT_ID('[dbo].[file_chunks]', 'U') IS NOT NULL DROP TABLE [dbo].[file_chunks];
IF OBJECT_ID('[dbo].[token_usage]', 'U') IS NOT NULL DROP TABLE [dbo].[token_usage];
IF OBJECT_ID('[dbo].[quota_alerts]', 'U') IS NOT NULL DROP TABLE [dbo].[quota_alerts];
IF OBJECT_ID('[dbo].[usage_events]', 'U') IS NOT NULL DROP TABLE [dbo].[usage_events];
IF OBJECT_ID('[dbo].[usage_aggregates]', 'U') IS NOT NULL DROP TABLE [dbo].[usage_aggregates];
IF OBJECT_ID('[dbo].[billing_records]', 'U') IS NOT NULL DROP TABLE [dbo].[billing_records];
IF OBJECT_ID('[dbo].[user_feedback]', 'U') IS NOT NULL DROP TABLE [dbo].[user_feedback];
IF OBJECT_ID('[dbo].[tool_permissions]', 'U') IS NOT NULL DROP TABLE [dbo].[tool_permissions];
IF OBJECT_ID('[dbo].[user_settings]', 'U') IS NOT NULL DROP TABLE [dbo].[user_settings];
IF OBJECT_ID('[dbo].[user_quotas]', 'U') IS NOT NULL DROP TABLE [dbo].[user_quotas];
IF OBJECT_ID('[dbo].[permission_presets]', 'U') IS NOT NULL DROP TABLE [dbo].[permission_presets];
IF OBJECT_ID('[dbo].[deletion_audit_log]', 'U') IS NOT NULL DROP TABLE [dbo].[deletion_audit_log];
IF OBJECT_ID('[dbo].[agent_usage_analytics]', 'U') IS NOT NULL DROP TABLE [dbo].[agent_usage_analytics];
IF OBJECT_ID('[dbo].[performance_metrics]', 'U') IS NOT NULL DROP TABLE [dbo].[performance_metrics];
IF OBJECT_ID('[dbo].[langgraph_checkpoint_writes]', 'U') IS NOT NULL DROP TABLE [dbo].[langgraph_checkpoint_writes];
IF OBJECT_ID('[dbo].[langgraph_checkpoints]', 'U') IS NOT NULL DROP TABLE [dbo].[langgraph_checkpoints];
IF OBJECT_ID('[dbo].[chat_attachments]', 'U') IS NOT NULL DROP TABLE [dbo].[chat_attachments];

-- Tables with FK to messages
IF OBJECT_ID('[dbo].[approvals]', 'U') IS NOT NULL DROP TABLE [dbo].[approvals];
IF OBJECT_ID('[dbo].[messages]', 'U') IS NOT NULL DROP TABLE [dbo].[messages];

-- Tables with FK to message_events
IF OBJECT_ID('[dbo].[message_events]', 'U') IS NOT NULL DROP TABLE [dbo].[message_events];

-- Tables with FK to sessions
IF OBJECT_ID('[dbo].[agent_executions]', 'U') IS NOT NULL DROP TABLE [dbo].[agent_executions];
IF OBJECT_ID('[dbo].[session_files]', 'U') IS NOT NULL DROP TABLE [dbo].[session_files];
IF OBJECT_ID('[dbo].[todos]', 'U') IS NOT NULL DROP TABLE [dbo].[todos];

-- Tables with FK to files (files → connections → users)
IF OBJECT_ID('[dbo].[files]', 'U') IS NOT NULL DROP TABLE [dbo].[files];
IF OBJECT_ID('[dbo].[upload_batches]', 'U') IS NOT NULL DROP TABLE [dbo].[upload_batches];

-- connection_scopes → connections → users
IF OBJECT_ID('[dbo].[connection_scopes]', 'U') IS NOT NULL DROP TABLE [dbo].[connection_scopes];
IF OBJECT_ID('[dbo].[connections]', 'U') IS NOT NULL DROP TABLE [dbo].[connections];

-- sessions → users
IF OBJECT_ID('[dbo].[sessions]', 'U') IS NOT NULL DROP TABLE [dbo].[sessions];

-- audit_log (FK to users with SET NULL, safe to drop after users)
IF OBJECT_ID('[dbo].[audit_log]', 'U') IS NOT NULL DROP TABLE [dbo].[audit_log];

-- Root table
IF OBJECT_ID('[dbo].[users]', 'U') IS NOT NULL DROP TABLE [dbo].[users];
