/**
 * Shared Prisma factory for backend scripts.
 *
 * Scripts run outside the main app (no path aliases, no Pino logger),
 * so this module creates a standalone PrismaClient with the MSSQL adapter.
 *
 * Usage:
 *   import { createPrisma } from './_shared/prisma';
 *   const prisma = createPrisma();
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

export function createPrisma(): PrismaClient {
  const server = process.env.DATABASE_SERVER;
  const database = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;

  if (!server || !database || !user || !password) {
    console.error('ERROR: Database env vars not set (DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD)');
    process.exit(1);
  }

  const adapter = new PrismaMssql({
    server,
    database,
    user,
    password,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  });

  return new PrismaClient({ adapter });
}
