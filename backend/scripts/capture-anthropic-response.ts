#!/usr/bin/env tsx
/**
 * Anthropic API Response Capture Script
 *
 * Captures real Anthropic API responses for E2E test mock validation.
 * Saves both streaming events and final responses as JSON fixtures.
 *
 * Usage:
 *   npx tsx scripts/capture-anthropic-response.ts --scenario=thinking-tools
 *   npx tsx scripts/capture-anthropic-response.ts --message="List 5 customers" --thinking
 *   npx tsx scripts/capture-anthropic-response.ts --help
 *
 * Output:
 *   backend/src/__tests__/fixtures/captured/
 *     └── {scenario}-{timestamp}.json
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageStreamEvent,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
import 'dotenv/config';

// Import SDK types and type guards
import {
  ANTHROPIC_SDK_VERSION,
  isTextBlock,
  isToolUseBlock,
  isThinkingBlock,
} from '../src/types/sdk.js';

// ============================================================================
// Synthetic Tools for Testing
// ============================================================================

/**
 * Simple synthetic tools that Claude will ALWAYS use when asked.
 * These are designed to guarantee tool_use events for mock validation.
 */
const SYNTHETIC_TOOLS: Anthropic.Tool[] = [
  {
    name: 'calculator',
    description: 'Performs mathematical calculations. You MUST use this tool for ANY math problem, equation, or arithmetic operation. Do not attempt to calculate in your head - always use this tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate, e.g., "15 * 23" or "100 / 4"',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'get_current_time',
    description: 'Gets the current date and time. Use this tool when asked about the current time, date, or timezone information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        timezone: {
          type: 'string',
          description: 'The timezone to get time for, e.g., "UTC", "America/New_York", "Europe/London"',
        },
      },
      required: ['timezone'],
    },
  },
];

// Types
interface CapturedResponse {
  metadata: {
    capturedAt: string;
    scenario: string;
    model: string;
    sdkVersion: string;
    scriptVersion: string;
    request: {
      message: string;
      thinking: boolean;
      thinkingBudget?: number;
      toolsEnabled: boolean;
      toolCount: number;
    };
  };
  // Use Message type from SDK
  finalResponse: Message;
  // Use MessageStreamEvent from SDK
  streamingEvents: Array<{
    index: number;
    event: MessageStreamEvent;
    timestampMs: number;
  }>;
  eventTimings: { type: string; deltaMs: number }[];
  contentSummary: {
    thinkingBlocks: number;
    textBlocks: number;
    toolUseBlocks: number;
  };
}

interface CaptureOptions {
  scenario?: string;
  message?: string;
  enableThinking?: boolean;
  thinkingBudget?: number;
  /** false = no tools, true/'bc' = BC tools, 'synthetic' = test tools */
  tools?: boolean | 'synthetic' | 'bc';
  outputDir?: string;
}

// Predefined scenarios
const SCENARIOS: Record<string, CaptureOptions> = {
  'simple': {
    scenario: 'simple',
    message: 'What is 2 + 2? Give a brief answer.',
    enableThinking: false,
    tools: false,
  },
  'thinking': {
    scenario: 'thinking',
    message: 'Explain the accounting cycle briefly. Think through your answer.',
    enableThinking: true,
    thinkingBudget: 5000,
    tools: false,
  },
  'thinking-tools': {
    scenario: 'thinking-tools',
    message: 'List the first 3 customers. Think through which tool to use.',
    enableThinking: true,
    thinkingBudget: 5000,
    tools: true,
  },
  'tools-only': {
    scenario: 'tools-only',
    message: 'Get a list of 3 customers.',
    enableThinking: false,
    tools: true,
  },
  'multi-tool': {
    scenario: 'multi-tool',
    message: 'Get 2 customers and 2 items in a single response.',
    enableThinking: false,
    tools: 'bc',
  },
  // ============================================================================
  // Synthetic Tool Scenarios (guaranteed tool_use events)
  // ============================================================================
  'tool-use-simple': {
    scenario: 'tool-use-simple',
    message: 'What is 15 multiplied by 23? You must use the calculator tool to compute this.',
    enableThinking: false,
    tools: 'synthetic',
  },
  'tool-use-multi': {
    scenario: 'tool-use-multi',
    message: 'I need two things: First, calculate 10 + 5 using the calculator. Second, get the current time in UTC timezone. Use both tools.',
    enableThinking: false,
    tools: 'synthetic',
  },
  'thinking-tool-use': {
    scenario: 'thinking-tool-use',
    message: 'Think step by step about what 100 divided by 4 equals, then use the calculator tool to verify your thinking.',
    enableThinking: true,
    thinkingBudget: 5000,
    tools: 'synthetic',
  },
};

