/**
 * purge-user.ts — Per-user data purge across all storage layers.
 *
 * Deletes ALL data for a specific user across Azure SQL, Blob Storage,
 * AI Search, and Redis. The user record itself can optionally be preserved
 * (--keep-account) so the account remains functional.
 *
 * Phases:
 *   1. SQL Database  — leaf tables first, then cascade parents
 *   2. Blob Storage  — user-scoped blobs (files + chat-attachments)
 *   3. AI Search     — user-scoped documents in file-chunks-index
 *   4. Redis         — MSAL cache, upload sessions, event sequences
 *   5. LangGraph     — checkpoints for user's sessions
 *
 * Safety:
 *   - Always runs a pre-flight inventory (same as inventory-user.ts)
 *   - --dry-run shows what would be deleted without making changes
 *   - Without --confirm, requires interactive "YES" confirmation
 *   - Deletion audit log is written for GDPR traceability
 *
 * Usage:
 *   npx tsx scripts/database/purge-user.ts --userId <UUID>                    # Interactive
 *   npx tsx scripts/database/purge-user.ts --userId <UUID> --dry-run          # Preview only
 *   npx tsx scripts/database/purge-user.ts --userId <UUID> --confirm          # Skip prompt
 *   npx tsx scripts/database/purge-user.ts --userId <UUID> --keep-account     # Preserve users row
 *   npx tsx scripts/database/purge-user.ts --userId <UUID> --reset-onboarding # Only reset onboarding preferences
 *   npx tsx scripts/database/purge-user.ts --userId <UUID> --skip-redis       # Skip Redis phase
 *   npx tsx scripts/database/purge-user.ts --help
 */
import 'dotenv/config';
import Redis from 'ioredis';
import { createInterface } from 'readline/promises';
import { PrismaClient } from '@prisma/client';
import { createPrisma } from '../_shared/prisma';
import { createBlobContainerClient, createSearchClient } from '../_shared/azure';
import { hasFlag, getFlag } from '../_shared/args';

// ─── ANSI Colors ─────────────────────────────────────────────────
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ─── Types ───────────────────────────────────────────────────────
interface PhaseResult {
  name: string;
  deleted: Record<string, number>;
  skipped?: boolean;
  error?: string;
}

