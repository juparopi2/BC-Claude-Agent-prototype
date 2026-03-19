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

-- ── agent_executions ──────────────────────────────────────────

ALTER TABLE [dbo].[agent_executions] ADD CONSTRAINT [chk_agent_executions_status]
  CHECK ([status] IN ('completed','failed','started'));


-- ── approvals ─────────────────────────────────────────────────

ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_action_type]
  CHECK ([action_type] IN ('create','custom','delete','update'));

ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_priority]
  CHECK ([priority] IN ('high','low','medium'));

ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_status]
  CHECK ([status] IN ('approved','expired','pending','rejected'));


-- ── connection_scopes ─────────────────────────────────────────

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_processing_status]
  CHECK ([processing_status] IN ('completed','idle','partial_failure','processing')
    OR [processing_status] IS NULL);

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_scope_mode]
  CHECK ([scope_mode] IN ('exclude','include'));

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_scope_type]
  CHECK ([scope_type] IN ('file','folder','library','root','site'));

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_sync_status]
  CHECK ([sync_status] IN ('error','idle','sync_queued','synced','syncing'));


-- ── connections ───────────────────────────────────────────────

ALTER TABLE [dbo].[connections] ADD CONSTRAINT [CK_connections_provider]
  CHECK ([provider] IN ('business_central','onedrive','power_bi','sharepoint'));

ALTER TABLE [dbo].[connections] ADD CONSTRAINT [CK_connections_status]
  CHECK ([status] IN ('connected','disconnected','error','expired'));


-- ── files ─────────────────────────────────────────────────────

ALTER TABLE [dbo].[files] ADD CONSTRAINT [CK_files_source_type]
  CHECK ([source_type] IN ('local','onedrive','sharepoint'));


-- ── message_events ────────────────────────────────────────────

ALTER TABLE [dbo].[message_events] ADD CONSTRAINT [CK_message_events_sequence_positive]
  CHECK ([sequence_number] >= 0);

ALTER TABLE [dbo].[message_events] ADD CONSTRAINT [CK_message_events_valid_type]
  CHECK ([event_type] IN ('agent_changed','agent_message_chunk','agent_message_sent','agent_thinking_block','agent_thinking_completed','agent_thinking_started','approval_completed','approval_requested','citations_created','error_occurred','session_ended','session_started','todo_created','todo_updated','tool_use_completed','tool_use_requested','user_message_sent'));


-- ── messages ──────────────────────────────────────────────────

ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_role]
  CHECK ([role] IN ('assistant','system','tool','user'));

ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_stop_reason]
  CHECK ([stop_reason] IN ('end_turn','max_tokens','pause_turn','refusal','stop_sequence','tool_use'));

ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_type]
  CHECK ([message_type] IN ('agent_changed','error','redacted_thinking','server_tool_use','text','thinking','tool_result','tool_use','web_search_tool_result'));


-- ── session_files ─────────────────────────────────────────────

ALTER TABLE [dbo].[session_files] ADD CONSTRAINT [chk_session_files_type]
  CHECK ([file_type] IN ('cloudmd','generated','reference','uploaded'));


-- ── todos ─────────────────────────────────────────────────────

ALTER TABLE [dbo].[todos] ADD CONSTRAINT [chk_todos_status]
  CHECK ([status] IN ('completed','failed','in_progress','pending'));


-- ── user_quotas ───────────────────────────────────────────────

ALTER TABLE [dbo].[user_quotas] ADD CONSTRAINT [CK_user_quotas_plan_tier]
  CHECK ([plan_tier] IN ('enterprise','free','free_trial','pro','unlimited'));


-- ── user_settings ─────────────────────────────────────────────

ALTER TABLE [dbo].[user_settings] ADD CONSTRAINT [CK_user_settings_theme]
  CHECK ([theme] IN ('dark','light','system'));


-- ── users ─────────────────────────────────────────────────────

ALTER TABLE [dbo].[users] ADD CONSTRAINT [chk_users_role]
  CHECK ([role] IN ('admin','editor','viewer'));

-- ============================================================
-- Filtered Indexes
-- ============================================================

CREATE NONCLUSTERED INDEX [IX_chat_attachments_deleted]
  ON [dbo].[chat_attachments] ([deleted_at])
  WHERE [is_deleted]=(1);
CREATE NONCLUSTERED INDEX [IX_chat_attachments_expires]
  ON [dbo].[chat_attachments] ([expires_at])
  WHERE [is_deleted]=(0);

CREATE NONCLUSTERED INDEX [IX_files_deletion_pending]
  ON [dbo].[files] ([id], [user_id], [blob_path], [deletion_status], [deleted_at])
  WHERE [deletion_status] IS NOT NULL;
CREATE NONCLUSTERED INDEX [IX_files_failed_at]
  ON [dbo].[files] ([failed_at])
  WHERE [failed_at] IS NOT NULL;
CREATE NONCLUSTERED INDEX [IX_files_user_favorites]
  ON [dbo].[files] ([user_id], [is_favorite])
  WHERE [is_favorite]=(1);
CREATE UNIQUE NONCLUSTERED INDEX [UQ_files_connection_external]
  ON [dbo].[files] ([connection_id], [external_id])
  WHERE [connection_id] IS NOT NULL AND [external_id] IS NOT NULL;

CREATE NONCLUSTERED INDEX [IX_message_events_unprocessed]
  ON [dbo].[message_events] ([processed], [timestamp])
  WHERE [processed]=(0);

CREATE NONCLUSTERED INDEX [idx_messages_stop_reason]
  ON [dbo].[messages] ([stop_reason])
  WHERE [stop_reason] IS NOT NULL;
CREATE NONCLUSTERED INDEX [idx_messages_todo]
  ON [dbo].[messages] ([current_todo_id])
  WHERE [current_todo_id] IS NOT NULL;
CREATE NONCLUSTERED INDEX [idx_messages_tool_use_id]
  ON [dbo].[messages] ([tool_use_id])
  WHERE [tool_use_id] IS NOT NULL;
CREATE NONCLUSTERED INDEX [IX_messages_event_id]
  ON [dbo].[messages] ([event_id])
  WHERE [event_id] IS NOT NULL;
CREATE NONCLUSTERED INDEX [IX_messages_session_sequence]
  ON [dbo].[messages] ([session_id], [sequence_number])
  WHERE [sequence_number] IS NOT NULL;