// Load BC tools from MCP server
function loadBCTools(): Anthropic.Tool[] {
  const toolsDir = join(__dirname, '../mcp-server/data/v1.0/entities');

  if (!existsSync(toolsDir)) {
    console.log('  BC tools directory not found, using empty tools list');
    return [];
  }

  const tools: Anthropic.Tool[] = [];
  const files = readdirSync(toolsDir).filter(f => f.endsWith('.json'));

  for (const file of files.slice(0, 10)) { // Limit to 10 tools for capture
    try {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const toolDef = JSON.parse(content);
      tools.push({
        name: toolDef.name || file.replace('.json', ''),
        description: toolDef.description || 'Business Central tool',
        input_schema: toolDef.inputSchema || { type: 'object', properties: {} },
      });
    } catch (e) {
      // Skip invalid files
    }
  }

  return tools;
}

async function captureResponse(options: CaptureOptions): Promise<CapturedResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set');
  }

  const client = new Anthropic({ apiKey });
  const startTime = Date.now();
  const streamingEvents: Array<{
    index: number;
    event: MessageStreamEvent;
    timestampMs: number;
  }> = [];
  let eventIndex = 0;

  // Load tools based on options
  let tools: Anthropic.Tool[] = [];
  let toolSource = 'none';

  if (options.tools === 'synthetic') {
    tools = SYNTHETIC_TOOLS;
    toolSource = 'synthetic';
  } else if (options.tools === true || options.tools === 'bc') {
    tools = loadBCTools();
    toolSource = 'bc';
  }

  console.log(`  Tools loaded: ${tools.length} (source: ${toolSource})`);

  // Build request
  const model = 'claude-sonnet-4-20250514';
  // max_tokens must be greater than thinking.budget_tokens
  const thinkingBudget = options.enableThinking ? (options.thinkingBudget || 5000) : 0;
  const maxTokens = Math.max(4096, thinkingBudget + 1024);

  const request: Anthropic.MessageCreateParamsStreaming = {
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: [{ role: 'user', content: options.message || 'Hello' }],
  };

  if (tools.length > 0) {
    request.tools = tools;
  }

  if (options.enableThinking) {
    request.thinking = {
      type: 'enabled',
      budget_tokens: options.thinkingBudget || 5000,
    };
  }

  console.log(`\n  Sending request to Anthropic API...`);
  console.log(`  Model: ${model}`);
  console.log(`  Message: ${options.message?.substring(0, 50)}...`);
  console.log(`  Thinking: ${options.enableThinking ? `enabled (budget: ${options.thinkingBudget})` : 'disabled'}`);
  console.log(`  Tools: ${tools.length > 0 ? `${tools.length} loaded` : 'disabled'}\n`);

  // Stream the response
  const stream = client.messages.stream(request);

  // Capture raw streaming events (MessageStreamEvent type from SDK)
  for await (const event of stream) {
    streamingEvents.push({
      index: eventIndex++,
      event: event, // Store the raw MessageStreamEvent
      timestampMs: Date.now() - startTime,
    });

    if (event.type === 'content_block_start') {
      console.log(`  [${event.type}] Block ${event.index}: ${event.content_block?.type}`);
    } else if (event.type === 'message_delta') {
      console.log(`  [${event.type}] Stop reason: ${event.delta?.stop_reason}`);
    }
  }

  // Get final message
  const finalMessage = await stream.finalMessage();
  console.log(`\n  Request completed in ${Date.now() - startTime}ms`);

  // Build content summary using type guards
  const contentSummary = {
    thinkingBlocks: 0,
    textBlocks: 0,
    toolUseBlocks: 0,
  };

  for (const block of finalMessage.content) {
    if (isThinkingBlock(block)) contentSummary.thinkingBlocks++;
    else if (isTextBlock(block)) contentSummary.textBlocks++;
    else if (isToolUseBlock(block)) contentSummary.toolUseBlocks++;
  }

  // Build captured response
  const captured: CapturedResponse = {
    metadata: {
      capturedAt: new Date().toISOString(),
      scenario: options.scenario || 'custom',
      model,
      sdkVersion: ANTHROPIC_SDK_VERSION,
      scriptVersion: '1.0.0',
      request: {
        message: options.message || 'Hello',
        thinking: options.enableThinking || false,
        thinkingBudget: options.thinkingBudget,
        toolsEnabled: tools.length > 0,
        toolCount: tools.length,
      },
    },
    // Use the SDK Message type directly
    finalResponse: finalMessage,
    streamingEvents,
    eventTimings: streamingEvents.map(e => ({
      type: e.event.type,
      deltaMs: e.timestampMs,
    })),
    contentSummary,
  };

  return captured;
}

