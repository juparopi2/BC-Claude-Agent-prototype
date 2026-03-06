/**
 * WebSocket Event Capture Script
 *
 * Captures all WebSocket events emitted by the backend during a chat session.
 * This is a diagnostic tool for comparing backend WebSocket events with raw Claude API events.
 *
 * Usage:
 *   npx tsx backend/scripts/capture-websocket-events.ts \
 *     --url "http://localhost:3002" \
 *     --session-id "test-session-123" \
 *     --user-id "test-user-456" \
 *     --message "What is 2+2?" \
 *     --output "docs/plans/phase-0/captured-events/"
 *
 * Requirements:
 *   - Backend must be running (npm run dev)
 *   - Backend must have a valid session (or use test endpoint without auth)
 *
 * @module scripts/capture-websocket-events
 */

import { io, Socket } from 'socket.io-client';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Captured WebSocket event
 */
interface WebSocketCapture {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Event name (e.g., 'connect', 'agent:event', 'disconnect') */
  eventName: string;
  /** Event payload (unknown type for maximum flexibility) */
  payload: unknown;
}

/**
 * Complete capture report
 */
interface WebSocketCaptureReport {
  /** Capture start time (Unix timestamp) */
  startTime: number;
  /** Capture end time (Unix timestamp) */
  endTime: number;
  /** Server URL */
  serverUrl: string;
  /** Session ID */
  sessionId: string;
  /** User ID */
  userId: string;
  /** Message sent to agent */
  message: string;
  /** All captured events in chronological order */
  events: WebSocketCapture[];
  /** Capture metadata */
  metadata: {
    /** Total number of events captured */
    totalEvents: number;
    /** Duration of capture in milliseconds */
    durationMs: number;
    /** Event type counts */
    eventTypeCounts: Record<string, number>;
  };
}

/**
 * CLI arguments
 */
