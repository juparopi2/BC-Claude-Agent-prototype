/**
 * debug-soft-deleted-folders.ts — Compare soft-deleted folder detection
 *
 * Runs the EXACT same query as FolderHierarchyDetector to understand
 * why it reports 0 when the debug-scope-folders script finds 19.
 */
import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';

const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

async function main() {
  const prisma = createPrisma();

  try {
    // Find the user
    const users = await prisma.users.findMany({
      select: { id: true, full_name: true },
      take: 5,
    });
    console.log(`\n${BOLD}Users:${RESET}`);
    for (const u of users) {
      console.log(`  ${u.id}  ${u.full_name}`);
    }

    const userId = users.find(u => u.full_name?.includes('Juan'))?.id ?? users[0]?.id;
    if (!userId) {
      console.log('No users found');
      return;
    }
    console.log(`\nUsing user: ${CYAN}${userId}${RESET}\n`);

    // Query 1: All soft-deleted folders (no joins)
    console.log(`${BOLD}${CYAN}── Query 1: All soft-deleted folders (no joins) ──${RESET}`);
    const allSoftDeleted = await prisma.files.findMany({
      where: {
        user_id: userId,
        is_folder: true,
        deletion_status: { not: null },
      },
      select: {
        id: true,
        name: true,
        connection_scope_id: true,
        deletion_status: true,
        pipeline_status: true,
      },
    });
    console.log(`Found: ${allSoftDeleted.length} soft-deleted folders`);
    for (const f of allSoftDeleted.slice(0, 5)) {
      console.log(`  ${f.name?.substring(0, 40).padEnd(40)} scope:${f.connection_scope_id?.substring(0, 8) ?? 'NULL'} del:${RED}${f.deletion_status}${RESET} pipe:${f.pipeline_status}`);
    }
    if (allSoftDeleted.length > 5) console.log(`  ... and ${allSoftDeleted.length - 5} more`);

    // Query 2: Check scope status for these folders
    const scopeIds = [...new Set(allSoftDeleted.map(f => f.connection_scope_id).filter(Boolean))] as string[];
    console.log(`\n${BOLD}${CYAN}── Query 2: Scope status for affected scopes ──${RESET}`);
    if (scopeIds.length > 0) {
      const scopes = await prisma.connection_scopes.findMany({
        where: { id: { in: scopeIds } },
        select: {
          id: true,
          sync_status: true,
          scope_display_name: true,
          connections: { select: { id: true, status: true } },
        },
      });
      for (const s of scopes) {
        const syncColor = s.sync_status === 'synced' || s.sync_status === 'idle' ? GREEN : YELLOW;
        const connColor = s.connections.status === 'connected' ? GREEN : RED;
        console.log(`  ${s.id.substring(0, 8)}  ${s.scope_display_name?.padEnd(20) ?? '(null)'.padEnd(20)} sync:${syncColor}${s.sync_status}${RESET}  conn:${connColor}${s.connections.status}${RESET}`);
      }
    } else {
      console.log(`  No scopes found (connection_scope_id is NULL on all folders)`);
    }

    // Query 3: EXACT detector query (INNER JOIN)
    console.log(`\n${BOLD}${CYAN}── Query 3: Detector query (INNER JOIN + filters) ──${RESET}`);
    const detected = await prisma.$queryRaw<Array<{ id: string; name: string; connection_scope_id: string }>>`
      SELECT f.id, f.name, f.connection_scope_id
      FROM files f
      INNER JOIN connection_scopes cs ON cs.id = f.connection_scope_id
      INNER JOIN connections c ON c.id = cs.connection_id
      WHERE f.user_id = ${userId}
        AND f.is_folder = 1
        AND f.deletion_status IS NOT NULL
        AND c.status = 'connected'
        AND cs.sync_status IN ('synced', 'idle')
    `;
    console.log(`Detected: ${detected.length} (this is what the detector returns)`);
    for (const f of detected.slice(0, 5)) {
      console.log(`  ${f.name?.substring(0, 40)}`);
    }

    // Query 4: Debug — try with LEFT JOIN to see what's missing
    console.log(`\n${BOLD}${CYAN}── Query 4: LEFT JOIN debug (what breaks the INNER JOIN?) ──${RESET}`);
    const leftJoined = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      connection_scope_id: string | null;
      scope_exists: number;
      conn_exists: number;
      scope_sync: string | null;
      conn_status: string | null;
    }>>`
      SELECT
        f.id, f.name, f.connection_scope_id,
        CASE WHEN cs.id IS NOT NULL THEN 1 ELSE 0 END as scope_exists,
        CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as conn_exists,
        cs.sync_status as scope_sync,
        c.status as conn_status
      FROM files f
      LEFT JOIN connection_scopes cs ON cs.id = f.connection_scope_id
      LEFT JOIN connections c ON c.id = cs.connection_id
      WHERE f.user_id = ${userId}
        AND f.is_folder = 1
        AND f.deletion_status IS NOT NULL
    `;
    console.log(`LEFT JOIN found: ${leftJoined.length}`);
    for (const f of leftJoined) {
      const scopeOk = f.scope_exists ? GREEN + 'yes' : RED + 'NO';
      const connOk = f.conn_exists ? GREEN + 'yes' : RED + 'NO';
      const syncOk = f.scope_sync === 'synced' || f.scope_sync === 'idle' ? GREEN + f.scope_sync : YELLOW + (f.scope_sync ?? 'NULL');
      const connSt = f.conn_status === 'connected' ? GREEN + f.conn_status : RED + (f.conn_status ?? 'NULL');
      console.log(`  ${f.name?.substring(0, 35).padEnd(35)} scope:${scopeOk}${RESET} conn:${connOk}${RESET} sync:${syncOk}${RESET} status:${connSt}${RESET}`);
    }

    // Summary
    console.log(`\n${BOLD}── SUMMARY ──${RESET}`);
    console.log(`  Total soft-deleted folders:     ${allSoftDeleted.length}`);
    console.log(`  Detected by INNER JOIN query:  ${detected.length}`);
    console.log(`  LEFT JOIN found:               ${leftJoined.length}`);
    if (detected.length === 0 && allSoftDeleted.length > 0) {
      console.log(`\n  ${RED}${BOLD}GAP: ${allSoftDeleted.length} folders are soft-deleted but detector finds 0${RESET}`);
      const nullScope = allSoftDeleted.filter(f => !f.connection_scope_id).length;
      const withScope = leftJoined.filter(f => f.scope_exists);
      const wrongSync = withScope.filter(f => f.scope_sync !== 'synced' && f.scope_sync !== 'idle');
      const wrongConn = withScope.filter(f => f.conn_status !== 'connected');
      console.log(`  Folders with NULL connection_scope_id: ${nullScope}`);
      console.log(`  Folders where scope exists but sync != synced/idle: ${wrongSync.length}`);
      console.log(`  Folders where conn exists but status != connected: ${wrongConn.length}`);
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
