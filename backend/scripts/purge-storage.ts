/**
 * Consolidated destructive purge script for all storage layers.
 *
 * Replaces:
 *   - purge-all-storage.ts
 *   - purge-ai-search.ts
 *
 * Usage:
 *   npx tsx backend/scripts/purge-storage.ts --target all              # Purge everything (SQL + Blob + AI Search)
 *   npx tsx backend/scripts/purge-storage.ts --target search           # AI Search only
 *   npx tsx backend/scripts/purge-storage.ts --target blobs            # Blob Storage only
 *   npx tsx backend/scripts/purge-storage.ts --target db               # SQL Database only
 *   npx tsx backend/scripts/purge-storage.ts --target all --confirm    # Skip interactive prompt
 *   npx tsx backend/scripts/purge-storage.ts --help
 *
 * Safety:
 *   - Requires --target flag
 *   - Interactive confirmation unless --confirm flag is passed
 *   - Bright red warning box before destructive operations
 */
import 'dotenv/config';
import { createInterface } from 'readline/promises';
import { createPrisma } from './_shared/prisma';
import { createBlobContainerClient, createSearchClient, CONTAINER_NAME, INDEX_NAME } from './_shared/azure';
import { getFlag, hasFlag } from './_shared/args';

type PurgeTarget = 'db' | 'blobs' | 'search' | 'all';

interface PurgeResult {
  db: { files: number; chunks: number; embeddings: number; attachments: number } | null;
  blobs: { count: number } | null;
  search: { count: number } | null;
}

interface ChunkDocument {
  chunkId: string;
  [key: string]: unknown;
}

// ANSI color codes for terminal output
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function printUsage(): void {
  console.log(`
${BOLD}Usage:${RESET}
  npx tsx backend/scripts/purge-storage.ts --target <target> [--confirm]

${BOLD}Targets:${RESET}
  all      Purge everything (SQL + Blob Storage + AI Search)
  db       SQL Database only (files, chunks, embeddings, attachments)
  blobs    Azure Blob Storage only
  search   Azure AI Search only

${BOLD}Flags:${RESET}
  --confirm   Skip interactive confirmation prompt
  --help      Show this help message

${BOLD}Examples:${RESET}
  npx tsx backend/scripts/purge-storage.ts --target all
  npx tsx backend/scripts/purge-storage.ts --target search --confirm
`);
}

function printWarning(target: PurgeTarget): void {
  const targetDescriptions: Record<PurgeTarget, string> = {
    all: 'all (SQL + Blob Storage + AI Search)',
    db: 'db (SQL Database)',
    blobs: 'blobs (Azure Blob Storage)',
    search: 'search (Azure AI Search)',
  };

  console.log(`
${RED}${BOLD}!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!${RESET}
${RED}${BOLD}!!  DANGER: This will PERMANENTLY DELETE data!            !!${RESET}
${RED}${BOLD}!!  Target: ${targetDescriptions[target].padEnd(45)}!!${RESET}
${RED}${BOLD}!!  This action is IRREVERSIBLE.                          !!${RESET}
${RED}${BOLD}!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!${RESET}
`);
}

async function confirmPurge(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question('Type YES to confirm: ');
    return answer.trim() === 'YES';
  } finally {
    rl.close();
  }
}

