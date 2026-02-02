/**
 * Socket Auth Middleware
 *
 * Middleware de autenticación para Socket.IO con auto-refresh.
 * Extraído de server.ts para seguir Single Responsibility.
 *
 * @module domains/auth/websocket/socket-auth.middleware
 */

import type { Socket } from 'socket.io';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';
import { AUTH_TIME_MS, AUTH_WS_EVENTS } from '@bc-agent/shared';
import type { ILoggerMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';

/** Socket con datos de auth adjuntos */
export interface AuthenticatedSocket extends Socket {
  userId: string;
  userEmail?: string;
}

/** Dependencias inyectables para testing */
export interface SocketAuthDependencies {
  oauthService: {
    refreshAccessTokenSilent: (partitionKey: string, homeAccountId: string) => Promise<{
      accessToken: string;
      refreshToken?: string;
      expiresAt: Date | string;
    }>;
  };
  logger: ILoggerMinimal;
}

/**
 * Factory function para crear el middleware
 * Permite dependency injection para testing
 */
export function createSocketAuthMiddleware(
  deps: SocketAuthDependencies
): (socket: Socket, next: (err?: Error) => void) => Promise<void> {
  const { oauthService, logger } = deps;

  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    const req = socket.request as unknown as Express.Request;

    // Verificar sesión existe
    if (!req.session?.microsoftOAuth) {
      logger.warn('[Socket.IO] Connection rejected: No valid session', { socketId: socket.id });
      return next(new Error('Authentication required'));
    }

    const session = req.session.microsoftOAuth as MicrosoftOAuthSession;

    // Verificar userId
    if (!session.userId) {
      logger.warn('[Socket.IO] Connection rejected: No userId in session', { socketId: socket.id });
      return next(new Error('Invalid session'));
    }

    // Verificar expiración del token
    const tokenExpiresAt = session.tokenExpiresAt ? new Date(session.tokenExpiresAt) : null;
    const now = new Date();
    const isExpired = tokenExpiresAt && tokenExpiresAt <= now;

    // Auto-refresh si expirado
    if (isExpired) {
      // Require homeAccountId and msalPartitionKey for cache-based refresh
      if (!session.homeAccountId || !session.msalPartitionKey) {
        logger.warn('[Socket.IO] Token expired, no homeAccountId/msalPartitionKey (legacy session)', {
          socketId: socket.id,
          userId: session.userId,
          hasHomeAccountId: !!session.homeAccountId,
          hasMsalPartitionKey: !!session.msalPartitionKey,
        });
        return next(new Error('Session expired'));
      }

      try {
        logger.info('[Socket.IO] Token expired, attempting silent refresh', {
          socketId: socket.id,
          userId: session.userId,
        });

        const refreshed = await oauthService.refreshAccessTokenSilent(
          session.msalPartitionKey,
          session.homeAccountId
        );

        // Actualizar sesión
        req.session.microsoftOAuth = {
          ...session,
          accessToken: refreshed.accessToken,
          tokenExpiresAt: refreshed.expiresAt instanceof Date
            ? refreshed.expiresAt.toISOString()
            : String(refreshed.expiresAt),
        };

        // Guardar sesión
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => (err ? reject(err) : resolve()));
        });

        logger.info('[Socket.IO] Token refreshed successfully via acquireTokenSilent', {
          socketId: socket.id,
          userId: session.userId,
        });
      } catch (err) {
        const errorInfo = err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
        logger.error('[Socket.IO] Silent token refresh failed', {
          socketId: socket.id,
          userId: session.userId,
          error: errorInfo,
        });
        return next(new Error('Session expired - refresh failed'));
      }
    }

    // Adjuntar datos de auth al socket
    const authSocket = socket as AuthenticatedSocket;
    authSocket.userId = session.userId;
    authSocket.userEmail = session.email;

    // Emitir warning si expira pronto
    const msUntilExpiry = tokenExpiresAt ? tokenExpiresAt.getTime() - Date.now() : Infinity;
    if (msUntilExpiry > 0 && msUntilExpiry <= AUTH_TIME_MS.EXPIRY_WARNING_THRESHOLD) {
      setTimeout(() => {
        socket.emit(AUTH_WS_EVENTS.EXPIRING, {
          type: AUTH_WS_EVENTS.EXPIRING,
          expiresAt: tokenExpiresAt?.toISOString(),
          expiresIn: msUntilExpiry,
          message: 'Your session will expire soon',
        });
      }, 100);
    }

    next();
  };
}
