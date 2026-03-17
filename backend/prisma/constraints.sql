-- ============================================================
-- CHECK Constraints & Filtered Indexes Registry
-- ============================================================
-- Prisma does NOT support CHECK constraints or filtered indexes.
-- This file is the source of truth for all constraints that exist
-- outside Prisma's schema DSL.
--
-- USAGE:
--   - When generating a new migration with `prisma migrate dev --create-only`,
--     append the relevant constraints from this file to the generated SQL.
--   - When adding a new enum-like value, update the constraint here AND
--     in the migration SQL.
--
-- VERIFY: After any migration, run against the target database:
--   SELECT name, definition FROM sys.check_constraints ORDER BY name;
-- ============================================================

-- ── messages ──────────────────────────────────────────────────

ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_role]
  CHECK ([role] IN ('user','assistant','system','tool'));

ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_type]
  CHECK ([message_type] IN ('text','thinking','redacted_thinking','tool_use',
    'server_tool_use','web_search_tool_result','tool_result','error','agent_changed'));

ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_stop_reason]
  CHECK ([stop_reason] IN ('end_turn','tool_use','max_tokens','stop_sequence',
    'pause_turn','refusal'));

-- ── message_events ────────────────────────────────────────────

ALTER TABLE [dbo].[message_events] ADD CONSTRAINT [CK_message_events_valid_type]
  CHECK ([event_type] IN ('user_message_sent','agent_thinking_started',
    'agent_thinking_completed','agent_thinking_block','agent_message_sent',
    'agent_message_chunk','session_started','session_ended','tool_use_requested',
    'tool_use_completed','error_occurred','todo_created','todo_updated',
    'approval_requested','approval_completed','citations_created','agent_changed'));

ALTER TABLE [dbo].[message_events] ADD CONSTRAINT [CK_message_events_sequence_positive]
  CHECK ([sequence_number] >= 0);

-- ── agent_executions ──────────────────────────────────────────

ALTER TABLE [dbo].[agent_executions] ADD CONSTRAINT [chk_agent_executions_status]
  CHECK ([status] IN ('started','completed','failed'));

-- ── approvals ─────────────────────────────────────────────────

ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_action_type]
  CHECK ([action_type] IN ('create','update','delete','custom'));

ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_priority]
  CHECK ([priority] IN ('low','medium','high'));

ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_status]
  CHECK ([status] IN ('pending','approved','rejected','expired'));

-- ── session_files ─────────────────────────────────────────────

ALTER TABLE [dbo].[session_files] ADD CONSTRAINT [chk_session_files_type]
  CHECK ([file_type] IN ('uploaded','cloudmd','generated','reference'));

-- ── todos ─────────────────────────────────────────────────────

ALTER TABLE [dbo].[todos] ADD CONSTRAINT [chk_todos_status]
  CHECK ([status] IN ('pending','in_progress','completed','failed'));

-- ── user_quotas ───────────────────────────────────────────────

ALTER TABLE [dbo].[user_quotas] ADD CONSTRAINT [CK_user_quotas_plan_tier]
  CHECK ([plan_tier] IN ('free','free_trial','pro','enterprise','unlimited'));

-- ── user_settings ─────────────────────────────────────────────

ALTER TABLE [dbo].[user_settings] ADD CONSTRAINT [CK_user_settings_theme]
  CHECK ([theme] IN ('light','dark','system'));

-- ── users ─────────────────────────────────────────────────────

ALTER TABLE [dbo].[users] ADD CONSTRAINT [chk_users_role]
  CHECK ([role] IN ('admin','editor','viewer'));

-- ── connections ───────────────────────────────────────────────

ALTER TABLE [dbo].[connections] ADD CONSTRAINT [CK_connections_provider]
  CHECK ([provider] IN ('business_central','onedrive','sharepoint','power_bi'));

ALTER TABLE [dbo].[connections] ADD CONSTRAINT [CK_connections_status]
  CHECK ([status] IN ('disconnected','connected','expired','error'));

-- ── connection_scopes ─────────────────────────────────────────

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_scope_type]
  CHECK ([scope_type] IN ('root','folder','file','site','library'));

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_sync_status]
  CHECK ([sync_status] IN ('idle','sync_queued','syncing','synced','error'));

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_scope_mode]
  CHECK ([scope_mode] IN ('include','exclude'));

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_processing_status]
  CHECK ([processing_status] IN ('idle','processing','completed','partial_failure'));

-- ── files ─────────────────────────────────────────────────────

ALTER TABLE [dbo].[files] ADD CONSTRAINT [CK_files_source_type]
  CHECK ([source_type] IN ('local','onedrive','sharepoint'));

-- ============================================================
-- Filtered Unique Indexes
-- ============================================================

-- Prevents duplicate file records when syncing from cloud connectors.
-- Filter allows NULLs (local uploads have no connection_id/external_id).
CREATE UNIQUE NONCLUSTERED INDEX [UQ_files_connection_external]
  ON [dbo].[files] ([connection_id], [external_id])
  WHERE [connection_id] IS NOT NULL AND [external_id] IS NOT NULL;
