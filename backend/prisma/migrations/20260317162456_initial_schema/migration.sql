BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[agent_executions] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__agent_execut__id__40058253] DEFAULT newid(),
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [agent_type] NVARCHAR(100) NOT NULL,
    [action] NVARCHAR(100) NOT NULL,
    [input_data] NVARCHAR(max),
    [output_data] NVARCHAR(max),
    [status] NVARCHAR(50) NOT NULL CONSTRAINT [DF__agent_exe__statu__40F9A68C] DEFAULT 'started',
    [error_message] NVARCHAR(max),
    [error_stack] NVARCHAR(max),
    [duration_ms] INT,
    [tokens_used] INT,
    [thinking_tokens] INT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__agent_exe__creat__41EDCAC5] DEFAULT getutcdate(),
    [completed_at] DATETIME2,
    CONSTRAINT [PK__agent_ex__3213E83F268230FD] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[approvals] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__approvals__id__09A971A2] DEFAULT newid(),
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [message_id] NVARCHAR(255),
    [action_type] NVARCHAR(100) NOT NULL,
    [action_description] NVARCHAR(max) NOT NULL,
    [action_data] NVARCHAR(max),
    [status] NVARCHAR(50) NOT NULL CONSTRAINT [DF__approvals__statu__0A9D95DB] DEFAULT 'pending',
    [decided_by_user_id] UNIQUEIDENTIFIER,
    [decided_at] DATETIME2,
    [rejection_reason] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__approvals__creat__0B91BA14] DEFAULT getutcdate(),
    [tool_name] NVARCHAR(100) NOT NULL,
    [tool_args] NVARCHAR(max),
    [expires_at] DATETIME2,
    [priority] NVARCHAR(20) NOT NULL CONSTRAINT [DF__approvals__prior__078C1F06] DEFAULT 'medium',
    CONSTRAINT [PK__approval__3213E83F0F00F114] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[audit_log] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__audit_log__id__58D1301D] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER,
    [session_id] UNIQUEIDENTIFIER,
    [action] NVARCHAR(100) NOT NULL,
    [entity_type] NVARCHAR(100),
    [entity_id] UNIQUEIDENTIFIER,
    [details] NVARCHAR(max),
    [ip_address] NVARCHAR(50),
    [user_agent] NVARCHAR(500),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__audit_log__creat__59C55456] DEFAULT getutcdate(),
    [event_type] NVARCHAR(100) NOT NULL,
    [event_data] NVARCHAR(max),
    CONSTRAINT [PK__audit_lo__3213E83F5EBAC4A4] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[billing_records] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__billing_reco__id__69C6B1F5] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [billing_period_start] DATETIME2 NOT NULL,
    [billing_period_end] DATETIME2 NOT NULL,
    [total_tokens] BIGINT NOT NULL CONSTRAINT [DF__billing_r__total__6ABAD62E] DEFAULT 0,
    [total_api_calls] INT NOT NULL CONSTRAINT [DF__billing_r__total__6BAEFA67] DEFAULT 0,
    [total_storage_bytes] BIGINT NOT NULL CONSTRAINT [DF__billing_r__total__6CA31EA0] DEFAULT 0,
    [base_cost] DECIMAL(18,8) NOT NULL CONSTRAINT [DF__billing_r__base___6D9742D9] DEFAULT 0.0,
    [usage_cost] DECIMAL(18,8) NOT NULL CONSTRAINT [DF__billing_r__usage__6E8B6712] DEFAULT 0.0,
    [overage_cost] DECIMAL(18,8) NOT NULL CONSTRAINT [DF__billing_r__overa__6F7F8B4B] DEFAULT 0.0,
    [total_cost] DECIMAL(18,8) NOT NULL CONSTRAINT [DF__billing_r__total__7073AF84] DEFAULT 0.0,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [DF__billing_r__statu__7167D3BD] DEFAULT 'pending',
    [payment_method] NVARCHAR(50),
    [paid_at] DATETIME2,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__billing_r__creat__725BF7F6] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF__billing_r__updat__73501C2F] DEFAULT getutcdate(),
    CONSTRAINT [PK__billing___3213E83F8DF5D999] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[chat_attachments] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__chat_attachm__id__62E4AA3C] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [name] NVARCHAR(512) NOT NULL,
    [mime_type] VARCHAR(100) NOT NULL,
    [size_bytes] BIGINT NOT NULL,
    [blob_path] VARCHAR(2048) NOT NULL,
    [content_hash] VARCHAR(64),
    [anthropic_file_id] NVARCHAR(255),
    [expires_at] DATETIME2 NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__chat_atta__creat__63D8CE75] DEFAULT getutcdate(),
    [is_deleted] BIT NOT NULL CONSTRAINT [DF__chat_atta__is_de__64CCF2AE] DEFAULT 0,
    [deleted_at] DATETIME2,
    CONSTRAINT [PK_chat_attachments] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[connections] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [connections_id_df] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [provider] NVARCHAR(50) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [connections_status_df] DEFAULT 'disconnected',
    [display_name] NVARCHAR(255),
    [access_token_encrypted] NVARCHAR(max),
    [refresh_token_encrypted] NVARCHAR(max),
    [token_expires_at] DATETIME2,
    [microsoft_tenant_id] NVARCHAR(255),
    [microsoft_resource_id] NVARCHAR(255),
    [microsoft_drive_id] NVARCHAR(200),
    [msal_home_account_id] NVARCHAR(512),
    [scopes_granted] NVARCHAR(max),
    [last_error] NVARCHAR(max),
    [last_error_at] DATETIME2,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [connections_created_at_df] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [connections_updated_at_df] DEFAULT getutcdate(),
    CONSTRAINT [connections_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_connections_user_provider] UNIQUE NONCLUSTERED ([user_id],[provider])
);

