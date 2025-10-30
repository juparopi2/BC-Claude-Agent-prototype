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
function getDatabaseConfig(): SqlConfig {
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
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
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

    console.log('🔌 Connecting to Azure SQL Database...');

    const config = getDatabaseConfig();
    pool = await sql.connect(config);

    console.log('✅ Connected to Azure SQL Database');

    // Handle connection errors
    pool.on('error', (err: Error) => {
      console.error('❌ Database connection error:', err);
      pool = null;
    });

    return pool;
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
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
 * Execute a query with parameters
 *
 * @param query - SQL query string
 * @param params - Query parameters
 * @returns Query result
 */
export async function executeQuery<T = any>(
  query: string,
  params?: Record<string, any>
): Promise<sql.IResult<T>> {
  try {
    const db = getDatabase();

    if (!db || !db.connected) {
      throw new Error('Database not connected. Call initDatabase() first.');
    }

    const request = db.request();

    // Add parameters to the request
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
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
 * Execute a stored procedure
 *
 * @param procedureName - Name of the stored procedure
 * @param params - Procedure parameters
 * @returns Procedure result
 */
export async function executeProcedure<T = any>(
  procedureName: string,
  params?: Record<string, any>
): Promise<sql.IResult<T>> {
  try {
    const db = getDatabase();

    if (!db || !db.connected) {
      throw new Error('Database not connected. Call initDatabase() first.');
    }

    const request = db.request();

    // Add parameters to the request
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
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
