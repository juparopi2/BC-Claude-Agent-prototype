/**
 * Cost Verification Script
 *
 * Cross-references internal cost data (usage_events, messages, token_usage)
 * against Azure Cost Management and Anthropic Console data to verify accuracy.
 *
 * Generates a reconciliation report showing:
 * 1. Internal DB totals (from our tables)
 * 2. Expected cost using model-specific pricing
 * 3. Azure resource costs via `az cost management` CLI
 * 4. Discrepancy analysis by date range
 *
 * Usage:
 *   npx tsx scripts/costs/verify-costs.ts                       # February + March (default)
 *   npx tsx scripts/costs/verify-costs.ts --from 2026-02-01 --to 2026-03-07
 *   npx tsx scripts/costs/verify-costs.ts --daily               # Daily breakdown
 *   npx tsx scripts/costs/verify-costs.ts --az                  # Include Azure CLI cost query
 *   npx tsx scripts/costs/verify-costs.ts --verbose             # Per-model + per-agent detail
 *
 * Prerequisites:
 *   - DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD in .env
 *   - `az login` (only if --az flag is used)
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { getFlag, hasFlag } from '../_shared/args';

// ============================================================================
// Model Pricing — imported from shared module
// ============================================================================

import { calculateCost as calculateCostForModel } from '../_shared/pricing';

// ============================================================================
// Formatting
// ============================================================================

function fmt$(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function pad(s: string, len: number, right = false): string {
  return right
    ? (s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length))
    : (s.length >= len ? s : ' '.repeat(len - s.length) + s);
}

// ============================================================================
// Types
// ============================================================================

type PrismaInstance = ReturnType<typeof createPrisma>;

interface DateRange {
  from: Date;
  to: Date;
}

interface DayBucket {
  date: string; // YYYY-MM-DD
  // From messages table (model-specific pricing)
  msg_inputTokens: number;
  msg_outputTokens: number;
  msg_cost: number;
  msg_calls: number;
  // From token_usage table (includes cache data)
  tu_inputTokens: number;
  tu_outputTokens: number;
  tu_cacheWriteTokens: number;
  tu_cacheReadTokens: number;
  tu_cost: number;
  tu_calls: number;
  // From usage_events table (pre-calculated cost)
  ue_aiCost: number;
  ue_embeddingsCost: number;
  ue_searchCost: number;
  ue_processingCost: number;
  ue_storageCost: number;
  ue_totalCost: number;
  ue_events: number;
}

interface ModelBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  cost: number;
  calls: number;
}

// ============================================================================
// Data Fetching
// ============================================================================

/** Get daily AI cost from messages table, computed with model-specific pricing. */
async function getMessagesCostByDay(
  prisma: PrismaInstance,
  range: DateRange
): Promise<Map<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }>> {
  const messages = await prisma.messages.findMany({
    where: {
      role: 'assistant',
      created_at: { gte: range.from, lt: range.to },
      OR: [{ input_tokens: { not: null } }, { output_tokens: { not: null } }],
    },
    select: { id: true, model: true, input_tokens: true, output_tokens: true, created_at: true },
  });

  // Batch fetch cache data from token_usage
  const messageIds = messages.map((m) => m.id);
  const tokenUsages = messageIds.length > 0
    ? await prisma.token_usage.findMany({
        where: { message_id: { in: messageIds } },
        select: { message_id: true, cache_creation_input_tokens: true, cache_read_input_tokens: true },
      })
    : [];
  const cacheMap = new Map(tokenUsages.map((t) => [t.message_id, t]));

  const result = new Map<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }>();

  for (const msg of messages) {
    const date = msg.created_at.toISOString().substring(0, 10);
    const input = msg.input_tokens ?? 0;
    const output = msg.output_tokens ?? 0;
    if (input === 0 && output === 0) continue;

    const cache = cacheMap.get(msg.id);
    const cw = cache?.cache_creation_input_tokens ?? 0;
    const cr = cache?.cache_read_input_tokens ?? 0;

    const cost = calculateCostForModel(msg.model, input, output, cw, cr);

    const existing = result.get(date) ?? { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
    existing.inputTokens += input;
    existing.outputTokens += output;
    existing.cost += cost;
    existing.calls++;
    result.set(date, existing);
  }

  return result;
}

