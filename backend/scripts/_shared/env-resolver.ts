/**
 * Shared remote environment resolver for backend scripts.
 *
 * Fetches secrets from Azure Key Vault and creates temporary SQL firewall
 * rules to allow local scripts to connect to dev/prod environments.
 *
 * Usage:
 *   import { resolveEnvironment, getTargetEnv } from './_shared/env-resolver';
 *
 *   const env = getTargetEnv();          // reads --env flag
 *   if (env) await resolveEnvironment(env);
 *   const prisma = createPrisma();       // now uses remote credentials
 */

import { execSync } from 'child_process';
import { getFlag } from './args';

// ─── ANSI Colors ──────────────────────────────────────────────────────────────
const RED   = '\x1b[31m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

// ─── Environment Config ───────────────────────────────────────────────────────
export const ENV_CONFIG = {
  dev: {
    keyVault:      'kv-bcagent-dev',
    sqlServer:     'sqlsrv-bcagent-dev',
    resourceGroup: 'rg-BCAgentPrototype-data-dev',
    sqlDb:         'sqldb-bcagent-dev',
  },
  prod: {
    keyVault:      'kv-myworkmate-prod',
    sqlServer:     'sqlsrv-myworkmate-prod',
    resourceGroup: 'rg-myworkmate-data-prod',
    sqlDb:         'sqldb-myworkmate-prod',
  },
} as const;

export type TargetEnv = keyof typeof ENV_CONFIG;

// ─── Firewall Cleanup State ───────────────────────────────────────────────────
let firewallRuleName: string | null = null;
let firewallResourceGroup: string | null = null;
let firewallSqlServer: string | null = null;
let cleanupRan = false;

function cleanupFirewallRule(): void {
  if (cleanupRan || !firewallRuleName) return;
  cleanupRan = true;
  try {
    execSync(
      `az sql server firewall-rule delete` +
      ` --resource-group "${firewallResourceGroup}"` +
      ` --server "${firewallSqlServer}"` +
      ` --name "${firewallRuleName}"`,
      { encoding: 'utf-8', timeout: 30_000, stdio: 'pipe' },
    );
    console.error(`${DIM}Firewall rule "${firewallRuleName}" deleted.${RESET}`);
  } catch {
    // Best-effort cleanup
  }
}

// Register cleanup handlers once on module load
process.on('exit', cleanupFirewallRule);
process.on('SIGINT', () => { cleanupFirewallRule(); process.exit(130); });
process.on('SIGTERM', () => { cleanupFirewallRule(); process.exit(143); });

// ─── Azure CLI Helpers ────────────────────────────────────────────────────────

function execAz(args: string): string {
  return execSync(`az ${args}`, { encoding: 'utf-8', timeout: 30_000 }).trim();
}

export function parseSqlConnectionString(connStr: string): {
  server: string;
  database: string;
  user: string;
  password: string;
} {
  const get = (key: string): string => {
    const match = connStr.match(new RegExp(`${key}=([^;]+)`, 'i'));
    return match?.[1]?.trim() ?? '';
  };
  return {
    server:   get('Server').replace('tcp:', '').replace(',1433', ''),
    database: get('Initial Catalog'),
    user:     get('User ID'),
    password: get('Password'),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read the --env flag from CLI args. Returns null if not present. */
export function getTargetEnv(): TargetEnv | null {
  const raw = getFlag('--env');
  if (!raw) return null;
  if (raw !== 'dev' && raw !== 'prod') {
    console.error(`${RED}Error: --env must be 'dev' or 'prod', got '${raw}'${RESET}`);
    process.exit(1);
  }
  return raw;
}

/**
 * Resolve a remote environment by fetching secrets from Azure Key Vault
 * and creating a temporary SQL firewall rule.
 *
 * After this call, process.env.DATABASE_*, STORAGE_*, AZURE_SEARCH_*
 * are set to the target environment's values. createPrisma() / createBlobContainerClient()
 * / createSearchClient() will pick them up automatically.
 *
 * @param targetEnv - 'dev' or 'prod'
 * @param options.redis - Also fetch Redis connection string (default: false)
 */
export async function resolveEnvironment(
  targetEnv: TargetEnv,
  options?: { redis?: boolean },
): Promise<void> {
  const cfg = ENV_CONFIG[targetEnv];
  console.error(`${DIM}Setting up environment: ${targetEnv}${RESET}`);

  // Verify az CLI login
  try {
    execAz('account show');
  } catch {
    console.error(`${RED}Error: Not logged in to Azure CLI. Run: az login${RESET}`);
    process.exit(1);
  }

  // Fetch secrets from Key Vault
  console.error(`${DIM}Fetching secrets from ${cfg.keyVault}...${RESET}`);

  const fetchSecret = (name: string): string => {
    try {
      return execAz(`keyvault secret show --vault-name "${cfg.keyVault}" --name "${name}" --query value -o tsv`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${RED}Failed to fetch secret "${name}" from Key Vault: ${msg}${RESET}`);
      process.exit(1);
    }
  };

  const sqlConnStr  = fetchSecret('SqlDb-ConnectionString');
  const storageConn = fetchSecret('Storage-ConnectionString');
  const searchEndpt = fetchSecret('AZURE-SEARCH-ENDPOINT');
  const searchKey   = fetchSecret('AZURE-SEARCH-KEY');

  // Parse SQL connection string and set env vars
  const { server, database, user, password } = parseSqlConnectionString(sqlConnStr);
  process.env.DATABASE_SERVER   = server;
  process.env.DATABASE_NAME     = database;
  process.env.DATABASE_USER     = user;
  process.env.DATABASE_PASSWORD = password;

  process.env.STORAGE_CONNECTION_STRING = storageConn;
  process.env.AZURE_SEARCH_ENDPOINT     = searchEndpt;
  process.env.AZURE_SEARCH_KEY          = searchKey;

  // Optionally fetch Redis
  if (options?.redis) {
    try {
      const redisConn = fetchSecret('Redis-ConnectionString');
      process.env.REDIS_CONNECTION_STRING = redisConn;
    } catch {
      console.error(`${DIM}Warning: Could not fetch Redis connection string (non-fatal)${RESET}`);
    }
  }

  // Add temp firewall rule for SQL
  let publicIp: string;
  try {
    const resp = await fetch('https://api.ipify.org');
    publicIp = (await resp.text()).trim();
  } catch {
    console.error(`${RED}Failed to get public IP for firewall rule.${RESET}`);
    process.exit(1);
  }

  const ruleName = `script-temp-${Date.now()}`;
  console.error(`${DIM}Creating SQL firewall rule for IP ${publicIp}...${RESET}`);

  try {
    execAz(
      `sql server firewall-rule create` +
      ` --resource-group "${cfg.resourceGroup}"` +
      ` --server "${cfg.sqlServer}"` +
      ` --name "${ruleName}"` +
      ` --start-ip-address "${publicIp}"` +
      ` --end-ip-address "${publicIp}"`,
    );
    firewallRuleName      = ruleName;
    firewallResourceGroup = cfg.resourceGroup;
    firewallSqlServer     = cfg.sqlServer;
    console.error(`${DIM}Firewall rule "${ruleName}" created.${RESET}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}Failed to create firewall rule: ${msg}${RESET}`);
    process.exit(1);
  }
}
