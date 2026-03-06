/**
 * PRD-07 Stage 1: Pipeline Status Migration
 *
 * Backfills the `pipeline_status` column for all historical files by mapping
 * the old (processing_status, embedding_status) pair to the new unified
 * pipeline state machine, then makes the column NOT NULL and drops the
 * deprecated columns.
 *
 * Uses Prisma via the shared script helper (same pattern as other scripts
 * in this directory).
 *
 * Migration mapping:
 *   processing_status=completed + embedding_status=completed  -> 'ready'
 *   processing_status=failed OR embedding_status=failed       -> 'failed'
 *   processing_status=processing                              -> 'extracting'
 *   processing_status=chunking                                -> 'chunking'
 *   embedding_status=processing                               -> 'embedding'
 *   processing_status=pending_processing                      -> 'queued'
 *   processing_status=pending (or anything else)              -> 'registered'
 *
 * Steps:
 *   1. Back up the files table
 *   2. Backfill pipeline_status
 *   3. Validate: count of NULL pipeline_status should be 0
 *   4. Make pipeline_status NOT NULL
 *   5. Drop deprecated columns: processing_status, embedding_status
 *
 * Usage:
 *   npx tsx backend/scripts/migrate-pipeline-status.ts
 *   npx tsx backend/scripts/migrate-pipeline-status.ts --dry-run
 *   npx tsx backend/scripts/migrate-pipeline-status.ts --skip-backup
 *   npx tsx backend/scripts/migrate-pipeline-status.ts --skip-drop
 */

import { createPrisma } from '../_shared/prisma';
import type { PrismaClient } from '@prisma/client';

// ─── Argument Parsing ─────────────────────────────────────────────────────────

interface MigrationOptions {
  dryRun: boolean;
  skipBackup: boolean;
  skipDrop: boolean;
}

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
PRD-07 Stage 1: Pipeline Status Migration

Backfills pipeline_status for all historical files, validates the migration,
makes the column NOT NULL, and drops the deprecated columns.

Usage:
  npx tsx backend/scripts/migrate-pipeline-status.ts [options]

Options:
  --dry-run      Preview changes without writing to the database
  --skip-backup  Skip the files table backup step (faster, riskier)
  --skip-drop    Skip dropping deprecated columns (safe for incremental rollout)
  --help, -h     Show this help message

Migration mapping (processing_status + embedding_status -> pipeline_status):
  completed + completed  -> 'ready'
  failed (either)        -> 'failed'
  processing             -> 'extracting'
  chunking               -> 'chunking'
  embedding/processing   -> 'embedding'
  pending_processing     -> 'queued'
  pending / else         -> 'registered'
`);
    process.exit(0);
  }

  return {
    dryRun: args.includes('--dry-run'),
    skipBackup: args.includes('--skip-backup'),
    skipDrop: args.includes('--skip-drop'),
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface StepResult {
  name: string;
  success: boolean;
  rowsAffected?: number;
  error?: string;
}

// ─── Step 1: Backup ───────────────────────────────────────────────────────────

async function backupFilesTable(prisma: PrismaClient, dryRun: boolean): Promise<StepResult> {
  const stepName = 'Backup files table';
  console.log(`[Step 1] ${stepName}${dryRun ? ' (DRY RUN)' : ''}`);

  if (dryRun) {
    console.log('  DRY RUN: Would execute: SELECT * INTO files_backup_pre_migration FROM files');
    return { name: stepName, success: true };
  }

  try {
    // Check if backup table already exists to prevent accidental overwrite
    const existsResult = await prisma.$queryRaw<{ table_count: number }[]>`
      SELECT COUNT(*) AS table_count
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'files_backup_pre_migration'
    `;

    const tableCount = existsResult[0]?.table_count ?? 0;
    if (tableCount > 0) {
      const errorMsg = 'Backup table "files_backup_pre_migration" already exists. ' +
        'Drop it manually or use --skip-backup if re-running after a partial migration.';
      console.error(`  ERROR: ${errorMsg}`);
      return { name: stepName, success: false, error: errorMsg };
    }

    // SELECT INTO is DDL — must use $executeRawUnsafe
    await prisma.$executeRawUnsafe(`SELECT * INTO files_backup_pre_migration FROM files`);

    console.log('  Backup created successfully');
    return { name: stepName, success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ERROR: ${msg}`);
    return { name: stepName, success: false, error: msg };
  }
}