/** Get daily token_usage data with cache breakdown. */
async function getTokenUsageByDay(
  prisma: PrismaInstance,
  range: DateRange
): Promise<Map<string, { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; cost: number; calls: number }>> {
  const records = await prisma.token_usage.findMany({
    where: { created_at: { gte: range.from, lt: range.to } },
    select: {
      model: true,
      input_tokens: true,
      output_tokens: true,
      cache_creation_input_tokens: true,
      cache_read_input_tokens: true,
      created_at: true,
    },
  });

  const result = new Map<string, { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; cost: number; calls: number }>();

  for (const r of records) {
    const date = r.created_at.toISOString().substring(0, 10);
    const cw = r.cache_creation_input_tokens ?? 0;
    const cr = r.cache_read_input_tokens ?? 0;
    const cost = calculateCostForModel(r.model, r.input_tokens, r.output_tokens, cw, cr);

    const existing = result.get(date) ?? { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, cost: 0, calls: 0 };
    existing.inputTokens += r.input_tokens;
    existing.outputTokens += r.output_tokens;
    existing.cacheWriteTokens += cw;
    existing.cacheReadTokens += cr;
    existing.cost += cost;
    existing.calls++;
    result.set(date, existing);
  }

  return result;
}

/** Get daily usage_events cost by category. */
async function getUsageEventsByDay(
  prisma: PrismaInstance,
  range: DateRange
): Promise<Map<string, { aiCost: number; embeddingsCost: number; searchCost: number; processingCost: number; storageCost: number; totalCost: number; events: number }>> {
  const events = await prisma.usage_events.findMany({
    where: { created_at: { gte: range.from, lt: range.to } },
    select: { category: true, cost: true, created_at: true },
  });

  const result = new Map<string, { aiCost: number; embeddingsCost: number; searchCost: number; processingCost: number; storageCost: number; totalCost: number; events: number }>();

  for (const e of events) {
    const date = e.created_at.toISOString().substring(0, 10);
    const cost = Number(e.cost);
    const existing = result.get(date) ?? { aiCost: 0, embeddingsCost: 0, searchCost: 0, processingCost: 0, storageCost: 0, totalCost: 0, events: 0 };

    switch (e.category) {
      case 'ai': existing.aiCost += cost; break;
      case 'embeddings': existing.embeddingsCost += cost; break;
      case 'search': existing.searchCost += cost; break;
      case 'processing': existing.processingCost += cost; break;
      case 'storage': existing.storageCost += cost; break;
    }
    existing.totalCost += cost;
    existing.events++;
    result.set(date, existing);
  }

  return result;
}

/** Get per-model breakdown for the full range. */
async function getModelBreakdown(
  prisma: PrismaInstance,
  range: DateRange
): Promise<ModelBreakdown[]> {
  const records = await prisma.token_usage.findMany({
    where: { created_at: { gte: range.from, lt: range.to } },
    select: {
      model: true,
      input_tokens: true,
      output_tokens: true,
      cache_creation_input_tokens: true,
      cache_read_input_tokens: true,
    },
  });

  const byModel = new Map<string, ModelBreakdown>();

  for (const r of records) {
    const model = r.model || '(unknown)';
    const cw = r.cache_creation_input_tokens ?? 0;
    const cr = r.cache_read_input_tokens ?? 0;
    const cost = calculateCostForModel(r.model, r.input_tokens, r.output_tokens, cw, cr);

    const existing = byModel.get(model) ?? { model, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, cost: 0, calls: 0 };
    existing.inputTokens += r.input_tokens;
    existing.outputTokens += r.output_tokens;
    existing.cacheWriteTokens += cw;
    existing.cacheReadTokens += cr;
    existing.cost += cost;
    existing.calls++;
    byModel.set(model, existing);
  }

  return [...byModel.values()].sort((a, b) => b.cost - a.cost);
}

/** Check for pricing discrepancy in usage_events AI category.
 *  usage_events uses UNIT_COSTS from pricing.config.ts which is Sonnet-only pricing.
 *  We recalculate with model-specific pricing and report the delta. */
