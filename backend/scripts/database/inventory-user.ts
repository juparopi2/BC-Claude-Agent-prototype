/**
 * inventory-user.ts — Full data inventory for a user across all tables and external services.
 *
 * Provides a comprehensive view of what data exists for a specific user (or all users)
 * across Azure SQL, Blob Storage, and AI Search. Useful for:
 *   - Pre-cleanup audit: see what will be affected before running purge-user.ts
 *   - Health checks: spot orphaned data or inconsistencies
 *   - Debugging: understand what state a user account is in
 *
 * Usage:
 *   npx tsx scripts/database/inventory-user.ts                  # List all users
 *   npx tsx scripts/database/inventory-user.ts Juan             # Search by name
 *   npx tsx scripts/database/inventory-user.ts <UUID>           # Direct user ID
 *   npx tsx scripts/database/inventory-user.ts Juan --all       # + summary for all users
 *   npx tsx scripts/database/inventory-user.ts Juan --external  # + Blob + AI Search counts
 */
import { createPrisma } from '../_shared/prisma';
import { createBlobContainerClient, createSearchClient } from '../_shared/azure';
import { getPositionalArg, hasFlag } from '../_shared/args';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

// ─── ANSI Colors ─────────────────────────────────────────────────
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

interface ChunkDocument {
  chunkId: string;
  fileStatus?: string;
  [key: string]: unknown;
}

