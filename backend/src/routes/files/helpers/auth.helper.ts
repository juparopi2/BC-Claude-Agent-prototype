/**
 * Auth Helper
 *
 * Authentication utilities for file routes.
 *
 * @module routes/files/helpers/auth.helper
 */

import type { Request } from 'express';

/**
 * Extract userId from authenticated request
 *
 * @param req - Express request with auth
 * @returns User ID
 * @throws Error if not authenticated
 */
export function getUserId(req: Request): string {
  if (!req.userId) {
    throw new Error('User not authenticated');
  }
  return req.userId;
}
