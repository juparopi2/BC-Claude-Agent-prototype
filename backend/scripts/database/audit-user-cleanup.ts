/**
 * audit-user-cleanup.ts
 *
 * Comprehensive audit of a user's data state across all subsystems.
 * Useful after disconnecting connectors (OneDrive/SharePoint) to verify clean state.
 *
 * Usage:
 *   npx tsx scripts/database/audit-user-cleanup.ts <userId>
 *   npx tsx scripts/database/audit-user-cleanup.ts --name Juan
 *
 * Checks:
 *   1. SQL: connections, scopes, files, chunks, citations, attachments, batches
 *   2. Blob Storage: orphan blobs for the user prefix
 *   3. AI Search: orphan documents referencing the user's file IDs
 */

import { createPrisma } from '../_shared/prisma.js';
import { createBlobContainerClient, createSearchClient, INDEX_NAME } from '../_shared/azure.js';
import { hasFlag, getFlag, getPositionalArg } from '../_shared/args.js';

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const ok = `${GREEN}✓${RESET}`;
const warn = `${YELLOW}⚠${RESET}`;
const fail = `${RED}✗${RESET}`;
const info = `${CYAN}ℹ${RESET}`;

function header(title: string) {
  console.log(`\n${BOLD}${CYAN}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${BOLD}${CYAN}${'═'.repeat(60)}${RESET}\n`);
}

function section(title: string) {
  console.log(`  ${BOLD}${title}${RESET}`);
  console.log(`  ${DIM}${'─'.repeat(50)}${RESET}`);
}

// ── Help ──────────────────────────────────────────────────────────────────────
if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
${BOLD}audit-user-cleanup.ts${RESET} — Verify clean state after connector disconnection

${BOLD}Usage:${RESET}
  npx tsx scripts/database/audit-user-cleanup.ts <userId>
  npx tsx scripts/database/audit-user-cleanup.ts --name Juan

${BOLD}Options:${RESET}
  --name <search>   Find user by name (partial match)
  --help, -h        Show this help