-- CreateTable
CREATE TABLE [dbo].[connection_scopes] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [connection_scopes_id_df] DEFAULT newid(),
    [connection_id] UNIQUEIDENTIFIER NOT NULL,
    [scope_type] NVARCHAR(50) NOT NULL,
    [scope_resource_id] NVARCHAR(512),
    [scope_display_name] NVARCHAR(255),
    [scope_path] NVARCHAR(1000),
    [sync_status] NVARCHAR(20) NOT NULL CONSTRAINT [connection_scopes_sync_status_df] DEFAULT 'idle',
    [last_sync_at] DATETIME2,
    [last_sync_error] NVARCHAR(max),
    [last_sync_cursor] NVARCHAR(max),
    [item_count] INT NOT NULL CONSTRAINT [connection_scopes_item_count_df] DEFAULT 0,
    [subscription_id] NVARCHAR(512),
    [subscription_expires_at] DATETIME2,
    [client_state] NVARCHAR(200),
    [remote_drive_id] NVARCHAR(200),
    [scope_mode] NVARCHAR(20) NOT NULL CONSTRAINT [connection_scopes_scope_mode_df] DEFAULT 'include',
    [scope_site_id] NVARCHAR(500),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [connection_scopes_created_at_df] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [connection_scopes_updated_at_df] DEFAULT getutcdate(),
    [processing_total] INT NOT NULL CONSTRAINT [connection_scopes_processing_total_df] DEFAULT 0,
    [processing_completed] INT NOT NULL CONSTRAINT [connection_scopes_processing_completed_df] DEFAULT 0,
    [processing_failed] INT NOT NULL CONSTRAINT [connection_scopes_processing_failed_df] DEFAULT 0,
    [processing_status] NVARCHAR(30),
    CONSTRAINT [connection_scopes_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[langgraph_checkpoints] (
    [thread_id] NVARCHAR(255) NOT NULL,
    [checkpoint_ns] NVARCHAR(255) NOT NULL CONSTRAINT [langgraph_checkpoints_checkpoint_ns_df] DEFAULT '',
    [checkpoint_id] NVARCHAR(255) NOT NULL,
    [parent_checkpoint_id] NVARCHAR(255),
    [checkpoint_data] VARBINARY(max) NOT NULL,
    [metadata] VARBINARY(max) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [langgraph_checkpoints_created_at_df] DEFAULT getutcdate(),
    CONSTRAINT [langgraph_checkpoints_pkey] PRIMARY KEY CLUSTERED ([thread_id],[checkpoint_ns],[checkpoint_id])
);

-- CreateTable
CREATE TABLE [dbo].[langgraph_checkpoint_writes] (
    [thread_id] NVARCHAR(255) NOT NULL,
    [checkpoint_ns] NVARCHAR(255) NOT NULL CONSTRAINT [langgraph_checkpoint_writes_checkpoint_ns_df] DEFAULT '',
    [checkpoint_id] NVARCHAR(255) NOT NULL,
    [task_id] NVARCHAR(255) NOT NULL,
    [idx] INT NOT NULL,
    [channel] NVARCHAR(255) NOT NULL,
    [type] NVARCHAR(255) NOT NULL,
    [value] VARBINARY(max) NOT NULL,
    CONSTRAINT [langgraph_checkpoint_writes_pkey] PRIMARY KEY CLUSTERED ([thread_id],[checkpoint_ns],[checkpoint_id],[task_id],[idx])
);

-- CreateTable
CREATE TABLE [dbo].[agent_usage_analytics] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [agent_usage_analytics_id_df] DEFAULT newid(),
    [date] DATE NOT NULL,
    [agent_id] NVARCHAR(100) NOT NULL,
    [invocation_count] INT NOT NULL CONSTRAINT [agent_usage_analytics_invocation_count_df] DEFAULT 0,
    [success_count] INT NOT NULL CONSTRAINT [agent_usage_analytics_success_count_df] DEFAULT 0,
    [error_count] INT NOT NULL CONSTRAINT [agent_usage_analytics_error_count_df] DEFAULT 0,
    [total_input_tokens] BIGINT NOT NULL CONSTRAINT [agent_usage_analytics_total_input_tokens_df] DEFAULT 0,
    [total_output_tokens] BIGINT NOT NULL CONSTRAINT [agent_usage_analytics_total_output_tokens_df] DEFAULT 0,
    [total_latency_ms] BIGINT NOT NULL CONSTRAINT [agent_usage_analytics_total_latency_ms_df] DEFAULT 0,
    [min_latency_ms] INT,
    [max_latency_ms] INT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [agent_usage_analytics_created_at_df] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [agent_usage_analytics_updated_at_df] DEFAULT getutcdate(),
    CONSTRAINT [agent_usage_analytics_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [agent_usage_analytics_date_agent_id_key] UNIQUE NONCLUSTERED ([date],[agent_id])
);

-- CreateTable
CREATE TABLE [dbo].[deletion_audit_log] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__deletion_aud__id__047AA831] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [resource_type] NVARCHAR(50) NOT NULL,
    [resource_id] UNIQUEIDENTIFIER NOT NULL,
    [resource_name] NVARCHAR(500),
    [deletion_reason] NVARCHAR(255),
    [requested_by] NVARCHAR(255),
    [deleted_from_db] BIT CONSTRAINT [DF__deletion___delet__056ECC6A] DEFAULT 0,
    [deleted_from_blob] BIT CONSTRAINT [DF__deletion___delet__0662F0A3] DEFAULT 0,
    [deleted_from_search] BIT CONSTRAINT [DF__deletion___delet__075714DC] DEFAULT 0,
    [deleted_from_cache] BIT CONSTRAINT [DF__deletion___delet__084B3915] DEFAULT 0,
    [child_files_deleted] INT CONSTRAINT [DF__deletion___child__093F5D4E] DEFAULT 0,
    [child_chunks_deleted] INT CONSTRAINT [DF__deletion___child__0A338187] DEFAULT 0,
    [requested_at] DATETIME2 CONSTRAINT [DF__deletion___reque__0B27A5C0] DEFAULT getutcdate(),
    [completed_at] DATETIME2,
    [status] NVARCHAR(50) CONSTRAINT [DF__deletion___statu__0C1BC9F9] DEFAULT 'pending',
    [error_details] NVARCHAR(max),
    [metadata] NVARCHAR(max),
    CONSTRAINT [PK__deletion__3213E83F227C67D7] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[file_chunks] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__file_chunks__id__44952D46] DEFAULT newid(),
    [file_id] UNIQUEIDENTIFIER NOT NULL,
    [chunk_index] INT NOT NULL,
    [chunk_text] NVARCHAR(max) NOT NULL,
    [chunk_tokens] INT NOT NULL,
    [search_document_id] NVARCHAR(255),
    [created_at] DATETIME2 CONSTRAINT [DF__file_chun__creat__4589517F] DEFAULT getutcdate(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [metadata] NVARCHAR(max),
    CONSTRAINT [PK__file_chu__3213E83F4561EC3B] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[files] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__files__id__3A179ED3] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [parent_folder_id] UNIQUEIDENTIFIER,
    [name] NVARCHAR(500) NOT NULL,
    [mime_type] NVARCHAR(255) NOT NULL,
    [size_bytes] BIGINT NOT NULL,
    [blob_path] NVARCHAR(1000),
    [is_folder] BIT NOT NULL CONSTRAINT [DF__files__is_folder__3B0BC30C] DEFAULT 0,
    [is_favorite] BIT NOT NULL CONSTRAINT [DF__files__is_favori__3BFFE745] DEFAULT 0,
    [extracted_text] NVARCHAR(max),
    [created_at] DATETIME2 CONSTRAINT [DF__files__created_a__3EDC53F0] DEFAULT getutcdate(),
    [updated_at] DATETIME2 CONSTRAINT [DF__files__updated_a__3FD07829] DEFAULT getutcdate(),
    [source_type] VARCHAR(50) NOT NULL CONSTRAINT [DF__files__source_ty__2AA05119] DEFAULT 'local',
    [external_id] VARCHAR(512),
    [external_metadata] NVARCHAR(max),
    [last_synced_at] DATETIME2,
    [content_hash] CHAR(64),
    [connection_id] UNIQUEIDENTIFIER,
    [connection_scope_id] UNIQUEIDENTIFIER,
    [external_drive_id] VARCHAR(512),
    [external_url] NVARCHAR(2048),
    [external_modified_at] DATETIME2,
    [content_hash_external] CHAR(64),
    [processing_retry_count] INT NOT NULL CONSTRAINT [DF__files__processin__3335971A] DEFAULT 0,
    [embedding_retry_count] INT NOT NULL CONSTRAINT [DF__files__embedding__3429BB53] DEFAULT 0,
    [last_processing_error] NVARCHAR(1000),
    [last_embedding_error] NVARCHAR(1000),
    [failed_at] DATETIME2,
    [deletion_status] NVARCHAR(20),
    [deleted_at] DATETIME2,
    [pipeline_status] NVARCHAR(50) NOT NULL,
    [batch_id] UNIQUEIDENTIFIER,
    [pipeline_retry_count] INT NOT NULL CONSTRAINT [files_pipeline_retry_count_df] DEFAULT 0,
    [file_modified_at] DATETIME2,
    [is_shared] BIT NOT NULL CONSTRAINT [files_is_shared_df] DEFAULT 0,
    CONSTRAINT [PK__files__3213E83F64B37894] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[upload_batches] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [upload_batches_id_df] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [status] NVARCHAR(50) NOT NULL CONSTRAINT [upload_batches_status_df] DEFAULT 'active',
    [total_files] INT NOT NULL,
    [confirmed_count] INT NOT NULL CONSTRAINT [upload_batches_confirmed_count_df] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [upload_batches_created_at_df] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [upload_batches_updated_at_df] DEFAULT getutcdate(),
    [expires_at] DATETIME2 NOT NULL,
    [metadata] NVARCHAR(max),
    [processed_count] INT NOT NULL CONSTRAINT [upload_batches_processed_count_df] DEFAULT 0,
    CONSTRAINT [upload_batches_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[image_embeddings] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__image_embedd__id__23F3538A] DEFAULT newid(),
    [file_id] UNIQUEIDENTIFIER NOT NULL,
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [embedding] NVARCHAR(max) NOT NULL,
    [dimensions] INT NOT NULL CONSTRAINT [DF__image_emb__dimen__24E777C3] DEFAULT 1024,
    [model] NVARCHAR(100) NOT NULL CONSTRAINT [DF__image_emb__model__25DB9BFC] DEFAULT 'azure-vision-vectorize-image',
    [model_version] NVARCHAR(50) NOT NULL CONSTRAINT [DF__image_emb__model__26CFC035] DEFAULT '2023-04-15',
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__image_emb__creat__27C3E46E] DEFAULT getutcdate(),
    [updated_at] DATETIME2,
    [caption] NVARCHAR(max),
    [caption_confidence] FLOAT(53),
    CONSTRAINT [PK__image_em__3213E83FD31C019B] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_image_embeddings_file] UNIQUE NONCLUSTERED ([file_id])
);

