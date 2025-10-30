/**
 * Authentication Middleware
 *
 * Middleware functions for JWT authentication and role-based authorization.
 */

import type { Request, Response, NextFunction } from 'express';
import { getAuthService } from '@/services/auth';
import type { UserRole } from '@/types';

/**
 * Authenticate JWT Middleware
 *
 * Verifies JWT token from Authorization header and attaches user to request.
 * Requires token to be present and valid.
 *
 * Usage:
 * ```typescript
 * app.get('/protected', authenticateJWT, (req, res) => {
 *   console.log(req.user); // JWTPayload
 * });
 * ```
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function authenticateJWT(req: Request, res: Response, next: NextFunction): void {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'No authorization header provided',
      });
      return;
    }

    // Check if header starts with 'Bearer '
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authorization header format. Expected: Bearer <token>',
      });
      return;
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided',
      });
      return;
    }

    // Verify token
    const authService = getAuthService();
    const verification = authService.verifyAccessToken(token);

    if (!verification.valid || !verification.payload) {
      res.status(401).json({
        error: 'Unauthorized',
        message: verification.error || 'Invalid token',
      });
      return;
    }

    // Attach user to request (safe to cast as we know verifyAccessToken returns JWTPayload)
    req.user = verification.payload as import('@/types').JWTPayload;

    next();
  } catch (error) {
    console.error('[Auth Middleware] Authentication failed:', error);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed',
    });
  }
}

/**
 * Authenticate JWT Optional Middleware
 *
 * Same as authenticateJWT but doesn't fail if no token is provided.
 * Useful for endpoints that behave differently when authenticated but are also public.
 *
 * Usage:
 * ```typescript
 * app.get('/public', authenticateOptional, (req, res) => {
 *   if (req.user) {
 *     // User is authenticated
 *   } else {
 *     // User is not authenticated (public access)
 *   }
 * });
 * ```
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function authenticateOptional(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    // No header - continue without user
    if (!authHeader) {
      next();
      return;
    }

    // Invalid format - continue without user (don't fail)
    if (!authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);

    // No token - continue without user
    if (!token) {
      next();
      return;
    }

    // Verify token
    const authService = getAuthService();
    const verification = authService.verifyAccessToken(token);

    // Valid token - attach user (safe to cast as we know verifyAccessToken returns JWTPayload)
    if (verification.valid && verification.payload) {
      req.user = verification.payload as import('@/types').JWTPayload;
    }

    // Continue regardless of verification result
    next();
  } catch (error) {
    console.error('[Auth Middleware] Optional authentication failed:', error);
    // Don't fail - continue without user
    next();
  }
}

/**
 * Role Hierarchy
 * admin > editor > viewer
 */
const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

/**
 * Require Role Middleware
 *
 * Checks if authenticated user has required role or higher.
 * Must be used AFTER authenticateJWT middleware.
 *
 * Usage:
 * ```typescript
 * app.post('/admin-action', authenticateJWT, requireRole('admin'), (req, res) => {
 *   // Only admin users can access
 * });
 *
 * app.post('/edit-action', authenticateJWT, requireRole('editor'), (req, res) => {
 *   // Editor and admin users can access
 * });
 * ```
 *
 * @param requiredRole - Minimum role required
 * @returns Express middleware function
 */
export function requireRole(requiredRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
        return;
      }

      const userRole = req.user.role;
      const userRoleLevel = ROLE_HIERARCHY[userRole];
      const requiredRoleLevel = ROLE_HIERARCHY[requiredRole];

      // Check if user has sufficient role
      if (userRoleLevel < requiredRoleLevel) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Insufficient permissions. Required role: ${requiredRole}, your role: ${userRole}`,
        });
        return;
      }

      next();
    } catch (error) {
      console.error('[Auth Middleware] Role check failed:', error);
      res.status(403).json({
        error: 'Forbidden',
        message: 'Authorization failed',
      });
    }
  };
}

/**
 * Require Admin Middleware
 *
 * Shorthand for requireRole('admin').
 * Checks if authenticated user is an admin.
 *
 * Usage:
 * ```typescript
 * app.delete('/users/:id', authenticateJWT, requireAdmin, (req, res) => {
 *   // Only admins can delete users
 * });
 * ```
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  return requireRole('admin')(req, res, next);
}

/**
 * Require Editor Middleware
 *
 * Shorthand for requireRole('editor').
 * Checks if authenticated user is an editor or admin.
 *
 * Usage:
 * ```typescript
 * app.post('/items', authenticateJWT, requireEditor, (req, res) => {
 *   // Editors and admins can create items
 * });
 * ```
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function requireEditor(req: Request, res: Response, next: NextFunction): void {
  return requireRole('editor')(req, res, next);
}
