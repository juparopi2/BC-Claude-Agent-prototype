/**
 * Configuration Module
 * @deprecated Import from '@/infrastructure' instead
 *
 * This file exists for backwards compatibility during migration.
 * All exports are re-exported from their new locations in infrastructure/.
 *
 * @module config
 */

// Environment configuration (from infrastructure/config)
export {
  env,
  isProd,
  isDev,
  validateRequiredSecrets,
  printConfig,
} from '../infrastructure/config/environment';

// Azure Key Vault (from infrastructure/keyvault)
export {
  SECRET_NAMES,
  getSecret,
  loadSecretsFromKeyVault,
  clearSecretCache,
} from '../infrastructure/keyvault/keyvault';

// Database configuration (from infrastructure/database)
export {
  initDatabase,
  getDatabase,
  executeQuery,
  executeProcedure,
  closeDatabase,
  checkDatabaseHealth,
  sql,
} from '../infrastructure/database/database';

// Redis configuration (from infrastructure/redis)
export {
  initRedis,
  getRedis,
  closeRedis,
  checkRedisHealth,
  setSession,
  getSession,
  deleteSession,
  setCache,
  getCache,
  deleteCache,
  deleteCachePattern,
} from '../infrastructure/redis/redis';

/**
 * Initialize all services
 * @deprecated Use imports from '@/infrastructure' directly
 */
export async function initializeAllServices(): Promise<void> {
  console.log('🚀 Initializing all services...');

  try {
    const { loadSecretsFromKeyVault } = await import('../infrastructure/keyvault/keyvault');
    await loadSecretsFromKeyVault();

    const { validateRequiredSecrets } = await import('../infrastructure/config/environment');
    validateRequiredSecrets();

    const { initDatabase } = await import('../infrastructure/database/database');
    await initDatabase();

    const { initRedis } = await import('../infrastructure/redis/redis');
    await initRedis();

    console.log('✅ All services initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    throw error;
  }
}

/**
 * Close all services gracefully
 * @deprecated Use imports from '@/infrastructure' directly
 */
export async function closeAllServices(): Promise<void> {
  console.log('🛑 Closing all services...');

  try {
    const { closeDatabase } = await import('../infrastructure/database/database');
    await closeDatabase();

    const { closeRedis } = await import('../infrastructure/redis/redis');
    await closeRedis();

    console.log('✅ All services closed successfully');
  } catch (error) {
    console.error('❌ Failed to close services:', error);
    throw error;
  }
}

/**
 * Check health of all services
 * @deprecated Use imports from '@/infrastructure' directly
 */
export async function checkAllServicesHealth(): Promise<{
  database: boolean;
  redis: boolean;
  overall: boolean;
}> {
  const { checkDatabaseHealth } = await import('../infrastructure/database/database');
  const { checkRedisHealth } = await import('../infrastructure/redis/redis');

  const database = await checkDatabaseHealth();
  const redis = await checkRedisHealth();

  return {
    database,
    redis,
    overall: database && redis,
  };
}
