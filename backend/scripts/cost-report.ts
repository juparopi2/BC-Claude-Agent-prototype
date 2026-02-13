/**
 * Platform Financial Report
 *
 * Comprehensive BI report showing platform-wide costs, usage distribution,
 * and financial metrics across all users, time periods, and cost categories.
 *
 * Usage:
 *   npx tsx scripts/cost-report.ts                          # Last 30 days, all users
 *   npx tsx scripts/cost-report.ts --days 90                # Last 90 days
 *   npx tsx scripts/cost-report.ts --domain "company.com"   # Filter by email domain
 *   npx tsx scripts/cost-report.ts --verbose                # Per-user details + per-model breakdown
 */

import 'dotenv/config';
import { createPrisma } from './_shared/prisma';
import { getFlag, getNumericFlag, hasFlag } from './_shared/args';

// ============================================================================
// Types
// ============================================================================

type PrismaInstance = ReturnType<typeof createPrisma>;

interface ParsedArgs {
  days: number;
  domain: string | null;
  verbose: boolean;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  plan_tier: string | null;
}

interface PeriodStats {
  label: string;
  users: number;
  sessions: number;
  aiCost: number;
  embeddingsCost: number;
  searchCost: number;
  processingCost: number;
  storageCost: number;
}

interface UserCostRow {
  email: string;
  planTier: string;
  sessions: number;
  totalTokens: number;
  totalCost: number;
}

interface DomainRow {
  domain: string;
  users: number;
  totalCost: number;
  totalTokens: number;
}

// ============================================================================
// Model Pricing (per 1M tokens) — duplicated from analyze-session-costs.ts
// Scripts cannot use @/ path aliases.
// ============================================================================

const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.10 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-opus-4-6-20250514': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
};

const DEFAULT_PRICING = MODEL_PRICING['claude-haiku-4-5-20251001'];