async function checkPricingDiscrepancy(
  prisma: PrismaInstance,
  range: DateRange
): Promise<{ usageEventsCost: number; recalculatedCost: number; delta: number; deltaPercent: number }> {
  // Get AI usage_events total
  const ueAgg = await prisma.usage_events.aggregate({
    where: {
      category: 'ai',
      created_at: { gte: range.from, lt: range.to },
    },
    _sum: { cost: true },
  });
  const usageEventsCost = Number(ueAgg._sum.cost ?? 0);

  // Get model-specific recalculated cost from token_usage
  const tuRecords = await prisma.token_usage.findMany({
    where: { created_at: { gte: range.from, lt: range.to } },
    select: {
      model: true,
      input_tokens: true,
      output_tokens: true,
      cache_creation_input_tokens: true,
      cache_read_input_tokens: true,
    },
  });

  let recalculatedCost = 0;
  for (const r of tuRecords) {
    const cw = r.cache_creation_input_tokens ?? 0;
    const cr = r.cache_read_input_tokens ?? 0;
    recalculatedCost += calculateCostForModel(r.model, r.input_tokens, r.output_tokens, cw, cr);
  }

  const delta = usageEventsCost - recalculatedCost;
  const deltaPercent = recalculatedCost > 0 ? (delta / recalculatedCost) * 100 : 0;

  return { usageEventsCost, recalculatedCost, delta, deltaPercent };
}

/** Find the earliest usage_event date to identify when tracking started. */
async function findTrackingStartDate(prisma: PrismaInstance): Promise<Date | null> {
  const earliest = await prisma.usage_events.findFirst({
    where: { category: 'ai' },
    orderBy: { created_at: 'asc' },
    select: { created_at: true },
  });
  return earliest?.created_at ?? null;
}

/** Find earliest token_usage date. */
async function findTokenUsageStartDate(prisma: PrismaInstance): Promise<Date | null> {
  const earliest = await prisma.token_usage.findFirst({
    orderBy: { created_at: 'asc' },
    select: { created_at: true },
  });
  return earliest?.created_at ?? null;
}

// ============================================================================
// Display
// ============================================================================

function displayHeader(range: DateRange): void {
  console.log();
  console.log('='.repeat(80));
  console.log('  COST VERIFICATION REPORT');
  console.log('='.repeat(80));
  console.log(`  Period:  ${range.from.toISOString().substring(0, 10)} to ${range.to.toISOString().substring(0, 10)}`);
  console.log('='.repeat(80));
  console.log();
}

