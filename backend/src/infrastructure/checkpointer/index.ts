/**
 * Checkpointer Module
 *
 * Provides a persistent LangGraph checkpointer backed by MSSQL via Prisma.
 * Must be initialized before the supervisor graph.
 *
 * @module infrastructure/checkpointer
 */

import { MSSQLSaver } from './MSSQLSaver';
import { prisma } from '@/infrastructure/database/prisma';
import { createChildLogger } from '@/shared/utils/logger';

export { MSSQLSaver } from './MSSQLSaver';

const logger = createChildLogger({ service: 'Checkpointer' });

let instance: MSSQLSaver | null = null;

/**
 * Initialize the MSSQL checkpointer.
 * Must be called once at server startup before initializeSupervisorGraph().
 */
export async function initializeCheckpointer(): Promise<MSSQLSaver> {
  if (instance) {
    logger.info('Checkpointer already initialized, skipping');
    return instance;
  }

  logger.info('Initializing MSSQL checkpointer...');
  instance = new MSSQLSaver(prisma);
  logger.info('MSSQL checkpointer initialized');

  return instance;
}

/**
 * Get the initialized checkpointer singleton.
 * Throws if not yet initialized.
 */
export function getCheckpointer(): MSSQLSaver {
  if (!instance) {
    throw new Error('Checkpointer not initialized. Call initializeCheckpointer() first.');
  }
  return instance;
}

/**
 * Reset checkpointer state (for testing).
 * @internal
 */
export function __resetCheckpointer(): void {
  instance = null;
}