function parseArgs(args: string[]): CaptureOptions {
  const options: CaptureOptions = {};

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg.startsWith('--scenario=')) {
      options.scenario = arg.split('=')[1];
    } else if (arg.startsWith('--message=')) {
      options.message = arg.split('=')[1];
    } else if (arg === '--thinking') {
      options.enableThinking = true;
    } else if (arg.startsWith('--thinking-budget=')) {
      options.thinkingBudget = parseInt(arg.split('=')[1] || '5000', 10);
    } else if (arg === '--tools') {
      options.tools = true;
    } else if (arg.startsWith('--output=')) {
      options.outputDir = arg.split('=')[1];
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Anthropic API Response Capture Script

Usage:
  npx tsx scripts/capture-anthropic-response.ts [options]

Options:
  --scenario=<name>     Use predefined scenario (simple, thinking, thinking-tools, tools-only, multi-tool)
  --message=<text>      Custom message to send
  --thinking            Enable extended thinking
  --thinking-budget=N   Set thinking budget (default: 5000)
  --tools               Enable BC tools
  --output=<dir>        Output directory (default: src/__tests__/fixtures/captured)
  --help, -h            Show this help

Examples:
  npx tsx scripts/capture-anthropic-response.ts --scenario=thinking-tools
  npx tsx scripts/capture-anthropic-response.ts --message="Hello" --thinking
  npx tsx scripts/capture-anthropic-response.ts --message="Get customers" --tools

Predefined Scenarios:
  simple           - Basic text response (no thinking, no tools)
  thinking         - Extended thinking (no tools)
  thinking-tools   - Extended thinking with BC tools
  tools-only       - BC tools without thinking
  multi-tool       - Multiple BC tool calls

  Synthetic Tool Scenarios (guaranteed tool_use):
  tool-use-simple  - Single calculator tool call
  tool-use-multi   - Multiple synthetic tool calls
  thinking-tool-use - Extended thinking + calculator tool
`);
}

async function main(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Anthropic API Response Capture');
  console.log('═══════════════════════════════════════════════════════════════');

  // Parse arguments
  const args = parseArgs(process.argv.slice(2));

  // Merge with predefined scenario if specified
  let options: CaptureOptions;
  if (args.scenario && SCENARIOS[args.scenario]) {
    options = { ...SCENARIOS[args.scenario], ...args };
    console.log(`\n  Using predefined scenario: ${args.scenario}`);
  } else if (args.message) {
    options = args;
    options.scenario = 'custom';
    console.log('\n  Using custom message');
  } else {
    console.error('\n  Error: Either --scenario or --message is required');
    console.log('  Use --help for usage information');
    process.exit(1);
  }

  try {
    // Capture response
    const captured = await captureResponse(options);

    // Save to file
    const outputDir = options.outputDir || join(__dirname, '../src/__tests__/fixtures/captured');
    mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `${options.scenario}-${timestamp}.json`;
    const filepath = join(outputDir, filename);

    writeFileSync(filepath, JSON.stringify(captured, null, 2));
    console.log(`\n  ✓ Saved to: ${filepath}`);

    // Print summary
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('  Capture Summary');
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  Streaming events: ${captured.streamingEvents.length}`);
    console.log(`  Thinking blocks: ${captured.contentSummary.thinkingBlocks}`);
    console.log(`  Text blocks: ${captured.contentSummary.textBlocks}`);
    console.log(`  Tool use blocks: ${captured.contentSummary.toolUseBlocks}`);
    console.log(`  Input tokens: ${captured.finalResponse.usage.input_tokens}`);
    console.log(`  Output tokens: ${captured.finalResponse.usage.output_tokens}`);
    console.log(`  Stop reason: ${captured.finalResponse.stop_reason}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n  ✗ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
