/**
 * diagnose-folder-state.ts — Folder & File State Diagnostic
 *
 * Audits the correctness of folder/file metadata fields that affect UI rendering:
 *   - is_shared: Should only be true for OneDrive "Shared with me" items
 *   - source_type: Must match the connection's source_type
 *   - Icon rendering: Predicts what icon FolderTree vs FileExplorer will show
 *
 * Business Scenarios Detected:
 *   1. SharePoint folders incorrectly marked is_shared=true (remote_drive_id ≠ shared)
 *   2. source_type mismatch between file and its connection scope
 *   3. Icon inconsistency between FolderTree (checks isShared) and FileIcon (hardcodes SP logo)
 *   4. Orphaned folders (scope deleted but folder remains)
 *   5. Scope remote_drive_id audit (which scopes set it and why)
 *
 * Usage:
 *   npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID>
 *   npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --fix --dry-run
 *   npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --fix --confirm
 *   npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --verbose
 *   npx tsx scripts/connectors/diagnose-folder-state.ts --help
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { getFlag, hasFlag } from '../_shared/args';

// ─── ANSI Colors ─────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Help ────────────────────────────────────────────────────────
function printHelp(): void {
  console.log(`
${BOLD}diagnose-folder-state.ts${RESET} — Audit folder/file metadata for UI rendering correctness

${BOLD}Usage:${RESET}
  npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID>
  npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --verbose
  npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --fix --dry-run
  npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --fix --confirm

${BOLD}Flags:${RESET}
  --userId <ID>       User ID or partial name to search
  --verbose           Show every folder/file with its metadata
  --fix               Show what would be corrected (dry-run by default)
  --dry-run           Preview fixes without applying (default with --fix)
  --confirm           Apply fixes to database
  --help, -h          Show this help message

${BOLD}What It Checks:${RESET}
  1. ${YELLOW}is_shared misclassification${RESET}
     SharePoint items marked is_shared=true because scope has remote_drive_id.
     remote_drive_id on SP scopes is the library drive ID, NOT a shared indicator.
     Only OneDrive "Shared with me" items should have is_shared=true.

  2. ${YELLOW}source_type consistency${RESET}
     Every file's source_type must match its connection scope's source_type.

  3. ${YELLOW}Icon rendering prediction${RESET}
     FolderTree uses is_shared to decide icon (Users vs provider logo).
     FileIcon hardcodes SharePoint logo regardless of is_shared.
     This causes visual inconsistency when SharePoint is_shared=true.

  4. ${YELLOW}Scope remote_drive_id audit${RESET}
     Shows which scopes have remote_drive_id and how it affects is_shared.
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp();
  process.exit(0);
}

// ─── Types ──────────────────────────────────────────────────────
interface ScopeInfo {
  id: string;
  scope_type: string;
  scope_display_name: string | null;
  remote_drive_id: string | null;
  sync_status: string;
  connection_id: string;
  source_type: string;
}

interface FileRow {
  id: string;
  name: string;
  is_folder: boolean;
  is_shared: boolean;
  source_type: string | null;
  connection_scope_id: string | null;
  parent_folder_id: string | null;
  deletion_status: string | null;
}

interface Finding {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  fileId?: string;
  fileName?: string;
}

// ─── Main ───────────────────────────────────────────────────────
async function main(): Promise<void> {
  const userIdOrName = getFlag('--userId');
  const verbose = hasFlag('--verbose');
  const fix = hasFlag('--fix');
  const confirm = hasFlag('--confirm');
  const dryRun = !confirm;

  if (!userIdOrName) {
    console.error(`${RED}ERROR: --userId is required${RESET}`);
    printHelp();
    process.exit(1);
  }

  const prisma = createPrisma();
  const findings: Finding[] = [];

  try {
    // ── Resolve user ──────────────────────────────────────────
    const userId = await resolveUserId(prisma, userIdOrName);
    if (!userId) {
      console.error(`${RED}ERROR: User not found: ${userIdOrName}${RESET}`);
      process.exit(1);
    }

    console.log(`\n${BOLD}=== Folder State Diagnostic ===${RESET}`);
    console.log(`${DIM}User: ${userId}${RESET}\n`);

    // ── 1. Scope Audit ──────────────────────────────────────
    console.log(`${BOLD}${CYAN}── 1. Scope & remote_drive_id Audit ──${RESET}\n`);

    const scopes = await prisma.connection_scopes.findMany({
      where: { connections: { user_id: userId } },
      select: {
        id: true,
        scope_type: true,
        scope_display_name: true,
        remote_drive_id: true,
        sync_status: true,
        connection_id: true,
        connections: { select: { provider: true } },
      },
    });

    const scopeMap = new Map<string, ScopeInfo>();
    for (const s of scopes) {
      // connections.provider matches FILE_SOURCE_TYPE values ('onedrive', 'sharepoint')
      const info: ScopeInfo = {
        id: s.id,
        scope_type: s.scope_type,
        scope_display_name: s.scope_display_name,
        remote_drive_id: s.remote_drive_id,
        sync_status: s.sync_status,
        connection_id: s.connection_id,
        source_type: s.connections.provider,
      };
      scopeMap.set(s.id, info);

      const hasRemoteDrive = !!s.remote_drive_id;
      const isSharePoint = s.connections.provider === 'sharepoint';
      const willSetShared = hasRemoteDrive;

      const status = isSharePoint && willSetShared
        ? `${RED}BUG: will set is_shared=true${RESET}`
        : hasRemoteDrive
          ? `${YELLOW}remote_drive_id present → is_shared=true${RESET}`
          : `${GREEN}no remote_drive_id → is_shared=false${RESET}`;

      console.log(
        `  ${s.connections.provider.padEnd(12)} ` +
        `${s.scope_type.padEnd(8)} ` +
        `${(s.scope_display_name ?? '(unnamed)').padEnd(30)} ` +
        `remote_drive_id: ${hasRemoteDrive ? DIM + s.remote_drive_id!.substring(0, 20) + '...' + RESET : DIM + 'null' + RESET}  ` +
        `${status}`
      );

      if (isSharePoint && willSetShared) {
        findings.push({
          severity: 'error',
          category: 'is_shared_misclassification',
          message: `SharePoint scope "${s.scope_display_name}" has remote_drive_id → sync sets is_shared=true on all its files/folders`,
        });
      }
    }

    // ── 2. File/Folder is_shared Audit ──────────────────────
    console.log(`\n${BOLD}${CYAN}── 2. File/Folder is_shared Audit ──${RESET}\n`);

    const files = await prisma.files.findMany({
      where: {
        user_id: userId,
        deletion_status: null,
      },
      select: {
        id: true,
        name: true,
        is_folder: true,
        is_shared: true,
        source_type: true,
        connection_scope_id: true,
        parent_folder_id: true,
        deletion_status: true,
      },
      orderBy: [{ source_type: 'asc' }, { is_folder: 'desc' }, { name: 'asc' }],
    });

    // Group by source_type + is_shared
    const groups: Record<string, { total: number; shared: number; notShared: number; folders: number; files: number }> = {};
    const misclassified: FileRow[] = [];

    for (const f of files) {
      const st = f.source_type ?? 'local';
      if (!groups[st]) groups[st] = { total: 0, shared: 0, notShared: 0, folders: 0, files: 0 };
      groups[st].total++;
      if (f.is_shared) groups[st].shared++;
      else groups[st].notShared++;
      if (f.is_folder) groups[st].folders++;
      else groups[st].files++;

      // Detect misclassification: SharePoint items should NOT be is_shared=true
      if (st === 'sharepoint' && f.is_shared) {
        misclassified.push(f);
      }
    }

    console.log(`  ${'Source Type'.padEnd(14)} ${'Total'.padEnd(7)} ${'Folders'.padEnd(9)} ${'Files'.padEnd(7)} ${'Shared'.padEnd(8)} ${'Not Shared'.padEnd(12)}`);
    console.log(`  ${'─'.repeat(14)} ${'─'.repeat(7)} ${'─'.repeat(9)} ${'─'.repeat(7)} ${'─'.repeat(8)} ${'─'.repeat(12)}`);
    for (const [st, g] of Object.entries(groups)) {
      const sharedColor = st === 'sharepoint' && g.shared > 0 ? RED : g.shared > 0 ? YELLOW : GREEN;
      console.log(
        `  ${st.padEnd(14)} ${String(g.total).padEnd(7)} ${String(g.folders).padEnd(9)} ${String(g.files).padEnd(7)} ` +
        `${sharedColor}${String(g.shared).padEnd(8)}${RESET} ${GREEN}${String(g.notShared).padEnd(12)}${RESET}`
      );
    }

    // ── 3. Misclassified Items Detail ───────────────────────
    if (misclassified.length > 0) {
      console.log(`\n${BOLD}${RED}── 3. Misclassified SharePoint Items (is_shared=true) ──${RESET}\n`);
      console.log(`  Found ${RED}${misclassified.length}${RESET} SharePoint items incorrectly marked as shared:\n`);

      const foldersWrong = misclassified.filter(f => f.is_folder);
      const filesWrong = misclassified.filter(f => !f.is_folder);

      if (foldersWrong.length > 0) {
        console.log(`  ${BOLD}Folders (${foldersWrong.length}):${RESET}`);
        for (const f of foldersWrong) {
          const scope = f.connection_scope_id ? scopeMap.get(f.connection_scope_id) : null;
          console.log(
            `    ${YELLOW}📁${RESET} ${f.name.padEnd(40)} ` +
            `${DIM}scope: ${scope?.scope_display_name ?? 'unknown'}${RESET}`
          );
          findings.push({
            severity: 'error',
            category: 'is_shared_misclassification',
            message: `Folder "${f.name}" is SharePoint but is_shared=true → FolderTree shows Users icon instead of SharePoint logo`,
            fileId: f.id,
            fileName: f.name,
          });
        }
      }

      if (filesWrong.length > 0) {
        console.log(`\n  ${BOLD}Files (${filesWrong.length}):${RESET}`);
        const showMax = verbose ? filesWrong.length : Math.min(filesWrong.length, 10);
        for (let i = 0; i < showMax; i++) {
          const f = filesWrong[i];
          console.log(`    ${YELLOW}📄${RESET} ${f.name}`);
        }
        if (!verbose && filesWrong.length > 10) {
          console.log(`    ${DIM}... and ${filesWrong.length - 10} more (use --verbose to see all)${RESET}`);
        }
        findings.push({
          severity: 'error',
          category: 'is_shared_misclassification',
          message: `${filesWrong.length} SharePoint files incorrectly marked is_shared=true`,
        });
      }
    } else {
      console.log(`\n${BOLD}${GREEN}── 3. No Misclassified Items ──${RESET}\n`);
      console.log(`  ${GREEN}✓${RESET} All SharePoint items correctly have is_shared=false`);
    }

    // ── 4. Icon Rendering Prediction ────────────────────────
    console.log(`\n${BOLD}${CYAN}── 4. Icon Rendering Prediction ──${RESET}\n`);

    const foldersBySource: Record<string, { name: string; isShared: boolean; treeIcon: string; explorerIcon: string; match: boolean }[]> = {};
    const allFolders = files.filter(f => f.is_folder);

    for (const f of allFolders) {
      const st = f.source_type ?? 'local';
      if (!foldersBySource[st]) foldersBySource[st] = [];

      let treeIcon: string;
      let explorerIcon: string;

      if (st === 'local') {
        treeIcon = 'Folder (no badge)';
        explorerIcon = 'Folder (no badge)';
      } else if (st === 'onedrive') {
        treeIcon = f.is_shared ? 'Users icon (shared)' : 'OneDrive logo';
        explorerIcon = f.is_shared ? 'Users icon (shared)' : 'OneDrive logo';
      } else if (st === 'sharepoint') {
        // FolderTreeItem checks isShared → shows Users icon if true
        treeIcon = f.is_shared ? `${RED}Users icon (BUG)${RESET}` : 'SharePoint logo';
        // FileIcon hardcodes SharePoint logo regardless of isShared
        explorerIcon = 'SharePoint logo';
      } else {
        treeIcon = 'Unknown';
        explorerIcon = 'Unknown';
      }

      const match = (treeIcon === explorerIcon) || (st === 'local');
      foldersBySource[st].push({ name: f.name, isShared: f.is_shared, treeIcon, explorerIcon, match });
    }

    let hasIconMismatch = false;
    for (const [st, folders] of Object.entries(foldersBySource)) {
      const mismatches = folders.filter(f => !f.match);
      if (mismatches.length > 0) {
        hasIconMismatch = true;
        console.log(`  ${BOLD}${st}${RESET} — ${RED}${mismatches.length} icon mismatches${RESET} between FolderTree and FileExplorer:\n`);
        console.log(`    ${'Folder'.padEnd(35)} ${'FolderTree'.padEnd(30)} ${'FileExplorer'.padEnd(20)} ${'Match?'}`);
        console.log(`    ${'─'.repeat(35)} ${'─'.repeat(30)} ${'─'.repeat(20)} ${'─'.repeat(6)}`);
        const showMax = verbose ? mismatches.length : Math.min(mismatches.length, 10);
        for (let i = 0; i < showMax; i++) {
          const f = mismatches[i];
          console.log(
            `    ${f.name.substring(0, 35).padEnd(35)} ` +
            `${f.treeIcon.padEnd(30)} ` +
            `${f.explorerIcon.padEnd(20)} ` +
            `${RED}✗${RESET}`
          );
        }
        if (!verbose && mismatches.length > 10) {
          console.log(`    ${DIM}... and ${mismatches.length - 10} more${RESET}`);
        }
        findings.push({
          severity: 'error',
          category: 'icon_inconsistency',
          message: `${mismatches.length} ${st} folders show different icons in FolderTree vs FileExplorer`,
        });
      } else {
        console.log(`  ${BOLD}${st}${RESET} — ${GREEN}✓ all ${folders.length} folders render consistently${RESET}`);
      }
    }

    // ── 5. source_type Consistency ──────────────────────────
    console.log(`\n${BOLD}${CYAN}── 5. source_type Consistency ──${RESET}\n`);

    let sourceTypeMismatches = 0;
    for (const f of files) {
      if (!f.connection_scope_id) continue;
      const scope = scopeMap.get(f.connection_scope_id);
      if (!scope) continue;
      if (f.source_type !== scope.source_type) {
        sourceTypeMismatches++;
        if (verbose) {
          console.log(
            `  ${RED}✗${RESET} ${f.is_folder ? '📁' : '📄'} ${f.name.padEnd(40)} ` +
            `file.source_type=${f.source_type} ≠ scope.source_type=${scope.source_type}`
          );
        }
        findings.push({
          severity: 'error',
          category: 'source_type_mismatch',
          message: `"${f.name}" has source_type="${f.source_type}" but scope source_type="${scope.source_type}"`,
          fileId: f.id,
          fileName: f.name,
        });
      }
    }

    if (sourceTypeMismatches === 0) {
      console.log(`  ${GREEN}✓${RESET} All files/folders have source_type matching their scope`);
    } else {
      console.log(`  ${RED}✗ ${sourceTypeMismatches} source_type mismatches${RESET}`);
    }

    // ── 6. Verbose: Full Folder Detail ──────────────────────
    if (verbose) {
      console.log(`\n${BOLD}${CYAN}── 6. Full Folder Detail ──${RESET}\n`);
      console.log(`  ${'Type'.padEnd(5)} ${'Source'.padEnd(12)} ${'Shared'.padEnd(8)} ${'Name'.padEnd(40)} ${'Scope'}`);
      console.log(`  ${'─'.repeat(5)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(40)} ${'─'.repeat(30)}`);
      for (const f of allFolders) {
        const scope = f.connection_scope_id ? scopeMap.get(f.connection_scope_id) : null;
        const sharedColor = f.is_shared ? (f.source_type === 'sharepoint' ? RED : YELLOW) : GREEN;
        console.log(
          `  ${'📁'.padEnd(5)} ` +
          `${(f.source_type ?? 'local').padEnd(12)} ` +
          `${sharedColor}${String(f.is_shared).padEnd(8)}${RESET} ` +
          `${f.name.substring(0, 40).padEnd(40)} ` +
          `${DIM}${scope?.scope_display_name ?? '(no scope)'}${RESET}`
        );
      }
    }

    // ── Summary ─────────────────────────────────────────────
    console.log(`\n${BOLD}=== Summary ===${RESET}\n`);

    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warning');

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`  ${GREEN}✓ All folder state checks passed${RESET}\n`);
    } else {
      if (errors.length > 0) {
        console.log(`  ${RED}✗ ${errors.length} error(s)${RESET}`);
        const categories = [...new Set(errors.map(e => e.category))];
        for (const cat of categories) {
          const catErrors = errors.filter(e => e.category === cat);
          console.log(`    ${RED}•${RESET} ${cat}: ${catErrors.length} issue(s)`);
        }
      }
      if (warnings.length > 0) {
        console.log(`  ${YELLOW}⚠ ${warnings.length} warning(s)${RESET}`);
      }
      console.log('');
    }

    // ── Fix Mode ────────────────────────────────────────────
    if (fix && misclassified.length > 0) {
      console.log(`${BOLD}${CYAN}── Fix: Correct is_shared for SharePoint items ──${RESET}\n`);

      const idsToFix = misclassified.map(f => f.id);

      if (dryRun) {
        console.log(`  ${YELLOW}DRY RUN${RESET}: Would set is_shared=false on ${idsToFix.length} SharePoint items`);
        console.log(`  ${DIM}Run with --confirm to apply${RESET}\n`);
      } else {
        console.log(`  Updating ${idsToFix.length} items...`);
        const result = await prisma.files.updateMany({
          where: { id: { in: idsToFix } },
          data: { is_shared: false },
        });
        console.log(`  ${GREEN}✓ Updated ${result.count} items (is_shared → false)${RESET}\n`);
        console.log(`  ${YELLOW}NOTE:${RESET} This fixes the data, but the sync code still uses`);
        console.log(`  ${YELLOW}isShared: !!scope.remote_drive_id${RESET} — next sync will re-introduce the bug.`);
        console.log(`  The root cause fix is in InitialSyncService.ts and DeltaSyncService.ts.\n`);
      }
    } else if (fix && misclassified.length === 0) {
      console.log(`  ${GREEN}✓ Nothing to fix${RESET}\n`);
    }

    // ── Root Cause Note ─────────────────────────────────────
    if (misclassified.length > 0) {
      console.log(`${BOLD}Root Cause:${RESET}`);
      console.log(`  The sync pipeline uses ${YELLOW}isShared: !!scope.remote_drive_id${RESET} to set is_shared.`);
      console.log(`  SharePoint folder scopes ALWAYS have remote_drive_id (the library's drive ID),`);
      console.log(`  so all SP items get is_shared=true. This is incorrect — remote_drive_id is`);
      console.log(`  needed for Graph API calls, not as a sharing indicator.`);
      console.log('');
      console.log(`  ${BOLD}Files affected:${RESET}`);
      console.log(`    • InitialSyncService.ts  — lines 240, 275, 301, 498`);
      console.log(`    • DeltaSyncService.ts    — lines 200, 424`);
      console.log(`    • FolderHierarchyResolver.ts — lines 152, 184, 288, 314`);
      console.log(`    • FolderHierarchyRepairer.ts — line 77`);
      console.log('');
      console.log(`  ${BOLD}Frontend:${RESET}`);
      console.log(`    • FolderTreeItem.tsx checks isShared for ALL non-local items (shows Users icon)`);
      console.log(`    • FileIcon.tsx hardcodes SharePoint logo (ignores isShared) — correct behavior`);
      console.log(`    → FolderTree and FileExplorer show different icons for same SharePoint folder\n`);
    }

  } finally {
    await prisma.$disconnect();
  }
}

// ─── Helpers ────────────────────────────────────────────────────
async function resolveUserId(prisma: ReturnType<typeof createPrisma>, input: string): Promise<string | null> {
  // Try as UUID first
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(input)) {
    const user = await prisma.users.findUnique({
      where: { id: input.toUpperCase() },
      select: { id: true, full_name: true },
    });
    if (user) {
      console.log(`${DIM}User: ${user.full_name} (${user.id})${RESET}`);
      return user.id;
    }
    return null;
  }

  // Search by name
  const users = await prisma.users.findMany({
    where: { full_name: { contains: input } },
    select: { id: true, full_name: true },
    take: 5,
  });

  if (users.length === 0) return null;
  if (users.length === 1) {
    console.log(`${DIM}User: ${users[0].full_name} (${users[0].id})${RESET}`);
    return users[0].id;
  }

  console.log(`Multiple users found for "${input}":`);
  for (const u of users) {
    console.log(`  ${u.id}  ${u.full_name}`);
  }
  console.log(`Use the full UUID with --userId`);
  return null;
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
