/**
 * Consolidated Storage Cleanup & Repair Script
 *
 * Replaces 3 separate cleanup scripts with a unified fix-storage tool.
 * Performs three phases of storage integrity repair:
 *
 * Phase 1: Stuck Deletions - Complete files stuck in deletion_status (pending/deleting/failed)
 * Phase 2: Ghost Records - Remove DB records where blob doesn't exist
 * Phase 3: Orphan Cleanup - Remove orphaned blobs, search docs, and chunks
 *
 * Usage:
 *   npx tsx backend/scripts/fix-storage.ts --userId <ID> --dry-run          # Preview all fixes
 *   npx tsx backend/scripts/fix-storage.ts --userId <ID> --stuck-deletions  # Phase 1 only
 *   npx tsx backend/scripts/fix-storage.ts --userId <ID> --ghost-records    # Phase 2 only
 *   npx tsx backend/scripts/fix-storage.ts --userId <ID> --orphans          # Phase 3 only
 *   npx tsx backend/scripts/fix-storage.ts --userId <ID>                    # All phases
 *   npx tsx backend/scripts/fix-storage.ts --all --dry-run                  # All users preview
 *   npx tsx backend/scripts/fix-storage.ts --help
 */
import 'dotenv/config';
import { createPrisma } from './_shared/prisma';
import { createBlobContainerClient, createSearchClient, CONTAINER_NAME, INDEX_NAME } from './_shared/azure';
import { getFlag, hasFlag } from './_shared/args';
import type { ContainerClient } from '@azure/storage-blob';
import type { SearchClient } from '@azure/search-documents';
import type { PrismaClient } from '@prisma/client';

// ============================================================================
// Types
// ============================================================================

interface StuckFile {
  id: string;
  user_id: string;
  name: string;
  is_folder: boolean;
  blob_path: string | null;
  deletion_status: string;
  deleted_at: Date | null;
  parent_folder_id: string | null;
}

interface GhostFile {
  id: string;
  name: string;
  blob_path: string | null;
  processing_status: string | null;
  created_at: Date;
}

interface VisualOrphan {
  id: string;
  name: string;
  parent_folder_id: string;
  parent_name: string;
  parent_status: string;
}

interface SearchDocument {
  chunkId: string;
  fileId: string;
  userId: string;
}

