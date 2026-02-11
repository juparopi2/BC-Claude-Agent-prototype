/**
 * Inspect Session Timeline
 *
 * QA diagnostic script that queries the database for a session's complete timeline.
 * Shows messages, events, citations, and potential issues.
 *
 * Usage:
 *   npx tsx scripts/inspect-session.ts "06b512d0-930f-4f6d-a795-9dde6c11379c"
 *   npx tsx scripts/inspect-session.ts "http://localhost:3000/chat/06b512d0-930f-4f6d-a795-9dde6c11379c"
 *   npx tsx scripts/inspect-session.ts "06b512d0-930f-4f6d-a795-9dde6c11379c" --verbose
 *   npx tsx scripts/inspect-session.ts "06b512d0-930f-4f6d-a795-9dde6c11379c" --events
 */

import 'dotenv/config';
import { createPrisma } from './_shared/prisma';
import { getPositionalArg, hasFlag } from './_shared/args';

// ============================================================================
// Types
// ============================================================================

interface SessionRecord {
  id: string;
  user_id: string;
  title: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  user: {
    email: string;
    full_name: string | null;
  };
}

interface MessageRecord {
  id: string;
  session_id: string;
  role: string;
  content: string;
  metadata: string | null;
  token_count: number | null;
  created_at: Date;
  message_type: string;
  stop_reason: string | null;
  sequence_number: number | null;
  event_id: string | null;
  tool_use_id: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  agent_id: string | null;
}

interface EventRecord {
  id: string;
  session_id: string;
  event_type: string;
  sequence_number: number;
  timestamp: Date;
  data: string;
  processed: boolean;
}

interface CitationRecord {
  id: string;
  message_id: string;
  file_id: string | null;
  file_name: string;
  source_type: string;
  mime_type: string;
  relevance_score: number;
  is_image: boolean;
  excerpt_count: number;
  created_at: Date;
}

interface SessionSummary {
  messageCountByRole: Record<string, number>;
  eventCountByType: Record<string, number>;
  messageCountByAgent: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
  citationCount: number;
  uniqueFileCount: number;
}

interface PotentialIssue {
  type: string;
  description: string;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): { sessionIdOrUrl: string; verbose: boolean; showEvents: boolean } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Session Inspector Script

Usage:
  npx tsx scripts/inspect-session.ts "<session-id-or-url>" [--verbose] [--events]

Arguments:
  <session-id-or-url>  Session ID or URL containing session ID
  --verbose, -v        Show full content instead of truncated
  --events             Show message_events table data

Examples:
  npx tsx scripts/inspect-session.ts "06b512d0-930f-4f6d-a795-9dde6c11379c"
  npx tsx scripts/inspect-session.ts "http://localhost:3000/chat/06b512d0-930f-4f6d-a795-9dde6c11379c"
  npx tsx scripts/inspect-session.ts "06b512d0-930f-4f6d-a795-9dde6c11379c" --verbose
  npx tsx scripts/inspect-session.ts "06b512d0-930f-4f6d-a795-9dde6c11379c" --events
