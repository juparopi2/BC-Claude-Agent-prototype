/**
 * Full user data reset script — simulates a brand-new user experience.
 *
 * Cleans ALL user-generated data across every storage layer:
 *   - Azure SQL: sessions, messages, events, files, citations, todos, usage, etc.
 *   - Azure Blob Storage: all blobs in user-files container
 *   - Azure AI Search: all documents in file-chunks-index
 *   - Redis: all BullMQ queues, caches, and ephemeral state
 *
 * The user record itself (users table) is PRESERVED so login still works.
 * User settings and permission presets are also preserved.
 *
 * Usage:
 *   npx tsx backend/scripts/reset-user-data.ts                 # Interactive confirmation
 *   npx tsx backend/scripts/reset-user-data.ts --confirm       # Skip confirmation
 *   npx tsx backend/scripts/reset-user-data.ts --dry-run       # Preview only
 *   npx tsx backend/scripts/reset-user-data.ts --skip-redis    # Skip Redis flush
 *   npx tsx backend/scripts/reset-user-data.ts --help
 */
import 'dotenv/config';
import Redis from 'ioredis';
import { createInterface } from 'readline/promises';
import { createPrisma } from './_shared/prisma';
import { createBlobContainerClient, createSearchClient, CONTAINER_NAME, INDEX_NAME } from './_shared/azure';
import { hasFlag } from './_shared/args';

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
${BOLD}Full User Data Reset${RESET}
Wipes ALL user data to simulate a brand-new user experience.

${BOLD}Usage:${RESET}
  npx tsx backend/scripts/reset-user-data.ts [flags]

${BOLD}Flags:${RESET}
  --confirm      Skip interactive confirmation
  --dry-run      Preview what would be deleted (no changes)
  --skip-redis   Skip Redis cleanup
  --help         Show this help

${BOLD}What gets deleted:${RESET}
  SQL Server   sessions, messages, events, files, chunks, citations,
               todos, approvals, usage, billing, audit logs, quotas,
               langgraph checkpoints, token usage, agent analytics
  Blob Storage all blobs in '${CONTAINER_NAME}' container
  AI Search    all documents in '${INDEX_NAME}' index
  Redis        all BullMQ queues, caches, rate limiters, event store

${BOLD}What is PRESERVED:${RESET}
  users table, user_settings, permission_presets
`);
}

function printWarning(): void {
  console.log(`
${RED}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}
${RED}${BOLD}║  NUCLEAR RESET — ALL user data will be PERMANENTLY DELETED  ║${RESET}
${RED}${BOLD}║  SQL + Blob Storage + AI Search + Redis                     ║${RESET}
${RED}${BOLD}║  This action is IRREVERSIBLE.                               ║${RESET}
${RED}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}
`);
}

async function confirm(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${YELLOW}Type YES to confirm: ${RESET}`);
    return answer.trim() === 'YES';
  } finally {
    rl.close();
  }
}

function logPhase(name: string): void {
  console.log(`\n${CYAN}${BOLD}━━━ Phase: ${name} ━━━${RESET}`);
}

function logStep(label: string, count: number, dryRun: boolean): void {
  const prefix = dryRun ? `${DIM}[DRY RUN]${RESET} ` : '';
  const countStr = count > 0 ? `${YELLOW}${count}${RESET}` : `${DIM}0${RESET}`;
  console.log(`  ${prefix}${label}: ${countStr}`);
}