async function purgeDatabase(): Promise<PurgeResult['db']> {
  console.log(`\n${YELLOW}Purging SQL Database...${RESET}`);
  const prisma = createPrisma();

  try {
    // Count before
    console.log('Counting records before deletion...');
    const [fileCount, chunkCount, embeddingCount, attachmentCount] = await Promise.all([
      prisma.files.count(),
      prisma.file_chunks.count(),
      prisma.image_embeddings.count(),
      prisma.message_file_attachments.count(),
    ]);

    console.log(`Found: ${fileCount} files, ${chunkCount} chunks, ${embeddingCount} embeddings, ${attachmentCount} attachments`);

    if (fileCount === 0 && attachmentCount === 0) {
      console.log('Database is already empty, skipping deletion.');
      return { files: 0, chunks: 0, embeddings: 0, attachments: 0 };
    }

    // Delete attachments first (safety - prevent orphans)
    if (attachmentCount > 0) {
      console.log('Deleting message_file_attachments...');
      await prisma.message_file_attachments.deleteMany({});
    }

    // Delete all files (CASCADE handles file_chunks and image_embeddings)
    if (fileCount > 0) {
      console.log('Deleting files (CASCADE will delete chunks and embeddings)...');
      await prisma.files.deleteMany({});
    }

    // Verify deletion
    const [filesAfter, chunksAfter, embeddingsAfter, attachmentsAfter] = await Promise.all([
      prisma.files.count(),
      prisma.file_chunks.count(),
      prisma.image_embeddings.count(),
      prisma.message_file_attachments.count(),
    ]);

    if (filesAfter > 0 || chunksAfter > 0 || embeddingsAfter > 0 || attachmentsAfter > 0) {
      console.error(`${RED}Warning: Some records remain after deletion!${RESET}`);
      console.error(`  Files: ${filesAfter}, Chunks: ${chunksAfter}, Embeddings: ${embeddingsAfter}, Attachments: ${attachmentsAfter}`);
    } else {
      console.log(`${GREEN}Database purge complete.${RESET}`);
    }

    return {
      files: fileCount,
      chunks: chunkCount,
      embeddings: embeddingCount,
      attachments: attachmentCount,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function purgeBlobs(): Promise<PurgeResult['blobs']> {
  console.log(`\n${YELLOW}Purging Azure Blob Storage...${RESET}`);
  const containerClient = createBlobContainerClient();

  if (!containerClient) {
    console.log('Blob Storage credentials not configured, skipping.');
    return null;
  }

  console.log(`Container: ${CONTAINER_NAME}`);

  // List all blobs
  console.log('Listing blobs...');
  const blobsToDelete: string[] = [];

  try {
    for await (const blob of containerClient.listBlobsFlat()) {
      blobsToDelete.push(blob.name);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${RED}Error listing blobs: ${errorMessage}${RESET}`);
    return null;
  }

  console.log(`Found ${blobsToDelete.length} blobs to delete`);

  if (blobsToDelete.length === 0) {
    console.log('No blobs to delete.');
    return { count: 0 };
  }

  // Delete each blob
  let deletedCount = 0;
  for (const blobName of blobsToDelete) {
    try {
      await containerClient.deleteBlob(blobName);
      deletedCount++;
      if (deletedCount % 100 === 0) {
        console.log(`  Deleted ${deletedCount}/${blobsToDelete.length} blobs...`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${RED}Failed to delete blob ${blobName}: ${errorMessage}${RESET}`);
    }
  }

  console.log(`${GREEN}Blob Storage purge complete. Deleted ${deletedCount} blobs.${RESET}`);
  return { count: deletedCount };
}

async function purgeSearch(): Promise<PurgeResult['search']> {
  console.log(`\n${YELLOW}Purging Azure AI Search...${RESET}`);
  const searchClient = createSearchClient<ChunkDocument>();

  if (!searchClient) {
    console.log('AI Search credentials not configured, skipping.');
    return null;
  }

  console.log(`Index: ${INDEX_NAME}`);

  // Search for all documents
  console.log('Searching for all documents...');
  const documentsToDelete: string[] = [];

  try {
    const searchResults = searchClient.search('*', {
      select: ['chunkId'],
      top: 10000,
    });

    for await (const result of searchResults.results) {
      if (result.document.chunkId) {
        documentsToDelete.push(result.document.chunkId);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${RED}Error searching index: ${errorMessage}${RESET}`);
    return null;
  }

  console.log(`Found ${documentsToDelete.length} documents to delete`);

  if (documentsToDelete.length === 0) {
    console.log('No documents to delete.');
    return { count: 0 };
  }

  // Delete in batches of 1000
  const BATCH_SIZE = 1000;
  let deletedCount = 0;

  for (let i = 0; i < documentsToDelete.length; i += BATCH_SIZE) {
    const batch = documentsToDelete.slice(i, i + BATCH_SIZE);
    try {
      await searchClient.deleteDocuments('chunkId', batch);
      deletedCount += batch.length;
      console.log(`  Deleted ${deletedCount}/${documentsToDelete.length} documents...`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${RED}Failed to delete batch: ${errorMessage}${RESET}`);
    }
  }

  // Verify deletion
  try {
    const verifyResults = searchClient.search('*', { top: 1 });
    let remainingCount = 0;
    for await (const _ of verifyResults.results) {
      remainingCount++;
    }

    if (remainingCount > 0) {
      console.error(`${RED}Warning: ${remainingCount} documents still remain in index!${RESET}`);
    } else {
      console.log(`${GREEN}AI Search purge complete. Deleted ${deletedCount} documents.${RESET}`);
    }
  } catch (error) {
    // Verification failed, but deletion was attempted
    console.log(`${YELLOW}Could not verify deletion, but ${deletedCount} documents were deleted.${RESET}`);
  }

  return { count: deletedCount };
}

function printSummary(result: PurgeResult): void {
  console.log(`
${BOLD}=== PURGE COMPLETE ===${RESET}`);

  if (result.db !== null) {
    console.log(`${BOLD}SQL Server:${RESET}`);
    console.log(`  Files deleted: ${result.db.files}`);
    console.log(`  Chunks deleted: ${result.db.chunks}`);
    console.log(`  Embeddings deleted: ${result.db.embeddings}`);
    console.log(`  Attachments deleted: ${result.db.attachments}`);
  }

  if (result.blobs !== null) {
    console.log(`${BOLD}Blob Storage:${RESET} ${result.blobs.count} blobs deleted`);
  }

  if (result.search !== null) {
    console.log(`${BOLD}AI Search:${RESET} ${result.search.count} documents deleted`);
  }
}

async function main(): Promise<void> {
  // Parse arguments
  const target = getFlag('--target') as PurgeTarget | null;
  const confirm = hasFlag('--confirm');
  const help = hasFlag('--help');

  if (help) {
    printUsage();
    process.exit(0);
  }

  if (!target || !['db', 'blobs', 'search', 'all'].includes(target)) {
    console.error(`${RED}Error: --target flag is required and must be one of: db, blobs, search, all${RESET}\n`);
    printUsage();
    process.exit(1);
  }

  // Print warning and get confirmation
  printWarning(target);

  if (!confirm) {
    const confirmed = await confirmPurge();
    if (!confirmed) {
      console.log('\nPurge cancelled.');
      process.exit(0);
    }
  }

  console.log(`\n${BOLD}Starting purge operation...${RESET}`);

  const result: PurgeResult = {
    db: null,
    blobs: null,
    search: null,
  };

  try {
    if (target === 'all' || target === 'db') {
      result.db = await purgeDatabase();
    }

    if (target === 'all' || target === 'blobs') {
      result.blobs = await purgeBlobs();
    }

    if (target === 'all' || target === 'search') {
      result.search = await purgeSearch();
    }

    printSummary(result);
    process.exit(0);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    console.error(`${RED}${BOLD}Fatal error during purge:${RESET}`, errorInfo);
    process.exit(1);
  }
}

main();
