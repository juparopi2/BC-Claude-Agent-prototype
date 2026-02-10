/**
 * Redis Diagnostics Script
 *
 * Comprehensive diagnostic tool for Azure Redis instance.
 * Also absorbs functionality from analyze-redis-memory.ts (use --memory-analysis).
 *
 * Helps identify issues related to:
 * - Connection limits (Azure Basic C0 = 256 connections)
 * - Memory pressure (Azure Basic C0 = 250MB)
 * - Lock-related BullMQ issues
 * - Key distribution and cleanup
 * - Embedding memory leaks (raw field detection)
 *
 * Usage:
 *   npx tsx scripts/diagnose-redis.ts
 *   npx tsx scripts/diagnose-redis.ts --memory-analysis
 *   npx tsx scripts/diagnose-redis.ts --connection-test
 */

import 'dotenv/config';
import IORedis from 'ioredis';

// ============================================================================
// Configuration
// ============================================================================

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_PORT === '6380' ? {} : undefined,
};

const QUEUE_PREFIX = process.env.QUEUE_NAME_PREFIX || 'bcagent';

// Azure Redis tier limits
const AZURE_REDIS_TIERS = {
  'Basic C0': { maxConnections: 256, maxMemoryMB: 250 },
  'Basic C1': { maxConnections: 256, maxMemoryMB: 1000 },
  'Standard C0': { maxConnections: 256, maxMemoryMB: 250 },
  'Standard C1': { maxConnections: 1000, maxMemoryMB: 1000 },
  'Standard C2': { maxConnections: 2000, maxMemoryMB: 2500 },
};

// ============================================================================
// Types
// ============================================================================

interface RedisMetrics {
  // Memory
  usedMemoryBytes: number;
  usedMemoryHuman: string;
  usedMemoryPeakHuman: string;
  maxMemoryBytes: number;
  maxMemoryPolicy: string;
  memoryFragmentationRatio: number;

  // Connections
  connectedClients: number;
  blockedClients: number;
  maxClients: number;
  totalConnectionsReceived: number;
  rejectedConnections: number;

  // Performance
  instantaneousOpsPerSec: number;
  instantaneousInputKbps: number;
  instantaneousOutputKbps: number;

  // Replication
  role: string;
  connectedSlaves: number;

  // Server
  redisVersion: string;
  uptimeInDays: number;
  tcpPort: number;

  // Keys
  totalKeys: number;
  expiringKeys: number;
  expiredKeys: number;
  evictedKeys: number;
}

interface KeyAnalysis {
  prefix: string;
  count: number;
  estimatedSizeBytes: number;
}

