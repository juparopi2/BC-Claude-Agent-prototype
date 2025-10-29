/**
 * Azure Key Vault Configuration
 *
 * Loads secrets from Azure Key Vault in production.
 * Uses Managed Identity for authentication when deployed to Azure.
 *
 * @module config/keyvault
 */

import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import { env, isProd, isDev } from './environment';

/**
 * Key Vault secret names
 * These map to the secrets stored in Azure Key Vault
 */
export const SECRET_NAMES = {
  BC_TENANT_ID: 'BC-TenantId',
  BC_CLIENT_ID: 'BC-ClientId',
  BC_CLIENT_SECRET: 'BC-ClientSecret',
  CLAUDE_API_KEY: 'Claude-ApiKey',
  JWT_SECRET: 'JWT-Secret',
  SQLDB_CONNECTION_STRING: 'SqlDb-ConnectionString',
  REDIS_CONNECTION_STRING: 'Redis-ConnectionString',
  STORAGE_CONNECTION_STRING: 'Storage-ConnectionString',
} as const;

/**
 * Secret cache to avoid multiple Key Vault calls
 */
const secretCache = new Map<string, string>();

/**
 * Initialize Azure Key Vault client
 *
 * @returns SecretClient instance or null if Key Vault is not configured
 */
function initializeKeyVaultClient(): SecretClient | null {
  try {
    const keyVaultName = env.AZURE_KEY_VAULT_NAME;

    if (!keyVaultName) {
      if (isDev) {
        console.log('ℹ️  Azure Key Vault not configured, using local environment variables');
        return null;
      }
      throw new Error('AZURE_KEY_VAULT_NAME is required in production');
    }

    const vaultUrl = `https://${keyVaultName}.vault.azure.net`;

    // In production (Azure Container Apps), use Managed Identity
    // In development, use Service Principal credentials
    let credential;

    if (isProd) {
      console.log('🔐 Authenticating to Key Vault using Managed Identity...');
      credential = new DefaultAzureCredential();
    } else if (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET) {
      console.log('🔐 Authenticating to Key Vault using Service Principal...');
      credential = new ClientSecretCredential(
        env.AZURE_TENANT_ID,
        env.AZURE_CLIENT_ID,
        env.AZURE_CLIENT_SECRET
      );
    } else {
      console.log('ℹ️  Key Vault credentials not configured, using local environment variables');
      return null;
    }

    const client = new SecretClient(vaultUrl, credential);
    console.log(`✅ Key Vault client initialized: ${vaultUrl}`);

    return client;
  } catch (error) {
    console.error('❌ Failed to initialize Key Vault client:', error);
    if (isProd) {
      throw error;
    }
    return null;
  }
}

/**
 * Get a secret from Azure Key Vault or environment variable
 *
 * @param secretName - Name of the secret in Key Vault
 * @param envVarName - Fallback environment variable name
 * @returns Secret value or undefined
 */
export async function getSecret(secretName: string, envVarName?: string): Promise<string | undefined> {
  // Check cache first
  if (secretCache.has(secretName)) {
    return secretCache.get(secretName);
  }

  // Try environment variable first (for local development)
  if (envVarName && process.env[envVarName]) {
    const value = process.env[envVarName];
    secretCache.set(secretName, value!);
    return value;
  }

  // Try Key Vault
  const client = initializeKeyVaultClient();

  if (!client) {
    // Key Vault not configured, return undefined
    return undefined;
  }

  try {
    console.log(`🔍 Fetching secret from Key Vault: ${secretName}`);
    const secret = await client.getSecret(secretName);

    if (secret.value) {
      secretCache.set(secretName, secret.value);
      console.log(`✅ Secret loaded: ${secretName}`);
      return secret.value;
    }

    console.warn(`⚠️  Secret not found in Key Vault: ${secretName}`);
    return undefined;
  } catch (error) {
    console.error(`❌ Failed to fetch secret from Key Vault: ${secretName}`, error);
    if (isProd) {
      throw error;
    }
    return undefined;
  }
}

/**
 * Load all required secrets from Key Vault
 * This should be called at application startup
 */
export async function loadSecretsFromKeyVault(): Promise<void> {
  console.log('🔐 Loading secrets from Azure Key Vault...');

  try {
    // Load BC credentials
    const bcTenantId = await getSecret(SECRET_NAMES.BC_TENANT_ID, 'BC_TENANT_ID');
    if (bcTenantId) process.env.BC_TENANT_ID = bcTenantId;

    const bcClientId = await getSecret(SECRET_NAMES.BC_CLIENT_ID, 'BC_CLIENT_ID');
    if (bcClientId) process.env.BC_CLIENT_ID = bcClientId;

    const bcClientSecret = await getSecret(SECRET_NAMES.BC_CLIENT_SECRET, 'BC_CLIENT_SECRET');
    if (bcClientSecret) process.env.BC_CLIENT_SECRET = bcClientSecret;

    // Load Claude API key
    const claudeApiKey = await getSecret(SECRET_NAMES.CLAUDE_API_KEY, 'ANTHROPIC_API_KEY');
    if (claudeApiKey) process.env.ANTHROPIC_API_KEY = claudeApiKey;

    // Load JWT secret
    const jwtSecret = await getSecret(SECRET_NAMES.JWT_SECRET, 'JWT_SECRET');
    if (jwtSecret) process.env.JWT_SECRET = jwtSecret;

    // Load connection strings
    const sqlConnectionString = await getSecret(SECRET_NAMES.SQLDB_CONNECTION_STRING, 'DATABASE_CONNECTION_STRING');
    if (sqlConnectionString) process.env.DATABASE_CONNECTION_STRING = sqlConnectionString;

    const redisConnectionString = await getSecret(SECRET_NAMES.REDIS_CONNECTION_STRING, 'REDIS_CONNECTION_STRING');
    if (redisConnectionString) process.env.REDIS_CONNECTION_STRING = redisConnectionString;

    const storageConnectionString = await getSecret(SECRET_NAMES.STORAGE_CONNECTION_STRING, 'STORAGE_CONNECTION_STRING');
    if (storageConnectionString) process.env.STORAGE_CONNECTION_STRING = storageConnectionString;

    console.log('✅ Secrets loaded successfully from Key Vault');
  } catch (error) {
    console.error('❌ Failed to load secrets from Key Vault:', error);
    if (isProd) {
      throw new Error('Failed to load secrets from Key Vault in production');
    }
    console.warn('⚠️  Continuing with local environment variables...');
  }
}

/**
 * Clear the secret cache
 * Useful for testing or when secrets need to be refreshed
 */
export function clearSecretCache(): void {
  secretCache.clear();
  console.log('🗑️  Secret cache cleared');
}
