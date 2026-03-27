/**
 * debug-scope-folders.ts
 *
 * Diagnostic script to understand why folder scopes aren't appearing in the frontend.
 * Runs five targeted queries against the DB for one or more scope IDs:
 *   1. Scope info from connection_scopes
 *   2. All files/folders belonging to those scopes
 *   3. Root-level entries (parent_folder_id IS NULL)
 *   4. Root folder created by ensureScopeRootFolder (external_id = scope_resource_id)
 *   5. Soft-deleted files in those scopes
 *
 * Usage:
 *   npx tsx scripts/connectors/debug-scope-folders.ts
 *   npx tsx scripts/connectors/debug-scope-folders.ts --scopeIds <ID1>,<ID2>
 */

import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { createPrisma } from '../_shared/prisma';
import { getFlag } from '../_shared/args';

// ─── ANSI Colors ────────────────────────────────────────────────────────────
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

// ─── Default scope IDs ──────────────────────────────────────────────────────
const DEFAULT_SCOPE_IDS = [
  '7F6295D0-1F09-46D0-8B0C-23C6317AFE82',
  'F290287B-9F11-429F-B69C-3B3919B514A8',
];

// ─── Types ──────────────────────────────────────────────────────────────────
interface ScopeRow {
  id: string;
  scope_type: string;
  scope_resource_id: string | null;
  scope_display_name: string | null;
  sync_status: string;
  remote_drive_id: string | null;
  connection_id: string;
  last_sync_at: Date | null;
  last_sync_error: string | null;
  scope_path: string | null;
}

interface FileRow {
  id: string;
  name: string;
  is_folder: boolean | number;
  parent_folder_id: string | null;
  connection_scope_id: string | null;
  source_type: string;
  deletion_status: string | null;
  pipeline_status: string;
  external_id: string | null;
  connection_id: string;
}

interface RootFileRow {
  id: string;
  name: string;
  external_id: string | null;
  connection_scope_id: string | null;
  parent_folder_id: string | null;
  source_type: string;
  deletion_status: string | null;
  is_folder: boolean | number;
}

interface ExternalIdRow {
  id: string;
  name: string;
  external_id: string | null;
  connection_scope_id: string | null;
  parent_folder_id: string | null;
  deletion_status: string | null;
  source_type: string;
  connection_id: string;
}