`);
    process.exit(0);
  }

  const sessionIdOrUrl = getPositionalArg() || '';
  const verbose = hasFlag('--verbose') || hasFlag('-v');
  const showEvents = hasFlag('--events');

  if (!sessionIdOrUrl) {
    console.error('ERROR: Session ID or URL is required');
    process.exit(1);
  }

  return { sessionIdOrUrl, verbose, showEvents };
}

// ============================================================================
// ID Normalization
// ============================================================================

function extractSessionId(input: string): string {
  // Extract UUID from URL if provided
  const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  const match = input.match(uuidRegex);

  if (!match) {
    console.error('ERROR: No valid UUID found in input');
    process.exit(1);
  }

  // Normalize to UPPERCASE per project rules
  return match[0].toUpperCase();
}

// ============================================================================
// Database Queries
// ============================================================================

async function getSession(
  prisma: ReturnType<typeof createPrisma>,
  sessionId: string
): Promise<SessionRecord | null> {
  const session = await prisma.sessions.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      user_id: true,
      title: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      users: {
        select: {
          email: true,
          full_name: true,
        },
      },
    },
  });

  if (!session) return null;

  return {
    id: session.id.toUpperCase(),
    user_id: session.user_id.toUpperCase(),
    title: session.title,
    is_active: session.is_active,
    created_at: session.created_at,
    updated_at: session.updated_at,
    user: session.users,
  };
}

async function getMessages(
  prisma: ReturnType<typeof createPrisma>,
  sessionId: string
): Promise<MessageRecord[]> {
  const messages = await prisma.messages.findMany({
    where: { session_id: sessionId },
    orderBy: [
      { sequence_number: 'asc' },
      { created_at: 'asc' },
    ],
  });

  return messages.map((m) => ({
    ...m,
    session_id: m.session_id.toUpperCase(),
    event_id: m.event_id ? m.event_id.toUpperCase() : null,
  }));
}

async function getEvents(
  prisma: ReturnType<typeof createPrisma>,
  sessionId: string
): Promise<EventRecord[]> {
  const events = await prisma.message_events.findMany({
    where: { session_id: sessionId },
    orderBy: [
      { sequence_number: 'asc' },
      { timestamp: 'asc' },
    ],
  });

  return events.map((e) => ({
    ...e,
    id: e.id.toUpperCase(),
    session_id: e.session_id.toUpperCase(),
  }));
}

async function getCitations(
  prisma: ReturnType<typeof createPrisma>,
  sessionId: string
): Promise<CitationRecord[]> {
  // message_citations has no direct relation to sessions in schema,
  // so we first get message IDs for this session, then query citations
  const messageIds = await prisma.messages.findMany({
    where: { session_id: sessionId },
    select: { id: true },
  });

  if (messageIds.length === 0) return [];

  const citations = await prisma.message_citations.findMany({
    where: {
      message_id: { in: messageIds.map((m) => m.id) },
    },
    orderBy: [
      { message_id: 'asc' },
      { relevance_score: 'desc' },
    ],
  });

  return citations.map((c) => ({
    ...c,
    id: c.id.toUpperCase(),
    file_id: c.file_id ? c.file_id.toUpperCase() : null,
    relevance_score: Number(c.relevance_score),
  }));
}

// ============================================================================
// Analysis
// ============================================================================

function analyzeSummary(
  messages: MessageRecord[],
  events: EventRecord[],
  citations: CitationRecord[]
): SessionSummary {
  const messageCountByRole: Record<string, number> = {};
  const eventCountByType: Record<string, number> = {};
  const messageCountByAgent: Record<string, number> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Count messages by role and message_type
  for (const msg of messages) {
    const key = msg.message_type || msg.role;
    messageCountByRole[key] = (messageCountByRole[key] || 0) + 1;

    if (msg.agent_id) {
      messageCountByAgent[msg.agent_id] = (messageCountByAgent[msg.agent_id] || 0) + 1;
    }

    totalInputTokens += msg.input_tokens || 0;
    totalOutputTokens += msg.output_tokens || 0;
  }

  // Count events by type
  for (const event of events) {
    eventCountByType[event.event_type] = (eventCountByType[event.event_type] || 0) + 1;
  }

  // Count citations
  const uniqueFileIds = new Set<string>();
  for (const citation of citations) {
    if (citation.file_id) {
      uniqueFileIds.add(citation.file_id);
    }
  }

  return {
    messageCountByRole,
    eventCountByType,
    messageCountByAgent,
    totalInputTokens,
    totalOutputTokens,
    citationCount: citations.length,
    uniqueFileCount: uniqueFileIds.size,
  };
}

function detectIssues(messages: MessageRecord[]): PotentialIssue[] {
  const issues: PotentialIssue[] = [];

  // Check for NULL agent_id in assistant messages
  const nullAgentCount = messages.filter(
    (m) => m.role === 'assistant' && !m.agent_id
  ).length;
  if (nullAgentCount > 0) {
    issues.push({
      type: 'NULL_AGENT_ID',
      description: `${nullAgentCount} assistant messages have NULL agent_id`,
    });
  }

  // Check for NULL sequence_number
  const nullSeqCount = messages.filter((m) => m.sequence_number === null).length;
  if (nullSeqCount > 0) {
    issues.push({
      type: 'NULL_SEQUENCE_NUMBER',
      description: `${nullSeqCount} messages have NULL sequence_number`,
    });
  }

  // Check for sequence gaps
  const sequenceNumbers = messages
    .map((m) => m.sequence_number)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  for (let i = 1; i < sequenceNumbers.length; i++) {
    if (sequenceNumbers[i] - sequenceNumbers[i - 1] > 1) {
      issues.push({
        type: 'SEQUENCE_GAP',
        description: `Sequence gap detected between #${sequenceNumbers[i - 1]} and #${sequenceNumbers[i]}`,
      });
    }
  }

  return issues;
}

