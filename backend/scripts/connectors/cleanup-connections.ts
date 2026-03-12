/**
 * Cleanup Connections
 *
 * Comprehensive cleanup script for resetting connector state (OneDrive,
 * SharePoint, or both). Removes all synced files, folders, connection scopes,
 * and the connection itself for a user+provider combination.
 *
 * Also cleans up associated Azure resources (Blob Storage, AI Search) when
 * credentials are available.
 *
 * Designed for e2e testing workflows — allows resetting to a clean slate
 * before re-testing connection and sync flows.
 *
 * Usage:
 *   npx tsx scripts/connectors/cleanup-connections.ts --userId <ID> --provider onedrive --dry-run
 *   npx tsx scripts/connectors/cleanup-connections.ts --userId <ID> --provider sharepoint --confirm
 *   npx tsx scripts/connectors/cleanup-connections.ts --userId <ID> --provider all --confirm
 *   npx tsx scripts/connectors/cleanup-connections.ts --help
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { getFlag, hasFlag } from '../_shared/args';
import { createBlobContainerClient, createSearchClient } from '../_shared/azure';

// ─── ANSI Colors ─────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Output helpers ───────────────────────────────────────────────
const ok = (msg: string): void => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const warn = (msg: string): void => console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
const fail = (msg: string): void => console.log(`  ${RED}✗${RESET} ${msg}`);
const info = (msg: string): void => console.log(`  ${CYAN}ℹ${RESET} ${msg}`);

function header(title: string): void {
  console.log(`\n${BOLD}${CYAN}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${BOLD}${CYAN}${'═'.repeat(60)}${RESET}\n`);
}

function subheader(title: string): void {
  console.log(`\n${BOLD}  ${title}${RESET}`);
  console.log(`  ${DIM}${'─'.repeat(50)}${RESET}`);
}

// ─── Types ───────────────────────────────────────────────────────
type Provider = 'onedrive' | 'sharepoint';

interface ChunkSearchDoc {
  chunkId: string;
  [key: string]: unknown;
}

// ─── Help ────────────────────────────────────────────────────────
function printHelp(): void {
  console.log(`
${BOLD}cleanup-connections.ts${RESET} — Reset connector state for e2e testing

${BOLD}Usage:${RESET}
  npx tsx scripts/connectors/cleanup-connections.ts --userId <ID> --provider onedrive --dry-run
  npx tsx scripts/connectors/cleanup-connections.ts --userId <ID> --provider sharepoint --confirm
  npx tsx scripts/connectors/cleanup-connections.ts --userId <ID> --provider all --confirm
  npx tsx scripts/connectors/cleanup-connections.ts --help

${BOLD}Flags:${RESET}
  --userId <ID>             Required. Target user whose connections will be cleaned.
  --provider <value>        Required. Which provider(s) to clean.
                              onedrive   — clean OneDrive connections only
                              sharepoint — clean SharePoint connections only
                              all        — clean both OneDrive and SharePoint
  --dry-run                 Preview what will be deleted without making changes (default mode).
  --confirm                 Actually execute the cleanup. Required for destructive operations.
  --help, -h                Show this help message.

${BOLD}What gets cleaned:${RESET}
  1. message_citations unlinked   (file_id set to NULL — no cascade)
  2. AI Search documents deleted  (from file_chunks.search_document_id)
  3. Blob Storage files deleted   (from files.blob_path)
  4. files deleted                (cascades file_chunks, image_embeddings, message_file_attachments)
  5. connection_scopes deleted
  6. connections deleted

${BOLD}Azure credentials (optional):${RESET}
  STORAGE_CONNECTION_STRING   — enables Blob Storage cleanup
  AZURE_SEARCH_ENDPOINT       — enables AI Search cleanup (also requires AZURE_SEARCH_KEY)
  AZURE_SEARCH_KEY
  When not set, those steps are skipped with a warning.
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp();
  process.exit(0);
}

// ─── Provider resolution ─────────────────────────────────────────
function resolveProviders(providerArg: string): Provider[] {
  if (providerArg === 'onedrive') return ['onedrive'];
  if (providerArg === 'sharepoint') return ['sharepoint'];
  if (providerArg === 'all') return ['onedrive', 'sharepoint'];
  return [];
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const userId = getFlag('--userId')?.toUpperCase() ?? null;
  const providerArg = getFlag('--provider') ?? null;
  const confirm = hasFlag('--confirm');

  // Validate required flags
  if (!userId) {
    console.error(`${RED}ERROR: --userId is required.${RESET}`);
    printHelp();
    process.exit(1);
  }

  if (!providerArg) {
    console.error(`${RED}ERROR: --provider is required (onedrive | sharepoint | all).${RESET}`);
    printHelp();
    process.exit(1);
  }

  const providers = resolveProviders(providerArg);
  if (providers.length === 0) {
    console.error(
      `${RED}ERROR: --provider must be one of: onedrive, sharepoint, all.${RESET}\n` +
      `  Got: "${providerArg}"`
    );
    process.exit(1);
  }

  const effectiveDryRun = !confirm;

  console.log(`\n${BOLD}Cleanup Connections${RESET}`);
  console.log(`  User:      ${CYAN}${userId}${RESET}`);
  console.log(`  Providers: ${CYAN}${providers.join(', ')}${RESET}`);
  console.log(`  Mode:      ${effectiveDryRun ? `${YELLOW}DRY RUN (preview only)${RESET}` : `${RED}LIVE — data WILL be deleted${RESET}`}`);

  const prisma = createPrisma();

  try {
    // ── Preview Phase ────────────────────────────────────────────
    header('Preview — What Will Be Cleaned');

    // 1. Connections for the provider(s)
    const connections = await prisma.connections.findMany({
      where: {
        user_id: userId,
        provider: { in: providers },
      },
      select: {
        id: true,
        provider: true,
        status: true,
        display_name: true,
        created_at: true,
      },
    });

    subheader(`Connections (${connections.length})`);
    if (connections.length === 0) {
      warn(`No connections found for user ${userId} with provider(s): ${providers.join(', ')}`);
      info('Nothing to clean — exiting.');
      return;
    }

    for (const conn of connections) {
      const statusColor =
        conn.status === 'connected' ? GREEN :
        conn.status === 'expired' ? YELLOW : RED;
      console.log(
        `    ${BOLD}${conn.display_name ?? conn.provider}${RESET}` +
        `  ${statusColor}${conn.status}${RESET}` +
        `  ${DIM}${conn.id}${RESET}`
      );
    }

    const connectionIds = connections.map((c) => c.id);

    // 2. Connection scopes
    const scopeCount = await prisma.connection_scopes.count({
      where: { connection_id: { in: connectionIds } },
    });
    subheader(`Connection Scopes`);
    info(`${scopeCount} scope(s) will be deleted`);

    // 3. Files breakdown (folders vs non-folders) per source_type
    // Includes soft-deleted files (deleted_at not null, deletion_status='pending')
    // since those still have DB records, chunks, and search docs to clean.
    subheader(`Files`);
    for (const provider of providers) {
      const folderCount = await prisma.files.count({
        where: { user_id: userId, source_type: provider, is_folder: true },
      });
      const fileCount = await prisma.files.count({
        where: { user_id: userId, source_type: provider, is_folder: false },
      });
      const pendingDeletion = await prisma.files.count({
        where: { user_id: userId, source_type: provider, deleted_at: { not: null } },
      });
      info(`${provider}: ${fileCount} file(s), ${folderCount} folder(s)${pendingDeletion > 0 ? ` (${pendingDeletion} pending deletion)` : ''}`);
    }

    const totalFileIds = await prisma.files.findMany({
      where: {
        user_id: userId,
        source_type: { in: providers },
      },
      select: { id: true },
    });
    const fileIds = totalFileIds.map((f) => f.id);
    const totalFileCount = fileIds.length;

    // 4. File chunks (will cascade from files delete)
    const chunkCount = totalFileCount > 0
      ? await prisma.file_chunks.count({ where: { file_id: { in: fileIds } } })
      : 0;
    info(`${chunkCount} file_chunk(s) will be cascade-deleted`);

    // 5. Message citations (no cascade — will be unlinked)
    const citationCount = totalFileCount > 0
      ? await prisma.message_citations.count({ where: { file_id: { in: fileIds } } })
      : 0;
    info(`${citationCount} message_citation(s) will be unlinked (file_id set to NULL)`);

    // 6. Message file attachments (cascade from files delete)
    const attachmentCount = totalFileCount > 0
      ? await prisma.message_file_attachments.count({ where: { file_id: { in: fileIds } } })
      : 0;
    info(`${attachmentCount} message_file_attachment(s) will be cascade-deleted`);

    // 7. Image embeddings (cascade from files delete)
    const embeddingCount = totalFileCount > 0
      ? await prisma.image_embeddings.count({ where: { file_id: { in: fileIds } } })
      : 0;
    info(`${embeddingCount} image_embedding(s) will be cascade-deleted`);

    // 8. AI Search documents (via file_chunks.search_document_id)
    subheader(`Azure Resources`);
    const chunksWithSearchDoc = totalFileCount > 0
      ? await prisma.file_chunks.count({
          where: {
            file_id: { in: fileIds },
            search_document_id: { not: null },
          },
        })
      : 0;
    info(`${chunksWithSearchDoc} AI Search document(s) to delete (chunks with search_document_id)`);

    // 9. Blob storage paths
    const filesWithBlobPath = totalFileCount > 0
      ? await prisma.files.count({
          where: {
            id: { in: fileIds },
            blob_path: { not: null },
          },
        })
      : 0;
    info(`${filesWithBlobPath} blob(s) to delete (files with non-null blob_path)`);

    // Summary table
    subheader('Summary');
    console.log(`    ${'connections:'.padEnd(34)} ${connections.length}`);
    console.log(`    ${'connection_scopes:'.padEnd(34)} ${scopeCount}`);
    console.log(`    ${'files (total):'.padEnd(34)} ${totalFileCount}`);
    console.log(`    ${'file_chunks (cascade):'.padEnd(34)} ${chunkCount}`);
    console.log(`    ${'message_citations (unlink):'.padEnd(34)} ${citationCount}`);
    console.log(`    ${'message_file_attachments (cascade):'.padEnd(34)} ${attachmentCount}`);
    console.log(`    ${'image_embeddings (cascade):'.padEnd(34)} ${embeddingCount}`);
    console.log(`    ${'AI Search docs:'.padEnd(34)} ${chunksWithSearchDoc}`);
    console.log(`    ${'Blob Storage files:'.padEnd(34)} ${filesWithBlobPath}`);

    if (effectiveDryRun) {
      console.log(`\n${YELLOW}DRY RUN — no changes made. Use --confirm to apply.${RESET}`);
      return;
    }

    // ── Cleanup Phase ─────────────────────────────────────────────
    header('Cleanup');

    // a. Unlink message_citations
    subheader('a. Unlink message_citations');
    if (citationCount > 0 && fileIds.length > 0) {
      // Prisma updateMany with an "in" list for the file_id
      const unlinked = await prisma.message_citations.updateMany({
        where: { file_id: { in: fileIds } },
        data: { file_id: null },
      });
      ok(`Unlinked ${unlinked.count} message_citation(s) (file_id → NULL)`);
    } else {
      info('No message_citations to unlink');
    }

    // b. Delete AI Search documents
    subheader('b. Delete AI Search documents');
    const searchClient = createSearchClient<ChunkSearchDoc>();
    if (!searchClient) {
      warn('AI Search credentials not configured (AZURE_SEARCH_ENDPOINT / AZURE_SEARCH_KEY not set) — skipping');
    } else if (chunksWithSearchDoc > 0 && fileIds.length > 0) {
      const chunksWithDocs = await prisma.file_chunks.findMany({
        where: {
          file_id: { in: fileIds },
          search_document_id: { not: null },
        },
        select: { search_document_id: true },
      });

      const searchDocIds = chunksWithDocs
        .map((c) => c.search_document_id)
        .filter((id): id is string => id !== null);

      const SEARCH_BATCH_SIZE = 1000;
      let deletedSearchDocs = 0;
      try {
        for (let i = 0; i < searchDocIds.length; i += SEARCH_BATCH_SIZE) {
          const batch = searchDocIds.slice(i, i + SEARCH_BATCH_SIZE);
          await searchClient.deleteDocuments('chunkId', batch);
          deletedSearchDocs += batch.length;
          if (searchDocIds.length > SEARCH_BATCH_SIZE) {
            console.log(`    ${DIM}deleted ${deletedSearchDocs}/${searchDocIds.length} search docs...${RESET}`);
          }
        }
        ok(`Deleted ${deletedSearchDocs} AI Search document(s)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fail(`AI Search deletion failed: ${msg}`);
        warn('Continuing with remaining cleanup steps...');
      }
    } else {
      info('No AI Search documents to delete');
    }

    // c. Delete blob storage files
    subheader('c. Delete Blob Storage files');
    const containerClient = createBlobContainerClient();
    if (!containerClient) {
      warn('Blob Storage credentials not configured (STORAGE_CONNECTION_STRING not set) — skipping');
    } else if (filesWithBlobPath > 0 && fileIds.length > 0) {
      const filesWithBlobs = await prisma.files.findMany({
        where: {
          id: { in: fileIds },
          blob_path: { not: null },
        },
        select: { id: true, name: true, blob_path: true },
      });

      let deletedBlobs = 0;
      let failedBlobs = 0;
      for (const file of filesWithBlobs) {
        const blobPath = file.blob_path!;
        try {
          await containerClient.deleteBlob(blobPath, { deleteSnapshots: 'include' });
          deletedBlobs++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Blob may already be gone — treat as non-fatal
          if (msg.includes('BlobNotFound') || msg.includes('404')) {
            deletedBlobs++; // Count as handled
          } else {
            failedBlobs++;
            if (failedBlobs <= 5) {
              warn(`Failed to delete blob "${blobPath}" (${file.name}): ${msg}`);
            }
          }
        }
        if (deletedBlobs % 50 === 0 && deletedBlobs > 0) {
          console.log(`    ${DIM}deleted ${deletedBlobs}/${filesWithBlobs.length} blobs...${RESET}`);
        }
      }
      ok(`Deleted ${deletedBlobs} blob(s)`);
      if (failedBlobs > 0) {
        warn(`${failedBlobs} blob(s) failed to delete (see warnings above)`);
      }
    } else {
      info('No blobs to delete');
    }

    // d. Delete files (cascades: file_chunks, image_embeddings, message_file_attachments)
    // Includes soft-deleted files — a full cleanup removes everything.
    subheader('d. Delete files');
    if (fileIds.length > 0) {
      const deletedFiles = await prisma.files.deleteMany({
        where: {
          user_id: userId,
          source_type: { in: providers },
        },
      });
      ok(`Deleted ${deletedFiles.count} file(s) (file_chunks, image_embeddings, message_file_attachments cascade-deleted)`);
    } else {
      info('No files to delete');
    }

    // e. Delete connection_scopes
    subheader('e. Delete connection_scopes');
    if (scopeCount > 0) {
      const deletedScopes = await prisma.connection_scopes.deleteMany({
        where: { connection_id: { in: connectionIds } },
      });
      ok(`Deleted ${deletedScopes.count} connection_scope(s)`);
    } else {
      info('No connection_scopes to delete');
    }

    // f. Delete connections
    subheader('f. Delete connections');
    const deletedConnections = await prisma.connections.deleteMany({
      where: {
        user_id: userId,
        provider: { in: providers },
      },
    });
    ok(`Deleted ${deletedConnections.count} connection(s)`);

    // ── Verification Phase ────────────────────────────────────────
    header('Verification');

    // Confirm 0 files remain
    const remainingFiles = await prisma.files.count({
      where: {
        user_id: userId,
        source_type: { in: providers },
      },
    });
    if (remainingFiles === 0) {
      ok(`Files remaining: 0`);
    } else {
      fail(`Files remaining: ${remainingFiles} (expected 0)`);
    }

    // Confirm 0 connection_scopes remain
    const remainingScopes = await prisma.connection_scopes.count({
      where: { connection_id: { in: connectionIds } },
    });
    if (remainingScopes === 0) {
      ok(`Connection scopes remaining: 0`);
    } else {
      fail(`Connection scopes remaining: ${remainingScopes} (expected 0)`);
    }

    // Confirm 0 connections remain
    const remainingConnections = await prisma.connections.count({
      where: {
        user_id: userId,
        provider: { in: providers },
      },
    });
    if (remainingConnections === 0) {
      ok(`Connections remaining: 0`);
    } else {
      fail(`Connections remaining: ${remainingConnections} (expected 0)`);
    }

    // Belt-and-suspenders: confirm 0 orphaned file_chunks
    const orphanedChunks = fileIds.length > 0
      ? await prisma.file_chunks.count({ where: { file_id: { in: fileIds } } })
      : 0;
    if (orphanedChunks === 0) {
      ok(`Orphaned file_chunks remaining: 0`);
    } else {
      fail(`Orphaned file_chunks remaining: ${orphanedChunks} (expected 0 — cascade may have failed)`);
    }

    const hasFailures =
      remainingFiles > 0 ||
      remainingScopes > 0 ||
      remainingConnections > 0 ||
      orphanedChunks > 0;

    console.log('');
    if (hasFailures) {
      fail('Cleanup completed with verification failures — see above');
    } else {
      ok(`${BOLD}Cleanup complete — ready for a fresh connection test.${RESET}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
