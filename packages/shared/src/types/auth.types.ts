/**
 * Auth Types
 *
 * Tipos compartidos para el sistema de autenticación.
 *
 * @module @bc-agent/shared/types/auth
 */

import type { AuthSessionStatus, AUTH_WS_EVENTS } from '../constants/auth.constants';

/** Respuesta del endpoint /api/auth/health */
export interface SessionHealthResponse {
  status: AuthSessionStatus;
  tokenExpiresAt?: string;
  tokenExpiresIn?: number;
  sessionExpiresAt?: string;
  needsRefresh: boolean;
  userId?: string;
  timestamp: string;
}

/** Payload del evento auth:expiring */
export interface AuthExpiringEventPayload {
  type: typeof AUTH_WS_EVENTS.EXPIRING;
  expiresAt: string;
  expiresIn: number;
  message: string;
}

/** Payload del evento auth:refreshed */
export interface AuthRefreshedEventPayload {
  type: typeof AUTH_WS_EVENTS.REFRESHED;
  expiresAt: string;
}

/** Extensión de UserProfile con datos de expiración */
export interface UserProfileWithExpiry {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  tokenExpiresAt: string | null;
  sessionExpiresAt: string | null;
}