// ─── Phase 1: SQL Database ──────────────────────────────────────
async function resetDatabase(dryRun: boolean): Promise<PhaseResult> {
  logPhase('SQL Database');
  const prisma = createPrisma();
  const deleted: Record<string, number> = {};

  try {
    // Count everything first
    console.log(`  ${DIM}Counting records...${RESET}`);
    const counts = {
      message_citations: await prisma.message_citations.count(),
      message_file_attachments: await prisma.message_file_attachments.count(),
      message_chat_attachments: await prisma.message_chat_attachments.count(),
      chat_attachments: await prisma.chat_attachments.count(),
      token_usage: await prisma.token_usage.count(),
      usage_events: await prisma.usage_events.count(),
      usage_aggregates: await prisma.usage_aggregates.count(),
      billing_records: await prisma.billing_records.count(),
      quota_alerts: await prisma.quota_alerts.count(),
      user_feedback: await prisma.user_feedback.count(),
      audit_log: await prisma.audit_log.count(),
      deletion_audit_log: await prisma.deletion_audit_log.count(),
      agent_usage_analytics: await prisma.agent_usage_analytics.count(),
      tool_permissions: await prisma.tool_permissions.count(),
      // These cascade from sessions:
      approvals: await prisma.approvals.count(),
      messages: await prisma.messages.count(),
      message_events: await prisma.message_events.count(),
      agent_executions: await prisma.agent_executions.count(),
      performance_metrics: await prisma.performance_metrics.count(),
      session_files: await prisma.session_files.count(),
      todos: await prisma.todos.count(),
      sessions: await prisma.sessions.count(),
      // These cascade from files:
      file_chunks: await prisma.file_chunks.count(),
      image_embeddings: await prisma.image_embeddings.count(),
      files: await prisma.files.count(),
      // LangGraph:
      langgraph_checkpoints: await prisma.langgraph_checkpoints.count(),
      langgraph_checkpoint_writes: await prisma.langgraph_checkpoint_writes.count(),
      // Quotas (reset, not delete):
      user_quotas: await prisma.user_quotas.count(),
    };

    const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`  ${DIM}Total records to process: ${totalRecords}${RESET}\n`);

    if (dryRun) {
      for (const [table, count] of Object.entries(counts)) {
        logStep(table, count, true);
      }
      return { name: 'SQL Database', deleted: counts };
    }

    // ── Delete order: leaf tables first, then cascade parents ──

    // 1. Tables with FK to files/messages (NoAction — won't cascade)
    deleted.message_citations = (await prisma.message_citations.deleteMany({})).count;
    logStep('message_citations', deleted.message_citations, false);

    deleted.message_file_attachments = (await prisma.message_file_attachments.deleteMany({})).count;
    logStep('message_file_attachments', deleted.message_file_attachments, false);

    // 2. Standalone usage/billing tables
    deleted.token_usage = (await prisma.token_usage.deleteMany({})).count;
    logStep('token_usage', deleted.token_usage, false);

    deleted.usage_events = (await prisma.usage_events.deleteMany({})).count;
    logStep('usage_events', deleted.usage_events, false);

    deleted.usage_aggregates = (await prisma.usage_aggregates.deleteMany({})).count;
    logStep('usage_aggregates', deleted.usage_aggregates, false);

    deleted.billing_records = (await prisma.billing_records.deleteMany({})).count;
    logStep('billing_records', deleted.billing_records, false);

    deleted.quota_alerts = (await prisma.quota_alerts.deleteMany({})).count;
    logStep('quota_alerts', deleted.quota_alerts, false);

    deleted.user_feedback = (await prisma.user_feedback.deleteMany({})).count;
    logStep('user_feedback', deleted.user_feedback, false);

    // 3. Audit tables
    deleted.audit_log = (await prisma.audit_log.deleteMany({})).count;
    logStep('audit_log', deleted.audit_log, false);

    deleted.deletion_audit_log = (await prisma.deletion_audit_log.deleteMany({})).count;
    logStep('deletion_audit_log', deleted.deletion_audit_log, false);

    // 4. Analytics
    deleted.agent_usage_analytics = (await prisma.agent_usage_analytics.deleteMany({})).count;
    logStep('agent_usage_analytics', deleted.agent_usage_analytics, false);

    // 5. Tool permissions
    deleted.tool_permissions = (await prisma.tool_permissions.deleteMany({})).count;
    logStep('tool_permissions', deleted.tool_permissions, false);

    // 6. Sessions (CASCADE: approvals, messages, message_events, agent_executions,
    //    chat_attachments → message_chat_attachments, performance_metrics,
    //    session_files, todos)
    deleted.sessions = (await prisma.sessions.deleteMany({})).count;
    logStep(`sessions (+ cascaded children)`, deleted.sessions, false);

    // 7. Files (CASCADE: file_chunks, image_embeddings)
    deleted.files = (await prisma.files.deleteMany({})).count;
    logStep(`files (+ cascaded chunks/embeddings)`, deleted.files, false);

    // 8. LangGraph state (large VarBinary(Max) rows — batch delete to avoid timeout)
    deleted.langgraph_checkpoint_writes = 0;
    if (counts.langgraph_checkpoint_writes > 0) {
      let rowsAffected: number;
      do {
        rowsAffected = await prisma.$executeRaw`DELETE TOP (100) FROM langgraph_checkpoint_writes`;
        deleted.langgraph_checkpoint_writes += rowsAffected;
      } while (rowsAffected > 0);
    }
    logStep('langgraph_checkpoint_writes', deleted.langgraph_checkpoint_writes, false);

    deleted.langgraph_checkpoints = 0;
    if (counts.langgraph_checkpoints > 0) {
      let rowsAffected: number;
      do {
        rowsAffected = await prisma.$executeRaw`DELETE TOP (100) FROM langgraph_checkpoints`;
        deleted.langgraph_checkpoints += rowsAffected;
        if (deleted.langgraph_checkpoints % 500 === 0 && deleted.langgraph_checkpoints > 0) {
          console.log(`  ${DIM}  deleted ${deleted.langgraph_checkpoints}/${counts.langgraph_checkpoints} checkpoints...${RESET}`);
        }
      } while (rowsAffected > 0);
    }
    logStep('langgraph_checkpoints', deleted.langgraph_checkpoints, false);

    // 9. Reset user quotas to zero (don't delete — user needs the record)
    if (counts.user_quotas > 0) {
      await prisma.user_quotas.updateMany({
        data: {
          current_token_usage: 0,
          current_api_call_usage: 0,
          current_storage_usage: 0,
        },
      });
      console.log(`  ${GREEN}user_quotas: reset counters to 0${RESET}`);
    }

    console.log(`\n  ${GREEN}SQL Database reset complete.${RESET}`);
    return { name: 'SQL Database', deleted };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ${RED}Error: ${msg}${RESET}`);
    return { name: 'SQL Database', deleted, error: msg };
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Phase 2: Blob Storage ──────────────────────────────────────
async function resetBlobStorage(dryRun: boolean): Promise<PhaseResult> {
  logPhase('Azure Blob Storage');
  const containerClient = createBlobContainerClient();

  if (!containerClient) {
    console.log(`  ${DIM}Blob Storage credentials not configured, skipping.${RESET}`);
    return { name: 'Blob Storage', deleted: {}, skipped: true };
  }

  console.log(`  Container: ${CONTAINER_NAME}`);

  try {
    const blobNames: string[] = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      blobNames.push(blob.name);
    }

    console.log(`  Found ${blobNames.length} blobs`);

    if (blobNames.length === 0) {
      return { name: 'Blob Storage', deleted: { blobs: 0 } };
    }

    if (dryRun) {
      logStep('blobs to delete', blobNames.length, true);
      return { name: 'Blob Storage', deleted: { blobs: blobNames.length } };
    }

    let deletedCount = 0;
    for (const name of blobNames) {
      try {
        await containerClient.deleteBlob(name);
        deletedCount++;
        if (deletedCount % 50 === 0) {
          console.log(`  ${DIM}  deleted ${deletedCount}/${blobNames.length}...${RESET}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  ${RED}Failed to delete blob ${name}: ${msg}${RESET}`);
      }
    }

    logStep('blobs deleted', deletedCount, false);
    console.log(`  ${GREEN}Blob Storage reset complete.${RESET}`);
    return { name: 'Blob Storage', deleted: { blobs: deletedCount } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ${RED}Error: ${msg}${RESET}`);
    return { name: 'Blob Storage', deleted: {}, error: msg };
  }
}