/** Reference unit costs from pricing.config.ts (cannot import due to path aliases). */
const UNIT_COSTS_REF = {
  text_embedding_token: 0.02 / 1_000_000,
  image_embedding: 0.0001,
  vector_search_query: 0.00073,
  hybrid_search_query: 0.001,
  document_intelligence_page: 0.01,
  document_intelligence_ocr_page: 0.015,
  docx_processing: 0.001,
  storage_per_byte: 0.018 / 1_073_741_824,
  // Monthly infrastructure estimates
  azure_sql_monthly: 379.60,
  azure_redis_monthly: 11.68,
};

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(6)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.substring(0, 2);
  return `${visible}***@${domain}`;
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function getPricing(model: string | null) {
  if (!model) return DEFAULT_PRICING;
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

function calculateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0
): number {
  const pricing = getPricing(model);
  return (
    (inputTokens * pricing.input) / 1_000_000 +
    (outputTokens * pricing.output) / 1_000_000 +
    (cacheWriteTokens * pricing.cacheWrite) / 1_000_000 +
    (cacheReadTokens * pricing.cacheRead) / 1_000_000
  );
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Platform Financial Report

Usage:
  npx tsx scripts/cost-report.ts                          # Last 30 days
  npx tsx scripts/cost-report.ts --days 90                # Last 90 days
  npx tsx scripts/cost-report.ts --domain "company.com"   # Filter by email domain
  npx tsx scripts/cost-report.ts --verbose                # Per-user + per-model details

Options:
  --days <N>           Report period in days (default: 30)
  --domain <domain>    Filter by email domain (e.g. "company.com")
  --verbose, -v        Show top 50 users + per-model AI cost breakdown
  --help, -h           Show this help
`);
    process.exit(0);
  }

  return {
    days: getNumericFlag('--days', 30),
    domain: getFlag('--domain'),
    verbose: hasFlag('--verbose') || hasFlag('-v'),
  };
}

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchUsers(prisma: PrismaInstance, domain: string | null): Promise<UserRow[]> {
  const allUsers = await prisma.users.findMany({
    where: { is_active: true },
    select: {
      id: true,
      email: true,
      full_name: true,
      user_quotas: { select: { plan_tier: true } },
    },
  });

  const mapped = allUsers.map((u) => ({
    id: u.id.toUpperCase(),
    email: u.email,
    full_name: u.full_name,
    plan_tier: u.user_quotas?.plan_tier ?? 'free',
  }));

  if (!domain) return mapped;
  return mapped.filter((u) => u.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
}

/** Sum usage_events cost by category for a set of users within a date range. */
async function sumUsageEventsByCategory(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date,
  until?: Date
): Promise<Record<string, number>> {
  if (userIds.length === 0) return {};

  const where: Record<string, unknown> = {
    user_id: { in: userIds },
    created_at: until ? { gte: since, lt: until } : { gte: since },
  };

  const groups = await prisma.usage_events.groupBy({
    by: ['category'],
    where,
    _sum: { cost: true },
  });

  const result: Record<string, number> = {};
  for (const g of groups) {
    result[g.category] = Number(g._sum.cost ?? 0);
  }
  return result;
}

/** Fallback: compute AI cost from messages table when usage_events has no AI data. */
async function computeAICostFromMessages(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date
): Promise<{ totalCost: number; inputTokens: number; outputTokens: number; llmCalls: number }> {
  if (userIds.length === 0) return { totalCost: 0, inputTokens: 0, outputTokens: 0, llmCalls: 0 };

  const messages = await prisma.messages.findMany({
    where: {
      role: 'assistant',
      created_at: { gte: since },
      sessions: { user_id: { in: userIds } },
      OR: [
        { input_tokens: { not: null } },
        { output_tokens: { not: null } },
      ],
    },
    select: { model: true, input_tokens: true, output_tokens: true, id: true },
  });

  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let llmCalls = 0;

  // Batch fetch token_usage for cache data
  const messageIds = messages.map((m) => m.id);
  const tokenUsages = messageIds.length > 0
    ? await prisma.token_usage.findMany({
        where: { message_id: { in: messageIds } },
        select: { message_id: true, cache_creation_input_tokens: true, cache_read_input_tokens: true },
      })
    : [];
  const cacheMap = new Map(tokenUsages.map((t) => [t.message_id, t]));

  for (const msg of messages) {
    const input = msg.input_tokens ?? 0;
    const output = msg.output_tokens ?? 0;
    if (input === 0 && output === 0) continue;

    const cache = cacheMap.get(msg.id);
    const cw = cache?.cache_creation_input_tokens ?? 0;
    const cr = cache?.cache_read_input_tokens ?? 0;

    totalCost += calculateCost(msg.model, input, output, cw, cr);
    inputTokens += input;
    outputTokens += output;
    llmCalls++;
  }

  return { totalCost, inputTokens, outputTokens, llmCalls };
}

/** Get cache metrics from token_usage table. */
async function getCacheMetrics(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date
): Promise<{ cacheWriteTokens: number; cacheReadTokens: number }> {
  if (userIds.length === 0) return { cacheWriteTokens: 0, cacheReadTokens: 0 };

  const agg = await prisma.token_usage.aggregate({
    where: {
      user_id: { in: userIds },
      created_at: { gte: since },
    },
    _sum: {
      cache_creation_input_tokens: true,
      cache_read_input_tokens: true,
    },
  });

  return {
    cacheWriteTokens: agg._sum.cache_creation_input_tokens ?? 0,
    cacheReadTokens: agg._sum.cache_read_input_tokens ?? 0,
  };
}

/** Count sessions for a set of users in a date range. */
async function countSessions(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date,
  until?: Date
): Promise<number> {
  if (userIds.length === 0) return 0;
  return prisma.sessions.count({
    where: {
      user_id: { in: userIds },
      created_at: until ? { gte: since, lt: until } : { gte: since },
    },
  });
}

/** Count distinct active users (those who had sessions) in a date range. */
async function countActiveUsers(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date,
  until?: Date
): Promise<number> {
  if (userIds.length === 0) return 0;

  const groups = await prisma.sessions.groupBy({
    by: ['user_id'],
    where: {
      user_id: { in: userIds },
      created_at: until ? { gte: since, lt: until } : { gte: since },
    },
  });

  return groups.length;
}

/** Count messages for a set of users in a date range. */
async function countMessages(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date
): Promise<number> {
  if (userIds.length === 0) return 0;
  return prisma.messages.count({
    where: {
      created_at: { gte: since },
      sessions: { user_id: { in: userIds } },
    },
  });
}

/** Get per-user cost data from messages table. */
async function getUserCostBreakdown(
  prisma: PrismaInstance,
  users: UserRow[],
  since: Date,
  limit: number
): Promise<UserCostRow[]> {
  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Get per-session-user token sums
  const sessions = await prisma.sessions.findMany({
    where: { user_id: { in: userIds }, created_at: { gte: since } },
    select: { id: true, user_id: true },
  });

  const sessionsByUser = new Map<string, string[]>();
  for (const s of sessions) {
    const uid = s.user_id.toUpperCase();
    const list = sessionsByUser.get(uid) ?? [];
    list.push(s.id);
    sessionsByUser.set(uid, list);
  }

  const results: UserCostRow[] = [];

  for (const user of users) {
    const sessionIds = sessionsByUser.get(user.id) ?? [];
    if (sessionIds.length === 0) continue;

    const agg = await prisma.messages.aggregate({
      where: {
        session_id: { in: sessionIds },
        role: 'assistant',
        created_at: { gte: since },
      },
      _sum: { input_tokens: true, output_tokens: true },
      _count: true,
    });

    const inputTokens = agg._sum.input_tokens ?? 0;
    const outputTokens = agg._sum.output_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens;

    if (totalTokens === 0) continue;

    const cost = calculateCost(null, inputTokens, outputTokens);

    results.push({
      email: user.email,
      planTier: user.plan_tier ?? 'free',
      sessions: sessionIds.length,
      totalTokens,
      totalCost: cost,
    });
  }

  results.sort((a, b) => b.totalCost - a.totalCost);
  return results.slice(0, limit);
}

/** Get embedding/processing details from file_chunks and files. */
async function getEmbeddingDetails(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date
): Promise<{
  totalChunks: number;
  totalChunkTokens: number;
  filesProcessed: number;
  filesEmbedded: number;
  avgChunksPerFile: number;
}> {
  if (userIds.length === 0) {
    return { totalChunks: 0, totalChunkTokens: 0, filesProcessed: 0, filesEmbedded: 0, avgChunksPerFile: 0 };
  }

  const chunkAgg = await prisma.file_chunks.aggregate({
    where: {
      user_id: { in: userIds },
      created_at: { not: null, gte: since },
    },
    _sum: { chunk_tokens: true },
    _count: true,
  });

  const totalChunks = chunkAgg._count;
  const totalChunkTokens = chunkAgg._sum.chunk_tokens ?? 0;

  const filesProcessed = await prisma.files.count({
    where: {
      user_id: { in: userIds },
      processing_status: 'completed',
      created_at: { gte: since },
    },
  });

  const filesEmbedded = await prisma.files.count({
    where: {
      user_id: { in: userIds },
      embedding_status: 'completed',
      created_at: { gte: since },
    },
  });

  const avgChunksPerFile = filesEmbedded > 0 ? totalChunks / filesEmbedded : 0;

  return { totalChunks, totalChunkTokens, filesProcessed, filesEmbedded, avgChunksPerFile };
}

/** Get per-model AI cost breakdown (verbose mode). */
async function getPerModelBreakdown(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date
): Promise<Array<{ model: string; inputTokens: number; outputTokens: number; cost: number; calls: number }>> {
  if (userIds.length === 0) return [];

  const messages = await prisma.messages.groupBy({
    by: ['model'],
    where: {
      role: 'assistant',
      created_at: { gte: since },
      sessions: { user_id: { in: userIds } },
      model: { not: null },
    },
    _sum: { input_tokens: true, output_tokens: true },
    _count: true,
  });

  return messages
    .filter((m) => m.model !== null)
    .map((m) => {
      const input = m._sum.input_tokens ?? 0;
      const output = m._sum.output_tokens ?? 0;
      return {
        model: m.model!,
        inputTokens: input,
        outputTokens: output,
        cost: calculateCost(m.model!, input, output),
        calls: m._count,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

// ============================================================================
// Time Period Helpers
// ============================================================================

function getTimePeriods(): Array<{ label: string; since: Date; until?: Date }> {
  const now = new Date();

  // Today (UTC)
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // This Week (Monday 00:00 UTC)
  const dayOfWeek = now.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));

  // This Month (1st of month)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // This Year (Jan 1st)
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  return [
    { label: 'Today', since: todayStart },
    { label: 'This Week', since: weekStart },
    { label: 'This Month', since: monthStart },
    { label: 'This Year', since: yearStart },
  ];
}

// ============================================================================
// Display: Section 1 — Platform Overview
// ============================================================================

async function displayPlatformOverview(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date,
  days: number,
  domain: string | null,
  activeUsers: number,
  totalSessions: number,
  totalMessages: number,
  llmCalls: number
): Promise<void> {
  const now = new Date();
  const sinceStr = since.toISOString().substring(0, 10);
  const nowStr = now.toISOString().substring(0, 10);

  console.log();
  console.log('='.repeat(78));
  console.log('  PLATFORM FINANCIAL REPORT');
  console.log('='.repeat(78));
  console.log(`  Period:        ${sinceStr} to ${nowStr} (${days} days)`);
  if (domain) {
    console.log(`  Domain filter: @${domain}`);
  }
  console.log(`  Active users:  ${activeUsers}`);
  console.log(`  Sessions:      ${totalSessions.toLocaleString()}`);
  console.log(`  Messages:      ${totalMessages.toLocaleString()}`);
  console.log(`  LLM calls:     ${llmCalls.toLocaleString()}`);
  console.log('='.repeat(78));
  console.log();
}

// ============================================================================
// Display: Section 2 — Temporal Breakdown
// ============================================================================

async function displayTemporalBreakdown(
  prisma: PrismaInstance,
  userIds: string[]
): Promise<void> {
  const periods = getTimePeriods();

  console.log('--- Temporal Breakdown ---');
  console.log();

  // Header
  const hdr = [
    padRight('Period', 14),
    padLeft('Users', 6),
    padLeft('Sessions', 9),
    padLeft('AI', 10),
    padLeft('Embed', 10),
    padLeft('Search', 10),
    padLeft('Process', 10),
    padLeft('Storage', 10),
    padLeft('TOTAL', 10),
  ].join('');
  console.log(`  ${hdr}`);
  console.log(`  ${'-'.repeat(hdr.length)}`);

  for (const period of periods) {
    const [users, sessions, costs] = await Promise.all([
      countActiveUsers(prisma, userIds, period.since, period.until),
      countSessions(prisma, userIds, period.since, period.until),
      sumUsageEventsByCategory(prisma, userIds, period.since, period.until),
    ]);

    const ai = costs['ai'] ?? 0;
    const embed = costs['embeddings'] ?? 0;
    const search = costs['search'] ?? 0;
    const process_ = costs['processing'] ?? 0;
    const storage = costs['storage'] ?? 0;
    const total = ai + embed + search + process_ + storage;

    const row = [
      padRight(period.label, 14),
      padLeft(String(users), 6),
      padLeft(String(sessions), 9),
      padLeft(formatCost(ai), 10),
      padLeft(formatCost(embed), 10),
      padLeft(formatCost(search), 10),
      padLeft(formatCost(process_), 10),
      padLeft(formatCost(storage), 10),
      padLeft(formatCost(total), 10),
    ].join('');
    console.log(`  ${row}`);
  }

  console.log();
}

// ============================================================================
// Display: Section 3 — Cost by Category
// ============================================================================

async function displayCostByCategory(
  prisma: PrismaInstance,
  userIds: string[],
  since: Date,
  days: number,
  verbose: boolean
): Promise<{ usageFallback: boolean }> {
  const costs = await sumUsageEventsByCategory(prisma, userIds, since);

  let aiCost = costs['ai'] ?? 0;
  let usageFallback = false;
  let fallbackData: { inputTokens: number; outputTokens: number; llmCalls: number } | null = null;

  // Fallback: if usage_events has no AI cost, compute from messages
  if (aiCost === 0) {
    const fb = await computeAICostFromMessages(prisma, userIds, since);
    if (fb.totalCost > 0) {
      aiCost = fb.totalCost;
      usageFallback = true;
      fallbackData = fb;
    }
  }

  const embeddingsCost = costs['embeddings'] ?? 0;
  const searchCost = costs['search'] ?? 0;
  const processingCost = costs['processing'] ?? 0;
  const storageCost = costs['storage'] ?? 0;

  const cache = await getCacheMetrics(prisma, userIds, since);

  console.log('--- Cost by Category ---');
  console.log();

  // AI (Claude)
  console.log('  AI (Claude):');
  if (usageFallback && fallbackData) {
    console.log(`    (computed from messages table — usage_events had no AI data)`);
    console.log(`    Input tokens:   ${formatTokens(fallbackData.inputTokens)}`);
    console.log(`    Output tokens:  ${formatTokens(fallbackData.outputTokens)}`);
    console.log(`    LLM calls:      ${fallbackData.llmCalls.toLocaleString()}`);
  }
  if (cache.cacheWriteTokens > 0 || cache.cacheReadTokens > 0) {
    console.log(`    Cache write:    ${formatTokens(cache.cacheWriteTokens)}`);
    console.log(`    Cache read:     ${formatTokens(cache.cacheReadTokens)}`);
  }
  console.log(`    Subtotal:       ${formatCost(aiCost)}`);
  console.log();

  // Verbose: per-model breakdown
  if (verbose) {
    const modelBreakdown = await getPerModelBreakdown(prisma, userIds, since);
    if (modelBreakdown.length > 0) {
      console.log('    Per-Model Breakdown:');
      for (const m of modelBreakdown) {
        console.log(`      ${padRight(m.model, 36)} ${padLeft(formatTokens(m.inputTokens), 8)} in  ${padLeft(formatTokens(m.outputTokens), 8)} out  ${padLeft(String(m.calls), 5)} calls  ${padLeft(formatCost(m.cost), 10)}`);
      }
      console.log();
    }
  }

  // Embeddings
  console.log(`  Embeddings:       ${formatCost(embeddingsCost)}`);

  // Search
  console.log(`  Search:           ${formatCost(searchCost)}`);

  // Processing
  console.log(`  Processing:       ${formatCost(processingCost)}`);

  // Storage
  console.log(`  Storage:          ${formatCost(storageCost)}`);
  console.log();

  // Totals
  const variableTotal = aiCost + embeddingsCost + searchCost + processingCost + storageCost;
  const infraFraction = days / 30;
  const infraEstimate = (UNIT_COSTS_REF.azure_sql_monthly + UNIT_COSTS_REF.azure_redis_monthly) * infraFraction;

  console.log(`  Infrastructure estimate (${days}d):`);
  console.log(`    Azure SQL:      ${formatCost(UNIT_COSTS_REF.azure_sql_monthly * infraFraction)} (~$${UNIT_COSTS_REF.azure_sql_monthly.toFixed(2)}/mo)`);
  console.log(`    Azure Redis:    ${formatCost(UNIT_COSTS_REF.azure_redis_monthly * infraFraction)} (~$${UNIT_COSTS_REF.azure_redis_monthly.toFixed(2)}/mo)`);
  console.log();

  console.log(`  ----------------------------------------`);
  console.log(`  Variable costs:   ${formatCost(variableTotal)}`);
  console.log(`  + Infrastructure: ${formatCost(infraEstimate)}`);
  console.log(`  GRAND TOTAL:      ${formatCost(variableTotal + infraEstimate)}`);
  console.log();

  return { usageFallback };
}

// ============================================================================
// Display: Section 4 — Top Users by Cost
// ============================================================================

async function displayTopUsers(
  prisma: PrismaInstance,
  users: UserRow[],
  since: Date,
  verbose: boolean
): Promise<void> {
  const limit = verbose ? 50 : 10;

  console.log(`--- Top ${limit} Users by Cost ---`);
  console.log();

  const topUsers = await getUserCostBreakdown(prisma, users, since, limit);

  if (topUsers.length === 0) {
    console.log('  (no user cost data found)');
    console.log();
    return;
  }

  const hdr = [
    padRight('#', 4),
    padRight('Email', 28),
    padLeft('Plan', 12),
    padLeft('Sessions', 9),
    padLeft('Tokens', 10),
    padLeft('Cost', 10),
  ].join('');
  console.log(`  ${hdr}`);
  console.log(`  ${'-'.repeat(hdr.length)}`);

  for (let i = 0; i < topUsers.length; i++) {
    const u = topUsers[i];
    const row = [
      padRight(String(i + 1), 4),
      padRight(maskEmail(u.email), 28),
      padLeft(u.planTier, 12),
      padLeft(String(u.sessions), 9),
      padLeft(formatTokens(u.totalTokens), 10),
      padLeft(formatCost(u.totalCost), 10),
    ].join('');
    console.log(`  ${row}`);
  }

  console.log();
}

// ============================================================================
// Display: Section 5 — Cost by Email Domain
// ============================================================================

async function displayCostByDomain(
  prisma: PrismaInstance,
  users: UserRow[],
  since: Date,
  domainFilter: string | null
): Promise<void> {
  if (domainFilter) {
    // Skip: domain filter is active, this section would be redundant
    return;
  }

  console.log('--- Cost by Email Domain ---');
  console.log();

  // Group users by domain
  const domainUsers = new Map<string, UserRow[]>();
  for (const u of users) {
    const domain = u.email.split('@')[1]?.toLowerCase() ?? 'unknown';
    const list = domainUsers.get(domain) ?? [];
    list.push(u);
    domainUsers.set(domain, list);
  }

  const domainRows: DomainRow[] = [];

  for (const [domain, dUsers] of domainUsers) {
    const userIds = dUsers.map((u) => u.id);
    const sessionsByUser = await prisma.sessions.findMany({
      where: { user_id: { in: userIds }, created_at: { gte: since } },
      select: { id: true },
    });
    const sessionIds = sessionsByUser.map((s) => s.id);

    if (sessionIds.length === 0) continue;

    const agg = await prisma.messages.aggregate({
      where: {
        session_id: { in: sessionIds },
        role: 'assistant',
        created_at: { gte: since },
      },
      _sum: { input_tokens: true, output_tokens: true },
    });

    const inputTokens = agg._sum.input_tokens ?? 0;
    const outputTokens = agg._sum.output_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens;
    const totalCost = calculateCost(null, inputTokens, outputTokens);

    if (totalTokens === 0) continue;

    domainRows.push({
      domain,
      users: dUsers.length,
      totalCost,
      totalTokens,
    });
  }

  if (domainRows.length === 0) {
    console.log('  (no domain cost data found)');
    console.log();
    return;
  }

  domainRows.sort((a, b) => b.totalCost - a.totalCost);

  const hdr = [
    padRight('Domain', 30),
    padLeft('Users', 6),
    padLeft('Total Cost', 12),
    padLeft('Avg/User', 10),
    padLeft('Tokens', 10),
  ].join('');
  console.log(`  ${hdr}`);
  console.log(`  ${'-'.repeat(hdr.length)}`);

  for (const d of domainRows) {
    const avgPerUser = d.users > 0 ? d.totalCost / d.users : 0;
    const row = [
      padRight(d.domain, 30),
      padLeft(String(d.users), 6),
      padLeft(formatCost(d.totalCost), 12),
      padLeft(formatCost(avgPerUser), 10),
      padLeft(formatTokens(d.totalTokens), 10),
    ].join('');
    console.log(`  ${row}`);
  }

  console.log();
}

// ============================================================================
// Display: Section 6 — Embedding & Processing Details
// ============================================================================

async function displayEmbeddingDetails(
  prisma: PrismaInstance,
  users: UserRow[],
  userIds: string[],
  since: Date,
  domainFilter: string | null
): Promise<void> {
  console.log('--- Embedding & Processing Details ---');
  console.log();

  const details = await getEmbeddingDetails(prisma, userIds, since);

  console.log(`  File chunks:        ${details.totalChunks.toLocaleString()}`);
  console.log(`  Chunk tokens:       ${formatTokens(details.totalChunkTokens)}`);
  console.log(`  Files processed:    ${details.filesProcessed.toLocaleString()}`);
  console.log(`  Files embedded:     ${details.filesEmbedded.toLocaleString()}`);
  console.log(`  Avg chunks/file:    ${details.avgChunksPerFile.toFixed(1)}`);

  // Estimated embedding cost from chunk tokens
  const estimatedEmbCost = details.totalChunkTokens * UNIT_COSTS_REF.text_embedding_token;
  if (estimatedEmbCost > 0) {
    console.log(`  Est. embedding cost: ${formatCost(estimatedEmbCost)} (from chunk tokens * text_embedding rate)`);
  }

  console.log();

  // Per-domain embedding breakdown (unless domain-filtered)
  if (!domainFilter) {
    const domainUsers = new Map<string, string[]>();
    for (const u of users) {
      const domain = u.email.split('@')[1]?.toLowerCase() ?? 'unknown';
      const list = domainUsers.get(domain) ?? [];
      list.push(u.id);
      domainUsers.set(domain, list);
    }

    const domainEmbeddings: Array<{ domain: string; chunks: number; tokens: number }> = [];

    for (const [domain, dUserIds] of domainUsers) {
      const agg = await prisma.file_chunks.aggregate({
        where: {
          user_id: { in: dUserIds },
          created_at: { not: null, gte: since },
        },
        _sum: { chunk_tokens: true },
        _count: true,
      });

      if (agg._count === 0) continue;

      domainEmbeddings.push({
        domain,
        chunks: agg._count,
        tokens: agg._sum.chunk_tokens ?? 0,
      });
    }

    if (domainEmbeddings.length > 0) {
      domainEmbeddings.sort((a, b) => b.tokens - a.tokens);

      console.log('  Per-Domain Embedding Breakdown:');
      const hdr = `    ${padRight('Domain', 30)}${padLeft('Chunks', 8)}${padLeft('Tokens', 10)}${padLeft('Est. Cost', 12)}`;
      console.log(hdr);
      console.log(`    ${'-'.repeat(60)}`);

      for (const d of domainEmbeddings) {
        const estCost = d.tokens * UNIT_COSTS_REF.text_embedding_token;
        const row = `    ${padRight(d.domain, 30)}${padLeft(String(d.chunks), 8)}${padLeft(formatTokens(d.tokens), 10)}${padLeft(formatCost(estCost), 12)}`;
        console.log(row);
      }

      console.log();
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();
  const prisma = createPrisma();

  try {
    const since = new Date();
    since.setDate(since.getDate() - args.days);

    // 1. Fetch users (optionally filtered by domain)
    const users = await fetchUsers(prisma, args.domain);
    const userIds = users.map((u) => u.id);

    if (users.length === 0) {
      console.error(`\nNo active users found${args.domain ? ` for domain @${args.domain}` : ''}.\n`);
      process.exit(1);
    }

    // 2. Platform overview metrics
    const [activeUsers, totalSessions, totalMessages, aiFallback] = await Promise.all([
      countActiveUsers(prisma, userIds, since),
      countSessions(prisma, userIds, since),
      countMessages(prisma, userIds, since),
      computeAICostFromMessages(prisma, userIds, since),
    ]);

    // Section 1: Platform Overview
    await displayPlatformOverview(
      prisma, userIds, since, args.days, args.domain,
      activeUsers, totalSessions, totalMessages, aiFallback.llmCalls
    );

    // Section 2: Temporal Breakdown
    await displayTemporalBreakdown(prisma, userIds);

    // Section 3: Cost by Category
    await displayCostByCategory(prisma, userIds, since, args.days, args.verbose);

    // Section 4: Top Users by Cost
    await displayTopUsers(prisma, users, since, args.verbose);

    // Section 5: Cost by Email Domain
    await displayCostByDomain(prisma, users, since, args.domain);

    // Section 6: Embedding & Processing Details
    await displayEmbeddingDetails(prisma, users, userIds, since, args.domain);

    console.log('Report complete.');
    console.log();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
