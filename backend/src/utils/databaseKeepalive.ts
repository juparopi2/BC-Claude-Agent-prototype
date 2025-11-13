/**
 * Database Keepalive Utility
 *
 * Maintains database connection alive during periods of inactivity
 * by periodically executing a lightweight query.
 *
 * @module utils/databaseKeepalive
 */

import { getDatabase, initDatabase } from '../config/database';

/**
 * Keepalive interval in milliseconds
 * Default: 3 minutes (180000ms)
 * Should be less than idleTimeoutMillis (5 minutes)
 */
const KEEPALIVE_INTERVAL = 3 * 60 * 1000; // 3 minutes

/**
 * Keepalive interval ID (for stopping the keepalive)
 */
let keepaliveInterval: NodeJS.Timeout | null = null;

/**
 * Keepalive error count (for monitoring)
 */
let keepaliveErrorCount = 0;

/**
 * Maximum consecutive errors before stopping keepalive
 */
const MAX_CONSECUTIVE_ERRORS = 5;

/**
 * Execute a simple query to keep the connection alive
 *
 * @returns Promise that resolves to true if successful, false otherwise
 */
async function executeKeepalive(): Promise<boolean> {
  try {
    const db = getDatabase();

    if (!db || !db.connected) {
      console.warn('⚠️  Database keepalive: connection not available, attempting reconnection...');

      // Attempt to reconnect
      await initDatabase();
      console.log('✅ Database keepalive: reconnection successful');

      // Reset error count on successful reconnection
      keepaliveErrorCount = 0;
      return true;
    }

    // Execute lightweight query
    await db.request().query('SELECT 1 AS keepalive');

    // Log successful keepalive
    console.log('💚 Database keepalive: ping successful');

    // Reset error count on success
    if (keepaliveErrorCount > 0) {
      console.log('✅ Database keepalive: recovered from previous errors');
      keepaliveErrorCount = 0;
    }

    return true;
  } catch (error) {
    keepaliveErrorCount++;
    console.error(`❌ Database keepalive failed (error ${keepaliveErrorCount}/${MAX_CONSECUTIVE_ERRORS}):`, error instanceof Error ? error.message : 'Unknown error');

    if (keepaliveErrorCount >= MAX_CONSECUTIVE_ERRORS) {
      console.error('❌ Database keepalive: too many consecutive errors, stopping keepalive');
      stopDatabaseKeepalive();
    }

    return false;
  }
}

/**
 * Start database keepalive
 * Executes a SELECT 1 query every KEEPALIVE_INTERVAL milliseconds
 *
 * @returns Interval ID
 */
export function startDatabaseKeepalive(): NodeJS.Timeout {
  // Stop existing keepalive if any
  if (keepaliveInterval) {
    console.log('⚠️  Database keepalive already running, stopping previous instance');
    stopDatabaseKeepalive();
  }

  console.log(`🔄 Starting database keepalive (interval: ${KEEPALIVE_INTERVAL / 1000}s)`);

  // Reset error count
  keepaliveErrorCount = 0;

  // Execute immediately once
  executeKeepalive();

  // Then execute periodically
  keepaliveInterval = setInterval(async () => {
    console.log('⏰ Database keepalive interval triggered');
    await executeKeepalive();
  }, KEEPALIVE_INTERVAL);

  console.log(`✅ Database keepalive scheduled (next execution in ${KEEPALIVE_INTERVAL / 1000}s)`);

  return keepaliveInterval;
}

/**
 * Stop database keepalive
 */
export function stopDatabaseKeepalive(): void {
  if (keepaliveInterval) {
    console.log('🛑 Stopping database keepalive');
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
    keepaliveErrorCount = 0;
  }
}

/**
 * Check if keepalive is running
 *
 * @returns true if keepalive is active, false otherwise
 */
export function isKeepaliveRunning(): boolean {
  return keepaliveInterval !== null;
}

/**
 * Get keepalive error count
 *
 * @returns Number of consecutive keepalive errors
 */
export function getKeepaliveErrorCount(): number {
  return keepaliveErrorCount;
}
