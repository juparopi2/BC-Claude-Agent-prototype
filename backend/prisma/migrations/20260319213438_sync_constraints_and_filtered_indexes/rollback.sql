-- Rollback: revert to original processing_status constraint (no NULL), drop new indexes
ALTER TABLE [dbo].[connection_scopes] DROP CONSTRAINT [CK_connection_scopes_processing_status];
ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_processing_status]
  CHECK ([processing_status] IN ('idle','processing','completed','partial_failure'));

DROP INDEX IF EXISTS [IX_chat_attachments_deleted] ON [dbo].[chat_attachments];
DROP INDEX IF EXISTS [IX_chat_attachments_expires] ON [dbo].[chat_attachments];
DROP INDEX IF EXISTS [IX_files_deletion_pending] ON [dbo].[files];
DROP INDEX IF EXISTS [IX_files_failed_at] ON [dbo].[files];
DROP INDEX IF EXISTS [IX_files_user_favorites] ON [dbo].[files];
DROP INDEX IF EXISTS [IX_message_events_unprocessed] ON [dbo].[message_events];
DROP INDEX IF EXISTS [idx_messages_stop_reason] ON [dbo].[messages];
DROP INDEX IF EXISTS [idx_messages_todo] ON [dbo].[messages];
DROP INDEX IF EXISTS [idx_messages_tool_use_id] ON [dbo].[messages];
DROP INDEX IF EXISTS [IX_messages_event_id] ON [dbo].[messages];
DROP INDEX IF EXISTS [IX_messages_session_sequence] ON [dbo].[messages];

-- Post-rollback: remove migration record
-- DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = '20260319213438_sync_constraints_and_filtered_indexes';
