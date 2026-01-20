/**
 * Redis infrastructure
 * @module infrastructure/redis
 */

// ioredis (for BullMQ and general Redis operations)
export {
  createRedisClient,
  getRedis,
  getRedisForBullMQ,
  getEagerRedis,
  closeRedis,
  initRedis,
  checkRedisHealth,
  getDefaultProfile,
  getRedisConfig,
  type RedisProfile,
} from './redis';

// redis package (for connect-redis session storage)
export {
  createRedisClient as createRedisPackageClient,
  getRedisClient as getRedisPackageClient,
  closeRedisClient as closeRedisPackageClient,
  initRedisClient as initRedisPackageClient,
  checkRedisClientHealth as checkRedisPackageClientHealth,
  type RedisClientProfile,
} from './redis-client';

// Distributed lock for horizontal scaling
export * from './DistributedLock';
