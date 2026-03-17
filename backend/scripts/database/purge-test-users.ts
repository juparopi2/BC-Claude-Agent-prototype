/**
 * purge-test-users.ts — Remove empty test/fixture users from the database.
 *
 * Identifies users that were created by integration/E2E tests and have no
 * meaningful data (0 sessions, 0 files, 0 connections). Real users with
 * data are always preserved.
 *
 * Detection heuristics:
 *   - Name matches "Test User*", "E2E*", "SDK Test*", "D23 Test*", "Test Race*"
 *   - Name matches known fixture names: "John Doe", "Jane Smith", "Admin User", "New Test User"
 *   - User has 0 sessions AND 0 files AND 0 connections
 *   - Explicitly excluded user IDs can be passed via --exclude
 *
 * Usage:
 *   npx tsx scripts/database/purge-test-users.ts                   # Dry run (default)
 *   npx tsx scripts/database/purge-test-users.ts --confirm          # Actually delete
 *   npx tsx scripts/database/purge-test-users.ts --exclude <UUID>   # Exclude specific user
 *   npx tsx scripts/database/purge-test-users.ts --include-data     # Also delete test users WITH data
 *   npx tsx scripts/database/purge-test-users.ts --help
 */
import { createPrisma } from '../_shared/prisma';
import { hasFlag, getFlag } from '../_shared/args';

// ─── ANSI Colors ─────────────────────────────────────────────────
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ─── Test user detection ─────────────────────────────────────────
const TEST_NAME_PATTERNS = [
  /^Test User/i,
  /^E2E /i,
  /^SDK Test/i,
  /^D23 Test/i,
  /^Test Race/i,
];

const FIXTURE_NAMES = new Set([
  'John Doe',
  'Jane Smith',
  'Admin User',
  'New Test User',
]);

function isTestUser(name: string | null): boolean {
  if (!name || name.trim() === '') return true;
  if (FIXTURE_NAMES.has(name)) return true;
  return TEST_NAME_PATTERNS.some(p => p.test(name));
}

function printUsage(): void {
  console.log(`
${BOLD}Purge Test Users${RESET}
Removes empty test/fixture users created by integration and E2E tests.

${BOLD}Usage:${RESET}
  npx tsx scripts/database/purge-test-users.ts [flags]

${BOLD}Flags:${RESET}
  --confirm        Actually delete (default is dry run)
  --exclude <UUID> Exclude a specific user ID from deletion
  --include-data   Also delete test users that have data (sessions/files)
  --help           Show this help

${BOLD}Detection:${RESET}
  Names matching: Test User*, E2E*, SDK Test*, D23 Test*, Test Race*,
  John Doe, Jane Smith, Admin User, New Test User, or empty/null names.
  Only deletes users with 0 sessions, 0 files, 0 connections (unless --include-data).
`);
}