-- CreateTable
CREATE TABLE [dbo].[message_chat_attachments] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__message_chat__id__6B79F03D] DEFAULT newid(),
    [message_id] NVARCHAR(255) NOT NULL,
    [chat_attachment_id] UNIQUEIDENTIFIER NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__message_c__creat__6C6E1476] DEFAULT getutcdate(),
    CONSTRAINT [PK_message_chat_attachments] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_message_attachment] UNIQUE NONCLUSTERED ([message_id],[chat_attachment_id])
);

-- CreateTable
CREATE TABLE [dbo].[message_citations] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__message_cita__id__2D7CBDC4] DEFAULT newid(),
    [message_id] NVARCHAR(255) NOT NULL,
    [file_id] UNIQUEIDENTIFIER,
    [file_name] NVARCHAR(512) NOT NULL,
    [source_type] VARCHAR(50) NOT NULL,
    [mime_type] VARCHAR(100) NOT NULL,
    [relevance_score] DECIMAL(5,4) NOT NULL,
    [is_image] BIT NOT NULL CONSTRAINT [DF__message_c__is_im__2E70E1FD] DEFAULT 0,
    [excerpt_count] INT NOT NULL CONSTRAINT [DF__message_c__excer__2F650636] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__message_c__creat__30592A6F] DEFAULT getutcdate(),
    CONSTRAINT [PK__message___3213E83F97B30FE9] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[message_events] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__message_even__id__214BF109] DEFAULT newid(),
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [event_type] NVARCHAR(50) NOT NULL,
    [sequence_number] INT NOT NULL,
    [timestamp] DATETIME2 NOT NULL CONSTRAINT [DF__message_e__times__22401542] DEFAULT getutcdate(),
    [data] NVARCHAR(max) NOT NULL,
    [processed] BIT NOT NULL CONSTRAINT [DF__message_e__proce__2334397B] DEFAULT 0,
    CONSTRAINT [PK__message___3213E83F3327D1FC] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_message_events_session_sequence] UNIQUE NONCLUSTERED ([session_id],[sequence_number])
);

