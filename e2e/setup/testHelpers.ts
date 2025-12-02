/**
 * Test Helpers for E2E Tests
 *
 * Reusable helper functions for Playwright E2E tests that interact
 * with the backend API and WebSocket directly.
 *
 * IMPORTANT: These helpers use REAL session cookies, not mock auth tokens.
 * Sessions are pre-injected into Redis by globalSetup.ts.
 *
 * @module e2e/setup/testHelpers
 */

import { Page, APIRequestContext, BrowserContext } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import * as fs from 'fs';
import * as path from 'path';

// Constants
export const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Timeout constants (in milliseconds)
export const TIMEOUTS = {
  short: 5000,
  medium: 15000,
  long: 60000,
  extraLong: 120000,
} as const;

// Session info file path (written by globalSetup.ts)
const SESSION_INFO_FILE = path.join(__dirname, '.e2e-sessions.json');

// Session info types
interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  cookieValue: string;
}

interface SessionInfo {
  testUser: SessionUser;
  adminUser: SessionUser;
}

// Cache for session info
let sessionInfoCache: SessionInfo | null = null;

/**
 * Get session info created by globalSetup.ts
 *
 * This reads the session info from the .e2e-sessions.json file that was
 * written during global setup. The file contains session IDs and cookie
 * values for the test users.
 *
 * @returns Session info for test and admin users
 *
 * @throws Error if session info file doesn't exist (globalSetup didn't run)
 */
export function getSessionInfo(): SessionInfo {
  if (sessionInfoCache) {
    return sessionInfoCache;
  }

  if (!fs.existsSync(SESSION_INFO_FILE)) {
    throw new Error(
      `Session info file not found: ${SESSION_INFO_FILE}\n` +
      'Make sure globalSetup.ts ran successfully before tests.'
    );
  }

  const content = fs.readFileSync(SESSION_INFO_FILE, 'utf-8');
  sessionInfoCache = JSON.parse(content) as SessionInfo;
  return sessionInfoCache;
}

/**
 * Get the test user session info
 */
export function getTestUserSession(): SessionUser {
  return getSessionInfo().testUser;
}

/**
 * Get the admin user session info
 */
export function getAdminUserSession(): SessionUser {
  return getSessionInfo().adminUser;
}

// ============================================================================
// Browser-Based Helpers (for UI tests)
// ============================================================================

/**
 * Authenticate a browser context with a test user session
 *
 * This sets the connect.sid cookie in the browser context so that
 * all subsequent requests are authenticated as the test user.
 *
 * @param context - Playwright BrowserContext
 * @param user - Which user to authenticate as ('test' or 'admin')
 *
 * @example
 * ```typescript
 * test.beforeEach(async ({ context }) => {
 *   await authenticateContext(context, 'test');
 * });
 * ```
 */
