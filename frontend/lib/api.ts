/**
 * API Client
 *
 * HTTP client for interacting with the backend API.
 * Handles authentication, request/response formatting, and error handling.
 *
 * @module lib/api
 */

import type { User, Session, Message, Approval, HealthStatus, AuthResponse } from './types';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * API configuration
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * API error class
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public data?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Get authentication token from localStorage
 */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

/**
 * Set authentication token in localStorage
 */
export function setAuthToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

/**
 * Remove authentication token from localStorage
 */
export function clearAuthToken(): void {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
}

/**
 * Get refresh token from localStorage
 */
export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('refresh_token');
}

/**
 * Set refresh token in localStorage
 */
export function setRefreshToken(token: string): void {
  localStorage.setItem('refresh_token', token);
}

/**
 * Flag to prevent infinite refresh loops
 */
let isRefreshing = false;

/**
 * Make an HTTP request to the API
 */
async function request<T = unknown>(
  method: HttpMethod,
  endpoint: string,
  data?: Record<string, unknown>,
  options?: RequestInit,
  _isRetry = false
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  // Add authentication token if available
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config: RequestInit = {
    method,
    headers,
    ...options,
  };

  // Add body for POST, PUT, PATCH requests
  if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
    config.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(url, config);

    // Parse response
    const responseData = await response.json().catch(() => null);

    // Handle errors
    if (!response.ok) {
      // Auto-refresh on 401 Unauthorized (if not already retrying and not on auth endpoints)
      if (
        response.status === 401 &&
        !_isRetry &&
        !endpoint.includes('/auth/') &&
        !isRefreshing
      ) {
        const refreshToken = getRefreshToken();
        if (refreshToken) {
          try {
            isRefreshing = true;

            // Attempt to refresh the token
            const refreshResponse = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            });

            if (refreshResponse.ok) {
              const refreshData = await refreshResponse.json();

              // Update tokens
              setAuthToken(refreshData.accessToken);
              if (refreshData.refreshToken) {
                setRefreshToken(refreshData.refreshToken);
              }

              isRefreshing = false;

              // Retry the original request with new token
              return request<T>(method, endpoint, data, options, true);
            } else {
              // Refresh failed - clear tokens and redirect to login
              isRefreshing = false;
              clearAuthToken();

              if (typeof window !== 'undefined') {
                window.location.href = '/login';
              }
            }
          } catch (refreshError) {
            // Refresh failed - clear tokens and redirect to login
            isRefreshing = false;
            clearAuthToken();

            if (typeof window !== 'undefined') {
              window.location.href = '/login';
            }
          }
        } else {
          // No refresh token available - redirect to login
          clearAuthToken();
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        }
      }

      throw new ApiError(
        responseData?.message || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        responseData
      );
    }

    return responseData as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    // Network or other errors
    throw new ApiError(
      error instanceof Error ? error.message : 'An unknown error occurred',
      0
    );
  }
}

/**
 * API client methods
 */
export const api = {
  /**
   * GET request
   */
  get: <T = unknown>(endpoint: string, options?: RequestInit) =>
    request<T>('GET', endpoint, undefined, options),

  /**
   * POST request
   */
  post: <T = unknown>(endpoint: string, data?: Record<string, unknown>, options?: RequestInit) =>
    request<T>('POST', endpoint, data, options),

  /**
   * PUT request
   */
  put: <T = unknown>(endpoint: string, data?: Record<string, unknown>, options?: RequestInit) =>
    request<T>('PUT', endpoint, data, options),

  /**
   * PATCH request
   */
  patch: <T = unknown>(endpoint: string, data?: Record<string, unknown>, options?: RequestInit) =>
    request<T>('PATCH', endpoint, data, options),

  /**
   * DELETE request
   */
  delete: <T = unknown>(endpoint: string, options?: RequestInit) =>
    request<T>('DELETE', endpoint, undefined, options),
};

/**
 * Authentication API
 */
export const authApi = {
  /**
   * Register a new user
   */
  register: async (email: string, password: string, fullName?: string) => {
    const response = await api.post<AuthResponse>('/api/auth/register', {
      fullName, // Backend expects 'fullName' not 'name'
      email,
      password,
    });

    if (response.accessToken) {
      setAuthToken(response.accessToken);
    }
    if (response.refreshToken) {
      setRefreshToken(response.refreshToken);
    }

    return response;
  },

  /**
   * Login
   */
  login: async (email: string, password: string) => {
    const response = await api.post<AuthResponse>('/api/auth/login', {
      email,
      password,
    });

    if (response.accessToken) {
      setAuthToken(response.accessToken);
    }
    if (response.refreshToken) {
      setRefreshToken(response.refreshToken);
    }

    return response;
  },

  /**
   * Logout
   */
  logout: () => {
    clearAuthToken();
  },

  /**
   * Get current user
   */
  me: () => api.get<{ user: User }>('/api/auth/me'),

  /**
   * Refresh token
   */
  refresh: async (refreshToken: string) => {
    const response = await api.post<AuthResponse>('/api/auth/refresh', { refreshToken });

    if (response.accessToken) {
      setAuthToken(response.accessToken);
    }
    if (response.refreshToken) {
      setRefreshToken(response.refreshToken);
    }

    return response;
  },
};

/**
 * Chat/Session API
 */
export const chatApi = {
  /**
   * Get all sessions for current user
   */
  getSessions: () => api.get<{ sessions: Session[] }>('/api/chat/sessions'),

  /**
   * Get a specific session
   */
  getSession: (sessionId: string) => api.get<{ session: Session }>(`/api/chat/sessions/${sessionId}`),

  /**
   * Create a new session
   */
  createSession: (title?: string) => api.post<{ session: Session }>('/api/chat/sessions', { title }),

  /**
   * Delete a session
   */
  deleteSession: (sessionId: string) => api.delete(`/api/chat/sessions/${sessionId}`),

  /**
   * Get messages for a session
   */
  getMessages: (sessionId: string) => api.get<{ messages: Message[] }>(`/api/chat/sessions/${sessionId}/messages`),

  /**
   * Send a message (via HTTP, not WebSocket)
   */
  sendMessage: (sessionId: string, content: string) =>
    api.post<{ message: Message }>(`/api/chat/sessions/${sessionId}/messages`, { content }),
};

/**
 * Approval API
 */
export const approvalApi = {
  /**
   * Get pending approvals for current user
   */
  getPendingApprovals: () => api.get<{ approvals: Approval[] }>('/api/approvals/pending'),

  /**
   * Approve an action
   */
  approve: (approvalId: string) => api.post(`/api/approvals/${approvalId}/approve`),

  /**
   * Reject an action
   */
  reject: (approvalId: string, reason?: string) =>
    api.post(`/api/approvals/${approvalId}/reject`, { reason }),
};

/**
 * Health check
 */
export const healthApi = {
  check: () => api.get<HealthStatus>('/health'),
};
