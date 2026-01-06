# Database Schema - Semantic Image Search

**Fecha**: 2026-01-06
**Versión**: 1.0

---

## 1. Nueva Tabla: `image_embeddings`

### 1.1 Propósito

Almacenar embeddings de imágenes generados por Azure Computer Vision para búsqueda semántica.

**Relación**: 1:1 con `files` (cada imagen tiene máximo un embedding)

### 1.2 Schema

```sql
-- Migration: 00X-create-image-embeddings.sql

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'image_embeddings')
BEGIN
    CREATE TABLE image_embeddings (
        -- Primary Key
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- Foreign Keys
        file_id UNIQUEIDENTIFIER NOT NULL,
        user_id UNIQUEIDENTIFIER NOT NULL,

        -- Embedding Data
        embedding NVARCHAR(MAX) NOT NULL,  -- JSON array of floats
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

        CONSTRAINT FK_image_embeddings_users
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

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
```

### 1.3 Column Details

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UNIQUEIDENTIFIER | No | Primary key (UUID v4) |
| `file_id` | UNIQUEIDENTIFIER | No | FK to files.id |
| `user_id` | UNIQUEIDENTIFIER | No | FK to users.id (multi-tenant) |
| `embedding` | NVARCHAR(MAX) | No | JSON array of 1024 floats |
| `dimensions` | INT | No | Embedding size (1024 for Azure Vision) |
| `model` | NVARCHAR(100) | No | Model identifier |
| `model_version` | NVARCHAR(50) | No | Model version for compatibility |
| `created_at` | DATETIME2 | No | Creation timestamp |
| `updated_at` | DATETIME2 | Yes | Last update timestamp |

### 1.4 Storage Estimation

```
Embedding storage per image:
- 1024 floats × 4 bytes = 4,096 bytes raw
- JSON overhead (~10%) = ~4,500 bytes
- Metadata (~200 bytes)
- Total: ~5 KB per image

For 10,000 images:
- Storage: ~50 MB
- Within SQL Server limits
```

---

## 2. Modificaciones a Tablas Existentes

### 2.1 Tabla `files`

**No requiere modificaciones**. El `embedding_status` existente se reutiliza:

```sql
-- Valores existentes en embedding_status:
-- 'pending'    - Esperando procesamiento
-- 'processing' - En proceso
-- 'queued'     - En cola de indexación
-- 'completed'  - Indexado exitosamente
-- 'failed'     - Error en procesamiento
```

### 2.2 Tabla `file_chunks` (Referencia)

La tabla `file_chunks` maneja chunks de texto. Las imágenes **NO** usan esta tabla - van directo a `image_embeddings`.

```sql
-- Existing schema (no changes needed)
CREATE TABLE file_chunks (
    id UNIQUEIDENTIFIER PRIMARY KEY,
    file_id UNIQUEIDENTIFIER NOT NULL,
    user_id UNIQUEIDENTIFIER NOT NULL,
    chunk_index INT NOT NULL,
    chunk_text NVARCHAR(MAX) NOT NULL,
    chunk_tokens INT NOT NULL,
    metadata NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL
);
```

---

## 3. Queries Comunes

### 3.1 Insertar Embedding

```sql
INSERT INTO image_embeddings
    (id, file_id, user_id, embedding, dimensions, model, model_version, created_at)
VALUES
    (@id, @fileId, @userId, @embedding, @dimensions, @model, @modelVersion, GETUTCDATE());
```

### 3.2 Obtener Embedding por File

```sql
SELECT id, file_id, user_id, embedding, dimensions, model, model_version, created_at
FROM image_embeddings
WHERE file_id = @fileId AND user_id = @userId;
```

### 3.3 Listar Imágenes Sin Embedding (Backfill)

```sql
SELECT f.id, f.user_id, f.blob_path, f.name, f.mime_type
FROM files f
LEFT JOIN image_embeddings ie ON f.id = ie.file_id
WHERE f.mime_type LIKE 'image/%'
  AND ie.id IS NULL
ORDER BY f.created_at ASC;
```

### 3.4 Estadísticas de Embeddings por Usuario

```sql
SELECT
    user_id,
    COUNT(*) as total_embeddings,
    MIN(created_at) as first_embedding,
    MAX(created_at) as last_embedding
FROM image_embeddings
GROUP BY user_id;
```

### 3.5 Eliminar Embeddings de Usuario (GDPR)

```sql
-- CASCADE delete handles this automatically via FK
DELETE FROM users WHERE id = @userId;

-- Or manual if needed:
DELETE FROM image_embeddings WHERE user_id = @userId;
```

---

## 4. Rollback Migration

```sql
-- Rollback: Drop image_embeddings table

IF EXISTS (SELECT * FROM sys.tables WHERE name = 'image_embeddings')
BEGIN
    DROP TABLE image_embeddings;
    PRINT 'Table image_embeddings dropped';
END
GO
```

---

## 5. Data Integrity Checks

### 5.1 Orphaned Embeddings Check

```sql
-- Find embeddings without corresponding files
SELECT ie.*
FROM image_embeddings ie
LEFT JOIN files f ON ie.file_id = f.id
WHERE f.id IS NULL;
```

### 5.2 Dimension Consistency Check

```sql
-- Verify all embeddings have correct dimensions
SELECT
    dimensions,
    COUNT(*) as count,
    CASE WHEN dimensions = 1024 THEN 'OK' ELSE 'MISMATCH' END as status
FROM image_embeddings
GROUP BY dimensions;
```

### 5.3 User Isolation Check

```sql
-- Verify no cross-user embedding access
SELECT ie.*
FROM image_embeddings ie
INNER JOIN files f ON ie.file_id = f.id
WHERE ie.user_id != f.user_id;

-- Should return 0 rows
```

---

## 6. Performance Considerations

### 6.1 Index Usage

```sql
-- Check index usage after deployment
SELECT
    i.name AS index_name,
    s.user_seeks,
    s.user_scans,
    s.user_lookups,
    s.user_updates
FROM sys.dm_db_index_usage_stats s
INNER JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
WHERE OBJECT_NAME(s.object_id) = 'image_embeddings';
```

### 6.2 Query Plan Analysis

```sql
-- Enable execution plan for optimization
SET STATISTICS IO ON;
SET STATISTICS TIME ON;

-- Run sample query
SELECT * FROM image_embeddings WHERE user_id = 'sample-user-id';

SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;
```

---

## 7. Backup & Recovery

### 7.1 Export Embeddings

```sql
-- Export to JSON for backup
SELECT
    file_id,
    user_id,
    embedding,
    model,
    model_version
FROM image_embeddings
FOR JSON PATH;
```

### 7.2 Point-in-Time Recovery

Embeddings can be regenerated from source images. In disaster recovery:
1. Restore files table from backup
2. Re-run embedding generation for images without embeddings
3. Re-index in Azure AI Search

---

## 8. Migration Checklist

- [ ] Run migration script in DEV environment
- [ ] Verify table created with correct schema
- [ ] Test FK cascade delete with test file
- [ ] Verify indexes created
- [ ] Run migration in STAGING
- [ ] Performance test with 1000 sample embeddings
- [ ] Run migration in PRODUCTION
- [ ] Monitor query performance for 24h