// ─── Step 2: Backfill ─────────────────────────────────────────────────────────

async function backfillPipelineStatus(prisma: PrismaClient, dryRun: boolean): Promise<StepResult> {
  const stepName = 'Backfill pipeline_status';
  console.log(`[Step 2] ${stepName}${dryRun ? ' (DRY RUN)' : ''}`);

  if (dryRun) {
    const previewResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM files WHERE pipeline_status IS NULL
    `;
    const nullCount = Number(previewResult[0]?.total ?? 0);
    console.log(`  DRY RUN: Would backfill ${nullCount} rows with NULL pipeline_status`);
    return { name: stepName, success: true, rowsAffected: nullCount };
  }

  try {
    // The mapping SQL, applied only to rows where pipeline_status is NULL
    // (rows already set by the V2 pipeline are left untouched).
    const rowsAffected = await prisma.$executeRawUnsafe(`
      UPDATE files
      SET pipeline_status = CASE
        WHEN processing_status = 'completed' AND embedding_status = 'completed'
          THEN 'ready'
        WHEN processing_status = 'failed' OR embedding_status = 'failed'
          THEN 'failed'
        WHEN processing_status = 'processing'
          THEN 'extracting'
        WHEN processing_status = 'chunking'
          THEN 'chunking'
        WHEN embedding_status = 'processing'
          THEN 'embedding'
        WHEN processing_status = 'pending_processing'
          THEN 'queued'
        ELSE 'registered'
      END
      WHERE pipeline_status IS NULL
    `);

    console.log(`  Backfill completed (${rowsAffected} rows updated)`);
    return { name: stepName, success: true, rowsAffected };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ERROR: ${msg}`);
    return { name: stepName, success: false, error: msg };
  }
}

// ─── Step 3: Validate ─────────────────────────────────────────────────────────

