/**
 * Database Configuration
 *
 * Azure SQL Database connection and pool management.
 * Uses mssql library for SQL Server connectivity.
 *
 * @module config/database
 */

import sql, { ConnectionPool, config as SqlConfig } from 'mssql';
import { env, isProd } from './environment';

/**
 * Database connection pool
 */
let pool: ConnectionPool | null = null;

/**
 * Get database configuration
 *
 * @returns SQL Server configuration object
 */
export function getDatabaseConfig(): SqlConfig {
  // If connection string is provided, parse it
  if (env.DATABASE_CONNECTION_STRING) {
    // In mssql v12, connectionString is no longer a direct property
    // Parse connection string manually or use it directly with sql.connect()
    // For now, we'll require individual parameters
    throw new Error('Connection string parsing not yet implemented for mssql v12. Please use DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, and DATABASE_PASSWORD.');
  }

  // Otherwise, use individual parameters
  if (!env.DATABASE_SERVER || !env.DATABASE_NAME || !env.DATABASE_USER || !env.DATABASE_PASSWORD) {
    throw new Error('Database configuration is incomplete. Provide either DATABASE_CONNECTION_STRING or DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, and DATABASE_PASSWORD.');
  }

  return {
    server: env.DATABASE_SERVER,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    options: {
      encrypt: true, // Required for Azure SQL
      trustServerCertificate: !isProd, // Trust certificate in development
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 1, // Keep 1 connection always alive (prevents cold starts)
      idleTimeoutMillis: 300000, // 5 minutes (increased from 30s to prevent disconnections)
      acquireTimeoutMillis: 10000, // 10 seconds to acquire connection from pool
    },
    connectionTimeout: 30000, // 30 seconds - Overall connection establishment timeout
    requestTimeout: 30000, // 30 seconds - Individual query timeout
  };
}

/**
 * Handle specific database error types with actionable messages
 *
 * @param err - Error object
 */
function handleDatabaseError(err: Error): void {
  console.error('❌ Database client error:', err.message);

  // Log specific error types for debugging
  if (err.message.includes('ETIMEDOUT')) {
    console.error('   Connection timeout. Check network connectivity and Azure SQL firewall rules.');
  } else if (err.message.includes('ECONNREFUSED')) {
    console.error('   Connection refused. Check if Azure SQL server is running and accessible.');
  } else if (err.message.includes('ECONNRESET')) {
    console.error('   Connection was reset. Check SSL/TLS configuration and network stability.');
  } else if (err.message.includes('ELOGIN') || err.message.includes('Login failed')) {
    console.error('   Authentication failed. Check DATABASE_USER and DATABASE_PASSWORD.');
  } else if (err.message.includes('ENOTFOUND')) {
    console.error('   Server not found. Check DATABASE_SERVER hostname.');
  } else if (err.message.includes('EINSTLOOKUP')) {
    console.error('   Instance lookup failed. Check server name and port.');
  }
}

/**
 * Verify database connection with a simple query
 *
 * @param pool - Connection pool to verify
 * @returns true if connection is healthy, false otherwise
 */
