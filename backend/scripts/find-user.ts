/**
 * Find User by Name
 *
 * Searches for users by name or email (partial or exact match) in the database.
 *
 * Usage:
 *   npx tsx scripts/find-user.ts "Juan Pablo"
 *   npx tsx scripts/find-user.ts "romero" --exact
 *   npx tsx scripts/find-user.ts "juan" --files
 */

import 'dotenv/config';
import { createPrisma } from './_shared/prisma';
import { getPositionalArg, hasFlag } from './_shared/args';

// ============================================================================
// Types
// ============================================================================

interface UserRecord {
  id: string;
  email: string;
  full_name: string | null;
  created_at: Date;
  last_microsoft_login: Date | null;
}

interface UserStats {
  total_sessions: number;
  total_files: number;
  total_folders: number;
}

interface FileDetails {
  processing: Record<string, number>;
  embeddings: Record<string, number>;
  stuck_deletions: number;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): { searchTerm: string; exactMatch: boolean; showFiles: boolean } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Find User Script

Usage:
  npx tsx scripts/find-user.ts "<search term>" [--exact] [--files]

Arguments:
  <search term>  Name or email to search for (partial match by default)
  --exact        Use exact match instead of partial match
  --files        Show detailed file statistics (processing, embeddings, stuck deletions)

Examples:
  npx tsx scripts/find-user.ts "Juan Pablo"
  npx tsx scripts/find-user.ts "juan.pablo@example.com" --exact
  npx tsx scripts/find-user.ts "romero"
  npx tsx scripts/find-user.ts "juan" --files
`);
    process.exit(0);
  }

  const searchTerm = getPositionalArg() || '';
  const exactMatch = hasFlag('--exact');
  const showFiles = hasFlag('--files');

  if (!searchTerm) {
    console.error('ERROR: Search term is required');
    process.exit(1);
  }

  return { searchTerm, exactMatch, showFiles };
}

// ============================================================================
// Database Queries
// ============================================================================

async function findUsers(
  prisma: ReturnType<typeof createPrisma>,
  searchTerm: string,
  exactMatch: boolean
): Promise<UserRecord[]> {
  const whereClause = exactMatch
    ? {
        OR: [{ full_name: searchTerm }, { email: searchTerm }],
      }
    : {
        OR: [{ full_name: { contains: searchTerm } }, { email: { contains: searchTerm } }],
      };

  const users = await prisma.users.findMany({
    where: whereClause,
    select: {
      id: true,
      email: true,
      full_name: true,
      created_at: true,
      last_microsoft_login: true,
    },
    orderBy: [{ full_name: 'asc' }, { created_at: 'desc' }],
  });

  return users.map((u) => ({
    ...u,
    id: u.id.toUpperCase(),
  }));
}

async function getUserStats(
  prisma: ReturnType<typeof createPrisma>,
  userId: string
): Promise<UserStats> {
  const [sessionCount, fileStats] = await Promise.all([
    prisma.sessions.count({ where: { user_id: userId } }),
    prisma.files.groupBy({
      by: ['is_folder'],
      where: { user_id: userId },
      _count: true,
    }),
  ]);

  const fileCount = fileStats.find((s) => s.is_folder === false)?._count || 0;
  const folderCount = fileStats.find((s) => s.is_folder === true)?._count || 0;

  return {
    total_sessions: sessionCount,
    total_files: fileCount,
    total_folders: folderCount,
  };
}

async function getFileDetails(
  prisma: ReturnType<typeof createPrisma>,
  userId: string
): Promise<FileDetails> {
  const [processingGroups, embeddingGroups, stuckCount] = await Promise.all([
    prisma.files.groupBy({
      by: ['processing_status'],
      where: { user_id: userId, is_folder: false, deletion_status: null },
      _count: true,
    }),
    prisma.files.groupBy({
      by: ['embedding_status'],
      where: { user_id: userId, is_folder: false, deletion_status: null },
      _count: true,
    }),
    prisma.files.count({
      where: { user_id: userId, deletion_status: { not: null } },
    }),
  ]);

  const processing: Record<string, number> = {};
  for (const group of processingGroups) {
    if (group.processing_status) {
      processing[group.processing_status] = group._count;
    }
  }

  const embeddings: Record<string, number> = {};
  for (const group of embeddingGroups) {
    if (group.embedding_status) {
      embeddings[group.embedding_status] = group._count;
    }
  }

  return {
    processing,
    embeddings,
    stuck_deletions: stuckCount,
  };
}

// ============================================================================
// Display Utilities
// ============================================================================

function formatFileDetails(details: FileDetails): string {
  const lines: string[] = [];
  lines.push('\n  File Details:');

  // Processing status
  const processingParts = Object.entries(details.processing)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}=${count}`);
  lines.push(`    Processing: ${processingParts.join(', ') || 'none'}`);

  // Embedding status
  const embeddingParts = Object.entries(details.embeddings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}=${count}`);
  lines.push(`    Embeddings: ${embeddingParts.join(', ') || 'none'}`);

  // Stuck deletions
  lines.push(`    Stuck Deletions: ${details.stuck_deletions}`);

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { searchTerm, exactMatch, showFiles } = parseArgs();

  console.log('=== FIND USER ===\n');
  console.log(`Search term: "${searchTerm}"`);
  console.log(`Match type: ${exactMatch ? 'exact' : 'partial'}`);
  if (showFiles) {
    console.log('File details: enabled');
  }
  console.log();

  const prisma = createPrisma();

  try {
    const users = await findUsers(prisma, searchTerm, exactMatch);

    if (users.length === 0) {
      console.log('No users found matching the search criteria.');
      return;
    }

    console.log(`Found ${users.length} user(s):\n`);
    console.log('-'.repeat(80));

    for (const user of users) {
      const stats = await getUserStats(prisma, user.id);

      console.log(`
User ID:      ${user.id}
Name:         ${user.full_name || '(not set)'}
Email:        ${user.email}
Created:      ${user.created_at.toISOString()}
Last Login:   ${user.last_microsoft_login?.toISOString() || '(never)'}
Sessions:     ${stats.total_sessions}
Files:        ${stats.total_files}
Folders:      ${stats.total_folders}`);

      if (showFiles) {
        const fileDetails = await getFileDetails(prisma, user.id);
        console.log(formatFileDetails(fileDetails));
      }

      console.log();
      console.log('-'.repeat(80));
    }

    // If only one user found, show copy-pasteable commands
    if (users.length === 1) {
      const userId = users[0].id;
      console.log('\nQuick commands for this user:\n');
      console.log(`  # Verify storage integrity`);
      console.log(`  npx tsx scripts/verify-storage.ts --userId ${userId}\n`);
      console.log(`  # Check queue status`);
      console.log(`  npx tsx scripts/queue-status.ts\n`);
      console.log(`  # Run storage cleanup`);
      console.log(`  npx tsx scripts/fix-storage.ts --userId ${userId}\n`);
      console.log(`  # Verify blob storage`);
      console.log(`  npx tsx scripts/verify-blob-storage.ts ${userId}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
