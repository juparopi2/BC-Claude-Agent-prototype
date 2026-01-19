/**
 * Auth Health Service
 *
 * Servicio para calcular el estado de salud de la sesión de autenticación.
 * Single Responsibility: Solo calcula el estado, no hace I/O.
 *
 * @module domains/auth/health/auth-health.service
 */

import {
  AUTH_SESSION_STATUS,
  AUTH_TIME_MS,
  type AuthSessionStatus,
  type SessionHealthResponse,
} from '@bc-agent/shared';

/** Input mínimo para calcular health (subset de MicrosoftOAuthSession) */
export interface SessionHealthInput {
  userId?: string;
  accessToken?: string;
  tokenExpiresAt?: string;
}

/** Interfaz del servicio */
export interface AuthHealthService {
  calculateHealth(session: SessionHealthInput | null): SessionHealthResponse;
}

/**
 * Factory function para crear el servicio
 * Permite dependency injection en tests
 */
export function createAuthHealthService(): AuthHealthService {
  return {
    calculateHealth(session: SessionHealthInput | null): SessionHealthResponse {
      const now = new Date();
      const timestamp = now.toISOString();

      // Sin sesión o sin datos críticos
      if (!session?.userId || !session?.accessToken) {
        return {
          status: AUTH_SESSION_STATUS.UNAUTHENTICATED,
          needsRefresh: false,
          timestamp,
        };
      }

      // Calcular estado del token
      const tokenExpiresAt = session.tokenExpiresAt
        ? new Date(session.tokenExpiresAt)
        : null;

      let status: AuthSessionStatus = AUTH_SESSION_STATUS.AUTHENTICATED;
      let needsRefresh = false;
      let tokenExpiresIn: number | undefined;

      if (tokenExpiresAt) {
        tokenExpiresIn = tokenExpiresAt.getTime() - now.getTime();

        if (tokenExpiresIn <= 0) {
          status = AUTH_SESSION_STATUS.EXPIRED;
          needsRefresh = true;
          tokenExpiresIn = 0; // Normalize to 0 for expired
        } else if (tokenExpiresIn <= AUTH_TIME_MS.EXPIRY_WARNING_THRESHOLD) {
          status = AUTH_SESSION_STATUS.EXPIRING;
          needsRefresh = true;
        } else if (tokenExpiresIn <= AUTH_TIME_MS.REFRESH_THRESHOLD) {
          needsRefresh = true;
        }
      }

      return {
        status,
        tokenExpiresAt: tokenExpiresAt?.toISOString(),
        tokenExpiresIn,
        needsRefresh,
        userId: session.userId,
        timestamp,
      };
    },
  };
}

// Singleton para uso general
let instance: AuthHealthService | null = null;

export function getAuthHealthService(): AuthHealthService {
  if (!instance) {
    instance = createAuthHealthService();
  }
  return instance;
}
