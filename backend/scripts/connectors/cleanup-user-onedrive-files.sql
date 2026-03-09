-- ============================================================
-- Cleanup: Remove ALL OneDrive-synced files for a specific user
-- ============================================================
-- Purpose: Deletes all files with source_type = 'onedrive' for the
--          given user. Cascading FKs handle file_chunks, image_embeddings,
--          and message_file_attachments automatically.
--          message_citations.file_id is NULLed (no cascade).
--
-- Usage: Replace @UserId with the target user GUID, then run
--        each section sequentially in Azure Data Studio / SSMS.
-- ============================================================

DECLARE @UserId UNIQUEIDENTIFIER = 'BCD5A31B-C560-40D5-972F-50E134A8389D';

-- ===================== STEP 0: PREVIEW =====================
-- See what will be deleted (run this first, review, then proceed)

SELECT
    f.id,
    f.name,
    f.source_type,
    f.pipeline_status,
    f.external_id,
    f.connection_id,
    f.connection_scope_id,
    f.created_at,
    f.last_synced_at
FROM files f
WHERE f.user_id = @UserId
  AND f.source_type = 'onedrive'
ORDER BY f.created_at DESC;

-- Count summary
SELECT
    COUNT(*) AS total_onedrive_files,
    COUNT(DISTINCT connection_id) AS distinct_connections,
    COUNT(DISTINCT connection_scope_id) AS distinct_scopes
FROM files
WHERE user_id = @UserId
  AND source_type = 'onedrive';

-- ===================== STEP 1: NULL out message_citations =====================
-- message_citations has no ON DELETE CASCADE, file_id is nullable
-- Set to NULL so the citation row survives but is unlinked from the deleted file

UPDATE mc
SET mc.file_id = NULL
FROM message_citations mc
INNER JOIN files f ON mc.file_id = f.id
WHERE f.user_id = @UserId
  AND f.source_type = 'onedrive';

PRINT 'message_citations unlinked: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- ===================== STEP 2: DELETE files =====================
-- Cascading FKs automatically delete:
--   - file_chunks        (ON DELETE CASCADE)
--   - image_embeddings   (ON DELETE CASCADE)
--   - message_file_attachments (ON DELETE CASCADE)

DELETE FROM files
WHERE user_id = @UserId
  AND source_type = 'onedrive';

PRINT 'OneDrive files deleted: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- ===================== STEP 3: VERIFY =====================

SELECT COUNT(*) AS remaining_onedrive_files
FROM files
WHERE user_id = @UserId
  AND source_type = 'onedrive';
-- Expected: 0

-- Check for orphaned file_chunks (should be 0 due to cascade)
SELECT COUNT(*) AS orphaned_chunks
FROM file_chunks fc
WHERE fc.user_id = @UserId
  AND NOT EXISTS (SELECT 1 FROM files f WHERE f.id = fc.file_id);
-- Expected: 0