// ============================================================================
// Display Utilities
// ============================================================================

const AGENT_ICONS: Record<string, string> = {
  'bc-agent': '📊',
  'rag-agent': '🧠',
  'supervisor': '🎯',
  'graphing-agent': '📈',
};

function getAgentIcon(agentId: string | null): string {
  if (!agentId) return '';
  return AGENT_ICONS[agentId] || '🤖';
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

function truncate(text: string, maxLen: number, verbose: boolean): string {
  if (verbose || text.length <= maxLen) {
    return text;
  }
  return text.substring(0, maxLen) + '...';
}

function formatMessageContent(msg: MessageRecord, verbose: boolean): string {
  if (msg.message_type === 'tool_use' || msg.role === 'tool') {
    // Try to parse metadata for tool info
    let toolName = 'unknown';
    let toolArgs = '';

    try {
      if (msg.metadata) {
        const meta = JSON.parse(msg.metadata);
        if (meta.name) toolName = meta.name;
        if (meta.input) toolArgs = JSON.stringify(meta.input);
      }
    } catch {
      // Fallback to content parsing
      toolName = msg.tool_use_id || 'unknown';
    }

    return `tool=${toolName} args=${truncate(toolArgs || '{}', 40, verbose)}`;
  }

  if (msg.message_type === 'tool_result') {
    const charCount = msg.content ? msg.content.length : 0;
    return `(${charCount} chars)`;
  }

  return truncate(msg.content || '', 80, verbose);
}

function displaySessionHeader(session: SessionRecord): void {
  const sessionIdShort = session.id.substring(0, 24) + '...';
  console.log('═'.repeat(60));
  console.log(`  SESSION INSPECTOR: ${sessionIdShort}`);
  console.log('═'.repeat(60));
  console.log();
}

function displaySessionInfo(session: SessionRecord): void {
  console.log('📋 Session Info');
  console.log(`  Owner:    ${session.user_id}`);
  console.log(`  Name:     ${session.user.full_name || '(not set)'}`);
  console.log(`  Email:    ${session.user.email}`);
  console.log(`  Title:    "${session.title}"`);
  console.log(`  Created:  ${formatTimestamp(session.created_at)}`);
  console.log(`  Status:   ${session.is_active ? 'active' : 'inactive'}`);
  console.log();
}

function displaySummary(summary: SessionSummary): void {
  console.log('📊 Summary');

  // Messages breakdown
  const msgParts = Object.entries(summary.messageCountByRole)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${count} ${type}`);
  const msgTotal = Object.values(summary.messageCountByRole).reduce((a, b) => a + b, 0);
  console.log(`  Messages:  ${msgTotal} total (${msgParts.join(', ')})`);

  // Events breakdown
  if (Object.keys(summary.eventCountByType).length > 0) {
    const eventParts = Object.entries(summary.eventCountByType)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, count]) => `${count} ${type}`);
    const eventTotal = Object.values(summary.eventCountByType).reduce((a, b) => a + b, 0);
    console.log(`  Events:    ${eventTotal} total (${eventParts.join(', ')})`);
  }

  // Agents breakdown
  if (Object.keys(summary.messageCountByAgent).length > 0) {
    const agentParts = Object.entries(summary.messageCountByAgent)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([agent, count]) => `${agent} (${count})`);
    console.log(`  Agents:    ${agentParts.join(', ')}`);
  }

  // Tokens
  const formattedInput = summary.totalInputTokens.toLocaleString();
  const formattedOutput = summary.totalOutputTokens.toLocaleString();
  console.log(`  Tokens:    ${formattedInput} input / ${formattedOutput} output`);

  // Citations
  console.log(`  Citations: ${summary.citationCount} (from ${summary.uniqueFileCount} files)`);
  console.log();
}

function displayMessages(messages: MessageRecord[], verbose: boolean): void {
  console.log('📨 Messages (by sequence_number)');

  if (messages.length === 0) {
    console.log('  (no messages)');
    console.log();
    return;
  }

  for (const msg of messages) {
    const seq = msg.sequence_number !== null ? `#${msg.sequence_number}` : '#?';
    const role = msg.role.padEnd(12);
    const icon = getAgentIcon(msg.agent_id);
    const agentLabel = msg.agent_id ? `[${msg.agent_id}] ${icon}` : '';
    const content = formatMessageContent(msg, verbose);

    console.log(`  ${seq.padEnd(5)} [${role}] ${agentLabel} "${content}"`);
  }
  console.log();
}

