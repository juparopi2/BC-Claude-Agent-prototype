/**
 * E2E Test Data Constants
 *
 * Fixed, known data for E2E tests. These IDs and values are
 * consistent across test runs for deterministic assertions.
 *
 * @module e2e/fixtures/test-data
 */

/**
 * Test User - Primary E2E User
 *
 * This user is used for most E2E tests.
 * It has a fixed ID for deterministic database queries.
 */
export const TEST_USER = {
  id: 'e2e00001-0000-0000-0000-000000000001',
  email: 'e2e-test@bcagent.test',
  fullName: 'E2E Test User',
  role: 'editor' as const,
  isAdmin: false,
  isActive: true,
  // Microsoft OAuth mock data
  microsoftId: 'e2e-microsoft-id-001',
  microsoftEmail: 'e2e-test@bcagent.test',
  microsoftTenantId: 'e2e-tenant-id',
} as const;

/**
 * Test Admin User - For admin-specific tests
 */
export const TEST_ADMIN_USER = {
  id: 'e2e00002-0000-0000-0000-000000000002',
  email: 'e2e-admin@bcagent.test',
  fullName: 'E2E Admin User',
  role: 'admin' as const,
  isAdmin: true,
  isActive: true,
  microsoftId: 'e2e-microsoft-id-002',
  microsoftEmail: 'e2e-admin@bcagent.test',
  microsoftTenantId: 'e2e-tenant-id',
} as const;

/**
 * Test Sessions - Pre-created sessions with known IDs
 */
export const TEST_SESSIONS = {
  /** Empty session - no messages */
  empty: {
    id: 'e2e10001-0000-0000-0000-000000000001',
    userId: TEST_USER.id,
    title: 'E2E Empty Session',
    isActive: true,
  },
  /** Session with conversation history */
  withHistory: {
    id: 'e2e10002-0000-0000-0000-000000000002',
    userId: TEST_USER.id,
    title: 'E2E Session With History',
    isActive: true,
  },
  /** Session with tool use messages */
  withToolUse: {
    id: 'e2e10003-0000-0000-0000-000000000003',
    userId: TEST_USER.id,
    title: 'E2E Session With Tool Use',
    isActive: true,
  },
  /** Session with pending approval */
  withApproval: {
    id: 'e2e10004-0000-0000-0000-000000000004',
    userId: TEST_USER.id,
    title: 'E2E Session With Approval',
    isActive: true,
  },
  /** Inactive (deleted) session */
  deleted: {
    id: 'e2e10005-0000-0000-0000-000000000005',
    userId: TEST_USER.id,
    title: 'E2E Deleted Session',
    isActive: false,
  },
  /** Session belonging to admin user (for isolation tests) */
  adminSession: {
    id: 'e2e10006-0000-0000-0000-000000000006',
    userId: TEST_ADMIN_USER.id,
    title: 'E2E Admin Session',
    isActive: true,
  },
} as const;

/**
 * Test Messages - Pre-created messages with known content
 *
 * Each message has a deterministic ID pattern:
 * - User messages: msg_e2e_user_XXXX
 * - Assistant messages: msg_e2e_asst_XXXX
 * - System IDs: e2e2XXXX-...
 */
export const TEST_MESSAGES = {
  /** Messages for session with history */
  history: [
    {
      id: 'msg_e2e_user_0001',
      sessionId: TEST_SESSIONS.withHistory.id,
      role: 'user' as const,
      messageType: 'text' as const,
      content: 'Hello, what can you help me with?',
      sequenceNumber: 0,
      metadata: '{}',
    },
    {
      id: 'msg_e2e_asst_0001',
      sessionId: TEST_SESSIONS.withHistory.id,
      role: 'assistant' as const,
      messageType: 'text' as const,
      content: 'Hello! I can help you interact with Business Central. I can query customers, sales orders, items, and more. What would you like to do?',
      sequenceNumber: 1,
      metadata: '{}',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 150,
      outputTokens: 45,
      stopReason: 'end_turn',
    },
    {
      id: 'msg_e2e_user_0002',
      sessionId: TEST_SESSIONS.withHistory.id,
      role: 'user' as const,
      messageType: 'text' as const,
      content: 'Show me the list of available entities',
      sequenceNumber: 2,
      metadata: '{}',
    },
    {
      id: 'msg_e2e_asst_0002',
      sessionId: TEST_SESSIONS.withHistory.id,
      role: 'assistant' as const,
      messageType: 'text' as const,
      content: 'Here are the available Business Central entities you can work with:\n\n1. Customers\n2. Vendors\n3. Items\n4. Sales Orders\n5. Purchase Orders\n\nWhich one would you like to explore?',
      sequenceNumber: 3,
      metadata: '{}',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 200,
      outputTokens: 80,
      stopReason: 'end_turn',
    },
  ],

  /** Messages for session with tool use */
  toolUse: [
    {
      id: 'msg_e2e_user_0010',
      sessionId: TEST_SESSIONS.withToolUse.id,
      role: 'user' as const,
      messageType: 'text' as const,
      content: 'List all available BC entities',
      sequenceNumber: 0,
      metadata: '{}',
    },
    {
      id: 'msg_e2e_asst_0010',
      sessionId: TEST_SESSIONS.withToolUse.id,
      role: 'assistant' as const,
      messageType: 'tool_use' as const,
      content: '',
      sequenceNumber: 1,
      toolUseId: 'toolu_e2e_0001',
      metadata: JSON.stringify({
        tool_name: 'list_all_entities',
        tool_args: {},
        tool_use_id: 'toolu_e2e_0001',
        status: 'success',
      }),
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 180,
      outputTokens: 50,
      stopReason: 'tool_use',
    },
    {
      id: 'msg_e2e_asst_0011',
      sessionId: TEST_SESSIONS.withToolUse.id,
      role: 'assistant' as const,
      messageType: 'tool_result' as const,
      content: '',
      sequenceNumber: 2,
      toolUseId: 'toolu_e2e_0001',
      metadata: JSON.stringify({
        tool_name: 'list_all_entities',
        tool_args: {},
        tool_use_id: 'toolu_e2e_0001',
        status: 'success',
        tool_result: {
          entities: ['customers', 'vendors', 'items', 'salesOrders', 'purchaseOrders'],
          count: 5,
        },
      }),
    },
    {
      id: 'msg_e2e_asst_0012',
      sessionId: TEST_SESSIONS.withToolUse.id,
      role: 'assistant' as const,
      messageType: 'text' as const,
      content: 'I found 5 Business Central entities available: customers, vendors, items, salesOrders, and purchaseOrders.',
      sequenceNumber: 3,
      metadata: '{}',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 250,
      outputTokens: 35,
      stopReason: 'end_turn',
    },
  ],
} as const;

