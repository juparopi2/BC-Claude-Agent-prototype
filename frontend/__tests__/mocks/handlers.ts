/**
 * MSW Request Handlers
 *
 * Mock API handlers for testing.
 */

import { http, HttpResponse } from 'msw';
import type { Session, Message, UserProfile, TokenUsage } from '@/src/infrastructure/api';
import type { ParsedFile } from '@bc-agent/shared';

// Base URL for mocking
const API_URL = 'http://localhost:3002';

// Mock data
export const mockUser: UserProfile = {
  id: 'user-123',
  email: 'test@example.com',
  fullName: 'Test User',
  role: 'user',
  microsoftEmail: 'test@example.com',
  microsoftId: 'ms-123',
  lastLogin: '2024-01-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  isActive: true,
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
    type: 'standard',
    id: 'msg-1',
    session_id: 'session-1',
    role: 'user',
    content: 'Hello, can you help me?',
    sequence_number: 1,
    created_at: '2024-01-01T10:00:00Z',
  },
  {
    type: 'standard',
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

export const mockFiles: ParsedFile[] = [
  {
    id: 'file-1',
    userId: 'user-123',
    parentFolderId: null,
    name: 'document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024000,
    blobPath: 'users/user-123/files/document.pdf',
    isFolder: false,
    isFavorite: false,
    processingStatus: 'completed',
    embeddingStatus: 'completed',
    readinessState: 'ready',
    processingRetryCount: 0,
    embeddingRetryCount: 0,
    lastError: null,
    failedAt: null,
    hasExtractedText: true,
    contentHash: 'abc123def456',
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
  },
  {
    id: 'folder-1',
    userId: 'user-123',
    parentFolderId: null,
    name: 'My Folder',
    mimeType: 'inode/directory',
    sizeBytes: 0,
    blobPath: '',
    isFolder: true,
    isFavorite: false,
    processingStatus: 'completed',
    embeddingStatus: 'completed',
    readinessState: 'ready',
    processingRetryCount: 0,
    embeddingRetryCount: 0,
    lastError: null,
    failedAt: null,
    hasExtractedText: false,
    contentHash: null,
    createdAt: '2024-01-14T10:00:00.000Z',
    updatedAt: '2024-01-14T10:00:00.000Z',
  },
];

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

  // Get sessions (wrapped in { sessions: [...] })
  http.get(`${API_URL}/api/chat/sessions`, () => {
    return HttpResponse.json({ sessions: mockSessions });
  }),

  // Get single session (returns Session directly)
  http.get(`${API_URL}/api/chat/sessions/:sessionId`, ({ params }) => {
    const session = mockSessions.find((s) => s.id === params.sessionId);
    if (session) {
      return HttpResponse.json(session);
    }
    return HttpResponse.json(
      { error: 'Not Found', message: 'Session not found', code: 'SESSION_NOT_FOUND' },
      { status: 404 }
    );
  }),

  // Create session (returns Session directly)
  http.post(`${API_URL}/api/chat/sessions`, async ({ request }) => {
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

  // Update session (returns Session directly)
  http.patch(`${API_URL}/api/chat/sessions/:sessionId`, async ({ params, request }) => {
    const body = (await request.json()) as { title?: string; is_active?: boolean };
    const session = mockSessions.find((s) => s.id === params.sessionId);
    if (session) {
      const updatedSession = {
        ...session,
        ...body,
        updated_at: new Date().toISOString(),
      };
      return HttpResponse.json(updatedSession);
    }
    return HttpResponse.json(
      { error: 'Not Found', message: 'Session not found', code: 'SESSION_NOT_FOUND' },
      { status: 404 }
    );
  }),

  // Delete session
  http.delete(`${API_URL}/api/chat/sessions/:sessionId`, ({ params }) => {
    const session = mockSessions.find((s) => s.id === params.sessionId);
    if (session) {
      return HttpResponse.json({ success: true });
    }
    return HttpResponse.json(
      { error: 'Not Found', message: 'Session not found', code: 'SESSION_NOT_FOUND' },
      { status: 404 }
    );
  }),

  // Get messages (wrapped in { messages: [...] })
  http.get(`${API_URL}/api/chat/sessions/:sessionId/messages`, ({ params }) => {
    const messages = mockMessages.filter((m) => m.session_id === params.sessionId);
    return HttpResponse.json({ messages });
  }),

  // Get token usage for session
  http.get(`${API_URL}/api/chat/sessions/:sessionId/token-usage`, () => {
    return HttpResponse.json(mockTokenUsage);
  }),

  // Get user token usage
  http.get(`${API_URL}/api/users/me/token-usage`, () => {
    return HttpResponse.json(mockTokenUsage);
  }),

  // Get files
  http.get(`${API_URL}/api/files`, ({ request }) => {
    const url = new URL(request.url);
    const folderId = url.searchParams.get('folderId');

    // Filter files by folderId
    const files = mockFiles.filter((f) => f.parentFolderId === folderId);

    return HttpResponse.json({
      files,
      pagination: {
        total: files.length,
        limit: 50,
        offset: 0,
      },
    });
  }),

  // Create folder
  http.post(`${API_URL}/api/files/folders`, async ({ request }) => {
    const body = (await request.json()) as { name: string; parentFolderId?: string };
    const newFolder: ParsedFile = {
      id: `folder-${Date.now()}`,
      userId: 'user-123',
      parentFolderId: body.parentFolderId || null,
      name: body.name,
      mimeType: 'inode/directory',
      sizeBytes: 0,
      blobPath: '',
      isFolder: true,
      isFavorite: false,
      processingStatus: 'completed',
      embeddingStatus: 'completed',
      readinessState: 'ready',
      processingRetryCount: 0,
      embeddingRetryCount: 0,
      lastError: null,
      failedAt: null,
      hasExtractedText: false,
      contentHash: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json({ folder: newFolder }, { status: 201 });
  }),
];

/**
 * Error handlers for testing error scenarios
 */
export const errorHandlers = {
  // Note: checkAuth() uses /api/auth/me directly, not /api/auth/status
  unauthorized: http.get(`${API_URL}/api/auth/me`, () => {
    return HttpResponse.json(
      { error: 'Unauthorized', message: 'Authentication required', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }),

  serverError: http.get(`${API_URL}/api/chat/sessions`, () => {
    return HttpResponse.json(
      { error: 'Internal Server Error', message: 'An unexpected error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }),

  networkError: http.get(`${API_URL}/api/chat/sessions`, () => {
    return HttpResponse.error();
  }),
};
