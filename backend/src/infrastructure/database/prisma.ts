import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import { createChildLogger } from '@/shared/utils/logger';

const prismaLogger = createChildLogger({ service: 'Prisma' });

/**
 * Build SQL Server configuration from environment variables.
 * Uses existing DATABASE_* variables for backward compatibility.
 */
function getSqlConfig() {
  const server = process.env.DATABASE_SERVER;
  const database = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;

  if (!server || !database || !user || !password) {
    throw new Error(
      'Database configuration missing. Set DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD environment variables.'
    );
  }

  return {
    server,
    database,
    user,
    password,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options: {
      encrypt: true, // Required for Azure SQL
      trustServerCertificate: false, // Set to true for local dev with self-signed certs
    },
  };
}

/**
 * Create the MSSQL adapter for Prisma 7.
 */
function createAdapter(): PrismaMssql {
  const sqlConfig = getSqlConfig();
  return new PrismaMssql(sqlConfig);
}

/**
 * Create a new PrismaClient with event-based logging routed through Pino.
 * All Prisma log levels emit events instead of printing to stdout,
 * and are forwarded to the Pino child logger so LOG_LEVEL and LOG_SERVICES apply.
 */
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    adapter: createAdapter(),
    log: [
      { level: 'query', emit: 'event' },
      { level: 'info', emit: 'event' },
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });

  // Route Prisma events through Pino logger
  client.$on('query', (e) => {
    prismaLogger.debug({ duration: e.duration, query: e.query, params: e.params }, 'Query executed');
  });

  client.$on('info', (e) => {
    prismaLogger.info(e.message);
  });

  client.$on('warn', (e) => {
    prismaLogger.warn(e.message);
  });

  client.$on('error', (e) => {
    prismaLogger.error(e.message);
  });

  return client;
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Prisma client singleton.
 * Uses global caching to prevent multiple instances during hot-reload in development.
 * Configured with the MSSQL adapter for Prisma 7.
 * Logging is routed through Pino, respecting LOG_LEVEL and LOG_SERVICES.
 */
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Gracefully disconnect from the database.
 * Call this during application shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
