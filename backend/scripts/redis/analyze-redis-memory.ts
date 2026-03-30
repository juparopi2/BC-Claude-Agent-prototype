/**
 * Redis Memory Analysis Script
 *
 * Analyzes Redis memory usage by key patterns to identify memory consumers.
 */
import 'dotenv/config';
import IORedis from 'ioredis';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

/**
 * BullMQ default Redis key prefix is 'bull'.
 * The app's QUEUE_NAME_PREFIX is for queue NAME prefixing (e.g. 'local--file-extract'),
 * NOT for the Redis key prefix. Scripts must use 'bull' to match production queues.
 */
const BULLMQ_PREFIX = 'bull';

/**
 * Parse Azure Redis connection string format:
 * hostname:port,password=xxx,ssl=True,abortConnect=False
 */
function parseRedisConnectionString(connStr: string): {
  host: string; port: number; password: string; tls: boolean;
} {
  const parts = connStr.split(',');
  const [hostPort] = parts;
  const [host, portStr] = hostPort.split(':');
  const passwordPart = parts.find(p => p.startsWith('password='));
  const password = passwordPart ? passwordPart.split('=').slice(1).join('=') : '';
  const sslPart = parts.find(p => p.toLowerCase().startsWith('ssl='));
  const tls = sslPart ? sslPart.split('=')[1].toLowerCase() === 'true' : false;

  return { host, port: parseInt(portStr) || 6380, password, tls };
}

function buildRedisConfig(): { host: string; port: number; password?: string; tls?: Record<string, never> } {
  const connStr = process.env.REDIS_CONNECTION_STRING;
  if (connStr) {
    const parsed = parseRedisConnectionString(connStr);
    return {
      host: parsed.host,
      port: parsed.port,
      password: parsed.password || undefined,
      tls: parsed.tls ? {} : undefined,
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6380'),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_PORT === '6380' ? {} : undefined,
  };
}

async function analyze() {
  // Resolve remote environment if --env flag is set
  const targetEnv = getTargetEnv();
  if (targetEnv) {
    await resolveEnvironment(targetEnv, { redis: true });
  }

  const REDIS_CONFIG = buildRedisConfig();

  const client = new IORedis({
    ...REDIS_CONFIG,
    lazyConnect: true,
  });
  await client.connect();

  console.log('=== REDIS MEMORY ANALYSIS ===\n');
  console.log(`Redis: ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`);
  console.log(`BullMQ prefix: ${BULLMQ_PREFIX}`);
  if (targetEnv) console.log(`Environment: ${targetEnv}`);
  console.log('');

  // Get memory info
  const info = await client.info('memory');
  const usedMemMatch = info.match(/used_memory_human:(\S+)/);
  const maxMemMatch = info.match(/maxmemory_human:(\S+)/);
  console.log(`Memory Used: ${usedMemMatch?.[1] || 'N/A'}`);
  console.log(`Memory Max: ${maxMemMatch?.[1] || 'N/A'}`);

  // Get all keys
  const keys = await client.keys('*');
  console.log(`\nTotal keys: ${keys.length}`);

  // Group by prefix (first segment)
  const groups: Record<string, number> = {};
  for (const key of keys) {
    const prefix = key.split(':')[0];
    groups[prefix] = (groups[prefix] || 0) + 1;
  }

  console.log('\n=== KEYS BY PREFIX ===');
  for (const [prefix, count] of Object.entries(groups).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${prefix}: ${count}`);
  }

  // Check embedding keys
  const embeddingKeys = keys.filter(k => k.startsWith('embedding:'));
  console.log('\n=== EMBEDDING ANALYSIS ===');
  console.log(`Embedding keys: ${embeddingKeys.length}`);

  // Sample a few embedding keys for size
  if (embeddingKeys.length > 0) {
    let totalSize = 0;
    const sample = embeddingKeys.slice(0, 5);
    for (const key of sample) {
      const val = await client.get(key);
      const size = val ? val.length : 0;
      totalSize += size;
      console.log(`  ${key.substring(0, 50)}... size: ${Math.round(size/1024)}KB`);

      // Check if it has 'raw' field
      if (val) {
        try {
          const parsed = JSON.parse(val);
          console.log(`    fields: ${Object.keys(parsed).join(', ')}`);
          if (parsed.raw) {
            console.log(`    ⚠️  WARNING: Still has 'raw' field! This is the memory leak!`);
          }
        } catch (e) {
          console.log(`    (not JSON)`);
        }
      }
    }
    if (sample.length > 0) {
      const avgSize = Math.round(totalSize / sample.length / 1024);
      const estTotal = Math.round(totalSize / sample.length * embeddingKeys.length / 1024 / 1024);
      console.log(`  Avg size: ${avgSize}KB`);
      console.log(`  Est. total embedding mem: ${estTotal}MB`);
    }
  }

  // Check for large keys (sample first 100 keys)
  console.log('\n=== TOP 10 LARGEST KEYS (sampled) ===');
  const keySizes: { key: string; size: number }[] = [];
  for (const key of keys.slice(0, 100)) {
    try {
      const mem = await client.memoryUsage(key);
      if (mem) keySizes.push({ key, size: mem });
    } catch (e) {}
  }
  keySizes.sort((a, b) => b.size - a.size);
  for (const { key, size } of keySizes.slice(0, 10)) {
    console.log(`  ${key.substring(0, 55).padEnd(55)} ${Math.round(size/1024).toString().padStart(6)}KB`);
  }

  // Analyze bull:* keys
  const bullKeys = keys.filter(k => k.startsWith(`${BULLMQ_PREFIX}:`) || k.startsWith('local:'));
  console.log('\n=== BULLMQ KEYS ===');
  console.log(`Total BullMQ keys: ${bullKeys.length}`);

  // Group bull keys by queue
  const queueGroups: Record<string, number> = {};
  for (const key of bullKeys) {
    const parts = key.split(':');
    const queue = parts.slice(0, 2).join(':');
    queueGroups[queue] = (queueGroups[queue] || 0) + 1;
  }
  for (const [queue, count] of Object.entries(queueGroups).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${queue}: ${count}`);
  }

  // Estimate memory by category
  console.log('\n=== MEMORY ESTIMATION BY CATEGORY ===');

  // Sample embeddings
  let embeddingMem = 0;
  if (embeddingKeys.length > 0) {
    for (const key of embeddingKeys.slice(0, 10)) {
      const mem = await client.memoryUsage(key);
      embeddingMem += mem || 0;
    }
    embeddingMem = (embeddingMem / Math.min(10, embeddingKeys.length)) * embeddingKeys.length;
  }

  // Sample bull keys
  let bullMem = 0;
  if (bullKeys.length > 0) {
    for (const key of bullKeys.slice(0, 20)) {
      const mem = await client.memoryUsage(key);
      bullMem += mem || 0;
    }
    bullMem = (bullMem / Math.min(20, bullKeys.length)) * bullKeys.length;
  }

  console.log(`  Embeddings: ~${Math.round(embeddingMem / 1024 / 1024)}MB (${embeddingKeys.length} keys)`);
  console.log(`  BullMQ:     ~${Math.round(bullMem / 1024 / 1024)}MB (${bullKeys.length} keys)`);
  console.log(`  Other:      ~${Math.round((211 * 1024 * 1024 - embeddingMem - bullMem) / 1024 / 1024)}MB`);

  await client.quit();
}

analyze().catch(console.error);
