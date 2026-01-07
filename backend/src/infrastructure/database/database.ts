/**
 * Database Configuration
 *
 * Azure SQL Database connection and pool management.
 * Uses mssql library for SQL Server connectivity.
 *
 * @module config/database
 */

import sql, { ConnectionPool, config as SqlConfig, ISqlType } from 'mssql';
import { env, isProd } from '@/infrastructure/config/environment';
import { isValidUUID } from '@/shared/utils/uuid';
import { validateQuery } from '@/shared/utils/sql/validators';

/**
 * Transient error codes that should trigger a retry
 * 
 * 40613: Database unavailable
 * 40197: Error processing request
 * 40501: Service busy
 * 10053: Transport-level error (software caused connection abort)
 * 10054: Transport-level error (connection reset by peer)
 * 10060: Network error
 * 40540: Service busy
 * 40143: Service busy
 * -1: Connection error (generic)
 * 'ETIMEDOUT': Connection timeout
 * 'ESOCKET': Socket error
 */
const TRANSIENT_ERROR_CODES = [
  40613, 40197, 40501, 10053, 10054, 10060, 40540, 40143, -1
];

/**
 * Check if the current environment is an E2E test environment
 */
const isE2E = process.env.E2E_TEST === 'true';

declare global {
  var __databasePool: ConnectionPool | null | undefined;
}

function _getPoolInternal(): ConnectionPool | null {
  return globalThis.__databasePool ?? null;
}

function _setPoolInternal(p: ConnectionPool | null): void {
  globalThis.__databasePool = p;
}

/**
 * SQL parameter type mapping
 *
 * Maps JavaScript parameter names to SQL Server data types.
 * This ensures that mssql library uses correct type binding
 * instead of inferring types (which can fail for UUIDs).
 *
 * Reference: https://github.com/tediousjs/node-mssql#data-types
 */