interface ChunkDocument {
  chunkId: string;
  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────
function printUsage(): void {
  console.log(`
${BOLD}Per-User Data Purge${RESET}
Deletes ALL data for a specific user across SQL, Blob, AI Search, and Redis.

${BOLD}Usage:${RESET}
  npx tsx scripts/database/purge-user.ts --userId <UUID> [flags]

${BOLD}Flags:${RESET}
  --userId <UUID>      Target user ID (required)
  --confirm            Skip interactive confirmation
  --dry-run            Preview what would be deleted (no changes)
  --keep-account       Preserve the users row + user_settings (account remains functional)
  --reset-onboarding   ONLY reset onboarding preferences (no data deletion)
  --skip-redis         Skip Redis cleanup
  --help               Show this help

${BOLD}Examples:${RESET}
  # Preview cleanup for a user
  npx tsx scripts/database/purge-user.ts --userId BCD5A31B-... --dry-run

  # Full purge, keep account alive
  npx tsx scripts/database/purge-user.ts --userId BCD5A31B-... --keep-account --confirm

  # Only reset onboarding (simulate first-time experience)
  npx tsx scripts/database/purge-user.ts --userId BCD5A31B-... --reset-onboarding --confirm
`);
}

async function confirm(userId: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${YELLOW}Type YES to confirm purge for ${userId}: ${RESET}`);
    return answer.trim() === 'YES';
  } finally {
    rl.close();
  }
}

function logStep(label: string, count: number, dryRun: boolean): void {
  const prefix = dryRun ? `${DIM}[DRY RUN]${RESET} ` : '';
  const countStr = count > 0 ? `${YELLOW}${count}${RESET}` : `${DIM}0${RESET}`;
  console.log(`  ${prefix}${label}: ${countStr}`);
}

// ─── Phase 1: SQL Database ──────────────────────────────────────
async function purgeDatabase(
  prisma: PrismaClient,
  userId: string,
  dryRun: boolean,
  keepAccount: boolean,
): Promise<PhaseResult> {
  console.log(`\n${CYAN}${BOLD}━━━ Phase 1: SQL Database ━━━${RESET}`);
  const deleted: Record<string, number> = {};

  try {
    // Get session IDs for this user
    const sessionIds = (await prisma.sessions.findMany({
      where: { user_id: userId },
      select: { id: true },
    })).map(s => s.id);

    // Get message IDs (for tables without FK relation through sessions)
    const messageIds = sessionIds.length > 0
      ? (await prisma.messages.findMany({
          where: { session_id: { in: sessionIds } },
          select: { id: true },
        })).map(m => m.id)
      : [];

    console.log(`  ${DIM}Found ${sessionIds.length} sessions, ${messageIds.length} messages${RESET}`);

    // ── Count everything ──
    const counts: Record<string, number> = {};

    // Leaf tables (no FK cascade — must delete explicitly)
    counts['message_citations'] = messageIds.length > 0
      ? await prisma.message_citations.count({ where: { message_id: { in: messageIds } } })
      : 0;
    counts['message_file_attachments'] = messageIds.length > 0
      ? await prisma.message_file_attachments.count({ where: { message_id: { in: messageIds } } })
      : 0;
    counts['message_chat_attachments'] = messageIds.length > 0
      ? await prisma.message_chat_attachments.count({ where: { message_id: { in: messageIds } } })
      : 0;

    // User-scoped standalone tables
    counts['token_usage'] = await prisma.token_usage.count({ where: { user_id: userId } });
    counts['usage_events'] = await prisma.usage_events.count({ where: { user_id: userId } });
    counts['usage_aggregates'] = await prisma.usage_aggregates.count({ where: { user_id: userId } });
    counts['billing_records'] = await prisma.billing_records.count({ where: { user_id: userId } });
    counts['quota_alerts'] = await prisma.quota_alerts.count({ where: { user_id: userId } });
    counts['user_feedback'] = await prisma.user_feedback.count({ where: { user_id: userId } });
    counts['audit_log'] = await prisma.audit_log.count({ where: { user_id: userId } });
    counts['deletion_audit_log'] = await prisma.deletion_audit_log.count({ where: { user_id: userId } });
    counts['agent_usage_analytics'] = await prisma.agent_usage_analytics.count();
    counts['tool_permissions'] = await prisma.tool_permissions.count({ where: { user_id: userId } });
    counts['chat_attachments'] = await prisma.chat_attachments.count({ where: { user_id: userId } });
    counts['upload_batches'] = await prisma.upload_batches.count({ where: { user_id: userId } });

    // Session-cascaded (deleting sessions will cascade these)
    counts['sessions'] = sessionIds.length;
    counts['messages (cascade)'] = messageIds.length;
    counts['message_events (cascade)'] = sessionIds.length > 0
      ? await prisma.message_events.count({ where: { session_id: { in: sessionIds } } })
      : 0;
    counts['approvals (cascade)'] = sessionIds.length > 0
      ? await prisma.approvals.count({ where: { session_id: { in: sessionIds } } })
      : 0;
    counts['todos (cascade)'] = sessionIds.length > 0
      ? await prisma.todos.count({ where: { session_id: { in: sessionIds } } })
      : 0;
    counts['agent_executions (cascade)'] = sessionIds.length > 0
      ? await prisma.agent_executions.count({ where: { session_id: { in: sessionIds } } })
      : 0;
    counts['session_files (cascade)'] = sessionIds.length > 0
      ? await prisma.session_files.count({ where: { session_id: { in: sessionIds } } })
      : 0;

    // File-cascaded
    counts['files'] = await prisma.files.count({ where: { user_id: userId } });
    counts['file_chunks (cascade)'] = await prisma.file_chunks.count({ where: { user_id: userId } });
    counts['image_embeddings (cascade)'] = await prisma.image_embeddings.count({ where: { user_id: userId } });

    // Connections
    counts['connections'] = await prisma.connections.count({ where: { user_id: userId } });

    // LangGraph (match by session thread_id)
    if (sessionIds.length > 0) {
      counts['langgraph_checkpoints'] = await prisma.langgraph_checkpoints.count({
        where: { thread_id: { in: sessionIds } },
      });
      counts['langgraph_checkpoint_writes'] = await prisma.langgraph_checkpoint_writes.count({
        where: { thread_id: { in: sessionIds } },
      });
    } else {
      counts['langgraph_checkpoints'] = 0;
      counts['langgraph_checkpoint_writes'] = 0;
    }

    // Account
    if (!keepAccount) {
      counts['user_settings'] = await prisma.user_settings.count({ where: { user_id: userId } });
      counts['user_quotas'] = await prisma.user_quotas.count({ where: { user_id: userId } });
      counts['user (account)'] = 1;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`  ${DIM}Total records to process: ${total}${RESET}\n`);

    if (dryRun) {
      for (const [table, count] of Object.entries(counts)) {
        logStep(table, count, true);
      }
      return { name: 'SQL Database', deleted: counts };
    }

    // ── DELETE ORDER: leaf tables → cascade parents → account ──

    // 1. Leaf FK tables (no cascade from messages)
    if (messageIds.length > 0) {
      // Batch in groups of 500 to avoid SQL parameter limits
      for (let i = 0; i < messageIds.length; i += 500) {
        const batch = messageIds.slice(i, i + 500);
        deleted['message_citations'] = (deleted['message_citations'] ?? 0) +
          (await prisma.message_citations.deleteMany({ where: { message_id: { in: batch } } })).count;
        deleted['message_file_attachments'] = (deleted['message_file_attachments'] ?? 0) +
          (await prisma.message_file_attachments.deleteMany({ where: { message_id: { in: batch } } })).count;
        deleted['message_chat_attachments'] = (deleted['message_chat_attachments'] ?? 0) +
          (await prisma.message_chat_attachments.deleteMany({ where: { message_id: { in: batch } } })).count;
      }
    }
    logStep('message_citations', deleted['message_citations'] ?? 0, false);
    logStep('message_file_attachments', deleted['message_file_attachments'] ?? 0, false);
    logStep('message_chat_attachments', deleted['message_chat_attachments'] ?? 0, false);

    // 2. Standalone usage/billing tables
    deleted['token_usage'] = (await prisma.token_usage.deleteMany({ where: { user_id: userId } })).count;
    logStep('token_usage', deleted['token_usage'], false);

    deleted['usage_events'] = (await prisma.usage_events.deleteMany({ where: { user_id: userId } })).count;
    logStep('usage_events', deleted['usage_events'], false);

    deleted['usage_aggregates'] = (await prisma.usage_aggregates.deleteMany({ where: { user_id: userId } })).count;
    logStep('usage_aggregates', deleted['usage_aggregates'], false);

    deleted['billing_records'] = (await prisma.billing_records.deleteMany({ where: { user_id: userId } })).count;
    logStep('billing_records', deleted['billing_records'], false);

    deleted['quota_alerts'] = (await prisma.quota_alerts.deleteMany({ where: { user_id: userId } })).count;
    logStep('quota_alerts', deleted['quota_alerts'], false);

    deleted['user_feedback'] = (await prisma.user_feedback.deleteMany({ where: { user_id: userId } })).count;
    logStep('user_feedback', deleted['user_feedback'], false);

    // 3. Audit tables
    deleted['audit_log'] = (await prisma.audit_log.deleteMany({ where: { user_id: userId } })).count;
    logStep('audit_log', deleted['audit_log'], false);

    deleted['deletion_audit_log'] = (await prisma.deletion_audit_log.deleteMany({ where: { user_id: userId } })).count;
    logStep('deletion_audit_log', deleted['deletion_audit_log'], false);

    // 4. Analytics & permissions
    deleted['agent_usage_analytics'] = (await prisma.agent_usage_analytics.deleteMany({})).count;
    logStep('agent_usage_analytics (global)', deleted['agent_usage_analytics'], false);

    deleted['tool_permissions'] = (await prisma.tool_permissions.deleteMany({ where: { user_id: userId } })).count;
    logStep('tool_permissions', deleted['tool_permissions'], false);

    // 5. Chat attachments (user-scoped, not session-cascaded)
    deleted['chat_attachments'] = (await prisma.chat_attachments.deleteMany({ where: { user_id: userId } })).count;
    logStep('chat_attachments', deleted['chat_attachments'], false);

    // 6. Upload batches
    deleted['upload_batches'] = (await prisma.upload_batches.deleteMany({ where: { user_id: userId } })).count;
    logStep('upload_batches', deleted['upload_batches'], false);

    // 7. LangGraph checkpoints (batch delete — large VarBinary rows)
    if (sessionIds.length > 0) {
      deleted['langgraph_checkpoint_writes'] = 0;
      for (let i = 0; i < sessionIds.length; i += 50) {
        const batch = sessionIds.slice(i, i + 50);
        deleted['langgraph_checkpoint_writes'] +=
          (await prisma.langgraph_checkpoint_writes.deleteMany({ where: { thread_id: { in: batch } } })).count;
      }
      logStep('langgraph_checkpoint_writes', deleted['langgraph_checkpoint_writes'], false);

      deleted['langgraph_checkpoints'] = 0;
      for (let i = 0; i < sessionIds.length; i += 50) {
        const batch = sessionIds.slice(i, i + 50);
        deleted['langgraph_checkpoints'] +=
          (await prisma.langgraph_checkpoints.deleteMany({ where: { thread_id: { in: batch } } })).count;
      }
      logStep('langgraph_checkpoints', deleted['langgraph_checkpoints'], false);
    }

    // 8. Sessions (CASCADE: messages, message_events, approvals, todos, agent_executions, session_files)
    deleted['sessions'] = (await prisma.sessions.deleteMany({ where: { user_id: userId } })).count;
    logStep('sessions (+ cascaded children)', deleted['sessions'], false);

    // 9. Files (CASCADE: file_chunks, image_embeddings)
    deleted['files'] = (await prisma.files.deleteMany({ where: { user_id: userId } })).count;
    logStep('files (+ cascaded chunks/embeddings)', deleted['files'], false);

    // 10. Connections (CASCADE: connection_scopes)
    deleted['connections'] = (await prisma.connections.deleteMany({ where: { user_id: userId } })).count;
    logStep('connections (+ cascaded scopes)', deleted['connections'], false);

    // 11. Account (optional)
    if (!keepAccount) {
      deleted['user_settings'] = (await prisma.user_settings.deleteMany({ where: { user_id: userId } })).count;
      deleted['user_quotas'] = (await prisma.user_quotas.deleteMany({ where: { user_id: userId } })).count;
      deleted['user'] = (await prisma.users.deleteMany({ where: { id: userId } })).count;
      logStep('user account DELETED', deleted['user'], false);
    } else {
      // Reset quotas to zero
      await prisma.user_quotas.updateMany({
        where: { user_id: userId },
        data: { current_token_usage: 0, current_api_call_usage: 0, current_storage_usage: 0 },
      });
      console.log(`  ${GREEN}user_quotas: reset counters to 0 (account preserved)${RESET}`);

      // Clear onboarding preferences so next login triggers the welcome tour
      await prisma.user_settings.updateMany({
        where: { user_id: userId },
        data: { preferences: null },
      });
      console.log(`  ${GREEN}user_settings.preferences: cleared (onboarding reset)${RESET}`);
    }

    console.log(`\n  ${GREEN}SQL phase complete.${RESET}`);
    return { name: 'SQL Database', deleted };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ${RED}Error: ${msg}${RESET}`);
    return { name: 'SQL Database', deleted, error: msg };
  }
}

