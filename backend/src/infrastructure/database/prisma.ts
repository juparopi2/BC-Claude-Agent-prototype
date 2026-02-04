import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

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

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Prisma client singleton.
 * Uses global caching to prevent multiple instances during hot-reload in development.
 * Configured with the MSSQL adapter for Prisma 7.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: createAdapter(),
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

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