interface PhaseResult {
  phase: string;
  itemsFound: number;
  itemsProcessed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

interface Args {
  userId: string | null;
  all: boolean;
  dryRun: boolean;
  stuckDeletions: boolean;
  ghostRecords: boolean;
  orphans: boolean;
  help: boolean;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): Args {
  const userId = getFlag('--userId');
  const normalizedUserId = userId ? userId.toUpperCase() : null;

  return {
    userId: normalizedUserId,
    all: hasFlag('--all'),
    dryRun: hasFlag('--dry-run'),
    stuckDeletions: hasFlag('--stuck-deletions'),
    ghostRecords: hasFlag('--ghost-records'),
    orphans: hasFlag('--orphans'),
    help: hasFlag('--help'),
  };
}

function printHelp(): void {
  console.log(`
Consolidated Storage Cleanup & Repair Script

Performs three phases of storage integrity repair:
  Phase 1: Stuck Deletions - Complete files stuck in deletion_status
  Phase 2: Ghost Records - Remove DB records where blob doesn't exist
  Phase 3: Orphan Cleanup - Remove orphaned blobs, search docs, and chunks

Usage:
  npx tsx backend/scripts/fix-storage.ts --userId <ID> --dry-run
  npx tsx backend/scripts/fix-storage.ts --userId <ID> --stuck-deletions
  npx tsx backend/scripts/fix-storage.ts --userId <ID> --ghost-records
  npx tsx backend/scripts/fix-storage.ts --userId <ID> --orphans
  npx tsx backend/scripts/fix-storage.ts --userId <ID>
  npx tsx backend/scripts/fix-storage.ts --all --dry-run

Options:
  --userId <id>        Process files for specific user (required unless --all)
  --all                Process all users in the system
  --dry-run            Preview what would be done without making changes
  --stuck-deletions    Run Phase 1 only (stuck deletions)
  --ghost-records      Run Phase 2 only (ghost records)
  --orphans            Run Phase 3 only (orphan cleanup)
  --help               Show this help message

Examples:
  npx tsx backend/scripts/fix-storage.ts --userId ABC123 --dry-run
  npx tsx backend/scripts/fix-storage.ts --userId ABC123
  npx tsx backend/scripts/fix-storage.ts --all --stuck-deletions --dry-run
`);
}

// ============================================================================
// Phase 1: Stuck Deletions
// ============================================================================

async function getStuckFiles(prisma: PrismaClient, userId: string | null): Promise<StuckFile[]> {
  const where = userId ? { user_id: userId, deletion_status: { not: null } } : { deletion_status: { not: null } };

  const files = await prisma.files.findMany({
    where,
    select: {
      id: true,
      user_id: true,
      name: true,
      is_folder: true,
      blob_path: true,
      deletion_status: true,
      deleted_at: true,
      parent_folder_id: true,
    },
    orderBy: [{ deleted_at: 'asc' }, { is_folder: 'desc' }],
  });

  return files as StuckFile[];
}

async function getChildFiles(prisma: PrismaClient, folderId: string): Promise<StuckFile[]> {
  const children = await prisma.files.findMany({
    where: { parent_folder_id: folderId },
    select: {
      id: true,
      user_id: true,
      name: true,
      is_folder: true,
      blob_path: true,
      deletion_status: true,
      deleted_at: true,
      parent_folder_id: true,
    },
    orderBy: { is_folder: 'asc' },
  });

  return children as StuckFile[];
}

async function getChunkIdsForFile(prisma: PrismaClient, fileId: string): Promise<string[]> {
  const chunks = await prisma.file_chunks.findMany({
    where: { file_id: fileId },
    select: { id: true },
  });
  return chunks.map((c) => c.id);
}

async function deleteBlobIfExists(
  containerClient: ContainerClient | null,
  blobPath: string | null
): Promise<boolean> {
  if (!blobPath || !containerClient) return true;

  try {
    const blobClient = containerClient.getBlobClient(blobPath);
    const exists = await blobClient.exists();

    if (!exists) return true;

    await containerClient.deleteBlob(blobPath);
    return true;
  } catch (error) {
    console.error(`    Failed to delete blob: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function deleteSearchDocumentsBatch(
  searchClient: SearchClient<SearchDocument> | null,
  chunkIds: string[]
): Promise<number> {
  if (!searchClient || chunkIds.length === 0) return 0;

  const BATCH_SIZE = 100;
  let deleted = 0;

  for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
    const batch = chunkIds.slice(i, i + BATCH_SIZE);
    try {
      await searchClient.deleteDocuments('chunkId', batch);
      deleted += batch.length;
    } catch (error) {
      // May fail if docs don't exist - that's OK
      console.error(
        `    Warning: Failed to delete search docs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return deleted;
}

async function deleteSingleFile(
  prisma: PrismaClient,
  containerClient: ContainerClient | null,
  searchClient: SearchClient<SearchDocument> | null,
  file: StuckFile,
  indent: string,
  dryRun: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Delete blob (if not a folder)
    if (!file.is_folder && file.blob_path) {
      if (!dryRun) {
        const blobDeleted = await deleteBlobIfExists(containerClient, file.blob_path);
        console.log(`${indent}Blob: ${blobDeleted ? 'Deleted' : 'FAILED'}`);
        if (!blobDeleted) {
          return { success: false, error: 'Failed to delete blob' };
        }
      } else {
        console.log(`${indent}[DRY RUN] Would delete blob: ${file.blob_path}`);
      }
    }

    // 2. Delete search documents (if not a folder)
    if (!file.is_folder) {
      const chunkIds = await getChunkIdsForFile(prisma, file.id);
      if (chunkIds.length > 0) {
        if (!dryRun) {
          const deleted = await deleteSearchDocumentsBatch(searchClient, chunkIds);
          console.log(`${indent}Search docs: Deleted ${deleted}/${chunkIds.length}`);
        } else {
          console.log(`${indent}[DRY RUN] Would delete ${chunkIds.length} search docs`);
        }
      }
    }

    // 3. Delete DB record (CASCADE handles file_chunks)
    if (!dryRun) {
      await prisma.files.delete({ where: { id: file.id } });
      console.log(`${indent}DB record: Deleted`);
    } else {
      console.log(`${indent}[DRY RUN] Would delete DB record`);
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`${indent}ERROR: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

async function runStuckDeletions(
  prisma: PrismaClient,
  containerClient: ContainerClient | null,
  searchClient: SearchClient<SearchDocument> | null,
  userId: string | null,
  dryRun: boolean
): Promise<PhaseResult> {
  console.log('\n' + '='.repeat(80));
  console.log('PHASE 1: STUCK DELETIONS');
  console.log('='.repeat(80));

  const result: PhaseResult = {
    phase: 'Stuck Deletions',
    itemsFound: 0,
    itemsProcessed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  const stuckFiles = await getStuckFiles(prisma, userId);
  result.itemsFound = stuckFiles.length;

  if (stuckFiles.length === 0) {
    console.log('\nNo stuck deletions found.');
    return result;
  }

  console.log(`\nFound ${stuckFiles.length} stuck files/folders`);

  const folders = stuckFiles.filter((f) => f.is_folder);
  const regularFiles = stuckFiles.filter((f) => !f.is_folder);

  console.log(`  Folders: ${folders.length}`);
  console.log(`  Files: ${regularFiles.length}`);

  // Process folders (delete children first, then folder)
  for (const folder of folders) {
    console.log(`\n[FOLDER] ${folder.name}`);
    console.log(`  ID: ${folder.id}`);
    console.log(`  Status: ${folder.deletion_status}`);

    result.itemsProcessed++;

    if (dryRun) {
      const children = await getChildFiles(prisma, folder.id);
      if (children.length > 0) {
        console.log(`  [DRY RUN] Would delete ${children.length} child file(s) first`);
      }
      console.log(`  [DRY RUN] Would delete folder`);
      result.succeeded++;
      continue;
    }

    // Delete children first to avoid FK constraint violation
    const children = await getChildFiles(prisma, folder.id);
    if (children.length > 0) {
      console.log(`  Deleting ${children.length} child file(s) first...`);
      for (const child of children) {
        console.log(`    [${child.is_folder ? 'FOLDER' : 'FILE'}] ${child.name}`);
        const childResult = await deleteSingleFile(prisma, containerClient, searchClient, child, '      ', false);
        if (!childResult.success) {
          result.failed++;
          result.errors.push(`Failed to delete child ${child.name}: ${childResult.error}`);
        } else {
          result.succeeded++;
        }
      }
    }

    // Delete the folder itself
    try {
      await prisma.files.delete({ where: { id: folder.id } });
      console.log(`  DB record: Deleted`);
      result.succeeded++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ERROR: ${errorMsg}`);
      result.failed++;
      result.errors.push(`Failed to delete folder ${folder.name}: ${errorMsg}`);
    }
  }

  // Process regular stuck files
  for (const file of regularFiles) {
    console.log(`\n[FILE] ${file.name}`);
    console.log(`  ID: ${file.id}`);
    console.log(`  Status: ${file.deletion_status}`);

    result.itemsProcessed++;

    const fileResult = await deleteSingleFile(prisma, containerClient, searchClient, file, '  ', dryRun);
    if (fileResult.success) {
      result.succeeded++;
    } else {
      result.failed++;
      result.errors.push(`Failed to delete file ${file.name}: ${fileResult.error}`);
    }
  }

  console.log('\n--- Phase 1 Summary ---');
  console.log(`Found: ${result.itemsFound}`);
  console.log(`Processed: ${result.itemsProcessed}`);
  console.log(`Succeeded: ${result.succeeded}`);
  console.log(`Failed: ${result.failed}`);

  return result;
}

// ============================================================================
// Phase 2: Ghost Records
// ============================================================================

async function getActiveFiles(prisma: PrismaClient, userId: string): Promise<GhostFile[]> {
  const files = await prisma.files.findMany({
    where: {
      user_id: userId,
      is_folder: false,
      deletion_status: null,
    },
    select: {
      id: true,
      name: true,
      blob_path: true,
      processing_status: true,
      created_at: true,
    },
  });

  return files as GhostFile[];
}

async function getVisualOrphans(prisma: PrismaClient, userId: string): Promise<VisualOrphan[]> {
  const orphans = await prisma.$queryRaw<VisualOrphan[]>`
    SELECT f.id, f.name, f.parent_folder_id, pf.name as parent_name, pf.deletion_status as parent_status
    FROM files f
    JOIN files pf ON f.parent_folder_id = pf.id
    WHERE f.user_id = ${userId} AND f.deletion_status IS NULL AND pf.deletion_status IS NOT NULL
  `;
  return orphans;
}

async function runGhostRecords(
  prisma: PrismaClient,
  containerClient: ContainerClient | null,
  userId: string | null,
  dryRun: boolean
): Promise<PhaseResult> {
  console.log('\n' + '='.repeat(80));
  console.log('PHASE 2: GHOST RECORDS');
  console.log('='.repeat(80));

  const result: PhaseResult = {
    phase: 'Ghost Records',
    itemsFound: 0,
    itemsProcessed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  if (!userId) {
    console.log('\nSkipping Phase 2: --all mode not supported (requires per-user blob checking)');
    return result;
  }

  if (!containerClient) {
    console.log('\nSkipping Phase 2: Blob Storage not available');
    return result;
  }

  console.log('\nChecking for ghost records (DB records without blobs)...');

  const activeFiles = await getActiveFiles(prisma, userId);
  console.log(`Found ${activeFiles.length} active files to check`);

  const ghostFiles: GhostFile[] = [];

  for (const file of activeFiles) {
    if (!file.blob_path) continue;

    try {
      const blobClient = containerClient.getBlobClient(file.blob_path);
      const exists = await blobClient.exists();

      if (!exists) {
        ghostFiles.push(file);
      }
    } catch (error) {
      console.error(`  Warning: Failed to check blob ${file.blob_path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  result.itemsFound = ghostFiles.length;

  if (ghostFiles.length === 0) {
    console.log('\nNo ghost records found.');
  } else {
    console.log(`\nFound ${ghostFiles.length} ghost records (DB records without blobs)`);

    for (const ghost of ghostFiles) {
      console.log(`\n[GHOST] ${ghost.name}`);
      console.log(`  ID: ${ghost.id}`);
      console.log(`  Blob path: ${ghost.blob_path}`);
      console.log(`  Processing status: ${ghost.processing_status}`);

      result.itemsProcessed++;

      if (dryRun) {
        console.log(`  [DRY RUN] Would delete DB record`);
        result.succeeded++;
      } else {
        try {
          await prisma.files.delete({ where: { id: ghost.id } });
          console.log(`  DB record: Deleted`);
          result.succeeded++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`  ERROR: ${errorMsg}`);
          result.failed++;
          result.errors.push(`Failed to delete ghost ${ghost.name}: ${errorMsg}`);
        }
      }
    }
  }

  // Check for visual orphans (files with deleted parent folders)
  console.log('\n--- Visual Orphans Check ---');
  const visualOrphans = await getVisualOrphans(prisma, userId);

  if (visualOrphans.length === 0) {
    console.log('No visual orphans found.');
  } else {
    console.log(`Found ${visualOrphans.length} visual orphans (files with deleted parent folders)`);
    for (const orphan of visualOrphans) {
      console.log(`  [ORPHAN] ${orphan.name} (parent: ${orphan.parent_name}, status: ${orphan.parent_status})`);
    }
  }

  console.log('\n--- Phase 2 Summary ---');
  console.log(`Found: ${result.itemsFound}`);
  console.log(`Processed: ${result.itemsProcessed}`);
  console.log(`Succeeded: ${result.succeeded}`);
  console.log(`Failed: ${result.failed}`);

  return result;
}

// ============================================================================
// Phase 3: Orphan Cleanup
// ============================================================================

async function runOrphanCleanup(
  prisma: PrismaClient,
  containerClient: ContainerClient | null,
  searchClient: SearchClient<SearchDocument> | null,
  userId: string | null,
  dryRun: boolean
): Promise<PhaseResult> {
  console.log('\n' + '='.repeat(80));
  console.log('PHASE 3: ORPHAN CLEANUP');
  console.log('='.repeat(80));

  const result: PhaseResult = {
    phase: 'Orphan Cleanup',
    itemsFound: 0,
    itemsProcessed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  // Sub-phase 3.1: Orphan AI Search docs
  if (searchClient) {
    console.log('\n--- 3.1: Orphan AI Search Documents ---');

    if (!userId) {
      console.log('Skipping: --all mode not supported for search orphan cleanup');
    } else {
      try {
        const searchResults = await searchClient.search('*', {
          select: ['chunkId', 'fileId', 'userId'],
          filter: `userId eq '${userId}'`,
          top: 10000,
        });

        const orphanChunkIds: string[] = [];

        for await (const doc of searchResults.results) {
          if (!doc.document.fileId) continue;

          const fileExists = await prisma.files.findUnique({
            where: { id: doc.document.fileId },
            select: { id: true },
          });

          if (!fileExists) {
            orphanChunkIds.push(doc.document.chunkId);
          }
        }

        result.itemsFound += orphanChunkIds.length;

        if (orphanChunkIds.length === 0) {
          console.log('No orphan search documents found.');
        } else {
          console.log(`Found ${orphanChunkIds.length} orphan search documents`);

          if (dryRun) {
            console.log(`[DRY RUN] Would delete ${orphanChunkIds.length} orphan search docs`);
            result.succeeded += orphanChunkIds.length;
          } else {
            const deleted = await deleteSearchDocumentsBatch(searchClient, orphanChunkIds);
            console.log(`Deleted ${deleted}/${orphanChunkIds.length} orphan search docs`);
            result.succeeded += deleted;
            result.failed += orphanChunkIds.length - deleted;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to check orphan search docs: ${errorMsg}`);
        result.errors.push(`Search orphan check failed: ${errorMsg}`);
      }
    }
  } else {
    console.log('\n--- 3.1: Orphan AI Search Documents ---');
    console.log('Skipping: AI Search not available');
  }

  // Sub-phase 3.2: Orphan blobs
  if (containerClient) {
    console.log('\n--- 3.2: Orphan Blobs ---');

    if (!userId) {
      console.log('Skipping: --all mode not supported for blob orphan cleanup');
    } else {
      try {
        const userPrefix = `${userId}/`;
        const blobsIter = containerClient.listBlobsFlat({ prefix: userPrefix });
        const blobPaths: string[] = [];

        for await (const blob of blobsIter) {
          blobPaths.push(blob.name);
        }

        console.log(`Found ${blobPaths.length} blobs for user ${userId}`);

        // Get all blob_paths from DB
        const dbFiles = await prisma.files.findMany({
          where: { user_id: userId },
          select: { blob_path: true },
        });

        const dbBlobPaths = new Set(dbFiles.map((f) => f.blob_path));

        const orphanBlobs = blobPaths.filter((bp) => !dbBlobPaths.has(bp));
        result.itemsFound += orphanBlobs.length;

        if (orphanBlobs.length === 0) {
          console.log('No orphan blobs found.');
        } else {
          console.log(`Found ${orphanBlobs.length} orphan blobs`);

          for (const blobPath of orphanBlobs) {
            result.itemsProcessed++;

            if (dryRun) {
              console.log(`  [DRY RUN] Would delete: ${blobPath}`);
              result.succeeded++;
            } else {
              try {
                await containerClient.deleteBlob(blobPath);
                console.log(`  Deleted: ${blobPath}`);
                result.succeeded++;
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`  Failed to delete ${blobPath}: ${errorMsg}`);
                result.failed++;
                result.errors.push(`Blob deletion failed: ${blobPath}`);
              }
            }
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to check orphan blobs: ${errorMsg}`);
        result.errors.push(`Blob orphan check failed: ${errorMsg}`);
      }
    }
  } else {
    console.log('\n--- 3.2: Orphan Blobs ---');
    console.log('Skipping: Blob Storage not available');
  }

  // Sub-phase 3.3: Orphan chunks
  console.log('\n--- 3.3: Orphan Chunks ---');
  try {
    if (dryRun) {
      const orphanChunks = await prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*) as count
        FROM file_chunks
        WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id = file_chunks.file_id)
        ${userId ? prisma.$queryRaw`AND file_id IN (SELECT id FROM files WHERE user_id = ${userId})` : prisma.$queryRaw``}
      `;

      const count = orphanChunks[0]?.count ?? 0;
      result.itemsFound += count;

      if (count === 0) {
        console.log('No orphan chunks found.');
      } else {
        console.log(`[DRY RUN] Would delete ${count} orphan chunks`);
        result.succeeded += count;
      }
    } else {
      const deleteResult = await prisma.$executeRaw`
        DELETE FROM file_chunks
        WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id = file_chunks.file_id)
        ${userId ? prisma.$queryRaw`AND file_id IN (SELECT id FROM files WHERE user_id = ${userId})` : prisma.$queryRaw``}
      `;

      result.itemsFound += deleteResult;
      result.succeeded += deleteResult;

      if (deleteResult === 0) {
        console.log('No orphan chunks found.');
      } else {
        console.log(`Deleted ${deleteResult} orphan chunks`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to delete orphan chunks: ${errorMsg}`);
    result.errors.push(`Chunk orphan cleanup failed: ${errorMsg}`);
  }

  console.log('\n--- Phase 3 Summary ---');
  console.log(`Found: ${result.itemsFound}`);
  console.log(`Processed: ${result.itemsProcessed}`);
  console.log(`Succeeded: ${result.succeeded}`);
  console.log(`Failed: ${result.failed}`);

  return result;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.userId && !args.all) {
    console.error('ERROR: Either --userId or --all is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('STORAGE CLEANUP & REPAIR SCRIPT');
  console.log('='.repeat(80));
  console.log(`User: ${args.userId ?? 'ALL USERS'}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN (preview only)' : 'LIVE (making changes)'}`);
  console.log(`Container: ${CONTAINER_NAME}`);
  console.log(`Search Index: ${INDEX_NAME}`);

  // Initialize services
  const prisma = createPrisma();
  const containerClient = createBlobContainerClient();
  const searchClient = createSearchClient<SearchDocument>();

  // Determine which phases to run
  const runAllPhases = !args.stuckDeletions && !args.ghostRecords && !args.orphans;
  const phases = {
    phase1: runAllPhases || args.stuckDeletions,
    phase2: runAllPhases || args.ghostRecords,
    phase3: runAllPhases || args.orphans,
  };

  console.log('\nPhases to run:');
  console.log(`  Phase 1 (Stuck Deletions): ${phases.phase1 ? 'YES' : 'NO'}`);
  console.log(`  Phase 2 (Ghost Records): ${phases.phase2 ? 'YES' : 'NO'}`);
  console.log(`  Phase 3 (Orphan Cleanup): ${phases.phase3 ? 'YES' : 'NO'}`);

  const phaseResults: PhaseResult[] = [];

  try {
    // Get users to process
    const userIds: string[] = [];
    if (args.all) {
      const users = await prisma.files.findMany({
        where: { is_folder: false },
        distinct: ['user_id'],
        select: { user_id: true },
      });
      userIds.push(...users.map((u) => u.user_id));
      console.log(`\nFound ${userIds.length} users to process`);
    } else {
      userIds.push(args.userId as string);
    }

    for (const currentUserId of userIds) {
      if (userIds.length > 1) {
        console.log('\n' + '='.repeat(80));
        console.log(`PROCESSING USER: ${currentUserId}`);
        console.log('='.repeat(80));
      }

      // Phase 1: Stuck Deletions
      if (phases.phase1) {
        const result = await runStuckDeletions(
          prisma,
          containerClient,
          searchClient,
          args.all ? null : currentUserId,
          args.dryRun
        );
        phaseResults.push(result);
      }

      // Phase 2: Ghost Records
      if (phases.phase2) {
        const result = await runGhostRecords(prisma, containerClient, currentUserId, args.dryRun);
        phaseResults.push(result);
      }

      // Phase 3: Orphan Cleanup
      if (phases.phase3) {
        const result = await runOrphanCleanup(prisma, containerClient, searchClient, currentUserId, args.dryRun);
        phaseResults.push(result);
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));

    let totalFound = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;

    for (const result of phaseResults) {
      console.log(`\n${result.phase}:`);
      console.log(`  Found: ${result.itemsFound}`);
      console.log(`  Succeeded: ${result.succeeded}`);
      console.log(`  Failed: ${result.failed}`);

      totalFound += result.itemsFound;
      totalSucceeded += result.succeeded;
      totalFailed += result.failed;

      if (result.errors.length > 0) {
        console.log(`  Errors:`);
        for (const error of result.errors.slice(0, 5)) {
          console.log(`    - ${error}`);
        }
        if (result.errors.length > 5) {
          console.log(`    ... and ${result.errors.length - 5} more errors`);
        }
      }
    }

    console.log('\nTotals:');
    console.log(`  Items Found: ${totalFound}`);
    console.log(`  Succeeded: ${totalSucceeded}`);
    console.log(`  Failed: ${totalFailed}`);

    if (args.dryRun) {
      console.log('\n[DRY RUN] No changes were made. Run without --dry-run to apply fixes.');
    } else {
      console.log(`\n${totalFailed === 0 ? 'SUCCESS' : 'COMPLETED WITH ERRORS'}`);
    }

    // Exit code based on failures
    process.exit(totalFailed > 0 ? 1 : 0);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n' + '='.repeat(80));
  console.error('SCRIPT FAILED');
  console.error('='.repeat(80));
  const errorInfo =
    error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
  console.error(JSON.stringify(errorInfo, null, 2));
  process.exit(1);
});