interface CLIArgs {
  url: string;
  sessionId: string;
  userId: string;
  message: string;
  output: string;
  timeout: number;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

/**
 * Parse command-line arguments
 */
function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<CLIArgs> = {
    url: 'http://localhost:3002',
    sessionId: `test-session-${Date.now()}`,
    userId: `test-user-${Date.now()}`,
    message: 'What is 2+2?',
    output: 'docs/plans/phase-0/captured-events/',
    timeout: 60000, // 60 seconds default
  };

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];

    switch (key) {
      case '--url':
        parsed.url = value;
        break;
      case '--session-id':
        parsed.sessionId = value;
        break;
      case '--user-id':
        parsed.userId = value;
        break;
      case '--message':
        parsed.message = value;
        break;
      case '--output':
        parsed.output = value;
        break;
      case '--timeout':
        parsed.timeout = parseInt(value, 10);
        break;
      case '--help':
        console.log(`
WebSocket Event Capture Script

Usage:
  npx tsx backend/scripts/capture-websocket-events.ts [options]

Options:
  --url <url>              Server URL (default: http://localhost:3002)
  --session-id <id>        Session ID (default: test-session-{timestamp})
  --user-id <id>           User ID (default: test-user-{timestamp})
  --message <message>      Message to send (default: "What is 2+2?")
  --output <path>          Output directory (default: docs/plans/phase-0/captured-events/)
  --timeout <ms>           Timeout in milliseconds (default: 60000)
  --help                   Show this help message

Example:
  npx tsx backend/scripts/capture-websocket-events.ts \\
    --message "Tell me a joke" \\
    --timeout 30000
        `);
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${key}`);
        process.exit(1);
    }
  }

  return parsed as CLIArgs;
}

// ============================================================================
// WebSocket Event Capture
// ============================================================================

/**
 * Capture WebSocket events during a chat session
 */
async function captureWebSocketEvents(args: CLIArgs): Promise<WebSocketCaptureReport> {
  const startTime = Date.now();
  const events: WebSocketCapture[] = [];

  console.log('🔌 Connecting to WebSocket server...');
  console.log(`   URL: ${args.url}`);
  console.log(`   Session ID: ${args.sessionId}`);
  console.log(`   User ID: ${args.userId}`);
  console.log(`   Message: "${args.message}"`);
  console.log(`   Timeout: ${args.timeout}ms`);
  console.log('');

  return new Promise<WebSocketCaptureReport>((resolveCapture, rejectCapture) => {
    // Create Socket.IO client
    const socket: Socket = io(args.url, {
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: args.timeout,
    });

    // Timeout handler
    const timeoutHandle = setTimeout(() => {
      console.error('❌ Capture timed out after', args.timeout, 'ms');
      socket.disconnect();
      rejectCapture(new Error(`Capture timed out after ${args.timeout}ms`));
    }, args.timeout);

    // Helper to capture an event
    const captureEvent = (eventName: string, payload: unknown): void => {
      const capture: WebSocketCapture = {
        timestamp: Date.now(),
        eventName,
        payload,
      };
      events.push(capture);
      console.log(`📡 [${eventName}]`, JSON.stringify(payload).substring(0, 100));
    };

    // Connection handlers
    socket.on('connect', () => {
      console.log('✅ Connected to WebSocket server');
      captureEvent('connect', { socketId: socket.id });

      // Send chat message
      console.log('📤 Sending chat message...');
      const messagePayload = {
        sessionId: args.sessionId,
        userId: args.userId,
        message: args.message,
      };
      socket.emit('chat:message', messagePayload);
      captureEvent('chat:message', messagePayload);
    });

    socket.on('connect_error', (error: Error) => {
      console.error('❌ Connection error:', error.message);
      captureEvent('connect_error', { error: error.message });
      clearTimeout(timeoutHandle);
      rejectCapture(error);
    });

    socket.on('disconnect', (reason: string) => {
      console.log('🔌 Disconnected:', reason);
      captureEvent('disconnect', { reason });
      clearTimeout(timeoutHandle);

      // Build final report
      const endTime = Date.now();
      const report = buildReport(
        startTime,
        endTime,
        args,
        events
      );

      resolveCapture(report);
    });

    // Capture ALL agent events
    socket.on('agent:event', (payload: unknown) => {
      captureEvent('agent:event', payload);

      // Check if this is a 'complete' event to end capture
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'type' in payload &&
        payload.type === 'complete'
      ) {
        console.log('✅ Received complete event - ending capture');
        setTimeout(() => {
          socket.disconnect();
        }, 500); // Give a small delay for any trailing events
      }

      // Check for error events
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'type' in payload &&
        payload.type === 'error'
      ) {
        console.error('❌ Received error event');
      }
    });

    // Capture any other events
    socket.onAny((eventName: string, ...argsArray: unknown[]) => {
      // Skip if already captured by specific handlers
      if (
        eventName === 'connect' ||
        eventName === 'connect_error' ||
        eventName === 'disconnect' ||
        eventName === 'agent:event'
      ) {
        return;
      }

      console.log(`📡 [${eventName}] (unexpected event)`);
      captureEvent(eventName, argsArray.length === 1 ? argsArray[0] : argsArray);
    });
  });
}

/**
 * Build the capture report
 */
function buildReport(
  startTime: number,
  endTime: number,
  args: CLIArgs,
  events: WebSocketCapture[]
): WebSocketCaptureReport {
  // Count event types
  const eventTypeCounts: Record<string, number> = {};
  for (const event of events) {
    // For agent:event, use the payload.type as the key
    let eventKey = event.eventName;
    if (
      event.eventName === 'agent:event' &&
      typeof event.payload === 'object' &&
      event.payload !== null &&
      'type' in event.payload
    ) {
      eventKey = `agent:event[${String((event.payload as { type: string }).type)}]`;
    }

    eventTypeCounts[eventKey] = (eventTypeCounts[eventKey] ?? 0) + 1;
  }

  return {
    startTime,
    endTime,
    serverUrl: args.url,
    sessionId: args.sessionId,
    userId: args.userId,
    message: args.message,
    events,
    metadata: {
      totalEvents: events.length,
      durationMs: endTime - startTime,
      eventTypeCounts,
    },
  };
}

/**
 * Save capture report to JSON file
 */
function saveReport(report: WebSocketCaptureReport, outputDir: string): string {
  // Ensure output directory exists
  const absoluteOutputDir = resolve(outputDir);
  if (!existsSync(absoluteOutputDir)) {
    mkdirSync(absoluteOutputDir, { recursive: true });
    console.log(`📁 Created output directory: ${absoluteOutputDir}`);
  }

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `websocket-capture-${timestamp}.json`;
  const filepath = join(absoluteOutputDir, filename);

  // Write to file
  writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');

  return filepath;
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  try {
    // Parse CLI arguments
    const args = parseArgs();

    // Capture events
    const report = await captureWebSocketEvents(args);

    // Save report
    const filepath = saveReport(report, args.output);

    // Print summary
    console.log('');
    console.log('✅ Capture completed successfully');
    console.log(`📊 Total events captured: ${report.metadata.totalEvents}`);
    console.log(`⏱️  Duration: ${report.metadata.durationMs}ms`);
    console.log('📋 Event type counts:');
    for (const [eventType, count] of Object.entries(report.metadata.eventTypeCounts)) {
      console.log(`   ${eventType}: ${count}`);
    }
    console.log('');
    console.log(`💾 Report saved to: ${filepath}`);
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ Capture failed:', error instanceof Error ? error.message : String(error));
    console.error('');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for potential testing
export { captureWebSocketEvents, parseArgs, type WebSocketCaptureReport };