async function main() {
  const targetEnv = getTargetEnv();
  if (targetEnv) await resolveEnvironment(targetEnv);

  const search = getPositionalArg();
  const showAll = hasFlag('--all');
  const showExternal = hasFlag('--external');
  const prisma = createPrisma();

  try {
    // ── Find or list users ──
    let userId: string | null = null;

    if (search && /^[0-9a-f]{8}-/i.test(search)) {
      userId = search.toUpperCase();
    } else {
      const users = await prisma.users.findMany({
        where: search ? { full_name: { contains: search } } : undefined,
        select: { id: true, full_name: true, email: true, is_active: true, role: true, created_at: true, last_login_at: true },
      });

      console.log(`${BOLD}=== ALL USERS ===${RESET}\n`);
      for (const u of users) {
        const login = u.last_login_at ? u.last_login_at.toISOString().slice(0, 10) : 'never';
        console.log(`  ${u.id}  ${(u.full_name ?? '(no name)').padEnd(30)}  <${u.email}>  role=${u.role}  active=${u.is_active}  created=${u.created_at?.toISOString().slice(0, 10)}  lastLogin=${login}`);
      }

      if (!search) {
        console.log('\nProvide a user name or ID to see full inventory.');
        return;
      }
      if (users.length === 0) {
        console.log(`${RED}No user found matching "${search}".${RESET}`);
        return;
      }
      userId = users[0].id;
      console.log(`\n${DIM}Using first match: ${userId}${RESET}`);
    }

    // ── Collect counts per table ──
    console.log(`\n${BOLD}${CYAN}=== DATA INVENTORY FOR ${userId} ===${RESET}\n`);

    // Get session IDs first (needed for indirect joins)
    const sessionIds = (await prisma.sessions.findMany({
      where: { user_id: userId },
      select: { id: true },
    })).map(s => s.id);

    // Get message IDs (for tables without Prisma relation to sessions)
    const messageIds = sessionIds.length > 0
      ? (await prisma.messages.findMany({
          where: { session_id: { in: sessionIds } },
          select: { id: true },
        })).map(m => m.id)
      : [];

    const counts: Record<string, number> = {};

    // Core Chat
    counts['sessions'] = sessionIds.length;
    counts['messages'] = messageIds.length;
    counts['message_events'] = sessionIds.length > 0
      ? await prisma.message_events.count({ where: { session_id: { in: sessionIds } } })
      : 0;
    counts['approvals'] = sessionIds.length > 0
      ? await prisma.approvals.count({ where: { session_id: { in: sessionIds } } })
      : 0;
    counts['todos'] = sessionIds.length > 0
      ? await prisma.todos.count({ where: { session_id: { in: sessionIds } } })
      : 0;
    counts['chat_attachments'] = await prisma.chat_attachments.count({ where: { user_id: userId } });
    counts['session_files'] = sessionIds.length > 0
      ? await prisma.session_files.count({ where: { session_id: { in: sessionIds } } })
      : 0;

    // Files
    counts['files'] = await prisma.files.count({ where: { user_id: userId } });
    counts['file_chunks'] = await prisma.file_chunks.count({ where: { user_id: userId } });
    counts['image_embeddings'] = await prisma.image_embeddings.count({ where: { user_id: userId } });
    counts['upload_batches'] = await prisma.upload_batches.count({ where: { user_id: userId } });

    // Integrations
    counts['connections'] = await prisma.connections.count({ where: { user_id: userId } });

    // Agent
    counts['agent_executions'] = sessionIds.length > 0
      ? await prisma.agent_executions.count({ where: { session_id: { in: sessionIds } } })
      : 0;

    // Usage & Billing
    counts['token_usage'] = await prisma.token_usage.count({ where: { user_id: userId } });
    counts['usage_events'] = await prisma.usage_events.count({ where: { user_id: userId } });
    counts['usage_aggregates'] = await prisma.usage_aggregates.count({ where: { user_id: userId } });
    counts['billing_records'] = await prisma.billing_records.count({ where: { user_id: userId } });
    counts['quota_alerts'] = await prisma.quota_alerts.count({ where: { user_id: userId } });

    // User Profile
    counts['user_settings'] = await prisma.user_settings.count({ where: { user_id: userId } });
    counts['user_quotas'] = await prisma.user_quotas.count({ where: { user_id: userId } });
    counts['tool_permissions'] = await prisma.tool_permissions.count({ where: { user_id: userId } });
    counts['user_feedback'] = await prisma.user_feedback.count({ where: { user_id: userId } });

    // Audit
    counts['audit_log'] = await prisma.audit_log.count({ where: { user_id: userId } });
    counts['deletion_audit_log'] = await prisma.deletion_audit_log.count({ where: { user_id: userId } });

    // Citations & Attachments (no Prisma relation to messages — use message_id IN)
    counts['message_citations'] = messageIds.length > 0
      ? await prisma.message_citations.count({ where: { message_id: { in: messageIds } } })
      : 0;
    counts['message_file_attachments'] = messageIds.length > 0
      ? await prisma.message_file_attachments.count({ where: { message_id: { in: messageIds } } })
      : 0;
    counts['message_chat_attachments'] = messageIds.length > 0
      ? await prisma.message_chat_attachments.count({ where: { message_id: { in: messageIds } } })
      : 0;

    // Global tables
    counts['performance_metrics'] = await prisma.performance_metrics.count();
    counts['langgraph_checkpoints'] = await prisma.langgraph_checkpoints.count();
    counts['agent_usage_analytics'] = await prisma.agent_usage_analytics.count();

    // ── Display grouped ──
    const groups: Record<string, string[]> = {
      'Core Chat': ['sessions', 'messages', 'message_events', 'approvals', 'todos', 'chat_attachments', 'session_files'],
      'Files': ['files', 'file_chunks', 'image_embeddings', 'upload_batches'],
      'Integrations': ['connections'],
      'Agent': ['agent_executions'],
      'Usage & Billing': ['token_usage', 'usage_events', 'usage_aggregates', 'billing_records', 'quota_alerts'],
      'User Profile': ['user_settings', 'user_quotas', 'tool_permissions', 'user_feedback'],
      'Audit': ['audit_log', 'deletion_audit_log'],
      'Citations & Links': ['message_citations', 'message_file_attachments', 'message_chat_attachments'],
      'Global (all users)': ['performance_metrics', 'langgraph_checkpoints', 'agent_usage_analytics'],
    };

    let totalUserRows = 0;
    for (const [group, keys] of Object.entries(groups)) {
      console.log(`${BOLD}${group}:${RESET}`);
      for (const k of keys) {
        const v = counts[k] ?? 0;
        if (group !== 'Global (all users)') totalUserRows += v;
        const color = v > 0 ? YELLOW : DIM;
        const bar = v > 0 ? ' ' + '█'.repeat(Math.min(30, Math.ceil(Math.log2(v + 1)))) : '';
        console.log(`  ${k.padEnd(30)} ${color}${String(v).padStart(8)}${RESET}${DIM}${bar}${RESET}`);
      }
      console.log();
    }
    console.log(`${BOLD}TOTAL USER-SCOPED DB ROWS: ~${totalUserRows}${RESET}\n`);

    // ── Connection details ──
    const conns = await prisma.connections.findMany({
      where: { user_id: userId },
      include: { connection_scopes: true },
    });
    if (conns.length > 0) {
      console.log(`${BOLD}${CYAN}=== CONNECTIONS ===${RESET}\n`);
      for (const c of conns) {
        console.log(`  ${c.provider.padEnd(20)} status=${c.status}  scopes=${c.connection_scopes.length}  tenant=${c.microsoft_tenant_id ?? 'n/a'}`);
        for (const s of c.connection_scopes) {
          const sub = s.subscription_id ? `${GREEN}active${RESET}` : `${DIM}none${RESET}`;
          console.log(`    └─ ${s.scope_type} ${s.scope_path ?? s.scope_resource_id ?? '(root)'}  sync=${s.sync_status}  subscription=${sub}`);
        }
      }
      console.log();
    }

    // ── External services (Blob + AI Search) ──
    if (showExternal) {
      console.log(`${BOLD}${CYAN}=== AZURE BLOB STORAGE ===${RESET}\n`);
      try {
        const container = createBlobContainerClient();
        if (container) {
          let blobCount = 0;
          let totalSize = 0;
          const prefixes = [`users/${userId}/files/`, `users/${userId}/chat-attachments/`];
          for (const prefix of prefixes) {
            for await (const blob of container.listBlobsFlat({ prefix })) {
              blobCount++;
              totalSize += blob.properties.contentLength ?? 0;
            }
          }
          // Also check lowercase user ID
          const lowerUserId = userId.toLowerCase();
          if (lowerUserId !== userId) {
            for (const prefix of [`users/${lowerUserId}/files/`, `users/${lowerUserId}/chat-attachments/`]) {
              for await (const blob of container.listBlobsFlat({ prefix })) {
                blobCount++;
                totalSize += blob.properties.contentLength ?? 0;
              }
            }
          }
          console.log(`  Blobs found:  ${blobCount}`);
          console.log(`  Total size:   ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        }
      } catch (e: unknown) {
        console.log(`  ${RED}ERROR: ${e instanceof Error ? e.message : String(e)}${RESET}`);
      }
      console.log();

      console.log(`${BOLD}${CYAN}=== AZURE AI SEARCH ===${RESET}\n`);
      try {
        const searchClient = createSearchClient<ChunkDocument>();
        if (searchClient) {
          // Count for both cases of userId
          for (const uid of [userId, userId.toLowerCase()]) {
            const result = await searchClient.search('*', {
              filter: `userId eq '${uid}'`,
              top: 0,
              includeTotalCount: true,
            });
            if ((result.count ?? 0) > 0) {
              console.log(`  Documents for ${uid}: ${result.count}`);
              // Break down by fileStatus
              const active = await searchClient.search('*', {
                filter: `userId eq '${uid}' and (fileStatus ne 'deleting' or fileStatus eq null)`,
                top: 0,
                includeTotalCount: true,
              });
              const deleting = await searchClient.search('*', {
                filter: `userId eq '${uid}' and fileStatus eq 'deleting'`,
                top: 0,
                includeTotalCount: true,
              });
              console.log(`    Active:   ${active.count ?? 0}`);
              console.log(`    Deleting: ${deleting.count ?? 0}`);
            }
          }
        }
      } catch (e: unknown) {
        console.log(`  ${RED}ERROR: ${e instanceof Error ? e.message : String(e)}${RESET}`);
      }
      console.log();
    } else {
      console.log(`${DIM}Use --external to include Blob Storage and AI Search counts.${RESET}\n`);
    }

    // ── All users summary ──
    if (showAll) {
      console.log(`${BOLD}${CYAN}=== ALL USERS SUMMARY ===${RESET}\n`);
      const allUsers = await prisma.users.findMany({
        select: { id: true, full_name: true, email: true, is_active: true },
      });
      for (const u of allUsers) {
        const uSessions = await prisma.sessions.count({ where: { user_id: u.id } });
        const uFiles = await prisma.files.count({ where: { user_id: u.id } });
        const uConns = await prisma.connections.count({ where: { user_id: u.id } });
        const uTokens = await prisma.token_usage.count({ where: { user_id: u.id } });
        console.log(`  ${u.id}  ${(u.full_name ?? '').padEnd(30)}  sessions=${String(uSessions).padStart(4)}  files=${String(uFiles).padStart(4)}  connections=${uConns}  token_records=${String(uTokens).padStart(5)}  active=${u.is_active}`);
      }
      console.log();
    }

    // ── Quick commands hint ──
    console.log(`${DIM}Quick commands:${RESET}`);
    console.log(`  ${DIM}npx tsx scripts/storage/verify-storage.ts --userId ${userId}${RESET}`);
    console.log(`  ${DIM}npx tsx scripts/connectors/diagnose-sync.ts --userId ${userId} --health${RESET}`);
    console.log(`  ${DIM}npx tsx scripts/database/purge-user.ts --userId ${userId} --dry-run${RESET}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
