-- Migration: 010-add-image-caption.sql
-- Purpose: Add caption column to image_embeddings for D26 (Multimodal RAG with Reranker)
-- Date: 2026-01-13
--
-- This migration adds a caption column to store AI-generated textual descriptions
-- of images, enabling better semantic search across both text and images.

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('image_embeddings')
    AND name = 'caption'
)
BEGIN
    ALTER TABLE image_embeddings
    ADD caption NVARCHAR(MAX) NULL;

    PRINT 'Column caption added to image_embeddings table';
END
ELSE
BEGIN
    PRINT 'Column caption already exists in image_embeddings table';
END
GO

-- Add caption_confidence column for storing the confidence score of the caption
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('image_embeddings')
    AND name = 'caption_confidence'
)
BEGIN
    ALTER TABLE image_embeddings
    ADD caption_confidence FLOAT NULL;

    PRINT 'Column caption_confidence added to image_embeddings table';
END
ELSE
BEGIN
    PRINT 'Column caption_confidence already exists in image_embeddings table';
END
GO