async function verifyConnection(pool: ConnectionPool): Promise<boolean> {
  try {
    const result = await pool.request().query('SELECT 1 AS health');
    if (result.recordset && result.recordset.length > 0 && result.recordset[0].health === 1) {
      console.log('✅ Database connection verified (SELECT 1 successful)');
      return true;
    }
    console.error('❌ Database verification failed: unexpected result');
    return false;
  } catch (error) {
    console.error('❌ Database verification failed:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Connect to database with exponential backoff retry logic
 *
 * @param config - Database configuration
 * @param maxRetries - Maximum number of retry attempts (default: 10)
 * @returns Promise that resolves to the connection pool
 */
async function connectWithRetry(config: SqlConfig, maxRetries: number = 10): Promise<ConnectionPool> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔌 Connecting to Azure SQL Database... (attempt ${attempt}/${maxRetries})`);

      const newPool = await sql.connect(config);

      // Verify connection with SELECT 1
      const isHealthy = await verifyConnection(newPool);
      if (!isHealthy) {
        await newPool.close();
        throw new Error('Connection established but verification failed');
      }

      return newPool;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      handleDatabaseError(lastError);

      if (attempt < maxRetries) {
        // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms, 3200ms (capped)
        const delay = Math.min(attempt * 100, 3200);
        console.log(`🔄 Retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  console.error(`❌ Failed to connect after ${maxRetries} attempts`);
  throw lastError || new Error('Database connection failed after all retries');
}

/**
 * Initialize database connection pool
 *
 * @returns Promise that resolves to the connection pool
 */
export async function initDatabase(): Promise<ConnectionPool> {
  try {
    if (pool && pool.connected) {
      console.log('✅ Database connection pool already initialized');
      return pool;
    }

    const config = getDatabaseConfig();

    // Connect with retry logic and exponential backoff
    pool = await connectWithRetry(config, 10);

    console.log('✅ Connected to Azure SQL Database');

    // Enhanced error handler with specific error types and reconnection attempt
    pool.on('error', async (err: Error) => {
      console.error('❌ Database connection error detected:');
      handleDatabaseError(err);

      // Mark pool as null to force reconnection on next query
      pool = null;

      // Attempt to reconnect in background (don't block)
      console.log('🔄 Attempting automatic reconnection in 5 seconds...');
      setTimeout(async () => {
        try {
          await initDatabase();
          console.log('✅ Automatic reconnection successful');
        } catch (reconnectError) {
          console.error('❌ Automatic reconnection failed:', reconnectError instanceof Error ? reconnectError.message : 'Unknown error');
        }
      }, 5000);
    });

    return pool;
  } catch (error) {
    console.error('❌ Failed to initialize database after all retries');
    throw error;
  }
}

/**
 * Get the database connection pool
 *
 * @returns Connection pool or null if not initialized
 */
export function getDatabase(): ConnectionPool | null {
  return pool;
}

/**
 * Get database connection pool (throws if not initialized)
 * Alias for getDatabase() that throws instead of returning null
 *
 * @returns Connection pool
 * @throws Error if pool is not initialized
 */
export function getPool(): ConnectionPool {
  if (!pool) {
    throw new Error('[Database] Pool not initialized. Call initDatabase() first.');
  }
  return pool;
}

/**
 * SQL Parameter Value Types
 * Supported types for SQL Server parameters
 */
export type SqlValue =
  | string
  | number
  | boolean
  | Date
  | Buffer
  | null
  | undefined;

/**
 * Typed SQL Parameters
 * Record of parameter names to SQL-compatible values
 */
export type SqlParams = Record<string, SqlValue>;

/**
 * Execute a query with type-safe parameters
 *
 * @param query - SQL query string with @paramName placeholders
 * @param params - Query parameters (Record<string, SqlValue>)
 * @returns Query result
 *
 * @example
 * ```typescript
 * const result = await executeQuery<Customer>(
 *   'SELECT * FROM customers WHERE id = @id',
 *   { id: '123e4567-e89b-12d3-a456-426614174000' }
 * );
 * ```
 */
export async function executeQuery<T = unknown>(
  query: string,
  params?: SqlParams
): Promise<sql.IResult<T>> {
  try {
    const db = getDatabase();

    if (!db || !db.connected) {
      throw new Error('Database not connected. Call initDatabase() first.');
    }

    const request = db.request();

    // Add parameters to the request with type checking
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        // Validate parameter value type
        if (value !== null && value !== undefined) {
          const validTypes = ['string', 'number', 'boolean', 'object'];
          const valueType = typeof value;

          if (!validTypes.includes(valueType) && !(value instanceof Date) && !(value instanceof Buffer)) {
            throw new Error(
              `Invalid parameter type for '${key}': ${valueType}. ` +
              `Expected string, number, boolean, Date, Buffer, null, or undefined.`
            );
          }
        }

        request.input(key, value);
      });
    }

    const result = await request.query<T>(query);
    return result;
  } catch (error) {
    console.error('❌ Query execution failed:', error);
    throw error;
  }
}

/**
 * Execute a stored procedure with type-safe parameters
 *
 * @param procedureName - Name of the stored procedure
 * @param params - Procedure parameters (Record<string, SqlValue>)
 * @returns Procedure result
 *
 * @example
 * ```typescript
 * const result = await executeProcedure<Customer>(
 *   'sp_GetCustomerById',
 *   { customerId: '123e4567-e89b-12d3-a456-426614174000' }
 * );
 * ```
 */
export async function executeProcedure<T = unknown>(
  procedureName: string,
  params?: SqlParams
): Promise<sql.IResult<T>> {
  try {
    const db = getDatabase();

    if (!db || !db.connected) {
      throw new Error('Database not connected. Call initDatabase() first.');
    }

    const request = db.request();

    // Add parameters to the request with type checking
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        // Validate parameter value type
        if (value !== null && value !== undefined) {
          const validTypes = ['string', 'number', 'boolean', 'object'];
          const valueType = typeof value;

          if (!validTypes.includes(valueType) && !(value instanceof Date) && !(value instanceof Buffer)) {
            throw new Error(
              `Invalid parameter type for '${key}': ${valueType}. ` +
              `Expected string, number, boolean, Date, Buffer, null, or undefined.`
            );
          }
        }

        request.input(key, value);
      });
    }

    const result = await request.execute<T>(procedureName);
    return result;
  } catch (error) {
    console.error('❌ Procedure execution failed:', error);
    throw error;
  }
}

/**
 * Close the database connection pool
 */
export async function closeDatabase(): Promise<void> {
  try {
    if (pool) {
      await pool.close();
      pool = null;
      console.log('✅ Database connection closed');
    }
  } catch (error) {
    console.error('❌ Failed to close database connection:', error);
    throw error;
  }
}

/**
 * Check if database is connected and healthy
 *
 * @returns true if database is healthy, false otherwise
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const db = getDatabase();

    if (!db || !db.connected) {
      return false;
    }

    // Try a simple query
    await executeQuery('SELECT 1 AS health');
    return true;
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    return false;
  }
}

/**
 * SQL Server data types for type-safe queries
 */
export { sql };

/**
 * Export pool for direct access (use with caution - may be null)
 * Prefer using getPool() which throws if not initialized
 */
export { pool };
