/**
 * Reset Stuck Pipeline Files
 *
 * Resets files stuck in 'queued' status with exhausted retries (pipeline_retry_count >= 3)
 * so the processing pipeline can attempt them again with a clean slate.
 *
 * Usage:
 *   npx tsx scripts/connectors/reset-stuck-pipeline.ts --userId <ID> --dry-run
 *   npx tsx scripts/connectors/reset-stuck-pipeline.ts --userId <ID> --fix
 *   npx tsx scripts/connectors/reset-stuck-pipeline.ts --all --dry-run --env prod
 *   npx tsx scripts/connectors/reset-stuck-pipeline.ts --all --fix --env prod
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { getFlag, hasFlag } from '../_shared/args';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

// ─── ANSI Colors ─────────────────────────────────────────────────
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

function printHelp(): void {
  console.log(`
${BOLD}reset-stuck-pipeline.ts${RESET} — Reset files stuck in 'queued' with exhausted retries

${BOLD}Usage:${RESET}
  npx tsx scripts/connectors/reset-stuck-pipeline.ts --userId <ID> --dry-run
  npx tsx scripts/connectors/reset-stuck-pipeline.ts --userId <ID> --fix
  npx tsx scripts/connectors/reset-stuck-pipeline.ts --all --dry-run --env prod

${BOLD}Flags:${RESET}
  --userId <ID>     Target a specific user (UUID)
  --all             Target all users with stuck files
  --dry-run         Preview what would be reset (no changes)
  --fix             Apply the reset
  --env dev|prod    Target environment (uses Azure Key Vault)
  --min-retries <N> Minimum retry count to match (default: 3)
  --help, -h        Show this help message

${BOLD}What it does:${RESET}
  1. Finds files with pipeline_status='queued' AND pipeline_retry_count >= N
  2. Resets pipeline_retry_count to 0 and last_error to null
  3. Updates updated_at so recovery services detect them as freshly queued

${BOLD}Why:${RESET}
  When extraction fails repeatedly, files get stuck in a loop between
  StuckFileRecoveryService and FileRequeueRepairer. This script breaks
  that cycle by giving files a clean retry slate.
`);
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) { printHelp(); return; }

  const targetEnv = getTargetEnv();
  if (targetEnv) await resolveEnvironment(targetEnv);

  const userId  = getFlag('--userId')?.toUpperCase() ?? null;
  const allMode = hasFlag('--all');
  const dryRun  = hasFlag('--dry-run');
  const fix     = hasFlag('--fix');
  const minRetries = parseInt(getFlag('--min-retries') ?? '3', 10);

  if (!userId && !allMode) {
    console.error(`${RED}Error: --userId or --all required${RESET}`);
    printHelp();
    process.exit(1);
  }

  if (!dryRun && !fix) {
    console.error(`${RED}Error: --dry-run or --fix required${RESET}`);
    process.exit(1);
  }

  const prisma = createPrisma();

  try {
    console.log(`${BOLD}=== Reset Stuck Pipeline Files ===${RESET}\n`);
    if (targetEnv) console.log(`Environment: ${CYAN}${targetEnv.toUpperCase()}${RESET}`);
    console.log(`Mode: ${fix ? `${RED}FIX (will modify data)${RESET}` : `${YELLOW}DRY RUN${RESET}`}`);
    console.log(`Min retries: ${minRetries}`);
    console.log();

    // ─── Find stuck files ─────────────────────────────────────────
    const whereClause: Record<string, unknown> = {
      pipeline_status: 'queued',
      pipeline_retry_count: { gte: minRetries },
      deletion_status: null,
      is_folder: false,
    };
    if (userId) whereClause.user_id = userId;

    const stuckFiles = await prisma.files.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        user_id: true,
        pipeline_retry_count: true,
        mime_type: true,
        source_type: true,
        connection_scope_id: true,
        updated_at: true,
        last_error: true,
      },
      orderBy: { updated_at: 'asc' },
    });

    if (stuckFiles.length === 0) {
      console.log(`${GREEN}No stuck files found matching criteria.${RESET}`);
      return;
    }

    // ─── Group by user for reporting ──────────────────────────────
    const byUser = new Map<string, typeof stuckFiles>();
    for (const f of stuckFiles) {
      const uid = f.user_id.toUpperCase();
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push(f);
    }

    console.log(`${BOLD}Found ${stuckFiles.length} stuck file(s) across ${byUser.size} user(s):${RESET}\n`);

    for (const [uid, files] of byUser) {
      console.log(`  ${CYAN}User: ${uid}${RESET}`);

      // Group by mime type
      const byMime = new Map<string, number>();
      for (const f of files) {
        const mime = f.mime_type ?? 'unknown';
        byMime.set(mime, (byMime.get(mime) ?? 0) + 1);
      }

      for (const [mime, count] of byMime) {
        console.log(`    ${DIM}${mime}${RESET}: ${YELLOW}${count}${RESET} files`);
      }

      // Show sample files
      const sample = files.slice(0, 5);
      console.log(`    ${DIM}Sample files:${RESET}`);
      for (const f of sample) {
        const age = Math.round((Date.now() - f.updated_at.getTime()) / 60_000);
        console.log(`      ${f.name} ${DIM}(retries: ${f.pipeline_retry_count}, age: ${age}min)${RESET}`);
      }
      if (files.length > 5) {
        console.log(`      ${DIM}... and ${files.length - 5} more${RESET}`);
      }
      console.log();
    }

    // ─── Apply fix ────────────────────────────────────────────────
    if (dryRun) {
      console.log(`${YELLOW}DRY RUN — no changes made.${RESET}`);
      console.log(`Run with --fix to reset ${stuckFiles.length} file(s).`);
      return;
    }

    console.log(`${BOLD}Resetting ${stuckFiles.length} files...${RESET}`);

    const result = await prisma.files.updateMany({
      where: whereClause,
      data: {
        pipeline_retry_count: 0,
        last_error: null,
        updated_at: new Date(),
      },
    });

    console.log(`\n${GREEN}${BOLD}Reset complete: ${result.count} file(s) updated.${RESET}`);
    console.log(`${DIM}Files will be picked up by the next StuckFileRecoveryService cycle (within 15 min).${RESET}`);
    console.log(`${DIM}Or trigger immediately via: POST /api/sync/health/reconcile${RESET}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
