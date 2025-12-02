/**
 * Configuration Module
 *
 * Centralized configuration exports for the application.
 * This module re-exports all configuration modules for easy imports.
 *
 * @module config
 */

// Environment configuration
export {
  env,
  isProd,
  isDev,
  validateRequiredSecrets,
  printConfig,
} from './environment';

// Azure Key Vault
export {
  SECRET_NAMES,
  getSecret,
  loadSecretsFromKeyVault,
  clearSecretCache,
} from './keyvault';

// Database configuration
export {
  initDatabase,
  getDatabase,
  executeQuery,
  executeProcedure,
  closeDatabase,
  checkDatabaseHealth,
  sql,
} from './database';

// Redis configuration
export {
  initRedis,
  getRedis,
  closeRedis,
  checkRedisHealth,
  // Session helpers
  setSession,
  getSession,
  deleteSession,
  // Cache helpers
  setCache,
  getCache,
  deleteCache,
  deleteCachePattern,
} from './redis';

/**
 * Initialize all services
 *
 * This function initializes all core services in the correct order:
 * 1. Load secrets from Key Vault
 * 2. Validate required secrets
 * 3. Initialize database connection
 * 4. Initialize Redis connection
 *
 * @returns Promise that resolves when all services are initialized
 */
export async function initializeAllServices(): Promise<void> {
  console.log('🚀 Initializing all services...');

  try {
    // Step 1: Load secrets from Key Vault (if configured)
    const { loadSecretsFromKeyVault } = await import('./keyvault');
    await loadSecretsFromKeyVault();

    // Step 2: Validate required secrets
    const { validateRequiredSecrets } = await import('./environment');
    validateRequiredSecrets();

    // Step 3: Initialize database
    const { initDatabase } = await import('./database');
    await initDatabase();

    // Step 4: Initialize Redis
    const { initRedis } = await import('./redis');
    await initRedis();

    console.log('✅ All services initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    throw error;
  }
}

/**
 * Close all services gracefully
 *
 * This function closes all active connections:
 * - Database connection pool
 * - Redis client
 *
 * Should be called on application shutdown.
 *
 * @returns Promise that resolves when all services are closed
 */
export async function closeAllServices(): Promise<void> {
  console.log('🛑 Closing all services...');

  try {
    // Close database connection
    const { closeDatabase } = await import('./database');
    await closeDatabase();

    // Close Redis connection
    const { closeRedis } = await import('./redis');
    await closeRedis();

    console.log('✅ All services closed successfully');
  } catch (error) {
    console.error('❌ Failed to close services:', error);
    throw error;
  }
}

/**
 * Check health of all services
 *
 * @returns Object with health status of each service
 */
export async function checkAllServicesHealth(): Promise<{
  database: boolean;
  redis: boolean;
  overall: boolean;
}> {
  const { checkDatabaseHealth } = await import('./database');
  const { checkRedisHealth } = await import('./redis');

  const database = await checkDatabaseHealth();
  const redis = await checkRedisHealth();

  return {
    database,
    redis,
    overall: database && redis,
  };
}
