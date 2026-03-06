/**
 * Diagnose Agent Flow
 *
 * Comprehensive diagnostic script for analyzing multi-agent orchestration.
 * Shows the complete flow of each conversation turn:
 *   - Agent handoffs (supervisor → worker routing)
 *   - Tool calls (name, duration, arguments, results)
 *   - Token usage per agent and per turn
 *   - Internal vs external events
 *   - Potential issues (missing agent_id, sequence gaps, failed tools)
 *
 * Usage:
 *   npx tsx scripts/diagnose-agent-flow.ts "<session-id-or-url>"
 *   npx tsx scripts/diagnose-agent-flow.ts "<session-id-or-url>" --verbose
 *   npx tsx scripts/diagnose-agent-flow.ts --user "<user-id>" [--days N]
 *   npx tsx scripts/diagnose-agent-flow.ts --latest
 *   npx tsx scripts/diagnose-agent-flow.ts --help
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { getFlag, getNumericFlag, getPositionalArg, hasFlag } from '../_shared/args';

// ─── ANSI Colors ─────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Agent Display ───────────────────────────────────────────────
const AGENT_ICONS: Record<string, string> = {
  supervisor: `${CYAN}[SUP]${RESET}`,
  'bc-agent': `${GREEN}[BC]${RESET}`,
  'rag-agent': `${MAGENTA}[RAG]${RESET}`,
  'graphing-agent': `${YELLOW}[GRA]${RESET}`,
  'research-agent': `${CYAN}[RES]${RESET}`,
};

function agentLabel(agentId: string | null): string {
  if (!agentId) return `${DIM}[???]${RESET}`;
  return AGENT_ICONS[agentId] ?? `[${agentId}]`;
}

// ─── Model Pricing (per 1M tokens) ──────────────────────────────
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-opus-4-6-20250514': { input: 15.0, output: 75.0 },
};
const DEFAULT_PRICING = { input: 1.0, output: 5.0 };

function calcCost(model: string | null, inTok: number, outTok: number): number {
  const p = (model && MODEL_PRICING[model]) || DEFAULT_PRICING;
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

// ─── Types ───────────────────────────────────────────────────────
interface MessageRow {
  id: string;
  role: string;
  content: string;
  message_type: string;
  sequence_number: number | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  agent_id: string | null;
  is_internal: boolean | null;
  stop_reason: string | null;
  created_at: Date;
}

interface EventRow {
  id: string;
  event_type: string;
  sequence_number: number | null;
  timestamp: Date;
  data: string | null;
  processed: boolean;
}

interface SessionRow {
  id: string;
  title: string;
  user_id: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  users: { email: string; full_name: string | null };
}

// ─── Helpers ─────────────────────────────────────────────────────
function extractSessionId(input: string): string {
  const urlMatch = input.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return (urlMatch?.[0] ?? input).toUpperCase();
}

function truncate(text: string | null, max: number): string {
  if (!text) return `${DIM}(empty)${RESET}`;
  const clean = text.replace(/\n/g, ' ').trim();
  return clean.length > max ? clean.substring(0, max) + '...' : clean;
}

function hr(char = '─', len = 80): string {
  return char.repeat(len);
}

function formatTokens(n: number | null): string {
  if (!n) return `${DIM}0${RESET}`;
  if (n >= 1000) return `${YELLOW}${(n / 1000).toFixed(1)}k${RESET}`;
  return `${n}`;
}

function formatCost(cost: number): string {
  if (cost === 0) return `${DIM}$0.0000${RESET}`;
  return `${YELLOW}$${cost.toFixed(4)}${RESET}`;
}

// ─── Session Analysis ────────────────────────────────────────────
async function analyzeSession(sessionId: string, verbose: boolean): Promise<void> {
  const prisma = createPrisma();

  try {
    // 1. Fetch session
    const session = await prisma.sessions.findUnique({
      where: { id: sessionId },
      select: {
        id: true, title: true, user_id: true, is_active: true,
        created_at: true, updated_at: true,
        users: { select: { email: true, full_name: true } },
      },
    }) as SessionRow | null;

    if (!session) {
      console.error(`${RED}Session not found: ${sessionId}${RESET}`);
      process.exit(1);
    }

    // 2. Fetch messages
    const messages = await prisma.messages.findMany({
      where: { session_id: sessionId },
      orderBy: [{ sequence_number: 'asc' }, { created_at: 'asc' }],
      select: {
        id: true, role: true, content: true, message_type: true,
        sequence_number: true, model: true, input_tokens: true,
        output_tokens: true, agent_id: true, is_internal: true,
        stop_reason: true, created_at: true,
      },
    }) as MessageRow[];

    // 3. Fetch events
    const events = await prisma.message_events.findMany({
      where: { session_id: sessionId },
      orderBy: [{ sequence_number: 'asc' }, { timestamp: 'asc' }],
      select: {
        id: true, event_type: true, sequence_number: true,
        timestamp: true, data: true, processed: true,
      },
    }) as EventRow[];

    // ── Print Header ──
    console.log(`\n${BOLD}${hr('═')}${RESET}`);
    console.log(`${BOLD}  AGENT FLOW DIAGNOSTIC${RESET}`);
    console.log(`${BOLD}${hr('═')}${RESET}`);
    console.log(`  Session:  ${session.id}`);
    console.log(`  Title:    ${session.title || `${DIM}(no title)${RESET}`}`);
    console.log(`  User:     ${session.users.full_name} <${session.users.email}>`);
    console.log(`  Status:   ${session.is_active ? `${GREEN}active${RESET}` : `${DIM}closed${RESET}`}`);
    console.log(`  Created:  ${session.created_at.toISOString()}`);
    console.log(`  Messages: ${messages.length}  |  Events: ${events.length}`);
    console.log(hr('═'));

    if (messages.length === 0) {
      console.log(`\n${DIM}No messages in this session.${RESET}\n`);
      return;
    }

    // ── Group into turns (user message → agent responses) ──
    const turns: { userMsg: MessageRow; responses: MessageRow[] }[] = [];
    let currentTurn: { userMsg: MessageRow; responses: MessageRow[] } | null = null;

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (currentTurn) turns.push(currentTurn);
        currentTurn = { userMsg: msg, responses: [] };
      } else if (currentTurn) {
        currentTurn.responses.push(msg);
      } else {
        // Orphan assistant message before first user message (system bootstrap)
        if (!currentTurn) {
          currentTurn = { userMsg: msg, responses: [] };
        }
      }
    }
    if (currentTurn) turns.push(currentTurn);

    // ── Aggregation accumulators ──
    const agentStats = new Map<string, {
      messages: number; tools: number; inTok: number; outTok: number;
      cost: number; models: Set<string>;
    }>();
    let totalIn = 0, totalOut = 0, totalCost = 0;
    const handoffs: { turn: number; from: string; to: string }[] = [];
    const toolCalls: { turn: number; agent: string | null; name: string; args: string; result: string; type: string }[] = [];
    const issues: string[] = [];

    // ── Process each turn ──
    for (let t = 0; t < turns.length; t++) {
      const turn = turns[t]!;
      const turnNum = t + 1;

      console.log(`\n${CYAN}${BOLD}── Turn ${turnNum} ${hr('─', 65)}${RESET}`);

      // User message
      if (turn.userMsg.role === 'user') {
        console.log(`  ${BOLD}User:${RESET} ${truncate(turn.userMsg.content, verbose ? 500 : 120)}`);
      }

      // Track agent transitions within this turn
      let prevAgent: string | null = null;
      let turnIn = 0, turnOut = 0, turnCost = 0, turnLLMCalls = 0;

      for (const msg of turn.responses) {
        const aId = msg.agent_id ?? 'unknown';
        const label = agentLabel(msg.agent_id);
        const inTok = msg.input_tokens ?? 0;
        const outTok = msg.output_tokens ?? 0;
        const cost = calcCost(msg.model, inTok, outTok);

        turnIn += inTok;
        turnOut += outTok;
        turnCost += cost;

        // Track agent stats
        if (!agentStats.has(aId)) {
          agentStats.set(aId, { messages: 0, tools: 0, inTok: 0, outTok: 0, cost: 0, models: new Set() });
        }
        const stats = agentStats.get(aId)!;
        stats.messages++;
        stats.inTok += inTok;
        stats.outTok += outTok;
        stats.cost += cost;
        if (msg.model) stats.models.add(msg.model);

        // Detect handoffs
        if (prevAgent && msg.agent_id && prevAgent !== msg.agent_id) {
          handoffs.push({ turn: turnNum, from: prevAgent, to: msg.agent_id });
          console.log(`  ${YELLOW}↳ HANDOFF: ${agentLabel(prevAgent)} → ${label}${RESET}`);
        }
        if (msg.agent_id) prevAgent = msg.agent_id;

        // Display by message type
        const internal = msg.is_internal ? ` ${DIM}[internal]${RESET}` : '';

        if (msg.message_type === 'thinking') {
          if (verbose) {
            console.log(`  ${label} ${DIM}thinking:${RESET} ${truncate(msg.content, 200)}${internal}`);
          } else {
            const thinkLen = msg.content?.length ?? 0;
            console.log(`  ${label} ${DIM}thinking (${thinkLen} chars)${RESET}${internal}`);
          }
        } else if (msg.message_type === 'tool_use') {
          stats.tools++;
          const toolName = extractToolName(msg.content);
          const toolArgs = extractToolArgs(msg.content, verbose);
          toolCalls.push({ turn: turnNum, agent: msg.agent_id, name: toolName, args: toolArgs, result: '', type: 'request' });
          console.log(`  ${label} ${GREEN}tool_use:${RESET} ${BOLD}${toolName}${RESET}(${toolArgs})${internal}`);
        } else if (msg.message_type === 'tool_result') {
          const resultPreview = truncate(msg.content, verbose ? 300 : 80);
          if (toolCalls.length > 0) {
            toolCalls[toolCalls.length - 1]!.result = resultPreview;
          }
          console.log(`  ${label} ${DIM}tool_result:${RESET} ${resultPreview}${internal}`);
        } else if (msg.message_type === 'text') {
          if (inTok > 0 || outTok > 0) turnLLMCalls++;
          console.log(`  ${label} ${BOLD}response:${RESET} ${truncate(msg.content, verbose ? 500 : 150)}${internal}`);
          if (inTok > 0 || outTok > 0) {
            console.log(`         ${DIM}tokens: in=${formatTokens(inTok)} out=${formatTokens(outTok)} cost=${formatCost(cost)} model=${msg.model ?? '?'}${RESET}`);
          }
        } else if (msg.message_type === 'agent_changed') {
          console.log(`  ${YELLOW}⟳ agent_changed:${RESET} ${truncate(msg.content, 100)}${internal}`);
        } else if (msg.message_type === 'error') {
          console.log(`  ${RED}✗ ERROR:${RESET} ${truncate(msg.content, 200)}${internal}`);
          issues.push(`Turn ${turnNum}: Error - ${truncate(msg.content, 100)}`);
        } else {
          console.log(`  ${label} ${msg.message_type}: ${truncate(msg.content, verbose ? 300 : 100)}${internal}`);
        }

        // Issue detection
        if (!msg.agent_id && msg.role === 'assistant') {
          issues.push(`Turn ${turnNum}: Message seq=${msg.sequence_number} has NULL agent_id (type=${msg.message_type})`);
        }
        if (msg.sequence_number === null) {
          issues.push(`Turn ${turnNum}: Message id=${msg.id.substring(0, 8)} has NULL sequence_number`);
        }
      }

      // Turn summary
      totalIn += turnIn;
      totalOut += turnOut;
      totalCost += turnCost;
      if (turnIn > 0 || turnOut > 0) {
        console.log(`  ${DIM}── turn totals: in=${formatTokens(turnIn)} out=${formatTokens(turnOut)} cost=${formatCost(turnCost)} llm_calls=${turnLLMCalls}${RESET}`);
      }
    }

    // ── Handoff Summary ──
    console.log(`\n${BOLD}${hr('═')}${RESET}`);
    console.log(`${BOLD}  AGENT HANDOFFS (${handoffs.length})${RESET}`);
    console.log(hr('─'));
    if (handoffs.length === 0) {
      console.log(`  ${DIM}No handoffs detected${RESET}`);
    } else {
      for (const h of handoffs) {
        console.log(`  Turn ${h.turn}: ${agentLabel(h.from)} → ${agentLabel(h.to)}`);
      }
    }

    // ── Tool Call Summary ──
    console.log(`\n${BOLD}  TOOL CALLS (${toolCalls.length})${RESET}`);
    console.log(hr('─'));
    if (toolCalls.length === 0) {
      console.log(`  ${DIM}No tool calls detected${RESET}`);
    } else {
      const toolGroups = new Map<string, number>();
      for (const tc of toolCalls) {
        toolGroups.set(tc.name, (toolGroups.get(tc.name) ?? 0) + 1);
      }
      for (const [name, count] of [...toolGroups.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${BOLD}${name}${RESET}: ${count}x`);
      }
    }

    // ── Per-Agent Summary ──
    console.log(`\n${BOLD}  PER-AGENT BREAKDOWN${RESET}`);
    console.log(hr('─'));
    console.log(`  ${'Agent'.padEnd(22)} ${'Msgs'.padStart(5)} ${'Tools'.padStart(6)} ${'In Tok'.padStart(8)} ${'Out Tok'.padStart(9)} ${'Cost'.padStart(10)}  Models`);
    console.log(`  ${hr('─', 78)}`);

    for (const [aId, s] of [...agentStats.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
      const label = aId.padEnd(22);
      const models = [...s.models].map(m => m.replace('claude-', '').substring(0, 20)).join(', ');
      console.log(`  ${label} ${String(s.messages).padStart(5)} ${String(s.tools).padStart(6)} ${String(s.inTok).padStart(8)} ${String(s.outTok).padStart(9)} ${formatCost(s.cost).padStart(18)}  ${DIM}${models}${RESET}`);
    }

    // ── Cost Summary ──
    console.log(`\n${BOLD}  COST SUMMARY${RESET}`);
    console.log(hr('─'));
    console.log(`  Total Input Tokens:  ${formatTokens(totalIn)}`);
    console.log(`  Total Output Tokens: ${formatTokens(totalOut)}`);
    console.log(`  Total Cost:          ${formatCost(totalCost)}`);
    console.log(`  Turns:               ${turns.length}`);
    console.log(`  Avg Cost/Turn:       ${formatCost(turns.length > 0 ? totalCost / turns.length : 0)}`);

    // ── Event Store Summary ──
    if (events.length > 0) {
      console.log(`\n${BOLD}  EVENT STORE (${events.length} events)${RESET}`);
      console.log(hr('─'));
      const eventTypes = new Map<string, number>();
      let unprocessed = 0;
      for (const ev of events) {
        eventTypes.set(ev.event_type, (eventTypes.get(ev.event_type) ?? 0) + 1);
        if (!ev.processed) unprocessed++;
      }
      for (const [type, count] of [...eventTypes.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type.padEnd(35)} ${String(count).padStart(4)}`);
      }
      if (unprocessed > 0) {
        issues.push(`${unprocessed} event(s) not marked as processed`);
      }

      // Sequence gap detection
      const seqNums = events
        .map(e => e.sequence_number)
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b);
      for (let i = 1; i < seqNums.length; i++) {
        const gap = seqNums[i]! - seqNums[i - 1]! - 1;
        if (gap > 0) {
          issues.push(`Sequence gap: ${seqNums[i - 1]} → ${seqNums[i]} (${gap} missing)`);
        }
      }
    }

    // ── Issues ──
    console.log(`\n${BOLD}  ISSUES (${issues.length})${RESET}`);
    console.log(hr('─'));
    if (issues.length === 0) {
      console.log(`  ${GREEN}No issues detected${RESET}`);
    } else {
      for (const issue of issues) {
        console.log(`  ${RED}!${RESET} ${issue}`);
      }
    }

    console.log(`\n${hr('═')}\n`);

  } finally {
    await prisma.$disconnect();
  }
}

// ─── Tool Name/Args Extraction ───────────────────────────────────
function extractToolName(content: string | null): string {
  if (!content) return 'unknown';
  // Try JSON parse for structured tool_use messages
  try {
    const parsed = JSON.parse(content);
    if (parsed.name) return parsed.name;
    if (parsed.tool) return parsed.tool;
  } catch {
    // Not JSON — try text extraction
  }
  // Try common patterns
  const nameMatch = content.match(/"name"\s*:\s*"([^"]+)"/);
  if (nameMatch) return nameMatch[1]!;
  return truncate(content, 40).replace(/\x1b\[[0-9;]*m/g, '');
}

function extractToolArgs(content: string | null, verbose: boolean): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content);
    if (parsed.input) {
      const args = JSON.stringify(parsed.input);
      return verbose ? args : truncate(args, 80).replace(/\x1b\[[0-9;]*m/g, '');
    }
    if (parsed.args) {
      const args = JSON.stringify(parsed.args);
      return verbose ? args : truncate(args, 80).replace(/\x1b\[[0-9;]*m/g, '');
    }
  } catch {
    // Not JSON
  }
  return '';
}

// ─── Multi-Session (--user) Mode ─────────────────────────────────
async function listUserSessions(userId: string, days: number): Promise<void> {
  const prisma = createPrisma();

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const sessions = await prisma.sessions.findMany({
      where: { user_id: userId, created_at: { gte: cutoff } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, title: true, created_at: true, updated_at: true,
        users: { select: { email: true, full_name: true } },
        _count: { select: { messages: true } },
      },
    });

    if (sessions.length === 0) {
      console.log(`${DIM}No sessions found for user ${userId} in the last ${days} days.${RESET}`);
      return;
    }

    console.log(`\n${BOLD}Sessions for ${(sessions[0] as { users: { full_name: string | null } }).users.full_name ?? userId} (last ${days} days)${RESET}\n`);
    console.log(`  ${'#'.padEnd(3)} ${'Session ID'.padEnd(38)} ${'Messages'.padStart(8)} ${'Created'.padEnd(20)}  Title`);
    console.log(`  ${hr('─', 100)}`);

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i] as { id: string; title: string; created_at: Date; _count: { messages: number } };
      const num = String(i + 1).padEnd(3);
      const msgs = String(s._count.messages).padStart(8);
      const created = s.created_at.toISOString().substring(0, 19).replace('T', ' ');
      const title = truncate(s.title, 40).replace(/\x1b\[[0-9;]*m/g, '');
      console.log(`  ${num} ${s.id.padEnd(38)} ${msgs} ${created}  ${title}`);
    }

    console.log(`\n${DIM}Run: npx tsx scripts/diagnose-agent-flow.ts "<session-id>" --verbose${RESET}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Latest Session Mode ─────────────────────────────────────────
async function getLatestSessionId(): Promise<string | null> {
  const prisma = createPrisma();
  try {
    const session = await prisma.sessions.findFirst({
      orderBy: { updated_at: 'desc' },
      select: { id: true },
    });
    return session?.id ?? null;
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
${BOLD}Agent Flow Diagnostic${RESET}
Analyzes multi-agent orchestration: handoffs, tool calls, tokens, and issues.

${BOLD}Usage:${RESET}
  npx tsx scripts/diagnose-agent-flow.ts "<session-id-or-url>"      # Single session
  npx tsx scripts/diagnose-agent-flow.ts "<session-id>" --verbose    # Full content
  npx tsx scripts/diagnose-agent-flow.ts --user "<user-id>"          # List sessions
  npx tsx scripts/diagnose-agent-flow.ts --user "<user-id>" --days 7 # Last 7 days
  npx tsx scripts/diagnose-agent-flow.ts --latest                    # Most recent session
  npx tsx scripts/diagnose-agent-flow.ts --latest --verbose

${BOLD}Output:${RESET}
  Per-turn timeline showing agent routing, thinking, tool calls, responses
  Handoff summary (supervisor → worker transitions)
  Tool call inventory (grouped by name)
  Per-agent token breakdown with cost
  Event store analysis with sequence gap detection
  Issues list (NULL agent_id, missing sequences, errors)

${BOLD}LOG_SERVICES for live debugging:${RESET}
  Chat + Orchestrator:
    LOG_SERVICES=ChatMessageHandler,AgentOrchestrator,MessageContextBuilder,SupervisorGraph,EventProcessor,PersistenceCoordinator

  RAG + Search:
    LOG_SERVICES=RAGAgent,SemanticSearchService,VectorSearchService,SemanticSearchHandler,FileContextPreparer

  Tools + Agents:
    LOG_SERVICES=ToolLifecycleManager,BCAgent,RAGAgent,FirstCallToolEnforcer,AgentBuilders

  Full flow:
    LOG_SERVICES=ChatMessageHandler,AgentOrchestrator,MessageContextBuilder,SupervisorGraph,GraphExecutor,EventProcessor,PersistenceCoordinator,ToolLifecycleManager,UsageTrackingService,RAGAgent,BCAgent
`);
    process.exit(0);
  }

  const verbose = hasFlag('--verbose') || hasFlag('-v');
  const userId = getFlag('--user');
  const latest = hasFlag('--latest');

  if (userId) {
    const days = getNumericFlag('--days', 30);
    await listUserSessions(userId.toUpperCase(), days);
    return;
  }

  let sessionInput = getPositionalArg();

  if (latest) {
    const latestId = await getLatestSessionId();
    if (!latestId) {
      console.error(`${RED}No sessions found in database.${RESET}`);
      process.exit(1);
    }
    sessionInput = latestId;
    console.log(`${DIM}Using latest session: ${latestId}${RESET}`);
  }

  if (!sessionInput) {
    console.error(`${RED}Error: Provide a session ID, --user <id>, or --latest${RESET}`);
    console.error(`Run with --help for usage.`);
    process.exit(1);
  }

  const sessionId = extractSessionId(sessionInput);
  await analyzeSession(sessionId, verbose);
}

main().catch((err) => {
  console.error(`${RED}Fatal: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  process.exit(1);
});
