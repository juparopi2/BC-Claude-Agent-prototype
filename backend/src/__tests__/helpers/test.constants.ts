/**
 * Test Constants
 *
 * Centralized constants for unit and integration tests.
 * Avoids magic strings and provides type safety.
 *
 * @module __tests__/helpers/test.constants
 */

/**
 * Queue-related test constants
 */
export const QUEUE_TEST_CONSTANTS = {
  /** Default job ID returned by mock queue.add() */
  JOB_ID: 'job-123',
  /** Default waiting job count */
  WAITING_COUNT: 5,
  /** Default active job count */
  ACTIVE_COUNT: 2,
  /** Default completed job count */
  COMPLETED_COUNT: 100,
  /** Default failed job count */
  FAILED_COUNT: 3,
  /** Default delayed job count */
  DELAYED_COUNT: 0,
  /** Default rate limit count (as string for Redis GET) */
  RATE_LIMIT_COUNT: '50',
  /** Max jobs per session for rate limiting */
  MAX_JOBS_PER_SESSION: 100,
  /** Rate limit window in seconds */
  RATE_LIMIT_WINDOW_SECONDS: 3600,
} as const;

/**
 * User-related test constants
 */
export const USER_TEST_CONSTANTS = {
  /** Test user ID (UUID format) */
  USER_ID: '550e8400-e29b-41d4-a716-446655440001',
  /** Secondary test user ID for multi-tenant tests */
  USER_ID_2: '550e8400-e29b-41d4-a716-446655440002',
  /** Test user email */
  EMAIL: 'test@example.com',
  /** Test user display name */
  DISPLAY_NAME: 'Test User',
  /** Test Microsoft ID (from OAuth) */
  MICROSOFT_ID: 'ms-test-id-12345',
} as const;

/**
 * Session-related test constants
 */
export const SESSION_TEST_CONSTANTS = {
  /** Test session ID (UUID format) */
  SESSION_ID: '660e8400-e29b-41d4-a716-446655440001',
  /** Secondary test session ID */
  SESSION_ID_2: '660e8400-e29b-41d4-a716-446655440002',
  /** Test session title */
  TITLE: 'Test Chat Session',
  /** Default session expiry in milliseconds (24 hours) */
  EXPIRY_MS: 86400000,
} as const;

/**
 * Message-related test constants
 */
export const MESSAGE_TEST_CONSTANTS = {
  /** Test message ID (Anthropic format) */
  MESSAGE_ID: 'msg_01XFDUDYJgAACzvnptvVoYEL',
  /** Test message ID (UUID fallback) */
  MESSAGE_ID_UUID: '770e8400-e29b-41d4-a716-446655440001',
  /** Test tool use ID */
  TOOL_USE_ID: 'toolu_01XYZ123abc',
  /** Test event ID */
  EVENT_ID: 'evt_01ABC456def',
  /** Sample message content */
  CONTENT: 'Hello, this is a test message',
  /** Sample thinking content */
  THINKING_CONTENT: 'Let me analyze this problem...',
} as const;

/**
 * Approval-related test constants
 */
export const APPROVAL_TEST_CONSTANTS = {
  /** Test approval ID */
  APPROVAL_ID: '880e8400-e29b-41d4-a716-446655440001',
  /** Approval timeout in milliseconds (5 minutes) */
  TIMEOUT_MS: 300000,
  /** Short timeout for testing (5 seconds) */
  SHORT_TIMEOUT_MS: 5000,
} as const;

/**
 * Redis key patterns
 */
export const REDIS_KEY_PATTERNS = {
  /** Session key prefix */
  SESSION_PREFIX: 'sess:',
  /** Rate limit key pattern */
  RATE_LIMIT: (sessionId: string) => `rate:queue:${sessionId}`,
  /** Sequence number key pattern */
  SEQUENCE: (sessionId: string) => `seq:${sessionId}`,
} as const;

/**
 * API endpoint constants
 */
export const API_ENDPOINTS = {
  /** Auth endpoints */
  AUTH: {
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    CALLBACK: '/api/auth/callback',
    ME: '/api/auth/me',
    BC_STATUS: '/api/auth/bc-status',
  },
  /** Chat endpoints */
  CHAT: {
    SESSIONS: '/api/chat/sessions',
    SESSION: (id: string) => `/api/chat/sessions/${id}`,
    MESSAGES: (sessionId: string) => `/api/chat/sessions/${sessionId}/messages`,
  },
  /** Approval endpoints */
  APPROVALS: {
    RESPOND: (id: string) => `/api/approvals/${id}/respond`,
    PENDING: (sessionId: string) => `/api/approvals/session/${sessionId}/pending`,
  },
} as const;

/**
 * WebSocket event names
 */
export const WS_EVENTS = {
  /** Client to server events */
  CLIENT: {
    CHAT_MESSAGE: 'chat:message',
    SESSION_JOIN: 'session:join',
    SESSION_LEAVE: 'session:leave',
    APPROVAL_RESPONSE: 'approval:response',
  },
  /** Server to client events */
  SERVER: {
    AGENT_EVENT: 'agent:event',
    ERROR: 'error',
  },
} as const;

/**
 * Agent event types (from agent:event)
 */
export const AGENT_EVENT_TYPES = {
  SESSION_START: 'session_start',
  THINKING: 'thinking',
  THINKING_CHUNK: 'thinking_chunk',
  MESSAGE_PARTIAL: 'message_partial',
  MESSAGE_CHUNK: 'message_chunk',
  MESSAGE: 'message',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result',
  APPROVAL_REQUESTED: 'approval_requested',
  APPROVAL_RESOLVED: 'approval_resolved',
  USER_MESSAGE_CONFIRMED: 'user_message_confirmed',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;

/**
 * Tool names from MCP
 */
export const TOOL_NAMES = {
  LIST_ALL_ENTITIES: 'list_all_entities',
  SEARCH_ENTITY_OPERATIONS: 'search_entity_operations',
  GET_ENTITY_DETAILS: 'get_entity_details',
  GET_ENTITY_RELATIONSHIPS: 'get_entity_relationships',
  VALIDATE_WORKFLOW_STRUCTURE: 'validate_workflow_structure',
  BUILD_KNOWLEDGE_BASE_WORKFLOW: 'build_knowledge_base_workflow',
  GET_ENDPOINT_DOCUMENTATION: 'get_endpoint_documentation',
  TODO_WRITE: 'TodoWrite',
} as const;

/**
 * Export all constants as a single object for convenience
 */
export const TEST_CONSTANTS = {
  QUEUE: QUEUE_TEST_CONSTANTS,
  USER: USER_TEST_CONSTANTS,
  SESSION: SESSION_TEST_CONSTANTS,
  MESSAGE: MESSAGE_TEST_CONSTANTS,
  APPROVAL: APPROVAL_TEST_CONSTANTS,
  REDIS_KEYS: REDIS_KEY_PATTERNS,
  API: API_ENDPOINTS,
  WS: WS_EVENTS,
  AGENT_EVENTS: AGENT_EVENT_TYPES,
  TOOLS: TOOL_NAMES,
} as const;