`);
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const prisma = createPrisma();
  let userId = getPositionalArg()?.toUpperCase();

  // Resolve by name if --name provided
  const nameSearch = getFlag('--name');
  if (nameSearch) {
    const users = await prisma.users.findMany({
      where: { display_name: { contains: nameSearch } },
      select: { id: true, display_name: true, email: true },
    });
    if (users.length === 0) {
      console.log(`${fail} No users found matching "${nameSearch}"`);
      process.exit(1);
    }
    if (users.length > 1) {
      console.log(`${warn} Multiple users match "${nameSearch}":`);
      users.forEach(u => console.log(`  - ${u.id} ${u.display_name} (${u.email})`));
      console.log(`\nPlease specify the full userId.`);
      process.exit(1);
    }
    userId = users[0].id;
    console.log(`${info} Resolved "${nameSearch}" → ${users[0].display_name} (${userId})`);
  }

  if (!userId) {
    console.log(`${fail} Usage: npx tsx scripts/database/audit-user-cleanup.ts <userId> | --name <search>`);
    process.exit(1);
  }

  let issues = 0;

  // ── 1. SQL Audit ──────────────────────────────────────────────────────────
  header('SQL DATABASE AUDIT');

  // 1a. Connections
  section('Connections');
  const connections = await prisma.connections.findMany({
    where: { user_id: userId },
    select: { id: true, provider: true, status: true, display_name: true, created_at: true },
  });
  if (connections.length === 0) {
    console.log(`  ${ok} No connections found (clean)\n`);
  } else {
    issues++;
    console.log(`  ${fail} Found ${connections.length} connection(s):`);
    connections.forEach(c => {
      console.log(`    ${c.provider.padEnd(12)} | ${c.status.padEnd(12)} | ${c.display_name || '(unnamed)'} | ${c.id.slice(0, 8)}...`);
    });
    console.log();
  }

  // 1b. Connection Scopes
  section('Connection Scopes');
  const scopes = await prisma.connection_scopes.findMany({
    where: { connections: { user_id: userId } },
    select: { id: true, scope_display_name: true, sync_status: true, item_count: true, connection_id: true },
  });
  if (scopes.length === 0) {
    console.log(`  ${ok} No connection scopes found (clean)\n`);
  } else {
    issues++;
    console.log(`  ${fail} Found ${scopes.length} scope(s):`);
    scopes.forEach(s => {
      console.log(`    ${(s.scope_display_name || '(unnamed)').padEnd(30)} | ${s.sync_status.padEnd(12)} | ${s.item_count} items`);
    });
    console.log();
  }

  // 1c. Files (including soft-deleted)
  section('Files');
  const files = await prisma.files.findMany({
    where: { user_id: userId },
    select: { id: true, name: true, source_type: true, pipeline_status: true, deleted_at: true, deletion_status: true, is_folder: true },
  });
  const activeFiles = files.filter(f => !f.deleted_at);
  const deletedFiles = files.filter(f => f.deleted_at);
  if (files.length === 0) {
    console.log(`  ${ok} No files found (clean)\n`);
  } else {
    if (activeFiles.length > 0) {
      issues++;
      console.log(`  ${fail} Found ${activeFiles.length} active file(s):`);
      const bySource: Record<string, number> = {};
      activeFiles.forEach(f => { bySource[f.source_type] = (bySource[f.source_type] || 0) + 1; });
      Object.entries(bySource).forEach(([src, count]) => console.log(`    ${src}: ${count}`));
    } else {
      console.log(`  ${ok} No active files`);
    }
    if (deletedFiles.length > 0) {
      const stuckDeletions = deletedFiles.filter(f => f.deletion_status && !['completed', 'deleted'].includes(f.deletion_status));
      if (stuckDeletions.length > 0) {
        issues++;
        console.log(`  ${warn} ${stuckDeletions.length} soft-deleted file(s) with non-terminal deletion_status:`);
        stuckDeletions.forEach(f => console.log(`    ${f.id.slice(0, 8)}... | ${f.deletion_status} | ${f.name}`));
      } else {
        console.log(`  ${info} ${deletedFiles.length} soft-deleted file(s) (all terminal)`);
      }
    }
    console.log();
  }

  // 1d. File Chunks
  section('File Chunks');
  const chunkCount = await prisma.file_chunks.count({
    where: { user_id: userId },
  });
  if (chunkCount === 0) {
    console.log(`  ${ok} No file chunks found (clean)\n`);
  } else {
    issues++;
    console.log(`  ${fail} Found ${chunkCount} orphan chunk(s) in database\n`);
  }

  // 1e. Message Citations with file references
  // message_citations doesn't have a direct session relation, so we query via user's sessions
  section('Message Citations');
  const userSessions = await prisma.sessions.findMany({
    where: { user_id: userId },
    select: { id: true },
  });
  const sessionIds = userSessions.map(s => s.id);
  const userMessageIds = sessionIds.length > 0
    ? (await prisma.messages.findMany({
        where: { session_id: { in: sessionIds } },
        select: { id: true },
      })).map(m => m.id)
    : [];
  const citations = userMessageIds.length > 0
    ? await prisma.message_citations.findMany({
        where: {
          message_id: { in: userMessageIds },
          file_id: { not: null },
        },
        select: { id: true, file_id: true, source_type: true },
      })
    : [];
  if (citations.length === 0) {
    console.log(`  ${ok} No file-linked citations found (clean)\n`);
  } else {
    console.log(`  ${info} ${citations.length} citation(s) reference file IDs`);
    // Check if referenced files still exist
    const citedFileIds = [...new Set(citations.map(c => c.file_id!))];
    const existingFiles = await prisma.files.findMany({
      where: { id: { in: citedFileIds } },
      select: { id: true },
    });
    const existingIds = new Set(existingFiles.map(f => f.id));
    const orphanCitations = citedFileIds.filter(id => !existingIds.has(id));
    if (orphanCitations.length > 0) {
      console.log(`  ${warn} ${orphanCitations.length} citation(s) reference deleted files (expected after cleanup)`);
    } else {
      console.log(`  ${ok} All cited files still exist in DB`);
    }
    console.log();
  }

  // 1f. Message File Attachments
  section('Message File Attachments');
  const attachments = userMessageIds.length > 0
    ? await prisma.message_file_attachments.count({
        where: { message_id: { in: userMessageIds } },
      })
    : 0;
  if (attachments === 0) {
    console.log(`  ${ok} No message file attachments found (clean)\n`);
  } else {
    console.log(`  ${info} ${attachments} attachment record(s) exist (cascade-deleted with files)\n`);
  }

  // 1g. Upload Batches
  section('Upload Batches');
  const batchCount = await prisma.upload_batches.count({ where: { user_id: userId } });
  const activeBatches = await prisma.upload_batches.count({
    where: { user_id: userId, status: { notIn: ['completed', 'expired', 'cancelled'] } },
  });
  console.log(`  ${info} ${batchCount} total upload batch(es)`);
  if (activeBatches > 0) {
    issues++;
    console.log(`  ${warn} ${activeBatches} batch(es) still in non-terminal status`);
  } else {
    console.log(`  ${ok} All batches in terminal status`);
  }
  console.log();

  // ── 2. Blob Storage Audit ─────────────────────────────────────────────────
  header('BLOB STORAGE AUDIT');

  try {
    const containerClient = createBlobContainerClient();
    const prefix = `${userId}/`;
    let blobCount = 0;
    const blobSamples: string[] = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      blobCount++;
      if (blobSamples.length < 5) blobSamples.push(blob.name);
    }

    if (blobCount === 0) {
      console.log(`  ${ok} No blobs found under prefix ${DIM}${prefix}${RESET} (clean)`);
    } else {
      issues++;
      console.log(`  ${fail} Found ${blobCount} orphan blob(s) under prefix ${DIM}${prefix}${RESET}`);
      blobSamples.forEach(name => console.log(`    ${DIM}${name}${RESET}`));
      if (blobCount > 5) console.log(`    ${DIM}... and ${blobCount - 5} more${RESET}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ${warn} Blob check skipped: ${msg}`);
  }
  console.log();

  // ── 3. AI Search Audit ────────────────────────────────────────────────────
  header('AI SEARCH AUDIT');

  try {
    const searchClient = createSearchClient();

    // Search for documents belonging to this user
    const searchResult = await searchClient.search('*', {
      filter: `userId eq '${userId}'`,
      top: 0,
      includeTotalCount: true,
    });

    const totalDocs = searchResult.count ?? 0;

    if (totalDocs === 0) {
      console.log(`  ${ok} No search documents found for this user (clean)`);
    } else {
      issues++;
      console.log(`  ${fail} Found ${totalDocs} orphan search document(s) for this user`);

      // Get sample to show file distribution
      const sampleResult = await searchClient.search('*', {
        filter: `userId eq '${userId}'`,
        top: 1000,
        select: ['fileId'],
      });

      const fileIds = new Set<string>();
      for await (const result of sampleResult.results) {
        const doc = result.document as Record<string, unknown>;
        if (doc.fileId) fileIds.add(doc.fileId as string);
      }
      console.log(`  ${info} Distributed across ${fileIds.size} unique file ID(s):`);
      let shown = 0;
      for (const fid of fileIds) {
        if (shown >= 5) {
          console.log(`    ${DIM}... and ${fileIds.size - 5} more${RESET}`);
          break;
        }
        console.log(`    ${DIM}${fid}${RESET}`);
        shown++;
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ${warn} AI Search check skipped: ${msg}`);
  }
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────
  header('SUMMARY');

  if (issues === 0) {
    console.log(`  ${ok} ${GREEN}${BOLD}CLEAN STATE${RESET} — No residual data found across all subsystems`);
  } else {
    console.log(`  ${fail} ${RED}${BOLD}${issues} ISSUE(S) DETECTED${RESET}`);
    console.log(`\n  ${DIM}To clean up residual data:${RESET}`);
    console.log(`  ${DIM}  Orphan blobs:   npx tsx scripts/storage/fix-storage.ts --userId ${userId}${RESET}`);
    console.log(`  ${DIM}  Orphan search:  npx tsx scripts/storage/fix-storage.ts --userId ${userId}${RESET}`);
    console.log(`  ${DIM}  Connections:    npx tsx scripts/connectors/cleanup-connections.ts --userId ${userId}${RESET}`);
  }
  console.log();

  await prisma.$disconnect();
  process.exit(issues > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${fail} Fatal error:`, e);
  process.exit(1);
});
