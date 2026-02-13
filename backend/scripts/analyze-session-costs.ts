/**
 * Analyze Session Costs
 *
 * Diagnostic script that analyzes token usage and costs per session, per turn,
 * and per agent using real data from the `messages` and `token_usage` tables.
 *
 * Usage:
 *   npx tsx scripts/analyze-session-costs.ts "4515496a-..."
 *   npx tsx scripts/analyze-session-costs.ts "http://localhost:3000/chat/4515496a-..."
 *   npx tsx scripts/analyze-session-costs.ts "4515496a-..." --verbose
 *   npx tsx scripts/analyze-session-costs.ts --user "user-id" --days 7
 */

import 'dotenv/config';
import { createPrisma } from './_shared/prisma';
import { getFlag, getNumericFlag, getPositionalArg, hasFlag } from './_shared/args';

// ============================================================================
// Types
// ============================================================================

interface MessageRecord {
  id: string;
  session_id: string;
  role: string;
  content: string;
  message_type: string;
  sequence_number: number | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  agent_id: string | null;
  is_internal: boolean | null;
  created_at: Date;
}

interface TokenUsageRecord {
  id: string;
  session_id: string;
  message_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  thinking_enabled: boolean;
  thinking_budget: number | null;
}

interface SessionInfo {
  id: string;
  title: string;
  user_id: string;
  created_at: Date;
  user: { email: string; full_name: string | null };
}

interface Turn {
  turnNumber: number;
  userMessage: MessageRecord;
  agentMessages: MessageRecord[];
}

interface TurnCostBreakdown {
  turnNumber: number;
  userContent: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  cost: number;
  agentIds: string[];
  llmCalls: number;
}

interface AgentStats {
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  messageCount: number;
  models: Set<string>;
}

interface CostTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  turnCount: number;
  llmCalls: number;
}

// ============================================================================
// Model Pricing (per 1M tokens)
// ============================================================================

const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  // Haiku 4.5 (current default for all agents)
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.10 },
  // Sonnet 3.5
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  // Sonnet 4.5
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  // Opus 4.6
  'claude-opus-4-6-20250514': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
};

// Default to Haiku pricing for unknown models
const DEFAULT_PRICING = MODEL_PRICING['claude-haiku-4-5-20251001'];

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