/**
 * Test Approvals - Pre-created approval requests
 */
export const TEST_APPROVALS = {
  pending: {
    id: 'e2e30001-0000-0000-0000-000000000001',
    sessionId: TEST_SESSIONS.withApproval.id,
    toolName: 'bc_create_customer',
    toolArgs: JSON.stringify({
      name: 'Test Customer Corp',
      email: 'test@customer.com',
    }),
    // Note: DB constraint accepts: 'create', 'update', 'delete', 'custom' (without bc_ prefix)
    actionType: 'create',
    actionDescription: 'Create new customer: Test Customer Corp',
    status: 'pending' as const,
    priority: 'high' as const,
    // Expires 5 minutes from now (will be set dynamically)
  },
  approved: {
    id: 'e2e30002-0000-0000-0000-000000000002',
    sessionId: TEST_SESSIONS.withApproval.id,
    toolName: 'bc_update_item',
    toolArgs: JSON.stringify({
      itemId: 'ITEM001',
      unitPrice: 99.99,
    }),
    actionType: 'update',
    actionDescription: 'Update item price: ITEM001',
    status: 'approved' as const,
    priority: 'medium' as const,
    decidedByUserId: TEST_USER.id,
  },
  rejected: {
    id: 'e2e30003-0000-0000-0000-000000000003',
    sessionId: TEST_SESSIONS.withApproval.id,
    toolName: 'bc_delete_customer',
    toolArgs: JSON.stringify({
      customerId: 'CUST001',
    }),
    actionType: 'delete',
    actionDescription: 'Delete customer: CUST001',
    status: 'rejected' as const,
    priority: 'high' as const,
    decidedByUserId: TEST_USER.id,
    rejectionReason: 'Operation not authorized for this customer',
  },
} as const;

/**
 * Mock BC Tokens for tests
 *
 * These are fake encrypted tokens - they won't work against real BC API
 * but allow testing the token flow.
 */
export const MOCK_BC_TOKENS = {
  /** Mock access token (base64 encoded fake JWT) */
  accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMmUtdGVzdC11c2VyIiwiYXVkIjoiaHR0cHM6Ly9hcGkuYnVzaW5lc3NjZW50cmFsLmR5bmFtaWNzLmNvbSIsImlzcyI6Imh0dHBzOi8vbG9naW4ubWljcm9zb2Z0b25saW5lLmNvbS9lMmUtdGVuYW50LWlkL3YyLjAiLCJleHAiOjE3MzUyMzQ1NjcsImlhdCI6MTczNTIzMDk2N30.fake-signature',
  /** Mock refresh token */
  refreshToken: 'fake-refresh-token-for-e2e-tests-only',
  /** Token expiration (1 hour from now - set dynamically) */
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
} as const;

/**
 * API Endpoints for E2E tests
 */
export const API_ENDPOINTS = {
  // Auth
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  callback: '/api/auth/callback',
  me: '/api/auth/me',
  bcStatus: '/api/auth/bc-status',
  bcConsent: '/api/auth/bc-consent',

  // Sessions
  sessions: '/api/chat/sessions',
  session: (id: string) => `/api/chat/sessions/${id}`,
  messages: (sessionId: string) => `/api/chat/sessions/${sessionId}/messages`,

  // Approvals
  approvals: (sessionId: string) => `/api/chat/sessions/${sessionId}/approvals`,
  approval: (sessionId: string, approvalId: string) =>
    `/api/chat/sessions/${sessionId}/approvals/${approvalId}`,

  // Health
  health: '/health',
} as const;

/**
 * WebSocket Events for E2E tests
 */
export const WS_EVENTS = {
  // Client -> Server
  chatMessage: 'chat:message',
  approvalResponse: 'approval:response',

  // Server -> Client
  agentEvent: 'agent:event',
  agentError: 'agent:error',  // Changed from 'error' to match backend emission
  connect: 'connect',
  disconnect: 'disconnect',
} as const;

/**
 * Agent Event Types (for assertions)
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
  userMessageConfirmed: 'user_message_confirmed',
  complete: 'complete',
  error: 'error',
} as const;

/**
 * Test Timeouts (in milliseconds)
 */
export const TIMEOUTS = {
  /** Short timeout for fast operations */
  short: 5000,
  /** Medium timeout for API calls */
  medium: 15000,
  /** Long timeout for Claude responses */
  long: 60000,
  /** Extra long for approval flows */
  extraLong: 120000,
} as const;
