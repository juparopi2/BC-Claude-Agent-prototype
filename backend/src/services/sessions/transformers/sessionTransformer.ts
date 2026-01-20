/**
 * Session Transformer
 *
 * Transforms database session rows to API response format.
 *
 * @module services/sessions/transformers/sessionTransformer
 */

import type { DbSessionRow, SessionResponse } from '@/domains/sessions';

/**
 * Transform database session row to API response format
 *
 * @param row - Raw session row from database
 * @returns Transformed session for API response
 */
export function transformSession(row: DbSessionRow): SessionResponse {
  // Map is_active (boolean) to status (string enum)
  let status: 'active' | 'completed' | 'cancelled' = 'active';
  if (!row.is_active) {
    status = 'completed'; // Default inactive sessions to 'completed'
  }

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title || 'New Chat',
    status,
    last_activity_at: row.updated_at.toISOString(), // Use updated_at as last_activity_at
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
