/**
 * API Service
 *
 * Type-safe HTTP client for REST API communication.
 * Uses types from @bc-agent/shared for guaranteed frontend-backend contract.
 *
 * @module lib/services/api
 */

import type { ApiErrorResponse } from '@bc-agent/shared';
import { isApiErrorResponse, ErrorCode } from '@bc-agent/shared';
import { env } from '../config/env';

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
 * Message from backend
 */
export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  sequence_number: number;
  created_at: string;
  token_usage?: {
    input_tokens: number;
    output_tokens: number;
    thinking_tokens?: number;
  };
  stop_reason?: string;
  model?: string;
}

/**
 * User profile from backend
 */
export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
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
   */
  async checkAuth(): Promise<ApiResponse<{ authenticated: boolean; user?: UserProfile }>> {
    return this.request('GET', '/api/auth/status');
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
    return this.request<Session[]>('GET', '/api/sessions');
  }

  /**
   * Get a single session by ID
   */
  async getSession(sessionId: string): Promise<ApiResponse<Session>> {
    return this.request<Session>('GET', `/api/sessions/${sessionId}`);
  }

  /**
   * Create a new session
   */
  async createSession(data?: CreateSessionRequest): Promise<ApiResponse<Session>> {
    return this.request<Session>('POST', '/api/sessions', data);
  }

  /**
   * Update a session
   */
  async updateSession(sessionId: string, data: UpdateSessionRequest): Promise<ApiResponse<Session>> {
    return this.request<Session>('PATCH', `/api/sessions/${sessionId}`, data);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>('DELETE', `/api/sessions/${sessionId}`);
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
    const path = `/api/sessions/${sessionId}/messages${query ? `?${query}` : ''}`;
    return this.request<Message[]>('GET', path);
  }

  /**
   * Get a single message by ID
   */
  async getMessage(sessionId: string, messageId: string): Promise<ApiResponse<Message>> {
    return this.request<Message>('GET', `/api/sessions/${sessionId}/messages/${messageId}`);
  }

  // ============================================
  // Token Usage Endpoints
  // ============================================

  /**
   * Get token usage for a session
   */
  async getSessionTokenUsage(sessionId: string): Promise<ApiResponse<TokenUsage>> {
    return this.request<TokenUsage>('GET', `/api/sessions/${sessionId}/token-usage`);
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
