/**
 * HTTP Client
 *
 * Type-safe HTTP client for REST API communication.
 * Uses types from @bc-agent/shared for guaranteed frontend-backend contract.
 *
 * @module infrastructure/api/httpClient
 */

import type { ApiErrorResponse } from '@bc-agent/shared';
import { isApiErrorResponse, ErrorCode } from '@bc-agent/shared';
import { env } from '@/lib/config/env';

// ============================================
// Message Types - Import from shared package
// ============================================
// PHASE 4.6: Single source of truth for message types
// Re-export for backward compatibility with existing imports

import type {
  Message,
  StandardMessage,
  ThinkingMessage,
  ToolUseMessage,
} from '@bc-agent/shared';

import {
  isStandardMessage,
  isThinkingMessage,
  isToolUseMessage,
} from '@bc-agent/shared';

// Re-export message types for components that import from api.ts
export type { Message, StandardMessage, ThinkingMessage, ToolUseMessage };
export { isStandardMessage, isThinkingMessage, isToolUseMessage };

// ============================================
// API Response Types
// ============================================

/**
 * API Response wrapper
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorResponse };

/**
 * Session from backend
 */
export interface Session {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  message_count?: number;
}

/**
 * User profile from backend
 * Note: Field names match backend /api/auth/me response (camelCase)
 */
export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  microsoftEmail: string | null;
  microsoftId: string | null;
  lastLogin: string | null;
  createdAt: string;
  isActive: boolean;
  /** Token expiration timestamp (ISO 8601) */
  tokenExpiresAt: string | null;
  /** Session expiration timestamp (ISO 8601) */
  sessionExpiresAt: string | null;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_thinking_tokens: number;
  message_count: number;
  period_start?: string;
  period_end?: string;
}

/**
 * Create session request
 */
export interface CreateSessionRequest {
  title?: string;
  initialMessage?: string;
}

/**
 * Update session request
 */
export interface UpdateSessionRequest {
  title?: string;
  is_active?: boolean;
}

/**
 * API Error class
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, string | number | boolean>;

  constructor(response: ApiErrorResponse, statusCode: number) {
    super(response.message);
    this.name = 'ApiError';
    this.code = response.code;
    this.statusCode = statusCode;
    this.details = response.details;
  }
}

/**
 * API Client Class
 *
 * Provides type-safe methods for all backend REST endpoints.
 *
 * @example
 * ```typescript
 * const api = new ApiClient();
 *
 * // Get sessions
 * const result = await api.getSessions();
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error.message);
 * }
 *
 * // Create session
 * const session = await api.createSession({ title: 'New Chat' });
 * ```
 */