export async function authenticateContext(
  context: BrowserContext,
  user: 'test' | 'admin' = 'test'
): Promise<void> {
  const sessionUser = user === 'admin' ? getAdminUserSession() : getTestUserSession();

  await context.addCookies([
    {
      name: 'connect.sid',
      value: sessionUser.cookieValue,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Login to the application using session cookie
 *
 * This sets the session cookie and navigates to the app. The user
 * will be automatically authenticated.
 *
 * @param page - Playwright Page object
 * @param user - Which user to authenticate as ('test' or 'admin')
 *
 * @example
 * ```typescript
 * test('authenticated user can access chat', async ({ page }) => {
 *   await loginToApp(page, 'test');
 *   await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
 * });
 * ```
 */
export async function loginToApp(page: Page, user: 'test' | 'admin' = 'test'): Promise<void> {
  await authenticateContext(page.context(), user);
  await page.goto(FRONTEND_URL);
}

/**
 * Wait for the agent to be in a specific state
 *
 * This function waits for UI indicators that show the agent is idle or busy.
 * Implementation depends on the frontend UI design.
 *
 * @param page - Playwright Page object
 * @param state - Desired agent state ('idle' or 'busy')
 */
export async function waitForAgentState(page: Page, state: 'idle' | 'busy'): Promise<void> {
  // Implementation depends on UI indicators
  // Example:
  // if (state === 'busy') {
  //   await expect(page.locator('[data-testid="agent-status"]')).toHaveText('Processing...');
  // } else {
  //   await expect(page.locator('[data-testid="agent-status"]')).toHaveText('Ready');
  // }
}

// ============================================================================
// API-Level Helpers (for API tests)
// ============================================================================

/**
 * Create Playwright API request context with session cookie
 *
 * This creates a reusable API context that includes the session cookie
 * in all requests, providing real authentication.
 *
 * @param playwright - Playwright instance (from test context)
 * @param user - Which user to authenticate as ('test' or 'admin')
 * @returns API request context with session cookie
 *
 * @example
 * ```typescript
 * test.beforeAll(async ({ playwright }) => {
 *   apiContext = await createApiContext(playwright, 'test');
 * });
 *
 * test('can list sessions', async () => {
 *   const response = await apiContext.get('/api/chat/sessions');
 *   expect(response.ok()).toBeTruthy();
 * });
 * ```
 */
export async function createApiContext(
  playwright: { request: { newContext: (options: object) => Promise<APIRequestContext> } },
  user: 'test' | 'admin' = 'test'
): Promise<APIRequestContext> {
  const sessionUser = user === 'admin' ? getAdminUserSession() : getTestUserSession();

  return await playwright.request.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: {
      Cookie: `connect.sid=${sessionUser.cookieValue}`,
    },
  });
}

// ============================================================================
// WebSocket Helpers
// ============================================================================

/**
 * Connect to WebSocket with session cookie authentication
 *
 * Establishes a Socket.IO connection to the backend with session cookie
 * authentication. Returns a promise that resolves when the connection is established.
 *
 * IMPORTANT: If autoJoinSession is provided, the socket will automatically join
 * the specified session room before resolving. This is REQUIRED for receiving
 * events that are broadcast to session rooms (e.g., user_message_confirmed,
 * agent:event with thinking/message events).
 *
 * @param user - Which user to connect as ('test' or 'admin')
 * @param timeout - Connection timeout in milliseconds (default: 15s)
 * @param autoJoinSession - Optional session ID to auto-join after connection
 * @returns Promise that resolves to connected Socket
 *
 * @throws Error if connection times out or fails
 *
 * @example
 * ```typescript
 * // Connect and auto-join session (RECOMMENDED for message tests)
 * const socket = await connectSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty);
 * expect(socket.connected).toBeTruthy();
 *
 * socket.emit('chat:message', { sessionId, userId, message });
 *
 * // Always disconnect when done
 * socket.disconnect();
 * ```
 */
export function connectSocket(
  user: 'test' | 'admin' = 'test',
  timeout: number = TIMEOUTS.medium,
  autoJoinSession?: string
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sessionUser = user === 'admin' ? getAdminUserSession() : getTestUserSession();

    console.log('[E2E] Connecting socket with session:', {
      sessionId: sessionUser.sessionId,
      userId: sessionUser.userId,
      cookieValue: sessionUser.cookieValue.substring(0, 20) + '...',
      autoJoinSession: autoJoinSession || 'none',
    });

    const socket = io(BACKEND_URL, {
      transports: ['websocket'],
      extraHeaders: {
        Cookie: `connect.sid=${sessionUser.cookieValue}`,
      },
    });

    const timer = setTimeout(() => {
      console.error('[E2E] Socket connection timeout');
      socket.disconnect();
      reject(new Error('WebSocket connection timeout'));
    }, timeout);

    socket.on('connect', async () => {
      console.log('[E2E] Socket connected, socket.id:', socket.id);
      clearTimeout(timer);

      // AUTO-JOIN SESSION IF PROVIDED (CRITICAL for receiving room broadcasts)
      if (autoJoinSession) {
        try {
          console.log('[E2E] Auto-joining session:', autoJoinSession);
          socket.emit('session:join', { sessionId: autoJoinSession });

          // Wait for join confirmation with timeout
          await new Promise<void>((resolveJoin, rejectJoin) => {
            const joinTimer = setTimeout(() => {
              rejectJoin(new Error(`Timeout waiting for session:joined event for ${autoJoinSession}`));
            }, 5000);

            socket.once('session:joined', (data: { sessionId: string }) => {
              clearTimeout(joinTimer);
              console.log('[E2E] Session joined successfully:', data.sessionId);
              resolveJoin();
            });
          });
        } catch (joinError) {
          console.error('[E2E] Failed to join session:', joinError);
          socket.disconnect();
          reject(joinError);
          return;
        }
      }

      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      console.error('[E2E] Socket connection error:', error.message);
      clearTimeout(timer);
      socket.disconnect();
      reject(error);
    });

    // Listen for agent errors (helps debug validation failures)
    socket.on('agent:error', (error) => {
      console.error('[E2E] Agent error received:', error);
    });
  });
}

