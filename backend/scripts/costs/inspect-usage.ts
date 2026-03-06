/**
 * Usage Event Inspector & Health Check Script
 *
 * Inspects usage_events with filtering, grouping, and per-category breakdown.
 * Health mode runs comprehensive checks to detect tracking gaps.
 *
 * Usage:
 *   npx tsx scripts/costs/inspect-usage.ts                        # Last 7 days summary
 *   npx tsx scripts/costs/inspect-usage.ts --health               # Comprehensive health checks
 *   npx tsx scripts/costs/inspect-usage.ts --category ai --detail # Individual AI events
 *   npx tsx scripts/costs/inspect-usage.ts --days 30              # Last 30 days
 *   npx tsx scripts/costs/inspect-usage.ts --from 2026-03-01 --to 2026-03-07
 *   npx tsx scripts/costs/inspect-usage.ts --user "USER-UUID" --days 7
 *
 * Prerequisites:
 *   - DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD in .env
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { hasFlag, getFlag, getNumericFlag } from '../_shared/args';
import { calculateCost } from '../_shared/pricing';

// ============================================================================
// Types
// ============================================================================

type PrismaInstance = ReturnType<typeof createPrisma>;

interface DateRange {
  from: Date;
  to: Date;
}

interface CategorySummary {
  category: string;
  eventType: string;
  count: number;
  totalCost: number;
  avgCost: number;
}

interface HealthCheck {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'INFO';
  message: string;
  detail?: string;
}

// ============================================================================
// Formatting
// ============================================================================

function fmt$(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function pad(s: string, len: number, right = false): string {
  return right
    ? (s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length))
    : (s.length >= len ? s : ' '.repeat(len - s.length) + s);
}

function statusIcon(status: HealthCheck['status']): string {
  switch (status) {
    case 'PASS': return '[PASS]';
    case 'WARN': return '[WARN]';
    case 'FAIL': return '[FAIL]';
    case 'INFO': return '[INFO]';
  }
}

// ============================================================================
// Date Range Parsing
// ============================================================================

function parseDateRange(): DateRange {
  const fromStr = getFlag('--from');
  const toStr = getFlag('--to');
  const days = getNumericFlag('--days', 7);

  if (fromStr) {
    const to = toStr
      ? new Date(`${toStr}T23:59:59Z`)
      : new Date();
    return { from: new Date(`${fromStr}T00:00:00Z`), to };
  }

  const to = toStr ? new Date(`${toStr}T23:59:59Z`) : new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

// ============================================================================
// Usage Summary Mode
// ============================================================================

async function runSummary(prisma: PrismaInstance, range: DateRange): Promise<void> {
  const categoryFilter = getFlag('--category');
  const eventTypeFilter = getFlag('--event-type');
  const userFilter = getFlag('--user');
  const showDetail = hasFlag('--detail');

  // Build where clause
  const where: Record<string, unknown> = {
    created_at: { gte: range.from, lt: range.to },
  };
  if (categoryFilter) where.category = categoryFilter;
  if (eventTypeFilter) where.event_type = eventTypeFilter;
  if (userFilter) where.user_id = userFilter.toUpperCase();

  // Fetch events
  const events = await prisma.usage_events.findMany({
    where,
    orderBy: { created_at: 'desc' },
  });

  if (events.length === 0) {
    console.log('\n  No usage events found for the given filters.\n');
    return;
  }

  // Group by category + event_type
  const groups = new Map<string, CategorySummary>();
  for (const e of events) {
    const key = `${e.category}|${e.event_type}`;
    const existing = groups.get(key);
    const cost = Number(e.cost);
    if (existing) {
      existing.count++;
      existing.totalCost += cost;
      existing.avgCost = existing.totalCost / existing.count;
    } else {
      groups.set(key, {
        category: e.category,
        eventType: e.event_type,
        count: 1,
        totalCost: cost,
        avgCost: cost,
      });
    }
  }

  const sorted = [...groups.values()].sort((a, b) => b.totalCost - a.totalCost);

  // Display summary
  console.log('\n--- Usage Event Summary ---\n');
  console.log(`  Period: ${range.from.toISOString().substring(0, 10)} to ${range.to.toISOString().substring(0, 10)}`);
  console.log(`  Total events: ${events.length}`);
  if (categoryFilter) console.log(`  Category filter: ${categoryFilter}`);
  if (eventTypeFilter) console.log(`  Event type filter: ${eventTypeFilter}`);
  if (userFilter) console.log(`  User filter: ${userFilter.toUpperCase()}`);
  console.log();

  const hdr = `  ${pad('Category', 14, true)}${pad('Event Type', 24, true)}${pad('Count', 7)}${pad('Total Cost', 12)}${pad('Avg Cost', 12)}`;
  console.log(hdr);
  console.log(`  ${'-'.repeat(hdr.length - 2)}`);

  let grandTotal = 0;
  for (const g of sorted) {
    const row = `  ${pad(g.category, 14, true)}${pad(g.eventType, 24, true)}${pad(String(g.count), 7)}${pad(fmt$(g.totalCost), 12)}${pad(fmt$(g.avgCost), 12)}`;
    console.log(row);
    grandTotal += g.totalCost;
  }

  console.log(`  ${'-'.repeat(hdr.length - 2)}`);
  console.log(`  ${pad('TOTAL', 14, true)}${pad('', 24, true)}${pad(String(events.length), 7)}${pad(fmt$(grandTotal), 12)}${pad('', 12)}`);
  console.log();

  // Detail mode: show individual events
  if (showDetail) {
    console.log('--- Individual Events (most recent first) ---\n');
    const limit = 50;
    const displayed = events.slice(0, limit);

    for (const e of displayed) {
      const meta = e.metadata ? JSON.parse(e.metadata as string) : {};
      const metaStr = Object.keys(meta).length > 0
        ? ` | ${Object.entries(meta).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')}`
        : '';

      console.log(`  ${e.created_at.toISOString().substring(0, 19)} | ${pad(e.category, 12, true)} | ${pad(e.event_type, 20, true)} | ${pad(fmt$(Number(e.cost)), 10)}${metaStr}`);
    }

    if (events.length > limit) {
      console.log(`\n  ... and ${events.length - limit} more events (showing first ${limit})`);
    }
    console.log();
  }
}

// ============================================================================
// Health Check Mode
// ============================================================================

async function runHealthChecks(prisma: PrismaInstance, range: DateRange): Promise<void> {
  const verbose = hasFlag('--verbose');
  const checks: HealthCheck[] = [];

  console.log('\n' + '='.repeat(70));
  console.log('  USAGE TRACKING HEALTH CHECK');
  console.log('='.repeat(70));
  console.log(`  Period: ${range.from.toISOString().substring(0, 10)} to ${range.to.toISOString().substring(0, 10)}`);
  console.log('='.repeat(70) + '\n');

  // 1. token_usage records
  const tuCount = await prisma.token_usage.count({
    where: { created_at: { gte: range.from, lt: range.to } },
  });
  checks.push({
    name: 'token_usage records',
    status: tuCount > 0 ? 'PASS' : 'FAIL',
    message: tuCount > 0
      ? `${tuCount} records found`
      : 'No records — TokenUsageService.recordUsage() may not be called',
  });

  // 2. Model NULL/unknown in messages
  const modelNullCount = await prisma.messages.count({
    where: {
      role: 'assistant',
      created_at: { gte: range.from, lt: range.to },
      OR: [{ model: null }, { model: 'unknown' }],
      input_tokens: { gt: 0 },
    },
  });
  const totalAssistantMsgs = await prisma.messages.count({
    where: {
      role: 'assistant',
      created_at: { gte: range.from, lt: range.to },
      input_tokens: { gt: 0 },
    },
  });
  checks.push({
    name: 'Model NULL/unknown',
    status: modelNullCount === 0 ? 'PASS' : 'WARN',
    message: modelNullCount === 0
      ? `All ${totalAssistantMsgs} assistant messages have model set`
      : `${modelNullCount}/${totalAssistantMsgs} messages have NULL/unknown model`,
    detail: modelNullCount > 0
      ? 'Fix: MessageNormalizer.extractModel() should check additional_kwargs.model'
      : undefined,
  });

  // 3. Storage events
  const storageCount = await prisma.usage_events.count({
    where: {
      category: 'storage',
      created_at: { gte: range.from, lt: range.to },
    },
  });
  // Also check if any files were uploaded in range
  const filesUploaded = await prisma.files.count({
    where: {
      created_at: { gte: range.from, lt: range.to },
      is_folder: false,
    },
  });
  checks.push({
    name: 'Storage events',
    status: storageCount > 0 ? 'PASS' : (filesUploaded > 0 ? 'WARN' : 'INFO'),
    message: storageCount > 0
      ? `${storageCount} storage events tracked`
      : filesUploaded > 0
        ? `${filesUploaded} files uploaded but 0 storage events — tracking gap`
        : 'No files uploaded and no storage events (expected)',
  });

  // 4. Supervisor 0-token messages (known limitation)
  const supervisorZeroTokens = await prisma.messages.count({
    where: {
      role: 'assistant',
      agent_id: 'supervisor',
      created_at: { gte: range.from, lt: range.to },
      input_tokens: 0,
      output_tokens: 0,
    },
  });
  checks.push({
    name: 'Supervisor 0-token msgs',
    status: 'INFO',
    message: `${supervisorZeroTokens} supervisor messages with 0 tokens (framework-generated, expected)`,
    detail: 'Supervisor routing messages are framework-generated. Actual LLM tokens are in usage_events.',
  });

  // 5. AI cost discrepancy
  const ueAiAgg = await prisma.usage_events.aggregate({
    where: {
      category: 'ai',
      created_at: { gte: range.from, lt: range.to },
    },
    _sum: { cost: true },
  });
  const ueAiCost = Number(ueAiAgg._sum.cost ?? 0);

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

  let recalculated = 0;
  for (const r of tuRecords) {
    const cw = r.cache_creation_input_tokens ?? 0;
    const cr = r.cache_read_input_tokens ?? 0;
    recalculated += calculateCost(r.model, r.input_tokens, r.output_tokens, cw, cr);
  }

  if (tuRecords.length > 0 && ueAiCost > 0) {
    const delta = Math.abs(ueAiCost - recalculated);
    const deltaPct = recalculated > 0 ? (delta / recalculated) * 100 : 0;
    checks.push({
      name: 'AI cost discrepancy',
      status: deltaPct < 5 ? 'PASS' : 'WARN',
      message: `usage_events: ${fmt$(ueAiCost)} vs recalculated: ${fmt$(recalculated)} (delta: ${deltaPct.toFixed(1)}%)`,
    });
  } else {
    checks.push({
      name: 'AI cost discrepancy',
      status: tuRecords.length === 0 ? 'WARN' : 'INFO',
      message: tuRecords.length === 0
        ? 'Cannot compare — no token_usage records'
        : `No AI usage_events. Recalculated from token_usage: ${fmt$(recalculated)}`,
    });
  }

  // 6. Category distribution
  const catDistribution = await prisma.usage_events.groupBy({
    by: ['category'],
    where: { created_at: { gte: range.from, lt: range.to } },
    _count: true,
    _sum: { cost: true },
  });

  // Display results
  for (const check of checks) {
    console.log(`  ${statusIcon(check.status)} ${check.name}: ${check.message}`);
    if (verbose && check.detail) {
      console.log(`         ${check.detail}`);
    }
  }

  // Category distribution table
  console.log('\n--- Category Distribution ---\n');
  if (catDistribution.length === 0) {
    console.log('  (no usage events in range)\n');
  } else {
    const catHdr = `  ${pad('Category', 16, true)}${pad('Events', 8)}${pad('Total Cost', 12)}`;
    console.log(catHdr);
    console.log(`  ${'-'.repeat(catHdr.length - 2)}`);
    for (const cat of catDistribution) {
      console.log(`  ${pad(cat.category, 16, true)}${pad(String(cat._count), 8)}${pad(fmt$(Number(cat._sum.cost ?? 0)), 12)}`);
    }
    console.log();
  }

  // Summary
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const warnCount = checks.filter(c => c.status === 'WARN').length;
  if (failCount > 0) {
    console.log(`  RESULT: ${failCount} FAIL, ${warnCount} WARN — action needed\n`);
  } else if (warnCount > 0) {
    console.log(`  RESULT: All checks passed, ${warnCount} warnings\n`);
  } else {
    console.log(`  RESULT: All checks passed\n`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage Event Inspector & Health Check

Usage:
  npx tsx scripts/costs/inspect-usage.ts [options]

Options:
  --help              Show this help
  --days N            Last N days (default: 7)
  --from YYYY-MM-DD   Start date
  --to YYYY-MM-DD     End date (default: today)
  --category CAT      Filter: ai, embeddings, search, processing, storage
  --event-type ET     Filter by event_type
  --user ID           Filter by user ID
  --detail            Show individual events with metadata
  --health            Run comprehensive health checks
  --verbose           Extra diagnostic info

Examples:
  npx tsx scripts/costs/inspect-usage.ts --health
  npx tsx scripts/costs/inspect-usage.ts --category ai --from 2026-03-06
  npx tsx scripts/costs/inspect-usage.ts --category storage --detail
  npx tsx scripts/costs/inspect-usage.ts --user "USER-UUID" --days 7
`);
    process.exit(0);
  }

  const range = parseDateRange();
  const prisma = createPrisma();

  try {
    if (hasFlag('--health')) {
      await runHealthChecks(prisma, range);
    } else {
      await runSummary(prisma, range);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