interface ParsedArgs {
  mode: 'session' | 'user';
  sessionIdOrUrl?: string;
  userId?: string;
  days: number;
  verbose: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Session Cost Analyzer

Usage:
  npx tsx scripts/analyze-session-costs.ts "<session-id-or-url>" [--verbose]
  npx tsx scripts/analyze-session-costs.ts --user "<user-id>" [--days N] [--verbose]

Arguments:
  <session-id-or-url>  Session ID or URL containing session ID
  --user <id>          Analyze all sessions for a user
  --days <N>           Limit to last N days (default: 30, used with --user)
  --verbose, -v        Show per-message token breakdown within each turn

Examples:
  npx tsx scripts/analyze-session-costs.ts "4515496a-..."
  npx tsx scripts/analyze-session-costs.ts "http://localhost:3000/chat/4515496a-..."
  npx tsx scripts/analyze-session-costs.ts "4515496a-..." --verbose
  npx tsx scripts/analyze-session-costs.ts --user "ABCD1234-..." --days 7
`);
    process.exit(0);
  }

  const userId = getFlag('--user');
  const verbose = hasFlag('--verbose') || hasFlag('-v');
  const days = getNumericFlag('--days', 30);

  if (userId) {
    return { mode: 'user', userId: userId.toUpperCase(), days, verbose };
  }

  const sessionIdOrUrl = getPositionalArg() || '';
  if (!sessionIdOrUrl) {
    console.error('ERROR: Session ID/URL or --user flag is required');
    process.exit(1);
  }

  return { mode: 'session', sessionIdOrUrl, verbose, days };
}

function extractSessionId(input: string): string {
  const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  const match = input.match(uuidRegex);

  if (!match) {
    console.error('ERROR: No valid UUID found in input');
    process.exit(1);
  }

  return match[0].toUpperCase();
}

// ============================================================================
// Database Queries
// ============================================================================

type PrismaInstance = ReturnType<typeof createPrisma>;

async function getSessionInfo(prisma: PrismaInstance, sessionId: string): Promise<SessionInfo | null> {
  const session = await prisma.sessions.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      user_id: true,
      created_at: true,
      users: { select: { email: true, full_name: true } },
    },
  });

  if (!session) return null;

  return {
    id: session.id.toUpperCase(),
    title: session.title,
    user_id: session.user_id.toUpperCase(),
    created_at: session.created_at,
    user: session.users,
  };
}

async function getSessionMessages(prisma: PrismaInstance, sessionId: string): Promise<MessageRecord[]> {
  const messages = await prisma.messages.findMany({
    where: { session_id: sessionId },
    orderBy: [{ sequence_number: 'asc' }, { created_at: 'asc' }],
    select: {
      id: true,
      session_id: true,
      role: true,
      content: true,
      message_type: true,
      sequence_number: true,
      model: true,
      input_tokens: true,
      output_tokens: true,
      agent_id: true,
      is_internal: true,
      created_at: true,
    },
  });

  return messages.map((m) => ({
    ...m,
    session_id: m.session_id.toUpperCase(),
  }));
}

async function getTokenUsageRecords(prisma: PrismaInstance, sessionId: string): Promise<TokenUsageRecord[]> {
  const records = await prisma.token_usage.findMany({
    where: { session_id: sessionId },
    select: {
      id: true,
      session_id: true,
      message_id: true,
      model: true,
      input_tokens: true,
      output_tokens: true,
      cache_creation_input_tokens: true,
      cache_read_input_tokens: true,
      thinking_enabled: true,
      thinking_budget: true,
    },
  });

  return records.map((r) => ({
    ...r,
    id: r.id.toUpperCase(),
    session_id: r.session_id.toUpperCase(),
  }));
}

async function getUserSessions(prisma: PrismaInstance, userId: string, days: number): Promise<SessionInfo[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const sessions = await prisma.sessions.findMany({
    where: {
      user_id: userId,
      created_at: { gte: cutoff },
    },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      title: true,
      user_id: true,
      created_at: true,
      users: { select: { email: true, full_name: true } },
    },
  });

  return sessions.map((s) => ({
    id: s.id.toUpperCase(),
    title: s.title,
    user_id: s.user_id.toUpperCase(),
    created_at: s.created_at,
    user: s.users,
  }));
}

// ============================================================================
// Analysis Logic
// ============================================================================

function groupMessagesByTurn(messages: MessageRecord[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Start a new turn
      currentTurn = {
        turnNumber: turns.length + 1,
        userMessage: msg,
        agentMessages: [],
      };
      turns.push(currentTurn);
    } else if (currentTurn) {
      currentTurn.agentMessages.push(msg);
    }
    // Messages before the first user message are orphans — skip them
  }

  return turns;
}

function calculateTurnCost(
  turn: Turn,
  tokenUsageByMessageId: Map<string, TokenUsageRecord>
): TurnCostBreakdown {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let llmCalls = 0;
  const agentIds = new Set<string>();

  for (const msg of turn.agentMessages) {
    inputTokens += msg.input_tokens || 0;
    outputTokens += msg.output_tokens || 0;

    if (msg.agent_id) agentIds.add(msg.agent_id);

    // Count LLM calls: messages with tokens indicate an LLM invocation
    if ((msg.input_tokens || 0) > 0 || (msg.output_tokens || 0) > 0) {
      llmCalls++;
    }

    // Get cache data from token_usage
    const usage = tokenUsageByMessageId.get(msg.id);
    if (usage) {
      cacheWriteTokens += usage.cache_creation_input_tokens || 0;
      cacheReadTokens += usage.cache_read_input_tokens || 0;
    }
  }

  // Determine dominant model for pricing (use the first model found)
  const model = turn.agentMessages.find((m) => m.model)?.model ?? null;

  const cost = calculateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);

  return {
    turnNumber: turn.turnNumber,
    userContent: truncate(turn.userMessage.content || '', 60),
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    cost,
    agentIds: [...agentIds],
    llmCalls,
  };
}

function aggregateByAgent(
  messages: MessageRecord[],
  tokenUsageByMessageId: Map<string, TokenUsageRecord>
): AgentStats[] {
  const statsMap = new Map<string, AgentStats>();

  for (const msg of messages) {
    if (msg.role === 'user') continue;

    const agentId = msg.agent_id || '(unattributed)';

    let stats = statsMap.get(agentId);
    if (!stats) {
      stats = { agentId, inputTokens: 0, outputTokens: 0, cost: 0, messageCount: 0, models: new Set() };
      statsMap.set(agentId, stats);
    }

    const input = msg.input_tokens || 0;
    const output = msg.output_tokens || 0;
    stats.inputTokens += input;
    stats.outputTokens += output;
    stats.messageCount++;
    if (msg.model) stats.models.add(msg.model);

    // Include cache in cost calculation
    const usage = tokenUsageByMessageId.get(msg.id);
    const cacheWrite = usage?.cache_creation_input_tokens || 0;
    const cacheRead = usage?.cache_read_input_tokens || 0;

    stats.cost += calculateCost(msg.model, input, output, cacheWrite, cacheRead);
  }

  return [...statsMap.values()].sort((a, b) => b.cost - a.cost);
}

function computeTotals(turnBreakdowns: TurnCostBreakdown[]): CostTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let totalCost = 0;
  let llmCalls = 0;

  for (const t of turnBreakdowns) {
    inputTokens += t.inputTokens;
    outputTokens += t.outputTokens;
    cacheWriteTokens += t.cacheWriteTokens;
    cacheReadTokens += t.cacheReadTokens;
    totalCost += t.cost;
    llmCalls += t.llmCalls;
  }

  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalCost,
    turnCount: turnBreakdowns.length,
    llmCalls,
  };
}

// ============================================================================
// Display Utilities
// ============================================================================

const AGENT_ICONS: Record<string, string> = {
  'bc-agent': '  ',
  'rag-agent': '  ',
  'supervisor': '  ',
  'graphing-agent': '  ',
};

function getAgentIcon(agentId: string): string {
  return AGENT_ICONS[agentId] || '  ';
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  return oneLine.length <= maxLen ? oneLine : oneLine.substring(0, maxLen) + '...';
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

function displaySessionHeader(session: SessionInfo): void {
  console.log();
  console.log('='.repeat(70));
  console.log(`  SESSION COST ANALYSIS`);
  console.log('='.repeat(70));
  console.log(`  ID:       ${session.id}`);
  console.log(`  Title:    "${session.title}"`);
  console.log(`  User:     ${session.user.full_name || session.user.email} (${session.user_id})`);
  console.log(`  Date:     ${formatTimestamp(session.created_at)}`);
  console.log('='.repeat(70));
  console.log();
}

function displayTurnBreakdown(turnBreakdowns: TurnCostBreakdown[], verbose: boolean, turns: Turn[], tokenUsageByMessageId: Map<string, TokenUsageRecord>): void {
  console.log('--- Per-Turn Breakdown ---');
  console.log();

  if (turnBreakdowns.length === 0) {
    console.log('  (no turns found)');
    console.log();
    return;
  }

  for (const tb of turnBreakdowns) {
    const agents = tb.agentIds.length > 0
      ? tb.agentIds.map((a) => `${getAgentIcon(a)}${a}`).join(', ')
      : '(none)';

    console.log(`  Turn ${tb.turnNumber}: "${tb.userContent}"`);
    console.log(`    Agents:  ${agents}`);
    console.log(`    LLM calls: ${tb.llmCalls}   Input: ${formatTokens(tb.inputTokens)}   Output: ${formatTokens(tb.outputTokens)}   Cost: ${formatCost(tb.cost)}`);

    if (tb.cacheWriteTokens > 0 || tb.cacheReadTokens > 0) {
      console.log(`    Cache:   write=${formatTokens(tb.cacheWriteTokens)}  read=${formatTokens(tb.cacheReadTokens)}`);
    }

    if (verbose) {
      const turn = turns[tb.turnNumber - 1];
      if (turn) {
        for (const msg of turn.agentMessages) {
          if ((msg.input_tokens || 0) === 0 && (msg.output_tokens || 0) === 0) continue;
          const usage = tokenUsageByMessageId.get(msg.id);
          const cw = usage?.cache_creation_input_tokens || 0;
          const cr = usage?.cache_read_input_tokens || 0;
          const agent = msg.agent_id || '?';
          const msgCost = calculateCost(msg.model, msg.input_tokens || 0, msg.output_tokens || 0, cw, cr);
          console.log(`      [${agent}] ${msg.message_type.padEnd(12)} in=${formatTokens(msg.input_tokens || 0)} out=${formatTokens(msg.output_tokens || 0)} model=${msg.model || '?'} cost=${formatCost(msgCost)}`);
        }
      }
    }

    console.log();
  }
}

function displayAgentBreakdown(agentStats: AgentStats[]): void {
  console.log('--- Per-Agent Breakdown ---');
  console.log();

  if (agentStats.length === 0) {
    console.log('  (no agent data)');
    console.log();
    return;
  }

  for (const stats of agentStats) {
    const icon = getAgentIcon(stats.agentId);
    const models = [...stats.models].join(', ') || '(unknown)';
    console.log(`  ${icon}${stats.agentId}`);
    console.log(`    Messages: ${stats.messageCount}   Input: ${formatTokens(stats.inputTokens)}   Output: ${formatTokens(stats.outputTokens)}`);
    console.log(`    Model(s): ${models}   Cost: ${formatCost(stats.cost)}`);
    console.log();
  }
}

function displayCacheEfficiency(tokenUsageRecords: TokenUsageRecord[]): void {
  let totalInput = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;

  for (const r of tokenUsageRecords) {
    totalInput += r.input_tokens;
    totalCacheWrite += r.cache_creation_input_tokens || 0;
    totalCacheRead += r.cache_read_input_tokens || 0;
  }

  if (totalCacheWrite === 0 && totalCacheRead === 0) {
    console.log('--- Cache Efficiency ---');
    console.log('  No cache data in token_usage table.');
    console.log();
    return;
  }

  const cacheHitRate = totalInput > 0
    ? ((totalCacheRead / (totalInput + totalCacheRead + totalCacheWrite)) * 100).toFixed(1)
    : '0.0';

  console.log('--- Cache Efficiency ---');
  console.log(`  Cache write tokens:  ${formatTokens(totalCacheWrite)}`);
  console.log(`  Cache read tokens:   ${formatTokens(totalCacheRead)}`);
  console.log(`  Non-cached input:    ${formatTokens(totalInput)}`);
  console.log(`  Cache hit rate:      ${cacheHitRate}%`);
  console.log();
}

function displayCostSummary(totals: CostTotals): void {
  console.log('--- Cost Summary ---');
  console.log();
  console.log(`  Turns:           ${totals.turnCount}`);
  console.log(`  LLM calls:       ${totals.llmCalls}`);
  console.log(`  Input tokens:    ${formatTokens(totals.inputTokens)}`);
  console.log(`  Output tokens:   ${formatTokens(totals.outputTokens)}`);

  if (totals.cacheWriteTokens > 0 || totals.cacheReadTokens > 0) {
    console.log(`  Cache write:     ${formatTokens(totals.cacheWriteTokens)}`);
    console.log(`  Cache read:      ${formatTokens(totals.cacheReadTokens)}`);
  }

  console.log(`  ----------------------------------------`);
  console.log(`  TOTAL COST:      ${formatCost(totals.totalCost)}`);
  console.log();

  // Context: compare against diagnostic estimates
  if (totals.turnCount > 0) {
    const avgPerTurn = totals.totalCost / totals.turnCount;
    console.log(`  Avg cost/turn:   ${formatCost(avgPerTurn)}`);
    console.log(`  Avg LLM calls/turn: ${(totals.llmCalls / totals.turnCount).toFixed(1)}`);
  }

  console.log();
}

// ============================================================================
// Single-Session Analysis
// ============================================================================

async function analyzeSession(
  prisma: PrismaInstance,
  sessionId: string,
  verbose: boolean
): Promise<CostTotals> {
  const session = await getSessionInfo(prisma, sessionId);

  if (!session) {
    console.error(`\nERROR: Session not found: ${sessionId}\n`);
    process.exit(1);
  }

  const [messages, tokenUsageRecords] = await Promise.all([
    getSessionMessages(prisma, sessionId),
    getTokenUsageRecords(prisma, sessionId),
  ]);

  // Build lookup map for token_usage by message_id
  const tokenUsageByMessageId = new Map<string, TokenUsageRecord>();
  for (const r of tokenUsageRecords) {
    tokenUsageByMessageId.set(r.message_id, r);
  }

  // Analyze
  const turns = groupMessagesByTurn(messages);
  const turnBreakdowns = turns.map((t) => calculateTurnCost(t, tokenUsageByMessageId));
  const agentStats = aggregateByAgent(messages, tokenUsageByMessageId);
  const totals = computeTotals(turnBreakdowns);

  // Display
  displaySessionHeader(session);
  displayTurnBreakdown(turnBreakdowns, verbose, turns, tokenUsageByMessageId);
  displayAgentBreakdown(agentStats);
  displayCacheEfficiency(tokenUsageRecords);
  displayCostSummary(totals);

  return totals;
}

// ============================================================================
// Multi-Session Analysis
// ============================================================================

async function analyzeUserSessions(
  prisma: PrismaInstance,
  userId: string,
  days: number,
  verbose: boolean
): Promise<void> {
  const sessions = await getUserSessions(prisma, userId, days);

  if (sessions.length === 0) {
    console.error(`\nERROR: No sessions found for user ${userId} in the last ${days} days.\n`);
    process.exit(1);
  }

  console.log();
  console.log('='.repeat(70));
  console.log(`  MULTI-SESSION COST ANALYSIS`);
  console.log('='.repeat(70));
  console.log(`  User:     ${sessions[0].user.full_name || sessions[0].user.email} (${userId})`);
  console.log(`  Period:   Last ${days} days`);
  console.log(`  Sessions: ${sessions.length}`);
  console.log('='.repeat(70));
  console.log();

  const sessionCosts: { sessionId: string; title: string; date: Date; totals: CostTotals }[] = [];

  for (const session of sessions) {
    const [messages, tokenUsageRecords] = await Promise.all([
      getSessionMessages(prisma, session.id),
      getTokenUsageRecords(prisma, session.id),
    ]);

    const tokenUsageByMessageId = new Map<string, TokenUsageRecord>();
    for (const r of tokenUsageRecords) {
      tokenUsageByMessageId.set(r.message_id, r);
    }

    const turns = groupMessagesByTurn(messages);
    const turnBreakdowns = turns.map((t) => calculateTurnCost(t, tokenUsageByMessageId));
    const totals = computeTotals(turnBreakdowns);

    sessionCosts.push({ sessionId: session.id, title: session.title, date: session.created_at, totals });

    if (verbose) {
      const agentStats = aggregateByAgent(messages, tokenUsageByMessageId);
      displaySessionHeader(session);
      displayTurnBreakdown(turnBreakdowns, verbose, turns, tokenUsageByMessageId);
      displayAgentBreakdown(agentStats);
      displayCacheEfficiency(tokenUsageRecords);
      displayCostSummary(totals);
    }
  }

  // Summary table
  console.log('--- Session Summary ---');
  console.log();
  console.log('  ' + 'Session'.padEnd(40) + 'Turns'.padStart(6) + 'LLM'.padStart(6) + 'Input'.padStart(10) + 'Output'.padStart(10) + 'Cost'.padStart(10));
  console.log('  ' + '-'.repeat(82));

  let grandTotalCost = 0;
  let grandTotalTurns = 0;
  let grandTotalLLMCalls = 0;
  let minCost = Infinity;
  let maxCost = 0;

  for (const sc of sessionCosts) {
    const titleTrunc = truncate(sc.title, 38).padEnd(40);
    const turns = String(sc.totals.turnCount).padStart(6);
    const llm = String(sc.totals.llmCalls).padStart(6);
    const input = formatTokens(sc.totals.inputTokens).padStart(10);
    const output = formatTokens(sc.totals.outputTokens).padStart(10);
    const cost = formatCost(sc.totals.totalCost).padStart(10);

    console.log(`  ${titleTrunc}${turns}${llm}${input}${output}${cost}`);

    grandTotalCost += sc.totals.totalCost;
    grandTotalTurns += sc.totals.turnCount;
    grandTotalLLMCalls += sc.totals.llmCalls;
    if (sc.totals.totalCost < minCost) minCost = sc.totals.totalCost;
    if (sc.totals.totalCost > maxCost) maxCost = sc.totals.totalCost;
  }

  console.log('  ' + '-'.repeat(82));
  console.log();

  // Aggregate stats
  const avgPerSession = sessionCosts.length > 0 ? grandTotalCost / sessionCosts.length : 0;
  const avgPerTurn = grandTotalTurns > 0 ? grandTotalCost / grandTotalTurns : 0;

  console.log('--- Aggregate Stats ---');
  console.log();
  console.log(`  Total sessions:      ${sessionCosts.length}`);
  console.log(`  Total turns:         ${grandTotalTurns}`);
  console.log(`  Total LLM calls:     ${grandTotalLLMCalls}`);
  console.log(`  Total spend:         ${formatCost(grandTotalCost)}`);
  console.log(`  Avg cost/session:    ${formatCost(avgPerSession)}`);
  console.log(`  Avg cost/turn:       ${formatCost(avgPerTurn)}`);
  console.log(`  Min session cost:    ${formatCost(minCost === Infinity ? 0 : minCost)}`);
  console.log(`  Max session cost:    ${formatCost(maxCost)}`);
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();
  const prisma = createPrisma();

  try {
    if (args.mode === 'session') {
      const sessionId = extractSessionId(args.sessionIdOrUrl!);
      await analyzeSession(prisma, sessionId, args.verbose);
    } else {
      await analyzeUserSessions(prisma, args.userId!, args.days, args.verbose);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