interface SoftDeleteRow {
  id: string;
  name: string;
  is_folder: boolean | number;
  deletion_status: string | null;
  deleted_at: Date | null;
  connection_scope_id: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function header(title: string): void {
  const line = '─'.repeat(60);
  console.log(`\n${BOLD}${CYAN}${line}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${BOLD}${CYAN}${line}${RESET}`);
}

function subheader(label: string, count: number): void {
  const color = count === 0 ? YELLOW : GREEN;
  console.log(`\n  ${BOLD}${label}${RESET}  ${color}(${count} row${count !== 1 ? 's' : ''})${RESET}`);
}

function kv(key: string, value: string | null | undefined, valueColor = RESET): void {
  const display = value ?? `${DIM}(null)${RESET}`;
  console.log(`    ${DIM}${key.padEnd(22)}${RESET}${valueColor}${display}${RESET}`);
}

function row(cells: string[]): void {
  console.log('    ' + cells.join('  '));
}

function boolStr(val: boolean | number | null | undefined): string {
  if (val === null || val === undefined) return `${DIM}null${RESET}`;
  const b = val === true || val === 1;
  return b ? `${GREEN}yes${RESET}` : `${DIM}no${RESET}`;
}

function statusColor(status: string | null | undefined): string {
  if (!status) return `${DIM}(null)${RESET}`;
  if (status === 'synced' || status === 'idle') return `${GREEN}${status}${RESET}`;
  if (status === 'syncing') return `${YELLOW}${status}${RESET}`;
  if (status === 'error') return `${RED}${status}${RESET}`;
  return status;
}

function deletionColor(status: string | null | undefined): string {
  if (!status) return `${DIM}(none)${RESET}`;
  return `${RED}${status}${RESET}`;
}

function truncate(s: string | null | undefined, len = 36): string {
  if (!s) return `${DIM}(null)${RESET}`;
  return s.length > len ? s.slice(0, len) + '…' : s;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Resolve scope IDs from --scopeIds flag or fall back to defaults
  const flagValue = getFlag('--scopeIds');
  const scopeIds: string[] = flagValue
    ? flagValue.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_SCOPE_IDS.map((s) => s.toUpperCase());

  if (scopeIds.length === 0) {
    console.error(`${RED}ERROR: No scope IDs provided. Pass --scopeIds <ID1>,<ID2> or use the hardcoded defaults.${RESET}`);
    process.exit(1);
  }

  console.log(`\n${BOLD}debug-scope-folders${RESET} — Diagnosing why folder scopes aren't showing in the frontend`);
  console.log(`${DIM}Scope IDs: ${scopeIds.join(', ')}${RESET}`);

  const prisma = createPrisma();

  try {
    // Build a reusable Prisma.join fragment for IN clauses
    const idList = Prisma.join(scopeIds);

    // ════════════════════════════════════════════════════════════════
    // Query 1 — Scope info
    // ════════════════════════════════════════════════════════════════
    header('Query 1 — Scope Info (connection_scopes)');

    const scopes = await prisma.$queryRaw<ScopeRow[]>`
      SELECT
        id,
        scope_type,
        scope_resource_id,
        scope_display_name,
        sync_status,
        remote_drive_id,
        connection_id,
        last_sync_at,
        last_sync_error,
        scope_path
      FROM connection_scopes
      WHERE id IN (${idList})
    `;

    subheader('Scopes', scopes.length);

    if (scopes.length === 0) {
      console.log(`  ${YELLOW}  No scopes found for the given IDs. Check the IDs are correct.${RESET}`);
    }

    for (const s of scopes) {
      console.log(`\n  ${BOLD}${CYAN}${s.id}${RESET}`);
      kv('scope_type', s.scope_type);
      kv('scope_display_name', s.scope_display_name);
      kv('scope_path', s.scope_path);
      kv('sync_status', null);
      console.log(`    ${DIM}${'sync_status'.padEnd(22)}${RESET}${statusColor(s.sync_status)}`);
      kv('scope_resource_id', s.scope_resource_id, MAGENTA);
      kv('remote_drive_id', s.remote_drive_id);
      kv('connection_id', s.connection_id, CYAN);
      kv('last_sync_at', s.last_sync_at ? new Date(s.last_sync_at).toISOString() : null);
      kv('last_sync_error', s.last_sync_error, RED);
    }

    if (scopes.length > 0 && scopes.length < scopeIds.length) {
      const foundIds = new Set(scopes.map((s) => s.id.toUpperCase()));
      const missing = scopeIds.filter((id) => !foundIds.has(id));
      console.log(`\n  ${YELLOW}WARNING: ${missing.length} scope(s) not found in DB:${RESET}`);
      for (const m of missing) {
        console.log(`    ${RED}${m}${RESET}`);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Query 2 — All files per scope
    // ════════════════════════════════════════════════════════════════
    header('Query 2 — All Files / Folders for These Scopes');

    const allFiles = await prisma.$queryRaw<FileRow[]>`
      SELECT
        id,
        name,
        is_folder,
        parent_folder_id,
        connection_scope_id,
        source_type,
        deletion_status,
        pipeline_status,
        external_id,
        connection_id
      FROM files
      WHERE connection_scope_id IN (${idList})
      ORDER BY connection_scope_id, is_folder DESC, name
    `;

    subheader('Files / Folders', allFiles.length);

    if (allFiles.length === 0) {
      console.log(`  ${YELLOW}  No files found for these scopes. The sync may not have run yet,`);
      console.log(`  ${YELLOW}  or files may have been deleted.${RESET}`);
    } else {
      // Group by scope for clarity
      const byScope = new Map<string, FileRow[]>();
      for (const f of allFiles) {
        const key = f.connection_scope_id ?? '(no scope)';
        if (!byScope.has(key)) byScope.set(key, []);
        byScope.get(key)!.push(f);
      }

      for (const [scopeId, files] of byScope) {
        console.log(`\n  ${DIM}Scope: ${CYAN}${scopeId}${RESET}  ${DIM}(${files.length} entries)${RESET}`);
        row([
          BOLD + 'is_folder'.padEnd(10) + RESET,
          BOLD + 'deletion'.padEnd(12) + RESET,
          BOLD + 'pipeline'.padEnd(16) + RESET,
          BOLD + 'name'.padEnd(40) + RESET,
          BOLD + 'id' + RESET,
        ]);
        for (const f of files) {
          row([
            boolStr(f.is_folder).padEnd(10),
            deletionColor(f.deletion_status).padEnd(12),
            (f.pipeline_status ?? DIM + '(null)' + RESET).padEnd(16),
            truncate(f.name, 40).padEnd(40),
            DIM + truncate(f.id, 36) + RESET,
          ]);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Query 3 — Scope root folders (parent_folder_id IS NULL)
    // ════════════════════════════════════════════════════════════════
    header('Query 3 — Root-Level Entries (parent_folder_id IS NULL)');

    const rootFiles = await prisma.$queryRaw<RootFileRow[]>`
      SELECT
        id,
        name,
        external_id,
        connection_scope_id,
        parent_folder_id,
        source_type,
        deletion_status,
        is_folder
      FROM files
      WHERE connection_scope_id IN (${idList})
        AND parent_folder_id IS NULL
    `;

    subheader('Root entries', rootFiles.length);

    if (rootFiles.length === 0) {
      console.log(`\n  ${YELLOW}  No root entries found (parent_folder_id IS NULL).`);
      console.log(`  ${YELLOW}  This means ensureScopeRootFolder may not have created a root folder,`);
      console.log(`  ${YELLOW}  OR all files have a parent_folder_id set (nested without a root).${RESET}`);
    } else {
      row([
        BOLD + 'is_folder'.padEnd(10) + RESET,
        BOLD + 'deletion'.padEnd(12) + RESET,
        BOLD + 'source_type'.padEnd(14) + RESET,
        BOLD + 'name'.padEnd(40) + RESET,
        BOLD + 'external_id'.padEnd(38) + RESET,
        BOLD + 'id' + RESET,
      ]);
      for (const f of rootFiles) {
        row([
          boolStr(f.is_folder).padEnd(10),
          deletionColor(f.deletion_status).padEnd(12),
          (f.source_type ?? '').padEnd(14),
          truncate(f.name, 40).padEnd(40),
          DIM + truncate(f.external_id, 36) + RESET + ' ',
          DIM + truncate(f.id, 36) + RESET,
        ]);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Query 4 — Root folder by external_id = scope_resource_id
    // ════════════════════════════════════════════════════════════════
    header('Query 4 — Root Folder by external_id = scope_resource_id');
    console.log(`  ${DIM}(Checks whether ensureScopeRootFolder created the root by matching external_id)${RESET}`);

    const scopesWithResource = scopes.filter((s) => s.scope_resource_id);

    if (scopesWithResource.length === 0) {
      console.log(`\n  ${YELLOW}  None of the found scopes have a scope_resource_id — skipping query 4.${RESET}`);
    } else {
      for (const scope of scopesWithResource) {
        console.log(`\n  ${DIM}Checking scope ${CYAN}${scope.id}${RESET}`);
        console.log(`  ${DIM}  scope_resource_id = ${MAGENTA}${scope.scope_resource_id}${RESET}`);
        console.log(`  ${DIM}  connection_id     = ${CYAN}${scope.connection_id}${RESET}`);

        const matchingFiles = await prisma.$queryRaw<ExternalIdRow[]>`
          SELECT
            id,
            name,
            external_id,
            connection_scope_id,
            parent_folder_id,
            deletion_status,
            source_type,
            connection_id
          FROM files
          WHERE external_id = ${scope.scope_resource_id}
            AND connection_id = ${scope.connection_id}
        `;

        subheader(`Files matching external_id for scope ${scope.id.slice(0, 8)}…`, matchingFiles.length);

        if (matchingFiles.length === 0) {
          console.log(`    ${RED}  NOT FOUND — ensureScopeRootFolder has not created a root folder for this scope,`);
          console.log(`    ${RED}  or the root folder was created with a different external_id.${RESET}`);
        } else {
          row([
            BOLD + 'deletion'.padEnd(12) + RESET,
            BOLD + 'has_scope_id'.padEnd(14) + RESET,
            BOLD + 'parent_folder_id'.padEnd(38) + RESET,
            BOLD + 'name'.padEnd(40) + RESET,
            BOLD + 'id' + RESET,
          ]);
          for (const f of matchingFiles) {
            const hasScopeId = f.connection_scope_id !== null;
            row([
              deletionColor(f.deletion_status).padEnd(12),
              (hasScopeId ? GREEN + 'yes' + RESET : YELLOW + 'no ' + RESET).padEnd(14),
              DIM + truncate(f.parent_folder_id, 36) + RESET + ' ',
              truncate(f.name, 40).padEnd(40),
              DIM + truncate(f.id, 36) + RESET,
            ]);
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Query 5 — Soft-deleted files
    // ════════════════════════════════════════════════════════════════
    header('Query 5 — Soft-Deleted Files in These Scopes');

    const deletedFiles = await prisma.$queryRaw<SoftDeleteRow[]>`
      SELECT
        id,
        name,
        is_folder,
        deletion_status,
        deleted_at,
        connection_scope_id
      FROM files
      WHERE connection_scope_id IN (${idList})
        AND deletion_status IS NOT NULL
    `;

    subheader('Soft-deleted entries', deletedFiles.length);

    if (deletedFiles.length === 0) {
      console.log(`  ${GREEN}  No soft-deleted files found for these scopes.${RESET}`);
    } else {
      row([
        BOLD + 'is_folder'.padEnd(10) + RESET,
        BOLD + 'deletion_status'.padEnd(18) + RESET,
        BOLD + 'deleted_at'.padEnd(26) + RESET,
        BOLD + 'name'.padEnd(40) + RESET,
        BOLD + 'id' + RESET,
      ]);
      for (const f of deletedFiles) {
        row([
          boolStr(f.is_folder).padEnd(10),
          deletionColor(f.deletion_status).padEnd(18),
          DIM + (f.deleted_at ? new Date(f.deleted_at).toISOString() : '(null)') + RESET + ' ',
          truncate(f.name, 40).padEnd(40),
          DIM + truncate(f.id, 36) + RESET,
        ]);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Summary
    // ════════════════════════════════════════════════════════════════
    header('Summary');
    console.log(`  Scopes queried:          ${scopeIds.length}`);
    console.log(`  Scopes found in DB:      ${scopes.length}`);
    console.log(`  Total files/folders:     ${allFiles.length}`);
    console.log(`  Root entries (no parent): ${rootFiles.length}`);
    console.log(`  Soft-deleted entries:    ${deletedFiles.length}`);

    const activeFiles = allFiles.filter((f) => f.deletion_status === null);
    const activeFolders = activeFiles.filter((f) => f.is_folder === true || f.is_folder === 1);
    const activeDocuments = activeFiles.filter((f) => f.is_folder !== true && f.is_folder !== 1);

    console.log(`\n  ${BOLD}Active (not soft-deleted):${RESET}`);
    console.log(`    Folders:   ${activeFolders.length}`);
    console.log(`    Documents: ${activeDocuments.length}`);

    if (rootFiles.length === 0 && allFiles.length > 0) {
      console.log(`\n  ${RED}${BOLD}LIKELY ISSUE:${RESET} Files exist but none have parent_folder_id = NULL.`);
      console.log(`  ${YELLOW}  The frontend tree likely expects at least one root-level entry per scope.${RESET}`);
    }

    if (scopes.length === 0) {
      console.log(`\n  ${RED}${BOLD}LIKELY ISSUE:${RESET} Scopes not found in connection_scopes table. Check IDs.${RESET}`);
    }

    console.log();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`\n${RED}${BOLD}Fatal error:${RESET} ${message}`);
  if (stack) console.error(`${DIM}${stack}${RESET}`);
  process.exit(1);
});