const PARAMETER_TYPE_MAP: Record<string, ISqlType | (() => ISqlType)> = {
  // ⭐ PHASE 1B: 'id' changed to NVARCHAR(255) for messages table
  // Now supports Anthropic message IDs (msg_01...), tool IDs (toolu_01...), and system IDs
  // Note: Other tables (sessions, users, etc.) still use UUID for 'id', but they use
  // different parameter names (session_id, user_id) which remain as UniqueIdentifier
  'id': sql.NVarChar(255),  // Was: sql.UniqueIdentifier - Changed for messages table Phase 1B
  'session_id': sql.UniqueIdentifier,
  'user_id': sql.UniqueIdentifier,
  'event_id': sql.UniqueIdentifier,
  // ⭐ PHASE 1B: message_id changed to NVARCHAR to support Anthropic IDs (msg_01...)
  'message_id': sql.NVarChar(255),  // Was: sql.UniqueIdentifier
  'decided_by_user_id': sql.UniqueIdentifier,
  'parent_todo_id': sql.UniqueIdentifier,
  'entity_id': sql.UniqueIdentifier,
  'file_id': sql.UniqueIdentifier,
  'parent_folder_id': sql.UniqueIdentifier,

  // NVARCHAR columns that end in 'Id' but are NOT UUIDs (Microsoft OAuth IDs, Anthropic IDs)
  'microsoftId': sql.NVarChar(255),
  'microsoft_id': sql.NVarChar(255),
  'messageId': sql.NVarChar(255),  // camelCase variant for Anthropic message IDs (msg_01...)

  // INT columns
  'chunk_index': sql.Int,
  'chunk_tokens': sql.Int,
  'sequence_number': sql.Int,
  'token_count': sql.Int,
  // Note: thinking_tokens column removed from database (Option A - 2025-11-24)
  // Thinking tokens are only available via WebSocket real-time events
  'tokens_used': sql.Int,
  'duration_ms': sql.Int,
  'order': sql.Int,
  // ⭐ PHASE 1A: Token tracking columns
  'input_tokens': sql.Int,
  'output_tokens': sql.Int,

  // BIGINT columns
  'file_size_bytes': sql.BigInt,
  'size_bytes': sql.BigInt,

  // DATETIME2 columns
  'created_at': sql.DateTime2,
  'updated_at': sql.DateTime2,
  'timestamp': sql.DateTime2,
  'expires_at': sql.DateTime2,
  'decided_at': sql.DateTime2,
  'started_at': sql.DateTime2,
  'completed_at': sql.DateTime2,
  'removed_at': sql.DateTime2,
  'last_microsoft_login': sql.DateTime2,
  'bc_token_expires_at': sql.DateTime2,

  // BIT columns (boolean)
  'processed': sql.Bit,
  'approved': sql.Bit,
  'rejected': sql.Bit,
  'completed': sql.Bit,
  'removed': sql.Bit,
  'success': sql.Bit,
  'is_folder': sql.Bit,
  'is_favorite': sql.Bit,

  // NVARCHAR columns (strings) - explicit for clarity
  'event_type': sql.NVarChar,
  'role': sql.NVarChar,
  'message_type': sql.NVarChar,
  'content': sql.NVarChar(sql.MAX),
  'metadata': sql.NVarChar(sql.MAX),
  'data': sql.NVarChar(sql.MAX),
  'stop_reason': sql.NVarChar,
  'tool_use_id': sql.NVarChar,  // Anthropic SDK tool_use block ID (e.g., toolu_01...)
  'tool_name': sql.NVarChar,
  // ⭐ PHASE 1A: Model name column
  'model': sql.NVarChar(100),
  'tool_args': sql.NVarChar(sql.MAX),
  'tool_result': sql.NVarChar(sql.MAX),
  'error_message': sql.NVarChar(sql.MAX),
  'title': sql.NVarChar,
  'description': sql.NVarChar,
  'status': sql.NVarChar,
  'type': sql.NVarChar,
  'entity_type': sql.NVarChar,
  'action_type': sql.NVarChar,
  'file_name': sql.NVarChar,
  'file_type': sql.NVarChar,
  'file_path': sql.NVarChar,
  'reasoning': sql.NVarChar(sql.MAX),
  'context': sql.NVarChar(sql.MAX),
  'decision': sql.NVarChar(sql.MAX),
  'bc_company_id': sql.NVarChar,
  'bc_environment': sql.NVarChar,
  'microsoft_oid': sql.NVarChar,
  'email': sql.NVarChar,
  'display_name': sql.NVarChar,
  'microsoft_access_token_encrypted': sql.NVarChar(sql.MAX),
  'microsoft_refresh_token_encrypted': sql.NVarChar(sql.MAX),
  'bc_access_token_encrypted': sql.NVarChar(sql.MAX),
  // File-related columns
  'blob_path': sql.NVarChar(1000),
  'mime_type': sql.NVarChar(255),
  'name': sql.NVarChar(500),
  'processing_status': sql.NVarChar(50),
  'embedding_status': sql.NVarChar(50),
  'extracted_text': sql.NVarChar(sql.MAX),
  'chunk_text': sql.NVarChar(sql.MAX),
  'search_document_id': sql.NVarChar(255),
  'usage_type': sql.NVarChar(50),

  // FLOAT columns
  'relevance_score': sql.Float,

  // VARBINARY columns
  'file_content': sql.VarBinary(sql.MAX),

  // Image embedding columns
  'embedding': sql.NVarChar(sql.MAX),  // JSON array of floats
  'dimensions': sql.Int,
  'model_version': sql.NVarChar(50),
};

/**
 * Infer SQL type from parameter name and value
 *
 * Falls back to heuristics if parameter name is not in explicit mapping.
 * For UUID parameters (detected by naming convention), validates format before binding.
 *
 * @param key - Parameter name
 * @param value - Parameter value
 * @returns SQL type factory
 * @throws Error if UUID parameter has invalid format
 */
