/**
 * Environment Configuration
 *
 * Loads and validates environment variables.
 * In production, secrets are loaded from Azure Key Vault.
 *
 * @module config/environment
 */

import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file
dotenv.config();

/**
 * Environment variables schema for validation
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001').transform(Number).pipe(z.number().min(1000).max(65535)),

  // Azure Key Vault (optional for local development)
  AZURE_KEY_VAULT_NAME: z.string().optional(),
  AZURE_TENANT_ID: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  AZURE_CLIENT_SECRET: z.string().optional(),

  // Database
  DATABASE_SERVER: z.string().optional(),
  DATABASE_NAME: z.string().optional(),
  DATABASE_USER: z.string().optional(),
  DATABASE_PASSWORD: z.string().optional(),
  DATABASE_CONNECTION_STRING: z.string().optional(),

  // Redis
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().transform(Number).pipe(z.number()).optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_CONNECTION_STRING: z.string().optional(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-20241022'),

  // Business Central
  BC_API_URL: z.string().url().default('https://api.businesscentral.dynamics.com/v2.0'),
  BC_TENANT_ID: z.string().optional(),
  BC_CLIENT_ID: z.string().optional(),
  BC_CLIENT_SECRET: z.string().optional(),
  BC_ENVIRONMENT: z.string().default('production'),

  // MCP Server
  MCP_SERVER_URL: z.string().url().default('https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp'),

  // JWT
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Session
  SESSION_TIMEOUT_MINUTES: z.string().default('30').transform(Number).pipe(z.number()),

  // Agent
  MAX_CONTEXT_TOKENS: z.string().default('100000').transform(Number).pipe(z.number()),
  ENABLE_PROMPT_CACHING: z.string().default('true').transform((v) => v === 'true'),
  ENABLE_EXTENDED_THINKING: z.string().default('true').transform((v) => v === 'true'),

  // Storage
  STORAGE_CONNECTION_STRING: z.string().optional(),
  STORAGE_CONTAINER_NAME: z.string().default('agent-files'),
});

/**
 * Parse and validate environment variables
 */
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

/**
 * Typed environment configuration
 */
export const env = parsedEnv.data;

/**
 * Check if running in production
 */
export const isProd = env.NODE_ENV === 'production';

/**
 * Check if running in development
 */
export const isDev = env.NODE_ENV === 'development';

/**
 * Check if running in test
 */
export const isTest = env.NODE_ENV === 'test';

/**
 * Validate that required secrets are present
 * This should be called after Key Vault secrets are loaded in production
 */
export function validateRequiredSecrets(): void {
  const requiredSecrets = [
    'ANTHROPIC_API_KEY',
    'JWT_SECRET',
    'BC_TENANT_ID',
    'BC_CLIENT_ID',
    'BC_CLIENT_SECRET',
  ];

  const missing = requiredSecrets.filter((key) => !process.env[key]);

  if (missing.length > 0 && isProd) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }

  if (missing.length > 0 && isDev) {
    console.warn(`⚠️  Warning: Missing secrets in development: ${missing.join(', ')}`);
  }
}

/**
 * Print configuration summary (without sensitive data)
 */
export function printConfig(): void {
  console.log('📋 Configuration:');
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   Port: ${env.PORT}`);
  console.log(`   MCP Server: ${env.MCP_SERVER_URL}`);
  console.log(`   BC API: ${env.BC_API_URL}`);
  console.log(`   CORS Origin: ${env.CORS_ORIGIN}`);
  console.log(`   Log Level: ${env.LOG_LEVEL}`);
  console.log(`   Prompt Caching: ${env.ENABLE_PROMPT_CACHING ? 'enabled' : 'disabled'}`);
  console.log(`   Extended Thinking: ${env.ENABLE_EXTENDED_THINKING ? 'enabled' : 'disabled'}`);
}
