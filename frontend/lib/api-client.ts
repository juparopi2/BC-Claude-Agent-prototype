/**
 * API Client
 *
 * Axios-based HTTP client for backend REST API.
 * Handles authentication via session cookies (withCredentials).
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import type {
  User,
  BCStatus,
  Session,
  SessionsResponse,
  SessionResponse,
  Message,
  MessagesResponse,
  Approval,
  ApprovalsResponse,
  HealthStatus,
} from "@/types/api";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3002";

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      withCredentials: true,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          if (typeof window !== "undefined") {
            window.location.href = "/login";
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  async post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  async put<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  async patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }

  auth = {
    me: () => this.get<User>("/api/auth/me"),
    bcStatus: () => this.get<BCStatus>("/api/auth/bc-status"),
    logout: () => this.post<void>("/api/auth/logout"),
  };

  sessions = {
    list: () => this.get<SessionsResponse>("/api/chat/sessions"),
    get: (sessionId: string) =>
      this.get<SessionResponse>(`/api/chat/sessions/${sessionId}`),
    create: (title?: string) =>
      this.post<SessionResponse>("/api/chat/sessions", { title }),
    update: (sessionId: string, title: string) =>
      this.patch<SessionResponse>(`/api/chat/sessions/${sessionId}`, {
        title,
      }),
    delete: (sessionId: string) =>
      this.delete<void>(`/api/chat/sessions/${sessionId}`),
  };

  messages = {
    list: (sessionId: string) =>
      this.get<MessagesResponse>(`/api/chat/sessions/${sessionId}/messages`),
    send: (sessionId: string, content: string) =>
      this.post<{ message: Message }>(
        `/api/chat/sessions/${sessionId}/messages`,
        { content }
      ),
  };

  approvals = {
    list: () => this.get<ApprovalsResponse>("/api/approvals/pending"),
    approve: (approvalId: string) =>
      this.post<void>(`/api/approvals/${approvalId}/approve`),
    reject: (approvalId: string, reason?: string) =>
      this.post<void>(`/api/approvals/${approvalId}/reject`, { reason }),
  };

  health = {
    check: () => this.get<HealthStatus>("/health"),
  };
}

export const apiClient = new ApiClient();