function displayEvents(events: EventRecord[], verbose: boolean): void {
  console.log('📝 Event Store (message_events)');

  if (events.length === 0) {
    console.log('  (no events)');
    console.log();
    return;
  }

  for (const event of events) {
    const seq = `#${event.sequence_number}`;
    const processed = event.processed ? '✓' : '✗';
    const timestamp = formatTimestamp(event.timestamp);
    const type = event.event_type.padEnd(25);

    console.log(`  ${seq.padEnd(5)} ${type} processed=${processed}  ${timestamp}`);

    if (verbose) {
      const dataTrunc = truncate(event.data, 200, verbose);
      console.log(`         data: ${dataTrunc}`);
    }
  }
  console.log();
}

function displayCitations(citations: CitationRecord[]): void {
  console.log('📎 Citations');

  if (citations.length === 0) {
    console.log('  (no citations)');
    console.log();
    return;
  }

  // Group by message_id
  const citationsByMessage: Record<string, CitationRecord[]> = {};
  for (const citation of citations) {
    if (!citationsByMessage[citation.message_id]) {
      citationsByMessage[citation.message_id] = [];
    }
    citationsByMessage[citation.message_id].push(citation);
  }

  for (const [messageId, msgCitations] of Object.entries(citationsByMessage)) {
    for (const citation of msgCitations) {
      const relevance = citation.relevance_score.toFixed(2);
      const excerpts = citation.excerpt_count;
      console.log(`  ${messageId} → "${citation.file_name}" (relevance: ${relevance}, excerpts: ${excerpts})`);
    }
  }
  console.log();
}

function displayIssues(issues: PotentialIssue[]): void {
  if (issues.length === 0) {
    return;
  }

  console.log('⚠️  Potential Issues');
  for (const issue of issues) {
    console.log(`  - ${issue.description}`);
  }
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { sessionIdOrUrl, verbose, showEvents } = parseArgs();
  const sessionId = extractSessionId(sessionIdOrUrl);

  const prisma = createPrisma();

  try {
    // Fetch all data
    const session = await getSession(prisma, sessionId);

    if (!session) {
      console.error(`\nERROR: Session not found: ${sessionId}\n`);
      process.exit(1);
    }

    const [messages, events, citations] = await Promise.all([
      getMessages(prisma, sessionId),
      getEvents(prisma, sessionId),
      getCitations(prisma, sessionId),
    ]);

    // Analyze
    const summary = analyzeSummary(messages, events, citations);
    const issues = detectIssues(messages);

    // Display
    displaySessionHeader(session);
    displaySessionInfo(session);
    displaySummary(summary);
    displayMessages(messages, verbose);

    if (showEvents) {
      displayEvents(events, verbose);
    }

    displayCitations(citations);
    displayIssues(issues);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