interface DiagnosticResult {
  status: 'healthy' | 'warning' | 'critical';
  metrics: RedisMetrics;
  keyAnalysis: KeyAnalysis[];
  recommendations: string[];
  tierEstimate: string;
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface Args {
  memoryAnalysis: boolean;
  connectionTest: boolean;
  cleanupStale: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Redis Diagnostics Script

Usage:
  npx tsx scripts/diagnose-redis.ts [options]

Options:
  --memory-analysis    Detailed memory breakdown by key pattern
  --connection-test    Test connection pooling behavior
  --cleanup-stale      Remove stale BullMQ locks (use with caution)

Examples:
  npx tsx scripts/diagnose-redis.ts
  npx tsx scripts/diagnose-redis.ts --memory-analysis
  npx tsx scripts/diagnose-redis.ts --connection-test
`);
    process.exit(0);
  }

  return {
    memoryAnalysis: args.includes('--memory-analysis'),
    connectionTest: args.includes('--connection-test'),
    cleanupStale: args.includes('--cleanup-stale'),
  };
}

// ============================================================================
// Redis Info Parsing
// ============================================================================

async function getRedisMetrics(connection: IORedis): Promise<RedisMetrics> {
  const info = await connection.info();
  const lines = info.split('\r\n');

  const getValue = (key: string): string => {
    const line = lines.find((l) => l.startsWith(`${key}:`));
    return line ? line.split(':')[1].trim() : '0';
  };

  const getNumber = (key: string): number => parseInt(getValue(key)) || 0;

  // Get dbsize for total keys
  const dbsize = await connection.dbsize();

  return {
    // Memory
    usedMemoryBytes: getNumber('used_memory'),
    usedMemoryHuman: getValue('used_memory_human'),
    usedMemoryPeakHuman: getValue('used_memory_peak_human'),
    maxMemoryBytes: getNumber('maxmemory'),
    maxMemoryPolicy: getValue('maxmemory_policy'),
    memoryFragmentationRatio: parseFloat(getValue('mem_fragmentation_ratio')) || 1,

    // Connections
    connectedClients: getNumber('connected_clients'),
    blockedClients: getNumber('blocked_clients'),
    maxClients: getNumber('maxclients'),
    totalConnectionsReceived: getNumber('total_connections_received'),
    rejectedConnections: getNumber('rejected_connections'),

    // Performance
    instantaneousOpsPerSec: getNumber('instantaneous_ops_per_sec'),
    instantaneousInputKbps: parseFloat(getValue('instantaneous_input_kbps')) || 0,
    instantaneousOutputKbps: parseFloat(getValue('instantaneous_output_kbps')) || 0,

    // Replication
    role: getValue('role'),
    connectedSlaves: getNumber('connected_slaves'),

    // Server
    redisVersion: getValue('redis_version'),
    uptimeInDays: getNumber('uptime_in_days'),
    tcpPort: getNumber('tcp_port'),

    // Keys
    totalKeys: dbsize,
    expiringKeys: getNumber('expires'),
    expiredKeys: getNumber('expired_keys'),
    evictedKeys: getNumber('evicted_keys'),
  };
}

// ============================================================================
// Key Analysis
// ============================================================================

async function analyzeKeys(connection: IORedis): Promise<KeyAnalysis[]> {
  const analysis: KeyAnalysis[] = [];
  const patterns = [
    `${QUEUE_PREFIX}:*:id`,
    `${QUEUE_PREFIX}:*:wait`,
    `${QUEUE_PREFIX}:*:active`,
    `${QUEUE_PREFIX}:*:completed`,
    `${QUEUE_PREFIX}:*:failed`,
    `${QUEUE_PREFIX}:*:delayed`,
    `${QUEUE_PREFIX}:*:stalled`,
    `${QUEUE_PREFIX}:*:meta`,
    `${QUEUE_PREFIX}:*:events`,
    `bull:*:lock:*`,
    `queue:ratelimit:*`,
  ];

  for (const pattern of patterns) {
    try {
      const keys = await connection.keys(pattern);
      if (keys.length > 0) {
        // Estimate size by sampling a few keys
        let totalSize = 0;
        const sampleSize = Math.min(10, keys.length);
        for (let i = 0; i < sampleSize; i++) {
          try {
            const size = await connection.memory('USAGE', keys[i]);
            totalSize += (size as number) || 0;
          } catch {
            // MEMORY USAGE might not be available
          }
        }
        const avgSize = totalSize / sampleSize;
        const estimatedSize = Math.floor(avgSize * keys.length);

        analysis.push({
          prefix: pattern,
          count: keys.length,
          estimatedSizeBytes: estimatedSize,
        });
      }
    } catch {
      // Pattern might not match any keys
    }
  }

  return analysis.sort((a, b) => b.count - a.count);
}

/**
 * Deep memory analysis (absorbed from analyze-redis-memory.ts).
 * Shows prefix-level grouping, embedding leak detection, and top largest keys.
 */
async function deepMemoryAnalysis(connection: IORedis): Promise<void> {
  console.log('\n=== DEEP MEMORY ANALYSIS ===\n');

  const keys = await connection.keys('*');
  console.log(`Total keys: ${keys.length}`);

  // Group by prefix (first segment)
  const groups: Record<string, number> = {};
  for (const key of keys) {
    const prefix = key.split(':')[0];
    groups[prefix] = (groups[prefix] || 0) + 1;
  }

  console.log('\n--- Keys by Prefix ---');
  for (const [prefix, count] of Object.entries(groups).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${prefix.padEnd(30)} ${count.toString().padStart(6)}`);
  }

  // Embedding leak detection
  const embeddingKeys = keys.filter(k => k.startsWith('embedding:'));
  if (embeddingKeys.length > 0) {
    console.log(`\n--- Embedding Analysis (${embeddingKeys.length} keys) ---`);
    let totalSize = 0;
    let hasRawField = 0;
    const sampleSize = Math.min(5, embeddingKeys.length);

    for (const key of embeddingKeys.slice(0, sampleSize)) {
      const val = await connection.get(key);
      const size = val ? val.length : 0;
      totalSize += size;
      console.log(`  ${key.substring(0, 55)}... ${Math.round(size / 1024)}KB`);

      if (val) {
        try {
          const parsed = JSON.parse(val);
          console.log(`    fields: ${Object.keys(parsed).join(', ')}`);
          if (parsed.raw) {
            hasRawField++;
            console.log('    WARNING: Has "raw" field (memory leak!)');
          }
        } catch {
          console.log('    (not JSON)');
        }
      }
    }

    if (sampleSize > 0) {
      const avgSize = Math.round(totalSize / sampleSize / 1024);
      const estTotal = Math.round(totalSize / sampleSize * embeddingKeys.length / 1024 / 1024);
      console.log(`\n  Avg size: ${avgSize}KB`);
      console.log(`  Est. total embedding mem: ${estTotal}MB`);
      if (hasRawField > 0) {
        console.log(`  WARNING: ${hasRawField}/${sampleSize} sampled keys have "raw" field leak`);
      }
    }
  }

  // Top largest keys (sample first 100)
  console.log('\n--- Top 10 Largest Keys (sampled) ---');
  const keySizes: { key: string; size: number }[] = [];
  for (const key of keys.slice(0, 100)) {
    try {
      const mem = await connection.memory('USAGE', key);
      if (typeof mem === 'number') keySizes.push({ key, size: mem });
    } catch {
      // MEMORY USAGE not always available
    }
  }
  keySizes.sort((a, b) => b.size - a.size);
  for (const { key, size } of keySizes.slice(0, 10)) {
    console.log(`  ${key.substring(0, 55).padEnd(55)} ${Math.round(size / 1024).toString().padStart(6)}KB`);
  }
}