/**
 * Wait for a specific event on the socket
 *
 * Generic helper to wait for any Socket.IO event. Uses `socket.once()` to
 * listen for a single event emission.
 *
 * @param socket - Socket.IO socket
 * @param eventName - Event name to wait for (e.g., 'connect', 'error')
 * @param timeout - Timeout in milliseconds (default: 15s)
 * @returns Promise that resolves to the event data
 *
 * @throws Error if timeout occurs before event is received
 */
export function waitForEvent(
  socket: Socket,
  eventName: string,
  timeout: number = TIMEOUTS.medium
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    socket.once(eventName, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Wait for a specific agent event type
 *
 * Agent events are discriminated by a `type` field in the event payload.
 * This helper filters events on the 'agent:event' channel and resolves
 * when the specified event type is received.
 *
 * @param socket - Socket.IO socket
 * @param eventType - Agent event type to wait for (e.g., 'complete', 'user_message_confirmed')
 * @param timeout - Timeout in milliseconds (default: 15s)
 * @returns Promise that resolves to the event data
 *
 * @throws Error if timeout occurs before event is received
 */
export function waitForAgentEvent(
  socket: Socket,
  eventType: string,
  timeout: number = TIMEOUTS.medium
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for agent event: ${eventType}`));
    }, timeout);

    const handler = (event: { type: string; [key: string]: unknown }) => {
      if (event.type === eventType) {
        clearTimeout(timer);
        socket.off('agent:event', handler);
        resolve(event);
      }
    };

    socket.on('agent:event', handler);
  });
}

/**
 * Wait for a condition to become true
 *
 * Polls a condition function at regular intervals until it returns true
 * or the timeout is reached. Useful for waiting on asynchronous state changes.
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Timeout in milliseconds (default: 15s)
 * @param errorMessage - Error message if timeout occurs
 * @returns Promise that resolves when condition is met
 *
 * @throws Error if timeout occurs before condition is met
 */
export function waitForCondition(
  condition: () => boolean,
  timeout: number = TIMEOUTS.medium,
  errorMessage: string = 'Condition not met within timeout'
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(timer);
        reject(new Error(errorMessage));
      }
    }, checkInterval);
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wait for a specific duration (sleep)
 *
 * Simple utility to pause test execution for a specified duration.
 * Use sparingly - prefer event-based waiting with waitForEvent or waitForCondition.
 *
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collect all agent events of a specific type
 *
 * Sets up a listener that collects all events of a specific type into an array.
 * Returns the array and a cleanup function to remove the listener.
 *
 * @param socket - Socket.IO socket
 * @param eventType - Agent event type to collect (e.g., 'message_chunk')
 * @returns Tuple of [collected events array, cleanup function]
 */
export function collectAgentEvents(
  socket: Socket,
  eventType: string
): [{ type: string; [key: string]: unknown }[], () => void] {
  const events: { type: string; [key: string]: unknown }[] = [];

  const handler = (event: { type: string; [key: string]: unknown }) => {
    if (event.type === eventType) {
      events.push(event);
    }
  };

  socket.on('agent:event', handler);

  const cleanup = () => {
    socket.off('agent:event', handler);
  };

  return [events, cleanup];
}

// ============================================================================
// Test Data Helpers
// ============================================================================

/**
 * Test session IDs (from seed-database.sql)
 */
export const TEST_SESSIONS = {
  empty: 'e2e10001-0000-0000-0000-000000000001',
  withHistory: 'e2e10002-0000-0000-0000-000000000002',
  withToolUse: 'e2e10003-0000-0000-0000-000000000003',
  withApproval: 'e2e10004-0000-0000-0000-000000000004',
  deleted: 'e2e10005-0000-0000-0000-000000000005',
  adminSession: 'e2e10006-0000-0000-0000-000000000006',
} as const;

/**
 * Test approval IDs (from seed-database.sql)
 */
export const TEST_APPROVALS = {
  pending: 'e2e30001-0000-0000-0000-000000000001',
  approved: 'e2e30002-0000-0000-0000-000000000002',
  rejected: 'e2e30003-0000-0000-0000-000000000003',
} as const;

// ============================================================================
// Thinking Event Helpers
// ============================================================================

/**
 * Agent event types
 */
export const AGENT_EVENT_TYPES = {
  sessionStart: 'session_start',
  thinking: 'thinking',
  thinkingChunk: 'thinking_chunk',
  messageChunk: 'message_chunk',
  message: 'message',
  toolUse: 'tool_use',
  toolResult: 'tool_result',
  approvalRequested: 'approval_requested',
  approvalResolved: 'approval_resolved',
  complete: 'complete',
  error: 'error',
  userMessageConfirmed: 'user_message_confirmed',
} as const;

/**
 * WebSocket event names
 */
export const WS_EVENTS = {
  agentEvent: 'agent:event',
  chatMessage: 'chat:message',
} as const;

/**
 * Wait for thinking chunk events from agent
 *
 * Collects thinking_chunk events until the minimum number is reached.
 * Useful for testing that extended thinking is producing output.
 *
 * @param socket - Authenticated socket connection
 * @param minChunks - Minimum number of chunks to wait for
 * @param timeout - Timeout in milliseconds
 * @returns Promise with array of thinking chunk events
 *
 * @throws Error if timeout occurs before minimum chunks received
 *
 * @example
 * ```typescript
 * const chunks = await waitForThinkingChunks(socket, 5);
 * expect(chunks.length).toBeGreaterThanOrEqual(5);
 * expect(chunks[0].type).toBe('thinking_chunk');
 * ```
 */
export async function waitForThinkingChunks(
  socket: Socket,
  minChunks: number = 1,
  timeout: number = TIMEOUTS.long
): Promise<any[]> {
  const chunks: any[] = [];

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        `Timeout waiting for ${minChunks} thinking chunks (received ${chunks.length})`
      ));
    }, timeout);

    const handler = (event: any) => {
      if (event.type === 'thinking_chunk') {
        chunks.push(event);
        if (chunks.length >= minChunks) {
          clearTimeout(timer);
          socket.off(WS_EVENTS.agentEvent, handler);
          resolve(chunks);
        }
      }
    };

    socket.on(WS_EVENTS.agentEvent, handler);
  });
}

/**
 * Wait for complete thinking block event
 *
 * Waits for the 'thinking' event which contains the complete thinking block
 * after all thinking_chunk events have been emitted.
 *
 * @param socket - Authenticated socket connection
 * @param timeout - Timeout in milliseconds
 * @returns Promise with thinking event data
 *
 * @throws Error if timeout occurs before event is received
 *
 * @example
 * ```typescript
 * const thinkingEvent = await waitForThinkingComplete(socket);
 * expect(thinkingEvent.type).toBe('thinking');
 * expect(thinkingEvent.content).toBeDefined();
 * ```
 */
export async function waitForThinkingComplete(
  socket: Socket,
  timeout: number = TIMEOUTS.long
): Promise<any> {
  return waitForAgentEvent(socket, AGENT_EVENT_TYPES.thinking, timeout);
}