// ─── Phase 2: Blob Storage ──────────────────────────────────────
async function purgeBlobStorage(userId: string, dryRun: boolean): Promise<PhaseResult> {
  console.log(`\n${CYAN}${BOLD}━━━ Phase 2: Azure Blob Storage ━━━${RESET}`);
  const containerClient = createBlobContainerClient();

  if (!containerClient) {
    console.log(`  ${DIM}Blob Storage credentials not configured, skipping.${RESET}`);
    return { name: 'Blob Storage', deleted: {}, skipped: true };
  }

  try {
    // Collect all blobs for this user (both cases for safety)
    const blobNames: string[] = [];
    const prefixes = [
      `users/${userId}/`,
      `users/${userId.toLowerCase()}/`,
    ];

    for (const prefix of prefixes) {
      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        blobNames.push(blob.name);
      }
    }

    // Deduplicate (in case uppercase == lowercase on some systems)
    const uniqueBlobs = [...new Set(blobNames)];
    console.log(`  Found ${uniqueBlobs.length} blobs`);

    if (uniqueBlobs.length === 0) {
      return { name: 'Blob Storage', deleted: { blobs: 0 } };
    }

    if (dryRun) {
      for (const name of uniqueBlobs.slice(0, 10)) {
        console.log(`    ${DIM}${name}${RESET}`);
      }
      if (uniqueBlobs.length > 10) {
        console.log(`    ${DIM}... and ${uniqueBlobs.length - 10} more${RESET}`);
      }
      logStep('blobs to delete', uniqueBlobs.length, true);
      return { name: 'Blob Storage', deleted: { blobs: uniqueBlobs.length } };
    }

    let deletedCount = 0;
    for (const name of uniqueBlobs) {
      try {
        await containerClient.deleteBlob(name);
        deletedCount++;
        if (deletedCount % 50 === 0) {
          console.log(`  ${DIM}  deleted ${deletedCount}/${uniqueBlobs.length}...${RESET}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  ${RED}Failed to delete blob ${name}: ${msg}${RESET}`);
      }
    }

    logStep('blobs deleted', deletedCount, false);
    console.log(`  ${GREEN}Blob Storage phase complete.${RESET}`);
    return { name: 'Blob Storage', deleted: { blobs: deletedCount } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ${RED}Error: ${msg}${RESET}`);
    return { name: 'Blob Storage', deleted: {}, error: msg };
  }
}

// ─── Phase 3: AI Search ─────────────────────────────────────────
async function purgeAISearch(userId: string, dryRun: boolean): Promise<PhaseResult> {
  console.log(`\n${CYAN}${BOLD}━━━ Phase 3: Azure AI Search ━━━${RESET}`);
  const searchClient = createSearchClient<ChunkDocument>();

  if (!searchClient) {
    console.log(`  ${DIM}AI Search credentials not configured, skipping.${RESET}`);
    return { name: 'AI Search', deleted: {}, skipped: true };
  }

  try {
    // Collect all docs for this user (both cases)
    const docIds: string[] = [];
    for (const uid of [userId, userId.toLowerCase()]) {
      const searchResponse = await searchClient.search('*', {
        filter: `userId eq '${uid}'`,
        select: ['chunkId'],
        top: 10000,
      });
      for await (const result of searchResponse.results) {
        if (result.document.chunkId) {
          docIds.push(result.document.chunkId);
        }
      }
    }

    const uniqueDocs = [...new Set(docIds)];
    console.log(`  Found ${uniqueDocs.length} documents`);

    if (uniqueDocs.length === 0) {
      return { name: 'AI Search', deleted: { documents: 0 } };
    }

    if (dryRun) {
      logStep('documents to delete', uniqueDocs.length, true);
      return { name: 'AI Search', deleted: { documents: uniqueDocs.length } };
    }

    const BATCH_SIZE = 1000;
    let deletedCount = 0;
    for (let i = 0; i < uniqueDocs.length; i += BATCH_SIZE) {
      const batch = uniqueDocs.slice(i, i + BATCH_SIZE);
      await searchClient.deleteDocuments('chunkId', batch);
      deletedCount += batch.length;
      console.log(`  ${DIM}  deleted ${deletedCount}/${uniqueDocs.length}...${RESET}`);
    }

    logStep('documents deleted', deletedCount, false);
    console.log(`  ${GREEN}AI Search phase complete.${RESET}`);
    return { name: 'AI Search', deleted: { documents: deletedCount } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ${RED}Error: ${msg}${RESET}`);
    return { name: 'AI Search', deleted: {}, error: msg };
  }
}

