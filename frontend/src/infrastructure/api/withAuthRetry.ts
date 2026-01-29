/**
 * Auth Retry Wrapper
 *
 * Provides automatic retry logic for API calls that fail due to
 * authentication errors (401/SESSION_EXPIRED).
 *
 * The wrapper will:
 * 1. Execute the API call
 * 2. If it fails with an auth error, attempt to refresh the token
 * 3. Retry the original call
 *
 * @module infrastructure/api/withAuthRetry
 */

import type { ApiResponse } from './httpClient';
import { ErrorCode, AUTH_TIME_MS } from '@bc-agent/shared';
import { env } from '@/lib/config/env';

/**
 * Check if an error code indicates an authentication failure that can be retried
 */
function isAuthError(code: string): boolean {
  return code === ErrorCode.SESSION_EXPIRED ||
         code === ErrorCode.UNAUTHORIZED ||
         code === ErrorCode.INVALID_TOKEN;
}

/**
 * Attempt to refresh the authentication token
 *
 * @returns true if refresh was successful, false otherwise
 */
async function attemptTokenRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${env.apiUrl}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      console.warn('[withAuthRetry] Token refresh failed:', response.status);
      return false;
    }

    const data = await response.json();
    console.info('[withAuthRetry] Token refreshed successfully, expires:', data.expiresAt);
    return true;
  } catch (error) {
    console.error('[withAuthRetry] Token refresh error:', error);
    return false;
  }
}

/**
 * Sleep helper
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Execute an API call with automatic retry on authentication errors
 *
 * @param fn - The API call function to execute
 * @param maxRetries - Maximum number of retries (default: AUTH_MAX_RETRIES from shared constants)
 * @returns The API response (success or error)
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = await withAuthRetry(() => fileApi.initUploadSession(data));
 *
 * // With custom retry count
 * const result = await withAuthRetry(
 *   () => fileApi.markSessionFileUploaded(sessionId, batchId, fileData),
 *   2
 * );
 * ```
 */
export async function withAuthRetry<T>(
  fn: () => Promise<ApiResponse<T>>,
  maxRetries: number = AUTH_TIME_MS.AUTH_MAX_RETRIES
): Promise<ApiResponse<T>> {
  let result = await fn();

  for (let attempt = 0; attempt < maxRetries && !result.success; attempt++) {
    // Check if this is a retryable auth error
    if (!isAuthError(result.error.code)) {
      // Not an auth error, return immediately
      break;
    }

    console.info(`[withAuthRetry] Auth error detected (${result.error.code}), attempting refresh (attempt ${attempt + 1}/${maxRetries})`);

    // Wait before retry
    if (attempt > 0) {
      await sleep(AUTH_TIME_MS.AUTH_RETRY_DELAY);
    }

    // Attempt to refresh the token
    const refreshed = await attemptTokenRefresh();

    if (!refreshed) {
      console.warn('[withAuthRetry] Token refresh failed, not retrying');
      break;
    }

    // Retry the original operation
    console.info('[withAuthRetry] Retrying original operation after token refresh');
    result = await fn();
  }

  return result;
}

/**
 * Create a version of an API function that automatically retries on auth errors
 *
 * @param fn - The API function to wrap
 * @param maxRetries - Maximum number of retries
 * @returns A wrapped function with automatic retry
 *
 * @example
 * ```typescript
 * const initUploadSessionWithRetry = createRetryableApiCall(
 *   (data: InitSessionInput) => fileApi.initUploadSession(data)
 * );
 *
 * const result = await initUploadSessionWithRetry({ folders, targetFolderId });
 * ```
 */
export function createRetryableApiCall<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<ApiResponse<TResult>>,
  maxRetries: number = AUTH_TIME_MS.AUTH_MAX_RETRIES
): (...args: TArgs) => Promise<ApiResponse<TResult>> {
  return (...args: TArgs) => withAuthRetry(() => fn(...args), maxRetries);
}
