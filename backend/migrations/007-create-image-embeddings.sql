-- Migration: 007-create-image-embeddings.sql
-- Purpose: Create table to store image embeddings for semantic image search
-- Date: 2026-01-06

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'image_embeddings')
BEGIN
    CREATE TABLE image_embeddings (
        -- Primary Key
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- Foreign Keys
        file_id UNIQUEIDENTIFIER NOT NULL,
        user_id UNIQUEIDENTIFIER NOT NULL,

        -- Embedding Data
        embedding NVARCHAR(MAX) NOT NULL,  -- JSON array of floats (1024 dimensions)
        dimensions INT NOT NULL DEFAULT 1024,

        -- Model Information
        model NVARCHAR(100) NOT NULL DEFAULT 'azure-vision-vectorize-image',
        model_version NVARCHAR(50) NOT NULL DEFAULT '2023-04-15',

        -- Timestamps
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NULL,

        -- Constraints
        CONSTRAINT FK_image_embeddings_files
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,

        -- Note: NO ACTION because files already cascade to users.
        -- Deletion path: user deleted → files deleted → embeddings deleted (via FK_image_embeddings_files)
        CONSTRAINT FK_image_embeddings_users
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION,

        CONSTRAINT UQ_image_embeddings_file
            UNIQUE (file_id)  -- Only one embedding per file
    );

    -- Indexes for common queries
    CREATE INDEX IX_image_embeddings_user_id
        ON image_embeddings(user_id);

    CREATE INDEX IX_image_embeddings_file_id
        ON image_embeddings(file_id);

    CREATE INDEX IX_image_embeddings_created_at
        ON image_embeddings(created_at DESC);

    PRINT 'Table image_embeddings created successfully';
END
ELSE
BEGIN
    PRINT 'Table image_embeddings already exists';
END
GO