export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = env.apiUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an HTTP request
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const response = await fetch(url, {
        method,
        headers,
        credentials: 'include', // Include cookies for session auth
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        if (isApiErrorResponse(data)) {
          return { success: false, error: data };
        }
        // Create a generic error response
        return {
          success: false,
          error: {
            error: response.statusText,
            message: data.message || 'An error occurred',
            code: ErrorCode.INTERNAL_ERROR,
          },
        };
      }

      return { success: true, data: data as T };
    } catch (error) {
      console.error('[ApiClient] Request failed:', error);
      return {
        success: false,
        error: {
          error: 'Network Error',
          message: error instanceof Error ? error.message : 'Failed to connect to server',
          code: ErrorCode.SERVICE_UNAVAILABLE,
        },
      };
    }
  }

  // ============================================
  // Authentication Endpoints
  // ============================================

  /**
   * Get current user profile
   */
  async getCurrentUser(): Promise<ApiResponse<UserProfile>> {
    return this.request<UserProfile>('GET', '/api/auth/me');
  }

  /**
   * Check if user is authenticated
   * Uses /api/auth/me and treats 401 as "not authenticated" (not an error)
   */
  async checkAuth(): Promise<ApiResponse<{ authenticated: boolean; user?: UserProfile }>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/me`, {
        credentials: 'include',
      });

      // 401 = not authenticated (treat as success with authenticated: false)
      if (response.status === 401) {
        return {
          success: true,
          data: { authenticated: false, user: undefined },
        };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const user = await response.json();
      return {
        success: true,
        data: { authenticated: true, user },
      };
    } catch {
      // Network errors or other issues - treat as not authenticated
      return {
        success: true,
        data: { authenticated: false, user: undefined },
      };
    }
  }

  /**
   * Get login URL
   */
  getLoginUrl(): string {
    return `${this.baseUrl}/api/auth/login`;
  }

  /**
   * Get logout URL
   */
  getLogoutUrl(): string {
    return `${this.baseUrl}/api/auth/logout`;
  }

  // ============================================
  // Session Endpoints
  // ============================================

  /**
   * Get all sessions for current user
   */
  async getSessions(): Promise<ApiResponse<Session[]>> {
    const result = await this.request<{ sessions: Session[] }>('GET', '/api/chat/sessions');
    if (result.success) {
      return { success: true, data: result.data.sessions };
    }
    return result;
  }

  /**
   * Get a single session by ID
   */
  async getSession(sessionId: string): Promise<ApiResponse<Session>> {
    // Backend returns session directly (not wrapped in { session: ... })
    const result = await this.request<Session>('GET', `/api/chat/sessions/${sessionId}`);
    return result;
  }

  /**
   * Create a new session
   */
  async createSession(data?: CreateSessionRequest): Promise<ApiResponse<Session>> {
    // Backend returns session directly (not wrapped in { session: ... })
    const result = await this.request<Session>('POST', '/api/chat/sessions', data);
    return result;
  }

  /**
   * Update a session
   */
  async updateSession(sessionId: string, data: UpdateSessionRequest): Promise<ApiResponse<Session>> {
    // Backend returns session directly (not wrapped in { session: ... })
    const result = await this.request<Session>('PATCH', `/api/chat/sessions/${sessionId}`, data);
    return result;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>('DELETE', `/api/chat/sessions/${sessionId}`);
  }

  // ============================================
  // Message Endpoints
  // ============================================

  /**
   * Get messages for a session
   */
  async getMessages(
    sessionId: string,
    options?: {
      limit?: number;
      before?: number; // sequence_number
      after?: number;  // sequence_number
    }
  ): Promise<ApiResponse<Message[]>> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.before) params.set('before', options.before.toString());
    if (options?.after) params.set('after', options.after.toString());

    const query = params.toString();
    const path = `/api/chat/sessions/${sessionId}/messages${query ? `?${query}` : ''}`;
    const result = await this.request<{ messages: Message[] }>('GET', path);
    if (result.success) {
      return { success: true, data: result.data.messages };
    }
    return result;
  }

  /**
   * Get a single message by ID
   */
  async getMessage(sessionId: string, messageId: string): Promise<ApiResponse<Message>> {
    return this.request<Message>('GET', `/api/chat/sessions/${sessionId}/messages/${messageId}`);
  }

  // ============================================
  // Token Usage Endpoints
  // ============================================

  /**
   * Get token usage for a session
   */
  async getSessionTokenUsage(sessionId: string): Promise<ApiResponse<TokenUsage>> {
    return this.request<TokenUsage>('GET', `/api/chat/sessions/${sessionId}/token-usage`);
  }

  /**
   * Get user's total token usage
   */
  async getUserTokenUsage(months?: number): Promise<ApiResponse<TokenUsage>> {
    const path = months ? `/api/users/me/token-usage?months=${months}` : '/api/users/me/token-usage';
    return this.request<TokenUsage>('GET', path);
  }

  // ============================================
  // Health Check
  // ============================================

  /**
   * Check API health
   */
  async healthCheck(): Promise<ApiResponse<{ status: string; timestamp: string }>> {
    return this.request<{ status: string; timestamp: string }>('GET', '/api/health');
  }
}

/**
 * Singleton API instance
 */
let apiInstance: ApiClient | null = null;

/**
 * Get or create the singleton API instance
 */
export function getApiClient(): ApiClient {
  if (!apiInstance) {
    apiInstance = new ApiClient();
  }
  return apiInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetApiClient(): void {
  apiInstance = null;
}