// ─── Phase 3: AI Search ─────────────────────────────────────────
async function resetAISearch(dryRun: boolean): Promise<PhaseResult> {
  logPhase('Azure AI Search');
  const searchClient = createSearchClient<ChunkDocument>();

  if (!searchClient) {
    console.log(`  ${DIM}AI Search credentials not configured, skipping.${RESET}`);
    return { name: 'AI Search', deleted: {}, skipped: true };
  }

  console.log(`  Index: ${INDEX_NAME}`);

  try {
    const docIds: string[] = [];
    const searchResponse = await searchClient.search('*', { select: ['chunkId'], top: 10000 });
    for await (const result of searchResponse.results) {
      if (result.document.chunkId) {
        docIds.push(result.document.chunkId);
      }
    }

    console.log(`  Found ${docIds.length} documents`);

    if (docIds.length === 0) {
      return { name: 'AI Search', deleted: { documents: 0 } };
    }

    if (dryRun) {
      logStep('documents to delete', docIds.length, true);
      return { name: 'AI Search', deleted: { documents: docIds.length } };
    }

    const BATCH_SIZE = 1000;
    let deletedCount = 0;
    for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
      const batch = docIds.slice(i, i + BATCH_SIZE);
      await searchClient.deleteDocuments('chunkId', batch);
      deletedCount += batch.length;
      console.log(`  ${DIM}  deleted ${deletedCount}/${docIds.length}...${RESET}`);
    }

    logStep('documents deleted', deletedCount, false);
    console.log(`  ${GREEN}AI Search reset complete.${RESET}`);
    return { name: 'AI Search', deleted: { documents: deletedCount } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ${RED}Error: ${msg}${RESET}`);
    return { name: 'AI Search', deleted: {}, error: msg };
  }
}

// ─── Phase 4: Redis ─────────────────────────────────────────────
async function resetRedis(dryRun: boolean): Promise<PhaseResult> {
  logPhase('Redis (Queues + Caches)');

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

    const prefix = process.env.QUEUE_NAME_PREFIX || 'local';

    // All patterns to flush
    const patterns = [
      `bull:${prefix}--*`,       // All BullMQ queues
      'queue:ratelimit:*',       // Rate limiters
      'embedding:*',             // Embedding cache
      'ratelimit:*',             // Global rate limiters
      'usage:*',                 // Usage tracking
      'upload-session:*',        // Upload sessions
      'sess:*',                  // Express sessions
      'event-store:*',           // Event store sequences
      `${prefix}:*`,             // Prefixed keys
    ];

    let totalKeys = 0;
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length === 0) continue;

      if (dryRun) {
        logStep(pattern, keys.length, true);
      } else {
        for (let i = 0; i < keys.length; i += 500) {
          const batch = keys.slice(i, i + 500);
          await redis.del(...batch);
        }
        logStep(pattern, keys.length, false);
      }
      totalKeys += keys.length;
    }

    if (totalKeys === 0) {
      console.log(`  ${DIM}No Redis keys matched.${RESET}`);
    } else {
      console.log(`\n  ${GREEN}Redis reset complete. ${dryRun ? 'Would delete' : 'Deleted'} ${totalKeys} keys.${RESET}`);
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
function printSummary(results: PhaseResult[], dryRun: boolean): void {
  const label = dryRun ? 'DRY RUN SUMMARY' : 'RESET COMPLETE';
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
    console.log(`\n${GREEN}${BOLD}Environment is now clean — ready for a fresh user experience.${RESET}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (hasFlag('--help')) {
    printUsage();
    process.exit(0);
  }

  const dryRun = hasFlag('--dry-run');
  const autoConfirm = hasFlag('--confirm');
  const skipRedis = hasFlag('--skip-redis');

  console.log(`${BOLD}Full User Data Reset${RESET}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE — data WILL be deleted'}`);
  if (skipRedis) console.log(`Redis: SKIPPED (--skip-redis)`);

  if (!dryRun) {
    printWarning();
    if (!autoConfirm) {
      const ok = await confirm();
      if (!ok) {
        console.log('\nReset cancelled.');
        process.exit(0);
      }
    }
  }

  const results: PhaseResult[] = [];

  try {
    results.push(await resetDatabase(dryRun));
    results.push(await resetBlobStorage(dryRun));
    results.push(await resetAISearch(dryRun));

    if (!skipRedis) {
      results.push(await resetRedis(dryRun));
    }

    printSummary(results, dryRun);

    const hasErrors = results.some((r) => r.error);
    process.exit(hasErrors ? 1 : 0);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n${RED}${BOLD}Fatal error: ${msg}${RESET}`);
    process.exit(1);
  }
}

main();
