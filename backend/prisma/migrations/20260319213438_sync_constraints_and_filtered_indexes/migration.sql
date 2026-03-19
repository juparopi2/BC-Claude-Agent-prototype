-- Sync CHECK constraints and filtered indexes with constraints.sql registry
-- These were applied to dev via db push but never had migration files.

BEGIN TRY

BEGIN TRAN;

-- ============================================================
-- 1. Update CK_connection_scopes_processing_status to allow NULL
-- ============================================================
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_connection_scopes_processing_status'
)
  ALTER TABLE [dbo].[connection_scopes] DROP CONSTRAINT [CK_connection_scopes_processing_status];

ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_processing_status]
  CHECK ([processing_status] IN ('idle','processing','completed','partial_failure')
    OR [processing_status] IS NULL);

-- ============================================================
-- 2. Add filtered indexes (IF NOT EXISTS guards)
-- ============================================================

-- chat_attachments
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chat_attachments_deleted')
  CREATE NONCLUSTERED INDEX [IX_chat_attachments_deleted]
    ON [dbo].[chat_attachments] ([deleted_at]) WHERE [is_deleted]=(1);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chat_attachments_expires')
  CREATE NONCLUSTERED INDEX [IX_chat_attachments_expires]
    ON [dbo].[chat_attachments] ([expires_at]) WHERE [is_deleted]=(0);

-- files
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_files_deletion_pending')
  CREATE NONCLUSTERED INDEX [IX_files_deletion_pending]
    ON [dbo].[files] ([id], [user_id], [blob_path], [deletion_status], [deleted_at])
    WHERE [deletion_status] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_files_failed_at')
  CREATE NONCLUSTERED INDEX [IX_files_failed_at]
    ON [dbo].[files] ([failed_at]) WHERE [failed_at] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_files_user_favorites')
  CREATE NONCLUSTERED INDEX [IX_files_user_favorites]
    ON [dbo].[files] ([user_id], [is_favorite]) WHERE [is_favorite]=(1);

-- message_events
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_message_events_unprocessed')
  CREATE NONCLUSTERED INDEX [IX_message_events_unprocessed]
    ON [dbo].[message_events] ([processed], [timestamp]) WHERE [processed]=(0);

-- messages
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_messages_stop_reason')
  CREATE NONCLUSTERED INDEX [idx_messages_stop_reason]
    ON [dbo].[messages] ([stop_reason]) WHERE [stop_reason] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_messages_todo')
  CREATE NONCLUSTERED INDEX [idx_messages_todo]
    ON [dbo].[messages] ([current_todo_id]) WHERE [current_todo_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_messages_tool_use_id')
  CREATE NONCLUSTERED INDEX [idx_messages_tool_use_id]
    ON [dbo].[messages] ([tool_use_id]) WHERE [tool_use_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_messages_event_id')
  CREATE NONCLUSTERED INDEX [IX_messages_event_id]
    ON [dbo].[messages] ([event_id]) WHERE [event_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_messages_session_sequence')
  CREATE NONCLUSTERED INDEX [IX_messages_session_sequence]
    ON [dbo].[messages] ([session_id], [sequence_number]) WHERE [sequence_number] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
