/**
 * MSW Request Handlers
 *
 * Mock API handlers for testing.
 */

import { http, HttpResponse } from 'msw';
import type { Session, Message, UserProfile, TokenUsage } from '../../lib/services/api';

// Base URL for mocking
const API_URL = 'http://localhost:3002';

// Mock data
export const mockUser: UserProfile = {
  id: 'user-123',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2024-01-01T00:00:00Z',
};

export const mockSessions: Session[] = [
  {
    id: 'session-1',
    user_id: 'user-123',
    title: 'First Chat',
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T10:30:00Z',
    is_active: true,
    message_count: 5,
  },
  {
    id: 'session-2',
    user_id: 'user-123',
    title: 'Second Chat',
    created_at: '2024-01-02T10:00:00Z',
    updated_at: '2024-01-02T11:00:00Z',
    is_active: true,
    message_count: 10,
  },
];

export const mockMessages: Message[] = [
  {
    id: 'msg-1',
    session_id: 'session-1',
    role: 'user',
    content: 'Hello, can you help me?',
    sequence_number: 1,
    created_at: '2024-01-01T10:00:00Z',
  },
  {
    id: 'msg-2',
    session_id: 'session-1',
    role: 'assistant',
    content: 'Of course! I\'m here to help. What do you need?',
    sequence_number: 2,
    created_at: '2024-01-01T10:00:05Z',
    token_usage: {
      input_tokens: 10,
      output_tokens: 15,
    },
    model: 'claude-sonnet-4-5-20250929',
  },
];

export const mockTokenUsage: TokenUsage = {
  total_input_tokens: 1000,
  total_output_tokens: 1500,
  total_thinking_tokens: 200,
  message_count: 50,
};

/**
 * Default API handlers
 */
export const handlers = [
  // Health check
  http.get(`${API_URL}/api/health`, () => {
    return HttpResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  }),

  // Auth status
  http.get(`${API_URL}/api/auth/status`, () => {
    return HttpResponse.json({
      authenticated: true,
      user: mockUser,
    });
  }),

  // Get current user
  http.get(`${API_URL}/api/auth/me`, () => {
    return HttpResponse.json(mockUser);
  }),

  // Get sessions
  http.get(`${API_URL}/api/sessions`, () => {
    return HttpResponse.json(mockSessions);
  }),

  // Get single session
  http.get(`${API_URL}/api/sessions/:sessionId`, ({ params }) => {
    const session = mockSessions.find((s) => s.id === params.sessionId);
    if (session) {
      return HttpResponse.json(session);
    }
    return HttpResponse.json(
      { error: 'Not Found', message: 'Session not found', code: 'SESSION_NOT_FOUND' },
      { status: 404 }
    );
  }),

  // Create session
  http.post(`${API_URL}/api/sessions`, async ({ request }) => {
    const body = (await request.json()) as { title?: string } | null;
    const newSession: Session = {
      id: `session-${Date.now()}`,
      user_id: 'user-123',
      title: body?.title || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: true,
      message_count: 0,
    };
    return HttpResponse.json(newSession, { status: 201 });
  }),

  // Update session
  http.patch(`${API_URL}/api/sessions/:sessionId`, async ({ params, request }) => {
    const body = (await request.json()) as { title?: string; is_active?: boolean };
    const session = mockSessions.find((s) => s.id === params.sessionId);
    if (session) {
      return HttpResponse.json({
        ...session,
        ...body,
        updated_at: new Date().toISOString(),
      });
    }
    return HttpResponse.json(
      { error: 'Not Found', message: 'Session not found', code: 'SESSION_NOT_FOUND' },
      { status: 404 }
    );
  }),

  // Delete session
  http.delete(`${API_URL}/api/sessions/:sessionId`, ({ params }) => {
    const session = mockSessions.find((s) => s.id === params.sessionId);
    if (session) {
      return HttpResponse.json({ success: true });
    }
    return HttpResponse.json(
      { error: 'Not Found', message: 'Session not found', code: 'SESSION_NOT_FOUND' },
      { status: 404 }
    );
  }),

  // Get messages
  http.get(`${API_URL}/api/sessions/:sessionId/messages`, ({ params }) => {
    const messages = mockMessages.filter((m) => m.session_id === params.sessionId);
    return HttpResponse.json(messages);
  }),

  // Get token usage for session
  http.get(`${API_URL}/api/sessions/:sessionId/token-usage`, () => {
    return HttpResponse.json(mockTokenUsage);
  }),

  // Get user token usage
  http.get(`${API_URL}/api/users/me/token-usage`, () => {
    return HttpResponse.json(mockTokenUsage);
  }),
];

/**
 * Error handlers for testing error scenarios
 */
export const errorHandlers = {
  unauthorized: http.get(`${API_URL}/api/auth/status`, () => {
    return HttpResponse.json(
      { error: 'Unauthorized', message: 'Authentication required', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }),

  serverError: http.get(`${API_URL}/api/sessions`, () => {
    return HttpResponse.json(
      { error: 'Internal Server Error', message: 'An unexpected error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }),

  networkError: http.get(`${API_URL}/api/sessions`, () => {
    return HttpResponse.error();
  }),
};