-- CreateTable
CREATE TABLE [dbo].[message_file_attachments] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__message_file__id__4959E263] DEFAULT newid(),
    [message_id] NVARCHAR(255) NOT NULL,
    [file_id] UNIQUEIDENTIFIER NOT NULL,
    [usage_type] NVARCHAR(50) NOT NULL,
    [relevance_score] FLOAT(53),
    [created_at] DATETIME2 CONSTRAINT [DF__message_f__creat__4A4E069C] DEFAULT getutcdate(),
    CONSTRAINT [PK__message___3213E83FE352E597] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[messages] (
    [id] NVARCHAR(255) NOT NULL,
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [role] NVARCHAR(50) NOT NULL,
    [content] NVARCHAR(max) NOT NULL,
    [metadata] NVARCHAR(max),
    [token_count] INT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__messages__create__04E4BC85] DEFAULT getutcdate(),
    [message_type] NVARCHAR(20) NOT NULL,
    [stop_reason] NVARCHAR(20),
    [sequence_number] INT,
    [event_id] UNIQUEIDENTIFIER,
    [tool_use_id] NVARCHAR(255),
    [model] NVARCHAR(100),
    [input_tokens] INT,
    [output_tokens] INT,
    [total_tokens] INT,
    [current_todo_id] UNIQUEIDENTIFIER,
    [agent_id] NVARCHAR(100),
    [is_internal] BIT CONSTRAINT [messages_is_internal_df] DEFAULT 0,
    CONSTRAINT [PK_messages] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[performance_metrics] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__performance___id__6BE40491] DEFAULT newid(),
    [session_id] UNIQUEIDENTIFIER,
    [metric_name] NVARCHAR(100) NOT NULL,
    [metric_value] FLOAT(53) NOT NULL,
    [metric_unit] NVARCHAR(50),
    [tags] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__performan__creat__6CD828CA] DEFAULT getutcdate(),
    CONSTRAINT [PK__performa__3213E83F2535ECB4] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[permission_presets] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__permission_p__id__3A4CA8FD] DEFAULT newid(),
    [name] NVARCHAR(100) NOT NULL,
    [description] NVARCHAR(500),
    [permissions] NVARCHAR(max) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [DF__permissio__is_ac__3B40CD36] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__permissio__creat__3C34F16F] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF__permissio__updat__3D2915A8] DEFAULT getutcdate(),
    CONSTRAINT [PK__permissi__3213E83FD0E303EE] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ__permissi__72E12F1BBE106145] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[quota_alerts] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [quota_type] NVARCHAR(50) NOT NULL,
    [threshold_percent] INT NOT NULL,
    [threshold_value] BIGINT NOT NULL,
    [alerted_at] DATETIME2 NOT NULL CONSTRAINT [DF__quota_ale__alert__7720AD13] DEFAULT getutcdate(),
    [acknowledged_at] DATETIME2,
    CONSTRAINT [PK__quota_al__3213E83FC6A065CB] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[session_files] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__session_file__id__65370702] DEFAULT newid(),
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [file_name] NVARCHAR(255) NOT NULL,
    [file_path] NVARCHAR(500) NOT NULL,
    [file_type] NVARCHAR(100) NOT NULL,
    [file_size_bytes] BIGINT,
    [mime_type] NVARCHAR(100),
    [content_hash] NVARCHAR(255),
    [is_active] BIT NOT NULL CONSTRAINT [DF__session_f__is_ac__662B2B3B] DEFAULT 1,
    [metadata] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__session_f__creat__671F4F74] DEFAULT getutcdate(),
    [removed_at] DATETIME2,
    CONSTRAINT [PK__session___3213E83FEA25EA4B] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[sessions] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__sessions__id__7C4F7684] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [title] NVARCHAR(500) NOT NULL CONSTRAINT [DF__sessions__title__7D439ABD] DEFAULT 'New Chat',
    [is_active] BIT NOT NULL CONSTRAINT [DF__sessions__is_act__7E37BEF6] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__sessions__create__7F2BE32F] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF__sessions__update__00200768] DEFAULT getutcdate(),
    [checkpoint_message_count] INT NOT NULL CONSTRAINT [sessions_checkpoint_message_count_df] DEFAULT 0,
    [is_pinned] BIT NOT NULL CONSTRAINT [sessions_is_pinned_df] DEFAULT 0,
    [pinned_at] DATETIME2,
    CONSTRAINT [PK__sessions__3213E83F49BB8136] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[todos] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__todos__id__29221CFB] DEFAULT newid(),
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [description] NVARCHAR(500) NOT NULL,
    [status] NVARCHAR(50) NOT NULL CONSTRAINT [DF__todos__status__2A164134] DEFAULT 'pending',
    [order_index] INT NOT NULL,
    [parent_todo_id] UNIQUEIDENTIFIER,
    [dependencies] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__todos__created_a__2B0A656D] DEFAULT getutcdate(),
    [started_at] DATETIME2,
    [completed_at] DATETIME2,
    [metadata] NVARCHAR(max),
    [content] NVARCHAR(500) NOT NULL,
    [activeForm] NVARCHAR(500) NOT NULL,
    [order] INT NOT NULL,
    [order_path] NVARCHAR(50),
    [depth] INT NOT NULL CONSTRAINT [DF__todos__depth__36470DEF] DEFAULT 0,
    [title] NVARCHAR(255),
    [system_prompt] NVARCHAR(max),
    [active_form] NVARCHAR(255),
    [first_message_id] NVARCHAR(255),
    [last_message_id] NVARCHAR(255),
    [message_count] INT NOT NULL CONSTRAINT [DF__todos__message_c__373B3228] DEFAULT 0,
    [blocked_by] UNIQUEIDENTIFIER,
    [reopened_from] UNIQUEIDENTIFIER,
    CONSTRAINT [PK__todos__3213E83F8F2C7F83] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[token_usage] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__token_usage__id__308E3499] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [message_id] NVARCHAR(255) NOT NULL,
    [model] NVARCHAR(100) NOT NULL,
    [request_timestamp] DATETIME2 NOT NULL CONSTRAINT [DF__token_usa__reque__318258D2] DEFAULT getutcdate(),
    [input_tokens] INT NOT NULL,
    [output_tokens] INT NOT NULL,
    [cache_creation_input_tokens] INT,
    [cache_read_input_tokens] INT,
    [thinking_enabled] BIT NOT NULL CONSTRAINT [DF__token_usa__think__32767D0B] DEFAULT 0,
    [thinking_budget] INT,
    [service_tier] NVARCHAR(20),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__token_usa__creat__336AA144] DEFAULT getutcdate(),
    CONSTRAINT [PK__token_us__3213E83FF28FAFA9] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tool_permissions] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__tool_permiss__id__31B762FC] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [tool_name] NVARCHAR(100) NOT NULL,
    [is_allowed] BIT NOT NULL CONSTRAINT [DF__tool_perm__is_al__32AB8735] DEFAULT 1,
    [requires_approval] BIT NOT NULL CONSTRAINT [DF__tool_perm__requi__339FAB6E] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__tool_perm__creat__3493CFA7] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF__tool_perm__updat__3587F3E0] DEFAULT getutcdate(),
    CONSTRAINT [PK__tool_per__3213E83F44FF7117] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [uq_user_tool] UNIQUE NONCLUSTERED ([user_id],[tool_name])
);