// ============================================================================
// BullMQ Lock Analysis
// ============================================================================

async function analyzeBullMQLocks(connection: IORedis): Promise<{
  activeLocks: number;
  staleLocks: string[];
}> {
  const lockPattern = `${QUEUE_PREFIX}:*:lock:*`;
  const lockKeys = await connection.keys(lockPattern);

  const staleLocks: string[] = [];
  const now = Date.now();
  const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

  for (const key of lockKeys) {
    try {
      const ttl = await connection.pttl(key);
      // If lock has no TTL or very long TTL, it might be stale
      if (ttl === -1 || ttl > STALE_THRESHOLD_MS) {
        staleLocks.push(key);
      }
    } catch {
      // Ignore errors
    }
  }

  return {
    activeLocks: lockKeys.length,
    staleLocks,
  };
}

// ============================================================================
// Connection Test
// ============================================================================

async function testConnectionPooling(): Promise<void> {
  console.log('\n=== CONNECTION POOLING TEST ===\n');

  const connections: IORedis[] = [];
  const MAX_TEST_CONNECTIONS = 20;

  console.log(`Testing up to ${MAX_TEST_CONNECTIONS} concurrent connections...`);

  try {
    for (let i = 0; i < MAX_TEST_CONNECTIONS; i++) {
      const conn = new IORedis({
        ...REDIS_CONFIG,
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });

      await conn.connect();
      connections.push(conn);

      if ((i + 1) % 5 === 0) {
        console.log(`  ${i + 1} connections established`);
      }
    }

    console.log(`\n✅ Successfully established ${connections.length} connections`);

    // Test concurrent operations
    console.log('\nTesting concurrent operations...');
    const start = Date.now();
    const operations = connections.map((conn, i) =>
      conn.set(`test:connection:${i}`, 'value', 'EX', 10)
    );
    await Promise.all(operations);
    const duration = Date.now() - start;
    console.log(`  ${MAX_TEST_CONNECTIONS} SET operations completed in ${duration}ms`);

    // Cleanup test keys
    for (let i = 0; i < MAX_TEST_CONNECTIONS; i++) {
      await connections[0].del(`test:connection:${i}`);
    }

  } catch (error) {
    console.log(`\n❌ Connection test failed at ${connections.length} connections`);
    console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    for (const conn of connections) {
      await conn.quit().catch(() => {});
    }
  }
}

// ============================================================================
// Stale Lock Cleanup
// ============================================================================

async function cleanupStaleLocks(connection: IORedis, staleLocks: string[]): Promise<number> {
  if (staleLocks.length === 0) return 0;

  console.log(`\nCleaning up ${staleLocks.length} stale locks...`);

  let cleaned = 0;
  for (const key of staleLocks) {
    try {
      await connection.del(key);
      cleaned++;
    } catch {
      // Ignore errors
    }
  }

  return cleaned;
}

// ============================================================================
// Diagnosis
// ============================================================================