function displayDataSourceTimeline(
  tokenUsageStart: Date | null,
  usageEventsStart: Date | null
): void {
  console.log('--- Data Source Timeline ---');
  console.log();
  console.log(`  token_usage first record:  ${tokenUsageStart ? tokenUsageStart.toISOString().substring(0, 10) : '(none)'}`);
  console.log(`  usage_events first AI:     ${usageEventsStart ? usageEventsStart.toISOString().substring(0, 10) : '(none)'}`);
  console.log();

  if (tokenUsageStart && usageEventsStart) {
    const diffDays = Math.round((usageEventsStart.getTime() - tokenUsageStart.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      console.log(`  NOTE: usage_events started ${diffDays} days AFTER token_usage.`);
      console.log(`  Data before ${usageEventsStart.toISOString().substring(0, 10)} has token data but NO usage_events.`);
      console.log(`  This is expected if usage tracking was added later.`);
      console.log();
    }
  }
}

function displayPricingDiscrepancy(disc: { usageEventsCost: number; recalculatedCost: number; delta: number; deltaPercent: number }): void {
  console.log('--- Pricing Accuracy Check ---');
  console.log();
  console.log(`  usage_events AI cost:     ${fmt$(disc.usageEventsCost)}`);
  console.log(`  Recalculated (per-model): ${fmt$(disc.recalculatedCost)}`);
  console.log(`  Delta:                    ${fmt$(Math.abs(disc.delta))} (${disc.delta > 0 ? 'OVERCHARGED' : disc.delta < 0 ? 'UNDERCHARGED' : 'EXACT'})`);
  console.log(`  Delta %:                  ${Math.abs(disc.deltaPercent).toFixed(1)}%`);
  console.log();

  if (Math.abs(disc.deltaPercent) > 5) {
    console.log('  WARNING: Significant pricing discrepancy detected!');
    console.log('  This is likely because pricing.config.ts uses a fixed model price');
    console.log('  (Sonnet $3/$15 per 1M) instead of model-specific pricing.');
    console.log('  Haiku calls ($1/$5) are overcharged 3x, Opus ($15/$75) undercharged 5x.');
    console.log();
  } else {
    console.log('  OK: Pricing is within acceptable tolerance (<5%).');
    console.log();
  }
}

function displayModelBreakdown(models: ModelBreakdown[]): void {
  console.log('--- Per-Model Breakdown ---');
  console.log();

  if (models.length === 0) {
    console.log('  (no model data)');
    console.log();
    return;
  }

  const hdr = `  ${pad('Model', 38, true)}${pad('Input', 10)}${pad('Output', 10)}${pad('CacheW', 10)}${pad('CacheR', 10)}${pad('Calls', 7)}${pad('Cost', 12)}`;
  console.log(hdr);
  console.log(`  ${'-'.repeat(hdr.length - 2)}`);

  let totalCost = 0;
  for (const m of models) {
    const row = `  ${pad(m.model, 38, true)}${pad(fmtTok(m.inputTokens), 10)}${pad(fmtTok(m.outputTokens), 10)}${pad(fmtTok(m.cacheWriteTokens), 10)}${pad(fmtTok(m.cacheReadTokens), 10)}${pad(String(m.calls), 7)}${pad(fmt$(m.cost), 12)}`;
    console.log(row);
    totalCost += m.cost;
  }

  console.log(`  ${'-'.repeat(hdr.length - 2)}`);
  console.log(`  ${pad('TOTAL', 38, true)}${pad('', 10)}${pad('', 10)}${pad('', 10)}${pad('', 10)}${pad('', 7)}${pad(fmt$(totalCost), 12)}`);
  console.log();
}

function displayDailySummary(buckets: DayBucket[]): void {
  console.log('--- Daily Reconciliation ---');
  console.log();

  const hdr = `  ${pad('Date', 12, true)}${pad('TU Cost', 10)}${pad('UE AI$', 10)}${pad('Delta', 10)}${pad('TU Calls', 9)}${pad('UE Evts', 8)}${pad('UE Other$', 10)}`;
  console.log(hdr);
  console.log(`  ${'-'.repeat(hdr.length - 2)}`);

  for (const b of buckets) {
    const delta = b.ue_aiCost - b.tu_cost;
    const otherCost = b.ue_embeddingsCost + b.ue_searchCost + b.ue_processingCost + b.ue_storageCost;
    const deltaStr = delta === 0 ? '-' : `${delta > 0 ? '+' : ''}${fmt$(delta)}`;

    const row = `  ${pad(b.date, 12, true)}${pad(fmt$(b.tu_cost), 10)}${pad(fmt$(b.ue_aiCost), 10)}${pad(deltaStr, 10)}${pad(String(b.tu_calls), 9)}${pad(String(b.ue_events), 8)}${pad(fmt$(otherCost), 10)}`;
    console.log(row);
  }

  console.log();
}

function displayCrossSourceSummary(buckets: DayBucket[]): void {
  console.log('--- Cross-Source Summary ---');
  console.log();

  let totalMsgCost = 0, totalTuCost = 0, totalUeAiCost = 0;
  let totalUeOther = 0;
  let daysWithTokenUsage = 0, daysWithUsageEvents = 0;

  for (const b of buckets) {
    totalMsgCost += b.msg_cost;
    totalTuCost += b.tu_cost;
    totalUeAiCost += b.ue_aiCost;
    totalUeOther += b.ue_embeddingsCost + b.ue_searchCost + b.ue_processingCost + b.ue_storageCost;
    if (b.tu_calls > 0) daysWithTokenUsage++;
    if (b.ue_events > 0) daysWithUsageEvents++;
  }

  console.log(`  Source: messages (model-specific):  ${fmt$(totalMsgCost)}`);
  console.log(`  Source: token_usage (with cache):   ${fmt$(totalTuCost)}`);
  console.log(`  Source: usage_events (AI only):     ${fmt$(totalUeAiCost)}`);
  console.log(`  Source: usage_events (non-AI):      ${fmt$(totalUeOther)}`);
  console.log();
  console.log(`  Days with token_usage data:  ${daysWithTokenUsage}/${buckets.length}`);
  console.log(`  Days with usage_events data: ${daysWithUsageEvents}/${buckets.length}`);
  console.log();

  // Check consistency
  if (daysWithTokenUsage > daysWithUsageEvents + 3) {
    console.log(`  NOTE: token_usage has data for ${daysWithTokenUsage - daysWithUsageEvents} more days than usage_events.`);
    console.log(`  This suggests usage_events tracking was enabled AFTER token_usage tracking.`);
    console.log(`  Days with token_usage but NO usage_events may have missing cost records.`);
    console.log();
  }

  // Identify period where both sources agree
  const bothPresent = buckets.filter((b) => b.tu_calls > 0 && b.ue_events > 0);
  if (bothPresent.length > 0) {
    const firstBoth = bothPresent[0].date;
    const lastBoth = bothPresent[bothPresent.length - 1].date;
    console.log(`  Period with BOTH sources: ${firstBoth} to ${lastBoth} (${bothPresent.length} days)`);

    let periodTuCost = 0, periodUeAiCost = 0;
    for (const b of bothPresent) {
      periodTuCost += b.tu_cost;
      periodUeAiCost += b.ue_aiCost;
    }
    const periodDelta = periodUeAiCost - periodTuCost;
    const periodDeltaPct = periodTuCost > 0 ? (periodDelta / periodTuCost) * 100 : 0;

    console.log(`  token_usage cost:   ${fmt$(periodTuCost)}`);
    console.log(`  usage_events cost:  ${fmt$(periodUeAiCost)}`);
    console.log(`  Difference:         ${fmt$(Math.abs(periodDelta))} (${Math.abs(periodDeltaPct).toFixed(1)}%)`);

    if (Math.abs(periodDeltaPct) < 5) {
      console.log(`  VERDICT: Costs are CONSISTENT within 5% for the overlapping period.`);
    } else {
      console.log(`  VERDICT: Costs DIVERGE by ${Math.abs(periodDeltaPct).toFixed(1)}% — investigation needed.`);
    }
    console.log();
  }
}

function displayAzureInstructions(): void {
  console.log('--- Azure Cost Verification (Manual Steps) ---');
  console.log();
  console.log('  Run these commands to get actual Azure spend:');
  console.log();
  console.log('  # 1. Anthropic API spend (check console.anthropic.com)');
  console.log('  #    Navigate to: Settings > Billing > Usage');
  console.log('  #    Filter by API Key and date range');
  console.log('  #    Compare the total against the "token_usage" cost above');
  console.log();
  console.log('  # 2. Azure resource costs (last 30 days)');
  console.log('  az cost management query --type ActualCost \\');
  console.log('    --timeframe Custom \\');
  console.log('    --time-period-from "2026-02-01" --time-period-to "2026-03-06" \\');
  console.log('    --dataset-grouping name="ResourceGroup" type=Dimension \\');
  console.log('    -o table');
  console.log();
  console.log('  # 3. Per-resource breakdown');
  console.log('  az cost management query --type ActualCost \\');
  console.log('    --timeframe Custom \\');
  console.log('    --time-period-from "2026-02-01" --time-period-to "2026-03-06" \\');
  console.log('    --dataset-grouping name="ServiceName" type=Dimension \\');
  console.log('    -o table');
  console.log();
  console.log('  # 4. Azure AI Search cost specifically');
  console.log('  az monitor metrics list \\');
  console.log('    --resource "/subscriptions/{sub}/resourceGroups/rg-BCAgentPrototype-data-dev/providers/Microsoft.Search/searchServices/search-bcagent-dev" \\');
  console.log('    --metric DocumentsProcessedCount \\');
  console.log('    --start-time 2026-02-01T00:00:00Z --end-time 2026-03-06T00:00:00Z \\');
  console.log('    --interval PT1D -o table');
  console.log();
  console.log('  # 5. Redis memory usage');
  console.log('  az redis list-keys --name redis-bcagent-dev --resource-group rg-BCAgentPrototype-data-dev');
  console.log('  az monitor metrics list \\');
  console.log('    --resource "/subscriptions/{sub}/resourceGroups/rg-BCAgentPrototype-data-dev/providers/Microsoft.Cache/Redis/redis-bcagent-dev" \\');
  console.log('    --metric usedmemory \\');
  console.log('    --start-time 2026-02-01T00:00:00Z --interval PT1D -o table');
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Cost Verification Script

Cross-references internal DB costs against expected pricing.

Usage:
  npx tsx scripts/costs/verify-costs.ts                       # February + March
  npx tsx scripts/costs/verify-costs.ts --from 2026-02-01 --to 2026-03-07
  npx tsx scripts/costs/verify-costs.ts --daily               # Daily breakdown
  npx tsx scripts/costs/verify-costs.ts --verbose             # Per-model detail
  npx tsx scripts/costs/verify-costs.ts --az                  # Show Azure CLI commands

Options:
  --from <date>   Start date (YYYY-MM-DD, default: 2026-02-01)
  --to <date>     End date (YYYY-MM-DD, default: today)
  --daily         Show per-day reconciliation table
  --verbose       Show per-model breakdown
  --az            Show Azure Cost Management CLI commands
  --help, -h      Show this help
`);
    process.exit(0);
  }

  const fromStr = getFlag('--from') ?? '2026-02-01';
  const toStr = getFlag('--to') ?? new Date().toISOString().substring(0, 10);
  const showDaily = hasFlag('--daily');
  const verbose = hasFlag('--verbose') || hasFlag('-v');
  const showAz = hasFlag('--az');

  const range: DateRange = {
    from: new Date(`${fromStr}T00:00:00Z`),
    to: new Date(`${toStr}T23:59:59Z`),
  };

  const prisma = createPrisma();

  try {
    displayHeader(range);

    // 1. Data source timeline
    const [tuStart, ueStart] = await Promise.all([
      findTokenUsageStartDate(prisma),
      findTrackingStartDate(prisma),
    ]);
    displayDataSourceTimeline(tuStart, ueStart);

    // 2. Pricing discrepancy check
    const discrepancy = await checkPricingDiscrepancy(prisma, range);
    displayPricingDiscrepancy(discrepancy);

    // 3. Per-model breakdown
    if (verbose) {
      const models = await getModelBreakdown(prisma, range);
      displayModelBreakdown(models);
    }

    // 4. Daily reconciliation
    const [msgByDay, tuByDay, ueByDay] = await Promise.all([
      getMessagesCostByDay(prisma, range),
      getTokenUsageByDay(prisma, range),
      getUsageEventsByDay(prisma, range),
    ]);

    // Build day buckets
    const allDates = new Set([...msgByDay.keys(), ...tuByDay.keys(), ...ueByDay.keys()]);
    const sortedDates = [...allDates].sort();

    const buckets: DayBucket[] = sortedDates.map((date) => {
      const msg = msgByDay.get(date);
      const tu = tuByDay.get(date);
      const ue = ueByDay.get(date);
      return {
        date,
        msg_inputTokens: msg?.inputTokens ?? 0,
        msg_outputTokens: msg?.outputTokens ?? 0,
        msg_cost: msg?.cost ?? 0,
        msg_calls: msg?.calls ?? 0,
        tu_inputTokens: tu?.inputTokens ?? 0,
        tu_outputTokens: tu?.outputTokens ?? 0,
        tu_cacheWriteTokens: tu?.cacheWriteTokens ?? 0,
        tu_cacheReadTokens: tu?.cacheReadTokens ?? 0,
        tu_cost: tu?.cost ?? 0,
        tu_calls: tu?.calls ?? 0,
        ue_aiCost: ue?.aiCost ?? 0,
        ue_embeddingsCost: ue?.embeddingsCost ?? 0,
        ue_searchCost: ue?.searchCost ?? 0,
        ue_processingCost: ue?.processingCost ?? 0,
        ue_storageCost: ue?.storageCost ?? 0,
        ue_totalCost: ue?.totalCost ?? 0,
        ue_events: ue?.events ?? 0,
      };
    });

    if (showDaily) {
      displayDailySummary(buckets);
    }

    // 5. Cross-source summary
    displayCrossSourceSummary(buckets);

    // 6. Azure instructions
    if (showAz) {
      displayAzureInstructions();
    }

    console.log('Verification complete.');
    console.log();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