-- CreateTable
CREATE TABLE [dbo].[usage_aggregates] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [period_type] NVARCHAR(20) NOT NULL,
    [period_start] DATETIME2 NOT NULL,
    [total_events] BIGINT NOT NULL CONSTRAINT [DF__usage_agg__total__61316BF4] DEFAULT 0,
    [total_tokens] BIGINT NOT NULL CONSTRAINT [DF__usage_agg__total__6225902D] DEFAULT 0,
    [total_api_calls] INT NOT NULL CONSTRAINT [DF__usage_agg__total__6319B466] DEFAULT 0,
    [total_cost] DECIMAL(18,8) NOT NULL CONSTRAINT [DF__usage_agg__total__640DD89F] DEFAULT 0.0,
    [category_breakdown] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__usage_agg__creat__6501FCD8] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF__usage_agg__updat__65F62111] DEFAULT getutcdate(),
    CONSTRAINT [PK__usage_ag__3213E83F2106A27F] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_usage_aggregates_period] UNIQUE NONCLUSTERED ([user_id],[period_type],[period_start])
);

-- CreateTable
CREATE TABLE [dbo].[usage_events] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [session_id] UNIQUEIDENTIFIER NOT NULL,
    [category] NVARCHAR(50) NOT NULL,
    [event_type] NVARCHAR(100) NOT NULL,
    [quantity] BIGINT NOT NULL,
    [unit] NVARCHAR(20) NOT NULL,
    [cost] DECIMAL(18,8) NOT NULL CONSTRAINT [DF__usage_even__cost__4E1E9780] DEFAULT 0.0,
    [metadata] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__usage_eve__creat__4F12BBB9] DEFAULT getutcdate(),
    CONSTRAINT [PK__usage_ev__3213E83F17068309] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[user_feedback] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__user_feedbac__id__7BE56230] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [what_they_like] NVARCHAR(max),
    [improvement_opportunities] NVARCHAR(max),
    [needed_features] NVARCHAR(max),
    [additional_comments] NVARCHAR(max),
    [feedback_source] NVARCHAR(50) NOT NULL CONSTRAINT [DF__user_feed__feedb__7CD98669] DEFAULT 'trial_extension',
    [trial_extended] BIT NOT NULL CONSTRAINT [DF__user_feed__trial__7DCDAAA2] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__user_feed__creat__7EC1CEDB] DEFAULT getutcdate(),
    CONSTRAINT [PK__user_fee__3213E83FF2C04287] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[user_quotas] (
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [plan_tier] NVARCHAR(20) NOT NULL CONSTRAINT [DF__user_quot__plan___52E34C9D] DEFAULT 'free',
    [monthly_token_limit] BIGINT NOT NULL CONSTRAINT [DF__user_quot__month__53D770D6] DEFAULT 100000,
    [current_token_usage] BIGINT NOT NULL CONSTRAINT [DF__user_quot__curre__54CB950F] DEFAULT 0,
    [monthly_api_call_limit] INT NOT NULL CONSTRAINT [DF__user_quot__month__55BFB948] DEFAULT 500,
    [current_api_call_usage] INT NOT NULL CONSTRAINT [DF__user_quot__curre__56B3DD81] DEFAULT 0,
    [storage_limit_bytes] BIGINT NOT NULL CONSTRAINT [DF__user_quot__stora__57A801BA] DEFAULT 10485760,
    [current_storage_usage] BIGINT NOT NULL CONSTRAINT [DF__user_quot__curre__589C25F3] DEFAULT 0,
    [quota_reset_at] DATETIME2 NOT NULL CONSTRAINT [DF__user_quot__quota__59904A2C] DEFAULT dateadd(month,(1),getutcdate()),
    [last_reset_at] DATETIME2,
    [allow_overage] BIT NOT NULL CONSTRAINT [DF__user_quot__allow__5A846E65] DEFAULT 0,
    [overage_rate] DECIMAL(18,8),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__user_quot__creat__5B78929E] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF__user_quot__updat__5C6CB6D7] DEFAULT getutcdate(),
    [trial_started_at] DATETIME2,
    [trial_expires_at] DATETIME2,
    [trial_extended] BIT NOT NULL CONSTRAINT [DF__user_quot__trial__7908F585] DEFAULT 0,
    CONSTRAINT [PK__user_quo__B9BE370FDAE183DD] PRIMARY KEY CLUSTERED ([user_id])
);