function diagnose(metrics: RedisMetrics, keyAnalysis: KeyAnalysis[]): DiagnosticResult {
  const recommendations: string[] = [];
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';

  // Estimate tier based on maxClients
  let tierEstimate = 'Unknown';
  for (const [tier, limits] of Object.entries(AZURE_REDIS_TIERS)) {
    if (metrics.maxClients === limits.maxConnections) {
      tierEstimate = tier;
      break;
    }
  }

  // Connection analysis
  const connectionUsagePercent = (metrics.connectedClients / metrics.maxClients) * 100;
  if (connectionUsagePercent > 80) {
    status = 'critical';
    recommendations.push(
      `🔴 Connection usage at ${connectionUsagePercent.toFixed(1)}% (${metrics.connectedClients}/${metrics.maxClients}). ` +
      `Consider upgrading to a higher tier for more connections.`
    );
  } else if (connectionUsagePercent > 50) {
    status = status === 'healthy' ? 'warning' : status;
    recommendations.push(
      `🟡 Connection usage at ${connectionUsagePercent.toFixed(1)}%. Monitor for spikes during bulk operations.`
    );
  }

  if (metrics.rejectedConnections > 0) {
    status = 'critical';
    recommendations.push(
      `🔴 ${metrics.rejectedConnections} connections have been rejected. Redis is hitting connection limits.`
    );
  }

  // Memory analysis
  const maxMemoryMB = metrics.maxMemoryBytes / 1024 / 1024;
  const usedMemoryMB = metrics.usedMemoryBytes / 1024 / 1024;
  const memoryUsagePercent = maxMemoryMB > 0 ? (usedMemoryMB / maxMemoryMB) * 100 : 0;

  if (memoryUsagePercent > 80) {
    status = 'critical';
    recommendations.push(
      `🔴 Memory usage at ${memoryUsagePercent.toFixed(1)}% (${metrics.usedMemoryHuman}). ` +
      `BullMQ job retention settings may need to be more aggressive.`
    );
  } else if (memoryUsagePercent > 60) {
    status = status === 'healthy' ? 'warning' : status;
    recommendations.push(
      `🟡 Memory usage at ${memoryUsagePercent.toFixed(1)}%. Consider reducing job retention.`
    );
  }

  if (metrics.evictedKeys > 0) {
    status = 'critical';
    recommendations.push(
      `🔴 ${metrics.evictedKeys} keys have been evicted due to memory pressure. This can cause BullMQ lock issues.`
    );
  }

  // Fragmentation
  if (metrics.memoryFragmentationRatio > 1.5) {
    status = status === 'healthy' ? 'warning' : status;
    recommendations.push(
      `🟡 Memory fragmentation ratio is ${metrics.memoryFragmentationRatio.toFixed(2)}. ` +
      `Consider restarting Redis during low-traffic periods.`
    );
  }

  // Key analysis recommendations
  const totalQueueKeys = keyAnalysis.reduce((sum, k) => sum + k.count, 0);
  if (totalQueueKeys > 10000) {
    status = status === 'healthy' ? 'warning' : status;
    recommendations.push(
      `🟡 ${totalQueueKeys} BullMQ keys in Redis. Consider more aggressive cleanup of completed/failed jobs.`
    );
  }

  // Tier-specific recommendations
  if (tierEstimate.includes('Basic')) {
    recommendations.push(
      `💡 Running on ${tierEstimate} tier (no SLA, max ${metrics.maxClients} connections). ` +
      `For production workloads with bulk uploads, consider upgrading to Standard C1 (1000 connections, 99.9% SLA).`
    );
  }

  // BullMQ-specific recommendations
  if (metrics.blockedClients > 5) {
    status = status === 'healthy' ? 'warning' : status;
    recommendations.push(
      `🟡 ${metrics.blockedClients} clients are blocked (waiting on BRPOP/BLPOP). ` +
      `This is normal for BullMQ workers but high numbers may indicate bottlenecks.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('✅ Redis appears healthy for current workload.');
  }

  return {
    status,
    metrics,
    keyAnalysis,
    recommendations,
    tierEstimate,
  };
}

// ============================================================================
// Output
// ============================================================================

function printDiagnostics(result: DiagnosticResult, lockInfo: { activeLocks: number; staleLocks: string[] }): void {
  const { metrics, keyAnalysis, recommendations, tierEstimate, status } = result;

  console.log('\n' + '='.repeat(80));
  console.log('REDIS DIAGNOSTICS REPORT');
  console.log('='.repeat(80));

  const statusIcon = status === 'healthy' ? '✅' : status === 'warning' ? '⚠️' : '🔴';
  console.log(`\nOverall Status: ${statusIcon} ${status.toUpperCase()}`);
  console.log(`Estimated Tier: ${tierEstimate}`);

  console.log('\n--- Server Info ---');
  console.log(`Version:              ${metrics.redisVersion}`);
  console.log(`Role:                 ${metrics.role}`);
  console.log(`Uptime:               ${metrics.uptimeInDays} days`);
  console.log(`Port:                 ${metrics.tcpPort}`);

  console.log('\n--- Memory ---');
  console.log(`Used:                 ${metrics.usedMemoryHuman}`);
  console.log(`Peak:                 ${metrics.usedMemoryPeakHuman}`);
  console.log(`Max:                  ${metrics.maxMemoryBytes > 0 ? `${(metrics.maxMemoryBytes / 1024 / 1024).toFixed(0)}MB` : 'No limit'}`);
  console.log(`Policy:               ${metrics.maxMemoryPolicy}`);
  console.log(`Fragmentation:        ${metrics.memoryFragmentationRatio.toFixed(2)}`);
  console.log(`Evicted Keys:         ${metrics.evictedKeys}`);

  console.log('\n--- Connections ---');
  console.log(`Connected:            ${metrics.connectedClients}`);
  console.log(`Max Clients:          ${metrics.maxClients}`);
  console.log(`Blocked:              ${metrics.blockedClients}`);
  console.log(`Rejected:             ${metrics.rejectedConnections}`);
  console.log(`Total Received:       ${metrics.totalConnectionsReceived}`);

  console.log('\n--- Performance ---');
  console.log(`Ops/sec:              ${metrics.instantaneousOpsPerSec}`);
  console.log(`Input KB/s:           ${metrics.instantaneousInputKbps.toFixed(2)}`);
  console.log(`Output KB/s:          ${metrics.instantaneousOutputKbps.toFixed(2)}`);

  console.log('\n--- Keys ---');
  console.log(`Total Keys:           ${metrics.totalKeys}`);
  console.log(`Expiring Keys:        ${metrics.expiringKeys}`);
  console.log(`Expired Keys:         ${metrics.expiredKeys}`);

  console.log('\n--- BullMQ Locks ---');
  console.log(`Active Locks:         ${lockInfo.activeLocks}`);
  console.log(`Potentially Stale:    ${lockInfo.staleLocks.length}`);

  if (keyAnalysis.length > 0) {
    console.log('\n--- Key Distribution ---');
    for (const item of keyAnalysis.slice(0, 15)) {
      const size = item.estimatedSizeBytes > 0
        ? ` (~${(item.estimatedSizeBytes / 1024).toFixed(1)}KB)`
        : '';
      console.log(`  ${item.prefix.padEnd(40)} ${item.count.toString().padStart(6)} keys${size}`);
    }
  }

  console.log('\n--- Recommendations ---');
  for (const rec of recommendations) {
    console.log(`  ${rec}`);
  }

  console.log('\n' + '='.repeat(80));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();

  console.log('=== REDIS DIAGNOSTICS ===\n');
  console.log(`Host: ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`);
  console.log(`TLS: ${REDIS_CONFIG.tls ? 'enabled' : 'disabled'}`);
  console.log(`Queue prefix: ${QUEUE_PREFIX}`);

  const connection = new IORedis({
    ...REDIS_CONFIG,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  try {
    await connection.connect();
    console.log('Connected to Redis\n');

    // Get metrics
    console.log('Gathering metrics...');
    const metrics = await getRedisMetrics(connection);

    // Analyze keys
    console.log('Analyzing keys...');
    const keyAnalysis = args.memoryAnalysis
      ? await analyzeKeys(connection)
      : [];

    // Analyze locks
    console.log('Analyzing BullMQ locks...');
    const lockInfo = await analyzeBullMQLocks(connection);

    // Run diagnostics
    const result = diagnose(metrics, keyAnalysis);

    // Print results
    printDiagnostics(result, lockInfo);

    // Deep memory analysis if requested (absorbed from analyze-redis-memory.ts)
    if (args.memoryAnalysis) {
      await deepMemoryAnalysis(connection);
    }

    // Cleanup stale locks if requested
    if (args.cleanupStale && lockInfo.staleLocks.length > 0) {
      const cleaned = await cleanupStaleLocks(connection, lockInfo.staleLocks);
      console.log(`\n✅ Cleaned up ${cleaned} stale locks`);
    }

    // Connection test if requested
    if (args.connectionTest) {
      await testConnectionPooling();
    }

    // Exit with appropriate code
    process.exit(result.status === 'critical' ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Failed to connect to Redis:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await connection.quit();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