async function validateMigration(prisma: PrismaClient): Promise<StepResult> {
  const stepName = 'Validate migration (NULL count should be 0)';
  console.log(`[Step 3] ${stepName}`);

  try {
    const result = await prisma.$queryRaw<{ null_count: bigint }[]>`
      SELECT COUNT(*) AS null_count FROM files WHERE pipeline_status IS NULL
    `;
    const nullCount = Number(result[0]?.null_count ?? 0);

    if (nullCount > 0) {
      const errorMsg = `Validation failed: ${nullCount} rows still have NULL pipeline_status after backfill`;
      console.error(`  ERROR: ${errorMsg}`);
      return { name: stepName, success: false, rowsAffected: nullCount, error: errorMsg };
    }

    console.log('  Validation passed: all rows have a non-NULL pipeline_status');
    return { name: stepName, success: true, rowsAffected: 0 };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ERROR: ${msg}`);
    return { name: stepName, success: false, error: msg };
  }
}

// ─── Step 4: Make NOT NULL ────────────────────────────────────────────────────

async function makePipelineStatusNotNull(prisma: PrismaClient, dryRun: boolean): Promise<StepResult> {
  const stepName = 'Make pipeline_status NOT NULL';
  console.log(`[Step 4] ${stepName}${dryRun ? ' (DRY RUN)' : ''}`);

  if (dryRun) {
    console.log('  DRY RUN: Would execute: ALTER TABLE files ALTER COLUMN pipeline_status NVARCHAR(50) NOT NULL');
    return { name: stepName, success: true };
  }

  try {
    // SQL Server cannot ALTER COLUMN while indexes reference it.
    // Drop the index, alter, then recreate.
    await prisma.$executeRawUnsafe(`
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_files_pipeline_status' AND object_id = OBJECT_ID('files'))
        DROP INDEX IX_files_pipeline_status ON files
    `);
    console.log('  Dropped IX_files_pipeline_status index');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE files ALTER COLUMN pipeline_status NVARCHAR(50) NOT NULL
    `);
    console.log('  pipeline_status is now NOT NULL');

    // Recreate the index
    await prisma.$executeRawUnsafe(`
      CREATE NONCLUSTERED INDEX IX_files_pipeline_status ON files (pipeline_status, created_at)
    `);
    console.log('  Recreated IX_files_pipeline_status index');

    return { name: stepName, success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ERROR: ${msg}`);
    return { name: stepName, success: false, error: msg };
  }
}

// ─── Step 5: Drop deprecated columns ─────────────────────────────────────────

async function dropDeprecatedColumns(prisma: PrismaClient, dryRun: boolean): Promise<StepResult> {
  const stepName = 'Drop deprecated columns (processing_status, embedding_status)';
  console.log(`[Step 5] ${stepName}${dryRun ? ' (DRY RUN)' : ''}`);

  if (dryRun) {
    console.log('  DRY RUN: Would drop DEFAULT constraints and columns: processing_status, embedding_status');
    return { name: stepName, success: true };
  }

  try {
    // SQL Server requires dropping DEFAULT constraints before dropping columns.
    // We look up the system-generated constraint names dynamically.

    // Drop ALL indexes and statistics that reference the columns.
    // SQL Server won't allow DROP COLUMN while any object references it.
    await prisma.$executeRawUnsafe(`
      DECLARE @sql NVARCHAR(MAX) = '';

      -- Drop indexes referencing these columns
      SELECT @sql = @sql + 'DROP INDEX [' + i.name + '] ON [files]; '
      FROM sys.indexes i
        JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.object_id = OBJECT_ID('files')
        AND c.name IN ('processing_status', 'embedding_status')
        AND i.is_primary_key = 0;

      -- Drop auto-created statistics referencing these columns
      -- (exclude index-associated stats — those are already dropped with their index)
      SELECT @sql = @sql + 'DROP STATISTICS [files].[' + s.name + ']; '
      FROM sys.stats s
        JOIN sys.stats_columns sc ON s.object_id = sc.object_id AND s.stats_id = sc.stats_id
        JOIN sys.columns c ON sc.object_id = c.object_id AND sc.column_id = c.column_id
      WHERE s.object_id = OBJECT_ID('files')
        AND c.name IN ('processing_status', 'embedding_status')
        AND s.auto_created = 1
        AND s.name NOT IN (
          SELECT i2.name FROM sys.indexes i2
          WHERE i2.object_id = OBJECT_ID('files') AND i2.name IS NOT NULL
        );

      IF LEN(@sql) > 0 EXEC sp_executesql @sql;
    `);
    console.log('  Dropped all indexes and statistics on deprecated columns');

    // Drop default constraint for processing_status
    await prisma.$executeRawUnsafe(`
      DECLARE @ps_constraint NVARCHAR(256)
      SELECT @ps_constraint = dc.name
      FROM sys.default_constraints dc
        JOIN sys.columns c ON dc.parent_object_id = c.object_id
          AND dc.parent_column_id = c.column_id
        JOIN sys.tables t ON c.object_id = t.object_id
      WHERE t.name = 'files' AND c.name = 'processing_status'

      IF @ps_constraint IS NOT NULL
        EXEC('ALTER TABLE files DROP CONSTRAINT [' + @ps_constraint + ']')
    `);
    console.log('  Dropped DEFAULT constraint for processing_status (if any)');

    // Drop default constraint for embedding_status
    await prisma.$executeRawUnsafe(`
      DECLARE @es_constraint NVARCHAR(256)
      SELECT @es_constraint = dc.name
      FROM sys.default_constraints dc
        JOIN sys.columns c ON dc.parent_object_id = c.object_id
          AND dc.parent_column_id = c.column_id
        JOIN sys.tables t ON c.object_id = t.object_id
      WHERE t.name = 'files' AND c.name = 'embedding_status'

      IF @es_constraint IS NOT NULL
        EXEC('ALTER TABLE files DROP CONSTRAINT [' + @es_constraint + ']')
    `);
    console.log('  Dropped DEFAULT constraint for embedding_status (if any)');

    // Now drop the columns themselves
    await prisma.$executeRawUnsafe(`
      ALTER TABLE files DROP COLUMN processing_status, embedding_status
    `);
    console.log('  Columns processing_status and embedding_status dropped');

    return { name: stepName, success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ERROR: ${msg}`);
    return { name: stepName, success: false, error: msg };
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary(results: StepResult[], dryRun: boolean): void {
  const allPassed = results.every((r) => r.success);
  const label = dryRun ? 'DRY RUN SUMMARY' : (allPassed ? 'MIGRATION COMPLETE' : 'MIGRATION FAILED');

  console.log('');
  console.log('='.repeat(60));
  console.log(`  ${label}`);
  console.log('='.repeat(60));

  for (const result of results) {
    const status = result.success ? 'OK' : 'FAILED';
    const rows = result.rowsAffected !== undefined ? ` (rows: ${result.rowsAffected})` : '';
    console.log(`  [${status}] ${result.name}${rows}`);
    if (result.error) {
      console.log(`         Error: ${result.error}`);
    }
  }

  console.log('='.repeat(60));

  if (dryRun) {
    console.log('  DRY RUN complete — no changes were made to the database.');
    console.log('  Re-run without --dry-run to apply the migration.');
  } else if (allPassed) {
    console.log('  All steps completed successfully.');
    console.log('  Next: run "npx prisma db pull && npx prisma generate" to sync the schema.');
  } else {
    console.log('  One or more steps failed. Check logs above for details.');
    console.log('  The files_backup_pre_migration table is available for recovery.');
  }

  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('');
  console.log('PRD-07 Stage 1: Pipeline Status Migration');
  console.log(`  Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Skip backup: ${options.skipBackup}`);
  console.log(`  Skip drop: ${options.skipDrop}`);
  console.log('');

  const prisma = createPrisma();

  const results: StepResult[] = [];

  try {
    // Step 1: Backup
    if (!options.skipBackup) {
      const backupResult = await backupFilesTable(prisma, options.dryRun);
      results.push(backupResult);
      if (!backupResult.success) {
        console.error('Aborting migration due to backup failure');
        printSummary(results, options.dryRun);
        process.exit(1);
      }
    } else {
      console.log('[Step 1] Skipping backup (--skip-backup flag set)');
      results.push({ name: 'Backup files table', success: true });
    }

    // Step 2: Backfill
    const backfillResult = await backfillPipelineStatus(prisma, options.dryRun);
    results.push(backfillResult);
    if (!backfillResult.success) {
      console.error('Aborting migration due to backfill failure');
      printSummary(results, options.dryRun);
      process.exit(1);
    }

    // Step 3: Validate
    const validationResult = await validateMigration(prisma);
    results.push(validationResult);
    if (!validationResult.success) {
      console.error('Aborting migration — pipeline_status still has NULL rows');
      printSummary(results, options.dryRun);
      process.exit(1);
    }

    // Step 4: Make NOT NULL
    const notNullResult = await makePipelineStatusNotNull(prisma, options.dryRun);
    results.push(notNullResult);
    if (!notNullResult.success) {
      console.error('Aborting migration: could not make pipeline_status NOT NULL');
      printSummary(results, options.dryRun);
      process.exit(1);
    }

    // Step 5: Drop deprecated columns (optional)
    if (!options.skipDrop) {
      const dropResult = await dropDeprecatedColumns(prisma, options.dryRun);
      results.push(dropResult);
      if (!dropResult.success) {
        console.error('Drop columns step failed — migration is otherwise complete, but cleanup did not finish');
        printSummary(results, options.dryRun);
        process.exit(1);
      }
    } else {
      console.log('[Step 5] Skipping column drop (--skip-drop flag set). Deprecated columns remain.');
      results.push({ name: 'Drop deprecated columns (skipped)', success: true });
    }

    printSummary(results, options.dryRun);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Unexpected error during migration: ${msg}`);
    printSummary(results, options.dryRun);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