function inferSqlType(key: string, value: unknown): ISqlType | (() => ISqlType) {
  // 1. Check explicit mapping first
  if (PARAMETER_TYPE_MAP[key]) {
    return PARAMETER_TYPE_MAP[key];
  }

  // 2. Heuristic fallbacks based on naming conventions
  // Detect UUID parameters in both snake_case and camelCase:
  // - snake_case: session_id, user_id, etc.
  // - camelCase: sessionId, userId, etc.
  // - exact match: id
  if (key.endsWith('_id') || key === 'id' || key.endsWith('Id')) {
    // Validate UUID format before attempting SQL binding
    if (typeof value !== 'string') {
      throw new Error(
        `Invalid UUID parameter '${key}': expected string, got ${typeof value}`
      );
    }

    if (!isValidUUID(value)) {
      throw new Error(
        `Invalid UUID format for parameter '${key}': ${value}`
      );
    }

    return sql.UniqueIdentifier;
  }

  if (key.includes('count') || key.includes('number') || key.includes('tokens')) {
    return sql.Int;
  }

  if (key.includes('_at') || key === 'timestamp') {
    return sql.DateTime2;
  }

  // 3. Type-based fallbacks
  if (typeof value === 'boolean') {
    return sql.Bit;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? sql.Int : sql.Float;
  }

  if (value instanceof Date) {
    return sql.DateTime2;
  }

  if (value instanceof Buffer) {
    return sql.VarBinary(sql.MAX);
  }

  // 4. Default to NVARCHAR for strings and unknowns
  return sql.NVarChar(sql.MAX);
}

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
      acquireTimeoutMillis: isE2E ? 60000 : 10000, // 60s for E2E, 10s for normal
    },
    connectionTimeout: isE2E ? 60000 : 30000, // 60s for E2E, 30s for normal
    requestTimeout: isE2E ? 60000 : 30000, // 60s for E2E, 30s for normal
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
    const existingPool = _getPoolInternal();
    if (existingPool && existingPool.connected) {
      console.log('✅ Database connection pool already initialized');
      return existingPool;
    }

    const config = getDatabaseConfig();

    const newPool = await connectWithRetry(config, 10);
    _setPoolInternal(newPool);

    console.log('✅ Connected to Azure SQL Database');

    newPool.on('error', async (err: Error) => {
      console.error('❌ Database connection error detected:');
      handleDatabaseError(err);

      _setPoolInternal(null);

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

    return newPool;
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
  return _getPoolInternal();
}

/**
 * Get database connection pool (throws if not initialized)
 * Alias for getDatabase() that throws instead of returning null
 *
 * @returns Connection pool
 * @throws Error if pool is not initialized
 */
export function getPool(): ConnectionPool {
  const pool = _getPoolInternal();
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
 * Execute an operation with retry logic for transient errors
 * 
 * @param operation - Function to execute
 * @param context - Description of the operation for logging
 * @param maxRetries - Maximum number of retries (default: 3)
 */
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries: number = 3
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if error is transient
      const err = error as { number?: number; code?: string | number; message?: string };
      const isTransient = 
        (err.number && TRANSIENT_ERROR_CODES.includes(err.number)) || 
        (err.code && typeof err.code === 'number' && TRANSIENT_ERROR_CODES.includes(err.code)) ||
        (err.message && (
          err.message.includes('ETIMEDOUT') || 
          err.message.includes('ECONNRESET') ||
          err.message.includes('socket hang up') ||
          err.message.includes('Transient')
        ));

      if (isTransient && attempt <= maxRetries) {
        const delay = Math.min(attempt * 200, 2000); // Exponential backoff capped at 2s
        console.warn(`⚠️ Transient error in ${context} (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms... Error: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

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
    // ⭐ Validate query in development/test (zero overhead in production)
    validateQuery(query, params);

    const db = getDatabase();

    if (!db || !db.connected) {
      throw new Error('Database not connected. Call initDatabase() first.');
    }

    const request = db.request();

    // Add parameters to the request with explicit type binding
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

        // ⭐ FIX TYPE 3: Infer SQL type and bind explicitly
        const sqlType = inferSqlType(key, value);

        // Bind parameter with explicit type
        request.input(key, sqlType, value);
      });
    }

    const result = await executeWithRetry(
      () => request.query<T>(query),
      'executeQuery'
    );
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

    // Add parameters to the request with explicit type binding
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

        // ⭐ FIX TYPE 3: Infer SQL type and bind explicitly
        const sqlType = inferSqlType(key, value);

        // Bind parameter with explicit type
        request.input(key, sqlType, value);
      });
    }

    const result = await executeWithRetry(
      () => request.execute<T>(procedureName),
      `executeProcedure(${procedureName})`
    );
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
    const pool = _getPoolInternal();
    if (pool) {
      await pool.close();
      _setPoolInternal(null);
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