-- CreateTable
CREATE TABLE [dbo].[user_settings] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__user_setting__id__4830B400] DEFAULT newid(),
    [user_id] UNIQUEIDENTIFIER NOT NULL,
    [theme] NVARCHAR(20) NOT NULL CONSTRAINT [DF__user_sett__theme__4924D839] DEFAULT 'system',
    [preferences] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__user_sett__creat__4A18FC72] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF__user_sett__updat__4B0D20AB] DEFAULT getutcdate(),
    CONSTRAINT [PK_user_settings] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [IX_user_settings_user_id] UNIQUE NONCLUSTERED ([user_id])
);

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [DF__users__id__75A278F5] DEFAULT newid(),
    [email] NVARCHAR(255) NOT NULL,
    [password_hash] NVARCHAR(255),
    [full_name] NVARCHAR(255),
    [is_active] BIT NOT NULL CONSTRAINT [DF__users__is_active__76969D2E] DEFAULT 1,
    [is_admin] BIT NOT NULL CONSTRAINT [DF__users__is_admin__778AC167] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF__users__created_a__787EE5A0] DEFAULT getutcdate(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF__users__updated_a__797309D9] DEFAULT getutcdate(),
    [last_login_at] DATETIME2,
    [role] NVARCHAR(50) NOT NULL CONSTRAINT [DF__users__role__7A3223E8] DEFAULT 'viewer',
    [microsoft_id] NVARCHAR(255),
    [microsoft_email] NVARCHAR(255),
    [microsoft_tenant_id] NVARCHAR(255),
    [last_microsoft_login] DATETIME2,
    [bc_access_token_encrypted] NVARCHAR(max),
    [bc_token_expires_at] DATETIME2,
    CONSTRAINT [PK__users__3213E83F5CD7330A] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ__users__AB6E61644C0F4565] UNIQUE NONCLUSTERED ([email])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_agent_executions_agent] ON [dbo].[agent_executions]([agent_type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_agent_executions_agent_status] ON [dbo].[agent_executions]([agent_type], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_agent_executions_created] ON [dbo].[agent_executions]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_agent_executions_session] ON [dbo].[agent_executions]([session_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_agent_executions_status] ON [dbo].[agent_executions]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_approvals_created_at] ON [dbo].[approvals]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_approvals_session_id] ON [dbo].[approvals]([session_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_approvals_status] ON [dbo].[approvals]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_audit_action] ON [dbo].[audit_log]([action]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_audit_created_at] ON [dbo].[audit_log]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_audit_entity] ON [dbo].[audit_log]([entity_type], [entity_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_audit_session_id] ON [dbo].[audit_log]([session_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_audit_user_id] ON [dbo].[audit_log]([user_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_billing_records_status] ON [dbo].[billing_records]([status], [created_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_billing_records_user_period] ON [dbo].[billing_records]([user_id], [billing_period_start] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_chat_attachments_user_session] ON [dbo].[chat_attachments]([user_id], [session_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_connections_user_status] ON [dbo].[connections]([user_id], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_connection_scopes_connection] ON [dbo].[connection_scopes]([connection_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_connection_scopes_subscription] ON [dbo].[connection_scopes]([subscription_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_connection_scopes_sync_status] ON [dbo].[connection_scopes]([sync_status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [langgraph_checkpoints_thread_id_checkpoint_ns_created_at_idx] ON [dbo].[langgraph_checkpoints]([thread_id], [checkpoint_ns], [created_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [agent_usage_analytics_date_idx] ON [dbo].[agent_usage_analytics]([date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [agent_usage_analytics_agent_id_idx] ON [dbo].[agent_usage_analytics]([agent_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_deletion_audit_resource_type] ON [dbo].[deletion_audit_log]([resource_type], [requested_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_deletion_audit_status] ON [dbo].[deletion_audit_log]([status], [requested_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_deletion_audit_user_id] ON [dbo].[deletion_audit_log]([user_id], [requested_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_file_chunks_file_index] ON [dbo].[file_chunks]([file_id], [chunk_index]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_file_chunks_user_file] ON [dbo].[file_chunks]([user_id], [file_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_file_chunks_user_id] ON [dbo].[file_chunks]([user_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_files_pipeline_status] ON [dbo].[files]([pipeline_status], [created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_files_source_type] ON [dbo].[files]([user_id], [source_type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_files_user_folder] ON [dbo].[files]([user_id], [parent_folder_id], [name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_files_user_content_hash] ON [dbo].[files]([user_id], [content_hash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_files_user_modified_date] ON [dbo].[files]([user_id], [file_modified_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [files_batch_id_idx] ON [dbo].[files]([batch_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [upload_batches_user_id_status_idx] ON [dbo].[upload_batches]([user_id], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [upload_batches_status_expires_at_idx] ON [dbo].[upload_batches]([status], [expires_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_image_embeddings_created_at] ON [dbo].[image_embeddings]([created_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_image_embeddings_file_id] ON [dbo].[image_embeddings]([file_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_image_embeddings_user_id] ON [dbo].[image_embeddings]([user_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_mca_attachment] ON [dbo].[message_chat_attachments]([chat_attachment_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_mca_message] ON [dbo].[message_chat_attachments]([message_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_message_citations_created] ON [dbo].[message_citations]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_message_citations_file] ON [dbo].[message_citations]([file_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_message_citations_message] ON [dbo].[message_citations]([message_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_message_events_session_sequence] ON [dbo].[message_events]([session_id], [sequence_number]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_message_events_timestamp] ON [dbo].[message_events]([timestamp] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_message_file_attachments_file] ON [dbo].[message_file_attachments]([file_id], [created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_message_file_attachments_message] ON [dbo].[message_file_attachments]([message_id], [created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_messages_created_at] ON [dbo].[messages]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_messages_role] ON [dbo].[messages]([role]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_messages_session_id] ON [dbo].[messages]([session_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_messages_session_type] ON [dbo].[messages]([session_id], [message_type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_messages_type] ON [dbo].[messages]([message_type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_messages_tokens] ON [dbo].[messages]([session_id], [created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_messages_agent_id] ON [dbo].[messages]([agent_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_metrics_created] ON [dbo].[performance_metrics]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_metrics_name] ON [dbo].[performance_metrics]([metric_name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_metrics_name_created] ON [dbo].[performance_metrics]([metric_name], [created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_metrics_session] ON [dbo].[performance_metrics]([session_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_permission_presets_is_active] ON [dbo].[permission_presets]([is_active]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_permission_presets_name] ON [dbo].[permission_presets]([name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_quota_alerts_user_alerted] ON [dbo].[quota_alerts]([user_id], [alerted_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_session_files_active] ON [dbo].[session_files]([session_id], [is_active]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_session_files_hash] ON [dbo].[session_files]([content_hash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_session_files_session] ON [dbo].[session_files]([session_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_session_files_type] ON [dbo].[session_files]([file_type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_sessions_created_at] ON [dbo].[sessions]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_sessions_is_active] ON [dbo].[sessions]([is_active]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_sessions_updated_at] ON [dbo].[sessions]([updated_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_sessions_user_id] ON [dbo].[sessions]([user_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_sessions_user_pinned] ON [dbo].[sessions]([user_id], [is_pinned]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_todos_order] ON [dbo].[todos]([session_id], [order_index]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_todos_order_path] ON [dbo].[todos]([session_id], [order_path]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_todos_parent] ON [dbo].[todos]([parent_todo_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_todos_session_id] ON [dbo].[todos]([session_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_todos_status] ON [dbo].[todos]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_token_usage_message] ON [dbo].[token_usage]([message_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_token_usage_model] ON [dbo].[token_usage]([model], [request_timestamp]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_token_usage_session] ON [dbo].[token_usage]([session_id], [request_timestamp]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_token_usage_user] ON [dbo].[token_usage]([user_id], [request_timestamp]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_tool_permissions_tool] ON [dbo].[tool_permissions]([tool_name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_tool_permissions_user] ON [dbo].[tool_permissions]([user_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_usage_aggregates_user_period] ON [dbo].[usage_aggregates]([user_id], [period_type], [period_start] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_usage_events_category] ON [dbo].[usage_events]([category], [created_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_usage_events_user_created] ON [dbo].[usage_events]([user_id], [created_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_user_feedback_source] ON [dbo].[user_feedback]([feedback_source], [created_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_user_feedback_user_created] ON [dbo].[user_feedback]([user_id], [created_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_users_created_at] ON [dbo].[users]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_users_email] ON [dbo].[users]([email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_users_is_active] ON [dbo].[users]([is_active]);

-- AddForeignKey
ALTER TABLE [dbo].[agent_executions] ADD CONSTRAINT [fk_agent_executions_session] FOREIGN KEY ([session_id]) REFERENCES [dbo].[sessions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [fk_approvals_decided_by] FOREIGN KEY ([decided_by_user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [fk_approvals_message] FOREIGN KEY ([message_id]) REFERENCES [dbo].[messages]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [fk_approvals_session] FOREIGN KEY ([session_id]) REFERENCES [dbo].[sessions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[audit_log] ADD CONSTRAINT [fk_audit_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[billing_records] ADD CONSTRAINT [FK_billing_records_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[chat_attachments] ADD CONSTRAINT [FK_chat_attachments_session] FOREIGN KEY ([session_id]) REFERENCES [dbo].[sessions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[connections] ADD CONSTRAINT [FK_connections_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [FK_connection_scopes_connection] FOREIGN KEY ([connection_id]) REFERENCES [dbo].[connections]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[file_chunks] ADD CONSTRAINT [FK__file_chun__file___467D75B8] FOREIGN KEY ([file_id]) REFERENCES [dbo].[files]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[files] ADD CONSTRAINT [FK_files_connection] FOREIGN KEY ([connection_id]) REFERENCES [dbo].[connections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[files] ADD CONSTRAINT [FK__files__parent_fo__41B8C09B] FOREIGN KEY ([parent_folder_id]) REFERENCES [dbo].[files]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[files] ADD CONSTRAINT [FK__files__user_id__40C49C62] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[upload_batches] ADD CONSTRAINT [upload_batches_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[image_embeddings] ADD CONSTRAINT [FK_image_embeddings_files] FOREIGN KEY ([file_id]) REFERENCES [dbo].[files]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[image_embeddings] ADD CONSTRAINT [FK_image_embeddings_users] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[message_chat_attachments] ADD CONSTRAINT [FK_mca_attachment] FOREIGN KEY ([chat_attachment_id]) REFERENCES [dbo].[chat_attachments]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[message_citations] ADD CONSTRAINT [FK_message_citations_files] FOREIGN KEY ([file_id]) REFERENCES [dbo].[files]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[message_events] ADD CONSTRAINT [FK_message_events_sessions] FOREIGN KEY ([session_id]) REFERENCES [dbo].[sessions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[message_file_attachments] ADD CONSTRAINT [FK__message_f__file___4B422AD5] FOREIGN KEY ([file_id]) REFERENCES [dbo].[files]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[messages] ADD CONSTRAINT [FK_messages_event_id] FOREIGN KEY ([event_id]) REFERENCES [dbo].[message_events]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[messages] ADD CONSTRAINT [fk_messages_session] FOREIGN KEY ([session_id]) REFERENCES [dbo].[sessions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[performance_metrics] ADD CONSTRAINT [fk_metrics_session] FOREIGN KEY ([session_id]) REFERENCES [dbo].[sessions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[quota_alerts] ADD CONSTRAINT [FK_quota_alerts_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[session_files] ADD CONSTRAINT [fk_session_files_session] FOREIGN KEY ([session_id]) REFERENCES [dbo].[sessions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[sessions] ADD CONSTRAINT [fk_sessions_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[todos] ADD CONSTRAINT [fk_todos_parent] FOREIGN KEY ([parent_todo_id]) REFERENCES [dbo].[todos]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[todos] ADD CONSTRAINT [fk_todos_session] FOREIGN KEY ([session_id]) REFERENCES [dbo].[sessions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[tool_permissions] ADD CONSTRAINT [fk_tool_permissions_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[usage_aggregates] ADD CONSTRAINT [FK_usage_aggregates_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[usage_events] ADD CONSTRAINT [FK_usage_events_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[user_feedback] ADD CONSTRAINT [FK_user_feedback_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[user_quotas] ADD CONSTRAINT [FK_user_quotas_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[user_settings] ADD CONSTRAINT [FK_user_settings_user] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;


-- ============================================================
-- CHECK Constraints (Prisma does not support these natively)
-- Source of truth: prisma/constraints.sql
-- ============================================================

ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_role] CHECK ([role] IN ('user','assistant','system','tool'));
ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_type] CHECK ([message_type] IN ('text','thinking','redacted_thinking','tool_use','server_tool_use','web_search_tool_result','tool_result','error','agent_changed'));
ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_stop_reason] CHECK ([stop_reason] IN ('end_turn','tool_use','max_tokens','stop_sequence','pause_turn','refusal'));
ALTER TABLE [dbo].[message_events] ADD CONSTRAINT [CK_message_events_valid_type] CHECK ([event_type] IN ('user_message_sent','agent_thinking_started','agent_thinking_completed','agent_thinking_block','agent_message_sent','agent_message_chunk','session_started','session_ended','tool_use_requested','tool_use_completed','error_occurred','todo_created','todo_updated','approval_requested','approval_completed','citations_created','agent_changed'));
ALTER TABLE [dbo].[message_events] ADD CONSTRAINT [CK_message_events_sequence_positive] CHECK ([sequence_number] >= 0);
ALTER TABLE [dbo].[agent_executions] ADD CONSTRAINT [chk_agent_executions_status] CHECK ([status] IN ('started','completed','failed'));
ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_action_type] CHECK ([action_type] IN ('create','update','delete','custom'));
ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_priority] CHECK ([priority] IN ('low','medium','high'));
ALTER TABLE [dbo].[approvals] ADD CONSTRAINT [chk_approvals_status] CHECK ([status] IN ('pending','approved','rejected','expired'));
ALTER TABLE [dbo].[session_files] ADD CONSTRAINT [chk_session_files_type] CHECK ([file_type] IN ('uploaded','cloudmd','generated','reference'));
ALTER TABLE [dbo].[todos] ADD CONSTRAINT [chk_todos_status] CHECK ([status] IN ('pending','in_progress','completed','failed'));
ALTER TABLE [dbo].[user_quotas] ADD CONSTRAINT [CK_user_quotas_plan_tier] CHECK ([plan_tier] IN ('free','free_trial','pro','enterprise','unlimited'));
ALTER TABLE [dbo].[user_settings] ADD CONSTRAINT [CK_user_settings_theme] CHECK ([theme] IN ('light','dark','system'));
ALTER TABLE [dbo].[users] ADD CONSTRAINT [chk_users_role] CHECK ([role] IN ('admin','editor','viewer'));
ALTER TABLE [dbo].[connections] ADD CONSTRAINT [CK_connections_provider] CHECK ([provider] IN ('business_central','onedrive','sharepoint','power_bi'));
ALTER TABLE [dbo].[connections] ADD CONSTRAINT [CK_connections_status] CHECK ([status] IN ('disconnected','connected','expired','error'));
ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_scope_type] CHECK ([scope_type] IN ('root','folder','file','site','library'));
ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_sync_status] CHECK ([sync_status] IN ('idle','sync_queued','syncing','synced','error'));
ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_scope_mode] CHECK ([scope_mode] IN ('include','exclude'));
ALTER TABLE [dbo].[connection_scopes] ADD CONSTRAINT [CK_connection_scopes_processing_status] CHECK ([processing_status] IN ('idle','processing','completed','partial_failure'));
ALTER TABLE [dbo].[files] ADD CONSTRAINT [CK_files_source_type] CHECK ([source_type] IN ('local','onedrive','sharepoint'));

-- Filtered Unique Index (not representable in Prisma DSL)
CREATE UNIQUE NONCLUSTERED INDEX [UQ_files_connection_external] ON [dbo].[files] ([connection_id], [external_id]) WHERE [connection_id] IS NOT NULL AND [external_id] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