async function main(): Promise<void> {
  if (hasFlag('--help')) {
    printUsage();
    process.exit(0);
  }

  const doConfirm = hasFlag('--confirm');
  const includeData = hasFlag('--include-data');
  const excludeId = getFlag('--exclude')?.toUpperCase();
  const dryRun = !doConfirm;

  const prisma = createPrisma();

  try {
    console.log(`${BOLD}Purge Test Users${RESET}`);
    console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE — users WILL be deleted'}\n`);

    const allUsers = await prisma.users.findMany({
      select: { id: true, full_name: true, email: true, is_active: true, created_at: true },
    });

    const candidates: Array<{
      id: string;
      name: string;
      email: string;
      sessions: number;
      files: number;
      connections: number;
      reason: string;
    }> = [];

    const preserved: string[] = [];

    for (const u of allUsers) {
      if (excludeId && u.id.toUpperCase() === excludeId) {
        preserved.push(`${u.id} ${u.full_name ?? ''} (--exclude)`);
        continue;
      }

      if (!isTestUser(u.full_name)) {
        preserved.push(`${u.id} ${u.full_name ?? ''} (real user)`);
        continue;
      }

      const sessions = await prisma.sessions.count({ where: { user_id: u.id } });
      const files = await prisma.files.count({ where: { user_id: u.id } });
      const connections = await prisma.connections.count({ where: { user_id: u.id } });

      const hasData = sessions > 0 || files > 0 || connections > 0;

      if (hasData && !includeData) {
        preserved.push(`${u.id} ${u.full_name ?? ''} (has data: ${sessions}s/${files}f/${connections}c)`);
        continue;
      }

      const reason = hasData
        ? `test user WITH data (${sessions}s/${files}f/${connections}c)`
        : 'empty test user';

      candidates.push({
        id: u.id,
        name: u.full_name ?? '(null)',
        email: u.email,
        sessions,
        files,
        connections,
        reason,
      });
    }

    // Display candidates
    console.log(`${BOLD}Users to delete: ${candidates.length}${RESET}\n`);
    for (const c of candidates) {
      console.log(`  ${YELLOW}DELETE${RESET} ${c.id}  ${c.name.padEnd(30)}  <${c.email}>  [${c.reason}]`);
    }

    if (preserved.length > 0) {
      console.log(`\n${BOLD}Users preserved: ${preserved.length}${RESET}\n`);
      for (const p of preserved) {
        console.log(`  ${GREEN}KEEP${RESET}   ${p}`);
      }
    }

    if (candidates.length === 0) {
      console.log(`\n${GREEN}No test users to delete.${RESET}`);
      return;
    }

    if (dryRun) {
      console.log(`\n${DIM}This was a dry run. Use --confirm to actually delete.${RESET}`);
      return;
    }

    // ── Delete ──
    console.log(`\n${BOLD}Deleting ${candidates.length} test users...${RESET}\n`);
    let deleted = 0;
    let errors = 0;

    for (const c of candidates) {
      try {
        // Delete ALL dependent records (same order as purge-user.ts)
        // Even "empty" users may have usage_events, audit_log, etc. with direct FK to users

        // Session-scoped cleanup (cascade won't handle FK-less leaf tables)
        const sessionIds = (await prisma.sessions.findMany({
          where: { user_id: c.id },
          select: { id: true },
        })).map(s => s.id);

        if (sessionIds.length > 0) {
          const messageIds = (await prisma.messages.findMany({
            where: { session_id: { in: sessionIds } },
            select: { id: true },
          })).map(m => m.id);

          if (messageIds.length > 0) {
            await prisma.message_citations.deleteMany({ where: { message_id: { in: messageIds } } });
            await prisma.message_file_attachments.deleteMany({ where: { message_id: { in: messageIds } } });
            await prisma.message_chat_attachments.deleteMany({ where: { message_id: { in: messageIds } } });
          }

          await prisma.langgraph_checkpoint_writes.deleteMany({ where: { thread_id: { in: sessionIds } } });
          await prisma.langgraph_checkpoints.deleteMany({ where: { thread_id: { in: sessionIds } } });
        }

        // User-scoped tables (always clean — these have direct FK to users)
        await prisma.token_usage.deleteMany({ where: { user_id: c.id } });
        await prisma.usage_events.deleteMany({ where: { user_id: c.id } });
        await prisma.usage_aggregates.deleteMany({ where: { user_id: c.id } });
        await prisma.billing_records.deleteMany({ where: { user_id: c.id } });
        await prisma.quota_alerts.deleteMany({ where: { user_id: c.id } });
        await prisma.audit_log.deleteMany({ where: { user_id: c.id } });
        await prisma.deletion_audit_log.deleteMany({ where: { user_id: c.id } });
        await prisma.chat_attachments.deleteMany({ where: { user_id: c.id } });
        await prisma.upload_batches.deleteMany({ where: { user_id: c.id } });
        await prisma.tool_permissions.deleteMany({ where: { user_id: c.id } });
        await prisma.user_feedback.deleteMany({ where: { user_id: c.id } });
        await prisma.sessions.deleteMany({ where: { user_id: c.id } });
        await prisma.files.deleteMany({ where: { user_id: c.id } });
        await prisma.connections.deleteMany({ where: { user_id: c.id } });

        // Delete user profile
        await prisma.user_settings.deleteMany({ where: { user_id: c.id } });
        await prisma.user_quotas.deleteMany({ where: { user_id: c.id } });
        await prisma.users.delete({ where: { id: c.id } });
        deleted++;

        if (deleted % 10 === 0) {
          console.log(`  ${DIM}Deleted ${deleted}/${candidates.length}...${RESET}`);
        }
      } catch (error) {
        errors++;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  ${RED}Failed to delete ${c.id} (${c.name}): ${msg}${RESET}`);
      }
    }

    console.log(`
${GREEN}${BOLD}╔════════════════════════════════════════╗${RESET}
${GREEN}${BOLD}║  TEST USER CLEANUP COMPLETE            ║${RESET}
${GREEN}${BOLD}╚════════════════════════════════════════╝${RESET}

  Deleted: ${GREEN}${deleted}${RESET}
  Errors:  ${errors > 0 ? RED + errors + RESET : DIM + '0' + RESET}
  Preserved: ${preserved.length}
`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