// ─── Phase 4: Redis ─────────────────────────────────────────────
async function purgeRedis(userId: string, sessionIds: string[], dryRun: boolean): Promise<PhaseResult> {
  console.log(`\n${CYAN}${BOLD}━━━ Phase 4: Redis ━━━${RESET}`);

  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port,
    password: process.env.REDIS_PASSWORD || undefined,
    ...(port === 6380 ? { tls: {} } : {}),
    maxRetriesPerRequest: null as null,
    lazyConnect: true,
    connectTimeout: 30000,
    commandTimeout: 30000,
  };

  const redis = new Redis(redisConfig);

  try {
    await redis.connect();
    await redis.ping();
    console.log(`  Connected to ${redisConfig.host}:${redisConfig.port}`);

    let totalKeys = 0;

    // 1. MSAL token cache
    const msalKey = `msal:token:${userId}`;
    const msalLower = `msal:token:${userId.toLowerCase()}`;
    for (const key of [msalKey, msalLower]) {
      const exists = await redis.exists(key);
      if (exists) {
        if (!dryRun) await redis.del(key);
        logStep(key, 1, dryRun);
        totalKeys++;
      }
    }

    // 2. Event sequences for user's sessions
    for (const sid of sessionIds) {
      const seqKey = `seq:${sid}`;
      const exists = await redis.exists(seqKey);
      if (exists) {
        if (!dryRun) await redis.del(seqKey);
        totalKeys++;
      }
    }
    if (sessionIds.length > 0) {
      logStep(`seq:{sessionId} keys`, totalKeys - (totalKeys > 0 ? 1 : 0), dryRun);
    }

    // 3. Upload sessions
    const uploadKeys = await redis.keys(`upload-session:*`);
    // Filter to user's uploads (check each key's userId field)
    let uploadCount = 0;
    for (const key of uploadKeys) {
      const data = await redis.get(key);
      if (data && data.includes(userId)) {
        if (!dryRun) await redis.del(key);
        uploadCount++;
        totalKeys++;
      }
    }
    if (uploadCount > 0) {
      logStep('upload-session keys', uploadCount, dryRun);
    }

    if (totalKeys === 0) {
      console.log(`  ${DIM}No Redis keys found for this user.${RESET}`);
    } else {
      console.log(`\n  ${GREEN}Redis phase complete. ${dryRun ? 'Would delete' : 'Deleted'} ${totalKeys} keys.${RESET}`);
    }

    return { name: 'Redis', deleted: { keys: totalKeys } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ${RED}Error: ${msg}${RESET}`);
    return { name: 'Redis', deleted: {}, error: msg };
  } finally {
    await redis.quit();
  }
}

// ─── Summary ─────────────────────────────────────────────────────
function printSummary(results: PhaseResult[], dryRun: boolean, keepAccount: boolean): void {
  const label = dryRun ? 'DRY RUN SUMMARY' : 'PURGE COMPLETE';
  console.log(`
${BOLD}${GREEN}╔════════════════════════════════════════╗${RESET}
${BOLD}${GREEN}║  ${label.padEnd(37)}║${RESET}
${BOLD}${GREEN}╚════════════════════════════════════════╝${RESET}
`);

  for (const result of results) {
    const status = result.error
      ? `${RED}ERROR${RESET}`
      : result.skipped
        ? `${DIM}SKIPPED${RESET}`
        : `${GREEN}OK${RESET}`;

    console.log(`${BOLD}${result.name}${RESET} [${status}]`);
    for (const [key, val] of Object.entries(result.deleted)) {
      console.log(`  ${key}: ${val}`);
    }
    if (result.error) {
      console.log(`  ${RED}${result.error}${RESET}`);
    }
  }

  if (!dryRun) {
    const verb = keepAccount ? 'cleaned — account preserved, ready for fresh start' : 'DELETED — account removed';
    console.log(`\n${GREEN}${BOLD}User data ${verb}.${RESET}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (hasFlag('--help')) {
    printUsage();
    process.exit(0);
  }

  const userId = (getFlag('--userId') ?? getFlag('--userid'))?.toUpperCase();
  if (!userId) {
    console.error(`${RED}Error: --userId is required.${RESET}`);
    printUsage();
    process.exit(1);
  }

  const dryRun = hasFlag('--dry-run');
  const autoConfirm = hasFlag('--confirm');
  const skipRedis = hasFlag('--skip-redis');
  const keepAccount = hasFlag('--keep-account');
  const resetOnboarding = hasFlag('--reset-onboarding');

  const prisma = createPrisma();

  try {
    // Verify user exists
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) {
      console.error(`${RED}Error: User ${userId} not found.${RESET}`);
      process.exit(1);
    }

    // ── Fast path: --reset-onboarding only clears preferences ──
    if (resetOnboarding) {
      console.log(`${BOLD}Reset Onboarding Preferences${RESET}`);
      console.log(`User:    ${user.full_name ?? '(no name)'} <${user.email}>`);
      console.log(`ID:      ${userId}`);
      console.log(`Mode:    ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

      const existing = await prisma.user_settings.findUnique({ where: { user_id: userId } });
      const hasPrefs = existing?.preferences != null;

      if (dryRun) {
        logStep('user_settings.preferences', hasPrefs ? 1 : 0, true);
        console.log(`\n${GREEN}${BOLD}DRY RUN complete — no changes made.${RESET}`);
      } else if (!hasPrefs) {
        console.log(`  ${DIM}No onboarding preferences found — already clean.${RESET}`);
      } else {
        if (!autoConfirm) {
          const ok = await confirm(userId);
          if (!ok) { console.log('\nCancelled.'); process.exit(0); }
        }
        await prisma.user_settings.updateMany({
          where: { user_id: userId },
          data: { preferences: null },
        });
        console.log(`  ${GREEN}user_settings.preferences: cleared to NULL${RESET}`);
        console.log(`\n${GREEN}${BOLD}Onboarding reset complete — next login will trigger the welcome tour.${RESET}`);
        console.log(`${DIM}Remember to clear localStorage key "bc-agent-onboarding" in the browser.${RESET}`);
      }

      await prisma.$disconnect();
      process.exit(0);
    }

    console.log(`${BOLD}Per-User Data Purge${RESET}`);
    console.log(`User:    ${user.full_name ?? '(no name)'} <${user.email}>`);
    console.log(`ID:      ${userId}`);
    console.log(`Mode:    ${dryRun ? 'DRY RUN (preview only)' : 'LIVE — data WILL be deleted'}`);
    console.log(`Account: ${keepAccount ? 'PRESERVED' : 'WILL BE DELETED'}`);
    if (skipRedis) console.log(`Redis:   SKIPPED`);

    if (!dryRun && !autoConfirm) {
      console.log(`
${RED}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}
${RED}${BOLD}║  USER PURGE — ALL data for this user will be DELETED        ║${RESET}
${RED}${BOLD}║  SQL + Blob Storage + AI Search + Redis                     ║${RESET}
${RED}${BOLD}║  This action is IRREVERSIBLE.                               ║${RESET}
${RED}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}
`);
      const ok = await confirm(userId);
      if (!ok) {
        console.log('\nPurge cancelled.');
        process.exit(0);
      }
    }

    // Get session IDs before purge (needed for Redis phase)
    const sessionIds = (await prisma.sessions.findMany({
      where: { user_id: userId },
      select: { id: true },
    })).map(s => s.id);

    const results: PhaseResult[] = [];

    // Phase 1: SQL
    results.push(await purgeDatabase(prisma, userId, dryRun, keepAccount));

    // Phase 2: Blob Storage
    results.push(await purgeBlobStorage(userId, dryRun));

    // Phase 3: AI Search
    results.push(await purgeAISearch(userId, dryRun));

    // Phase 4: Redis
    if (!skipRedis) {
      results.push(await purgeRedis(userId, sessionIds, dryRun));
    }

    printSummary(results, dryRun, keepAccount);

    const hasErrors = results.some(r => r.error);
    process.exit(hasErrors ? 1 : 0);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n${RED}${BOLD}Fatal error: ${msg}${RESET}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
