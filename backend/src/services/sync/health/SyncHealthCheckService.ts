/**
 * SyncHealthCheckService (PRD-300)
 *
 * Periodic health monitor for sync scopes. Runs every 15 minutes via
 * MaintenanceWorker and provides per-user health reports via the
 * GET /api/sync/health endpoint.
 *
 * Responsibilities:
 *   - Inspect all non-deleted connection scopes for known failure modes
 *   - Delegate recovery to SyncRecoveryService (stuck + error scopes)
 *   - Apply Redis exponential backoff for error-state scope retries
 *   - Emit per-user `sync:health_report` WebSocket events
 *
 * @module services/sync/health
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { getRedisClient } from '@/infrastructure/redis/redis-client';
import { getSyncRecoveryService } from './SyncRecoveryService';
import { getSocketIO, isSocketServiceInitialized } from '@/services/websocket/SocketService';
import { SYNC_WS_EVENTS } from '@bc-agent/shared';
import type {
  SyncHealthCheckMetrics,
  SyncHealthReport,
  ScopeHealthReport,
  ConnectionHealthReport,
  ScopeIssue,
  ScopeFileStats,
  SyncHealthStatus,
} from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_STUCK_THRESHOLD_MS = 600_000; // 10 minutes
const DEFAULT_STUCK_QUEUED_THRESHOLD_MS = 3_600_000; // 1 hour
const STALE_SYNC_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
const HIGH_FAILURE_RATE_THRESHOLD = 0.5; // 50%
/** Files stuck in intermediate pipeline states for > 30 min are counted as degraded */
const STUCK_PIPELINE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const STUCK_PIPELINE_STATUSES = ['queued', 'extracting', 'chunking', 'embedding'] as const;
const MAX_BACKOFF_ATTEMPTS = 5;
/** Delay in ms before each retry attempt (index = attemptCount - 1) */
const BACKOFF_SCHEDULE_MS = [
  0,               // attempt 1: immediate
  15 * 60_000,     // attempt 2: 15 min
  30 * 60_000,     // attempt 3: 30 min
  60 * 60_000,     // attempt 4: 1 hour
  2 * 60 * 60_000, // attempt 5: 2 hours
];
const BACKOFF_TTL_SECONDS = 86400; // 24 hours

// ──────────────────────────────────────────────────────────────────────────────
// Prisma query result type
// ──────────────────────────────────────────────────────────────────────────────

type ScopeWithConnection = {
  id: string;
  sync_status: string;
  last_sync_at: Date | null;
  scope_display_name: string | null;
  updated_at: Date;
  connections: {
    id: string;
    user_id: string;
    status: string;
    provider: string;
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

export class SyncHealthCheckService {
  private readonly logger = createChildLogger({ service: 'SyncHealthCheckService' });
  private readonly stuckThresholdMs: number;

  constructor(options?: { stuckThresholdMs?: number }) {
    this.stuckThresholdMs =
      options?.stuckThresholdMs ??
      (parseInt(process.env.SYNC_HEALTH_STUCK_THRESHOLD_MS ?? '', 10) ||
        DEFAULT_STUCK_THRESHOLD_MS);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public: run() — called by MaintenanceWorker every 15 minutes
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute a full health check across all non-deleted connection scopes.
   *
   * Detects stuck and error-state scopes, applies exponential backoff for
   * retries, delegates recovery to SyncRecoveryService, and emits
   * per-user health reports over WebSocket.
   */
  async run(): Promise<SyncHealthCheckMetrics> {
    const startTime = Date.now();

    this.logger.info('SyncHealthCheckService.run: starting');

    const metrics: SyncHealthCheckMetrics = {
      scopesChecked: 0,
      stuckSyncingDetected: 0,
      stuckSyncingReset: 0,
      stuckSyncQueuedDetected: 0,
      stuckSyncQueuedReset: 0,
      errorScopesDetected: 0,
      errorScopesRetried: 0,
      errorScopesSkippedExpiredConnection: 0,
      errorScopesBackoffDeferred: 0,
      durationMs: 0,
    };

    // connection_scopes has no deleted_at — query all non-error-deleted scopes
    const scopes = await prisma.connection_scopes.findMany({
      where: { sync_status: { not: undefined } }, // fetch all
      include: {
        connections: { select: { id: true, user_id: true, status: true, provider: true } },
      },
    });

    metrics.scopesChecked = scopes.length;

    const stuckScopeIds: string[] = [];
    const stuckQueuedScopeIds: string[] = [];
    const retryScopeIds: string[] = [];
    // Map from userId -> ScopeHealthReport[] for WS emission
    const scopesByUser = new Map<string, ScopeHealthReport[]>();

    for (const scope of scopes as ScopeWithConnection[]) {
      try {
        const report = await this.inspectScope(scope);
        const userId = scope.connections.user_id.toUpperCase();

        // Accumulate per-user reports
        const existing = scopesByUser.get(userId);
        if (existing) {
          existing.push(report);
        } else {
          scopesByUser.set(userId, [report]);
        }

        const issueTypes = report.issues.map((i) => i.type);

        if (issueTypes.includes('stuck_syncing')) {
          metrics.stuckSyncingDetected++;
          stuckScopeIds.push(scope.id.toUpperCase());
        }

        if (issueTypes.includes('stuck_sync_queued')) {
          metrics.stuckSyncQueuedDetected++;
          stuckQueuedScopeIds.push(scope.id.toUpperCase());
        }

        if (issueTypes.includes('error_state')) {
          metrics.errorScopesDetected++;

          if (scope.connections.status !== 'connected') {
            metrics.errorScopesSkippedExpiredConnection++;
          } else {
            const allowed = await this.shouldRetryErrorScope(scope.id);
            if (allowed) {
              retryScopeIds.push(scope.id.toUpperCase());
            } else {
              metrics.errorScopesBackoffDeferred++;
            }
          }
        }
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, stack: err.stack, name: err.name, cause: err.cause }
            : { value: String(err) };
        this.logger.error(
          { scopeId: scope.id, error: errorInfo },
          'SyncHealthCheckService.run: error inspecting scope',
        );
      }
    }

    // Delegate recovery
    if (stuckScopeIds.length > 0) {
      const resetResult = await getSyncRecoveryService().resetStuckScopes(stuckScopeIds);
      metrics.stuckSyncingReset = resetResult.scopesReset;
    }

    if (stuckQueuedScopeIds.length > 0) {
      const queuedResetResult = await getSyncRecoveryService().resetStuckQueuedScopes(stuckQueuedScopeIds);
      metrics.stuckSyncQueuedReset = queuedResetResult.scopesRequeued;
    }

    if (retryScopeIds.length > 0) {
      const retryResult = await getSyncRecoveryService().retryErrorScopes(retryScopeIds);
      metrics.errorScopesRetried = retryResult.scopesRequeued;
    }

    // Emit per-user health reports over WebSocket
    if (isSocketServiceInitialized()) {
      for (const [userId, userScopes] of scopesByUser) {
        const report = this.buildReport(userScopes);
        getSocketIO()
          .to(`user:${userId}`)
          .emit(SYNC_WS_EVENTS.SYNC_HEALTH_REPORT, {
            userId,
            report: {
              overallStatus: report.overallStatus,
              summary: report.summary,
              scopes: report.scopes.map((s) => ({
                scopeId: s.scopeId,
                connectionId: s.connectionId,
                scopeName: s.scopeName,
                syncStatus: s.syncStatus,
                healthStatus: s.healthStatus,
                issues: s.issues.map((i) => ({
                  type: i.type,
                  severity: i.severity,
                  message: i.message,
                })),
                lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
              })),
              connections: report.connections.map((c) => ({
                connectionId: c.connectionId,
                userId: c.userId,
                provider: c.provider,
                connectionStatus: c.connectionStatus,
                healthStatus: c.healthStatus,
                summary: c.summary,
                scopes: c.scopes.map((s) => ({
                  scopeId: s.scopeId,
                  connectionId: s.connectionId,
                  scopeName: s.scopeName,
                  syncStatus: s.syncStatus,
                  healthStatus: s.healthStatus,
                  issues: s.issues.map((i) => ({
                    type: i.type,
                    severity: i.severity,
                    message: i.message,
                  })),
                  lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
                })),
              })),
            },
          });
      }
    }

    metrics.durationMs = Date.now() - startTime;

    this.logger.info(
      {
        scopesChecked: metrics.scopesChecked,
        stuckSyncingDetected: metrics.stuckSyncingDetected,
        stuckSyncingReset: metrics.stuckSyncingReset,
        stuckSyncQueuedDetected: metrics.stuckSyncQueuedDetected,
        stuckSyncQueuedReset: metrics.stuckSyncQueuedReset,
        errorScopesDetected: metrics.errorScopesDetected,
        errorScopesRetried: metrics.errorScopesRetried,
        errorScopesSkippedExpiredConnection: metrics.errorScopesSkippedExpiredConnection,
        errorScopesBackoffDeferred: metrics.errorScopesBackoffDeferred,
        durationMs: metrics.durationMs,
      },
      'SyncHealthCheckService.run: complete',
    );

    return metrics;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public: getHealthForUser() — called by GET /api/sync/health
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Return a health report for a single user's sync scopes.
   * Inspection only — no recovery actions are taken.
   */
  async getHealthForUser(userId: string): Promise<SyncHealthReport> {
    const normalizedUserId = userId.toUpperCase();

    this.logger.info({ userId: normalizedUserId }, 'getHealthForUser: starting');

    const scopes = await prisma.connection_scopes.findMany({
      where: {
        connections: { user_id: normalizedUserId },
      },
      include: {
        connections: { select: { id: true, user_id: true, status: true, provider: true } },
      },
    });

    const scopeReports: ScopeHealthReport[] = [];

    for (const scope of scopes as ScopeWithConnection[]) {
      try {
        const report = await this.inspectScope(scope);
        scopeReports.push(report);
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, stack: err.stack, name: err.name, cause: err.cause }
            : { value: String(err) };
        this.logger.error(
          { scopeId: scope.id, userId: normalizedUserId, error: errorInfo },
          'getHealthForUser: error inspecting scope',
        );
      }
    }

    return this.buildReport(scopeReports);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: inspectScope()
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Analyze a single scope and classify its health.
   * Returns a ScopeHealthReport with detected issues and file statistics.
   */
  private async inspectScope(scope: ScopeWithConnection): Promise<ScopeHealthReport> {
    const scopeId = scope.id.toUpperCase();
    const connectionId = scope.connections.id.toUpperCase();
    const userId = scope.connections.user_id.toUpperCase();
    const now = new Date();
    const checkedAt = now;

    const fileStats = await this.getFileStats(scopeId);
    const issues: ScopeIssue[] = [];

    // 1. Stuck syncing: sync_status='syncing' and updated_at older than threshold
    const cutoff = new Date(Date.now() - this.stuckThresholdMs);
    if (scope.sync_status === 'syncing' && scope.updated_at < cutoff) {
      issues.push({
        type: 'stuck_syncing',
        severity: 'critical',
        message: `Scope has been in 'syncing' state since ${scope.updated_at.toISOString()} (threshold: ${this.stuckThresholdMs}ms)`,
        detectedAt: now,
      });
    }

    // 1b. Stuck sync_queued: scope waiting > threshold to start syncing
    const queuedCutoff = new Date(Date.now() - DEFAULT_STUCK_QUEUED_THRESHOLD_MS);
    if (scope.sync_status === 'sync_queued' && scope.updated_at < queuedCutoff) {
      issues.push({
        type: 'stuck_sync_queued',
        severity: 'critical',
        message: `Scope has been in 'sync_queued' state since ${scope.updated_at.toISOString()} (threshold: ${DEFAULT_STUCK_QUEUED_THRESHOLD_MS}ms)`,
        detectedAt: now,
      });
    }

    // 2. Error state: sync_status='error'
    if (scope.sync_status === 'error') {
      issues.push({
        type: 'error_state',
        severity: 'error',
        message: `Scope is in 'error' sync state`,
        detectedAt: now,
      });
    }

    // 3. Stale sync: last_sync_at is null or older than 48h
    const staleCutoff = new Date(Date.now() - STALE_SYNC_THRESHOLD_MS);
    if (scope.last_sync_at === null || scope.last_sync_at < staleCutoff) {
      const lastSyncStr = scope.last_sync_at
        ? scope.last_sync_at.toISOString()
        : 'never';
      issues.push({
        type: 'stale_sync',
        severity: 'warning',
        message: `Scope has not been synced recently (last sync: ${lastSyncStr})`,
        detectedAt: now,
      });
    }

    // 4. High failure rate: > 50% of files in failed or stuck state
    const problematicFiles = fileStats.failed + fileStats.stuck;
    if (fileStats.total > 0 && problematicFiles / fileStats.total > HIGH_FAILURE_RATE_THRESHOLD) {
      const rate = Math.round((problematicFiles / fileStats.total) * 100);
      issues.push({
        type: 'high_failure_rate',
        severity: 'error',
        message: `${rate}% of files (${problematicFiles}/${fileStats.total}) have failed or stuck pipeline status (failed: ${fileStats.failed}, stuck: ${fileStats.stuck})`,
        detectedAt: now,
      });
    }

    // Classify overall health
    const hasCriticalOrError = issues.some(
      (i) => i.severity === 'critical' || i.severity === 'error',
    );
    const hasWarning = issues.some((i) => i.severity === 'warning');

    let healthStatus: SyncHealthStatus;
    if (hasCriticalOrError) {
      healthStatus = 'unhealthy';
    } else if (hasWarning) {
      healthStatus = 'degraded';
    } else {
      healthStatus = 'healthy';
    }

    return {
      scopeId,
      connectionId,
      userId,
      provider: scope.connections.provider,
      connectionStatus: scope.connections.status,
      scopeName: scope.scope_display_name ?? scopeId,
      syncStatus: scope.sync_status,
      healthStatus,
      issues,
      fileStats,
      lastSyncedAt: scope.last_sync_at,
      checkedAt,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: getFileStats()
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Aggregate file counts by pipeline_status for a scope.
   *
   * Also counts files stuck in intermediate pipeline states (queued, extracting,
   * chunking, embedding) with updated_at older than 30 minutes. These are
   * included in the `stuck` field and factored into the high_failure_rate check.
   */
  private async getFileStats(scopeId: string): Promise<ScopeFileStats> {
    const stuckCutoff = new Date(Date.now() - STUCK_PIPELINE_THRESHOLD_MS);

    const [counts, stuckCount] = await Promise.all([
      prisma.files.groupBy({
        by: ['pipeline_status'],
        where: { connection_scope_id: scopeId, deleted_at: null },
        _count: true,
      }),
      prisma.files.count({
        where: {
          connection_scope_id: scopeId,
          deleted_at: null,
          pipeline_status: { in: [...STUCK_PIPELINE_STATUSES] },
          updated_at: { lt: stuckCutoff },
        },
      }),
    ]);

    const stats: ScopeFileStats = {
      total: 0,
      ready: 0,
      failed: 0,
      processing: 0,
      queued: 0,
      stuck: stuckCount,
    };

    for (const row of counts) {
      const count = row._count;
      stats.total += count;

      switch (row.pipeline_status) {
        case 'ready':
          stats.ready += count;
          break;
        case 'failed':
          stats.failed += count;
          break;
        case 'processing':
          stats.processing += count;
          break;
        case 'queued':
          stats.queued += count;
          break;
        default:
          // Other statuses (e.g. 'pending', 'extracting') counted in total only
          break;
      }
    }

    return stats;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: buildReport()
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Compute the aggregate SyncHealthReport from a list of ScopeHealthReports.
   */
  private buildReport(scopeReports: ScopeHealthReport[]): SyncHealthReport {
    let healthyScopes = 0;
    let degradedScopes = 0;
    let unhealthyScopes = 0;

    for (const s of scopeReports) {
      if (s.healthStatus === 'healthy') healthyScopes++;
      else if (s.healthStatus === 'degraded') degradedScopes++;
      else unhealthyScopes++;
    }

    let overallStatus: SyncHealthStatus;
    if (unhealthyScopes > 0) {
      overallStatus = 'unhealthy';
    } else if (degradedScopes > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    const connections = this.buildConnectionReports(scopeReports);

    let healthyConnections = 0;
    let degradedConnections = 0;
    let unhealthyConnections = 0;

    for (const c of connections) {
      if (c.healthStatus === 'healthy') healthyConnections++;
      else if (c.healthStatus === 'degraded') degradedConnections++;
      else unhealthyConnections++;
    }

    return {
      timestamp: new Date(),
      overallStatus,
      summary: {
        totalScopes: scopeReports.length,
        healthyScopes,
        degradedScopes,
        unhealthyScopes,
        totalConnections: connections.length,
        healthyConnections,
        degradedConnections,
        unhealthyConnections,
      },
      scopes: scopeReports,
      connections,
    };
  }

  /**
   * Group scope health reports by connectionId and compute connection-level
   * health using worst-of-children: unhealthy > degraded > healthy.
   */
  buildConnectionReports(scopeReports: ScopeHealthReport[]): ConnectionHealthReport[] {
    // Group scopes by connectionId — each ScopeHealthReport already carries connectionId
    const byConnection = new Map<string, ScopeHealthReport[]>();

    for (const scope of scopeReports) {
      const existing = byConnection.get(scope.connectionId);
      if (existing) {
        existing.push(scope);
      } else {
        byConnection.set(scope.connectionId, [scope]);
      }
    }

    const reports: ConnectionHealthReport[] = [];

    for (const [connectionId, scopes] of byConnection) {
      if (scopes.length === 0) continue;

      // All scopes under a connection share the same userId, provider, and connectionStatus
      // (safe to read from the first entry — guaranteed non-empty by the grouping above)
      const first = scopes[0]!;

      let healthyScopes = 0;
      let degradedScopes = 0;
      let unhealthyScopes = 0;

      for (const s of scopes) {
        if (s.healthStatus === 'healthy') healthyScopes++;
        else if (s.healthStatus === 'degraded') degradedScopes++;
        else unhealthyScopes++;
      }

      // Worst-of-children: unhealthy > degraded > healthy
      let healthStatus: SyncHealthStatus;
      if (unhealthyScopes > 0) {
        healthStatus = 'unhealthy';
      } else if (degradedScopes > 0) {
        healthStatus = 'degraded';
      } else {
        healthStatus = 'healthy';
      }

      reports.push({
        connectionId,
        userId: first.userId,
        provider: first.provider,
        connectionStatus: first.connectionStatus,
        healthStatus,
        scopes,
        summary: {
          totalScopes: scopes.length,
          healthyScopes,
          degradedScopes,
          unhealthyScopes,
        },
      });
    }

    return reports;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: Redis exponential backoff
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Determine whether an error-state scope should be retried now.
   *
   * Uses two Redis keys per scope:
   *   - `sync:error_retry:{scopeId}`    — attempt counter (integer)
   *   - `sync:error_retry_ts:{scopeId}` — timestamp of last retry attempt (ms)
   *
   * Fails open (returns true) if Redis is unavailable.
   */
  private async shouldRetryErrorScope(scopeId: string): Promise<boolean> {
    const client = getRedisClient();

    if (!client) {
      this.logger.warn(
        { scopeId },
        'shouldRetryErrorScope: Redis client unavailable, failing open',
      );
      return true;
    }

    const counterKey = `sync:error_retry:${scopeId}`;
    const tsKey = `sync:error_retry_ts:${scopeId}`;

    try {
      // Increment attempt counter
      const attemptCount = await client.incr(counterKey);

      // First attempt: set TTL on the counter key
      if (attemptCount === 1) {
        await client.expire(counterKey, BACKOFF_TTL_SECONDS);
      }

      // Exceeded maximum retries — give up
      if (attemptCount > MAX_BACKOFF_ATTEMPTS) {
        this.logger.warn(
          { scopeId, attemptCount, max: MAX_BACKOFF_ATTEMPTS },
          'shouldRetryErrorScope: max backoff attempts reached, deferring',
        );
        return false;
      }

      // Check how long it has been since the last attempt
      const lastAttemptTs = await client.get(tsKey);

      if (lastAttemptTs !== null) {
        const elapsedMs = Date.now() - parseInt(lastAttemptTs, 10);
        const requiredDelayMs = BACKOFF_SCHEDULE_MS[attemptCount - 1] ?? 0;

        if (elapsedMs < requiredDelayMs) {
          this.logger.debug(
            { scopeId, attemptCount, elapsedMs, requiredDelayMs },
            'shouldRetryErrorScope: backoff delay not yet elapsed, deferring',
          );
          return false;
        }
      }

      // Record this attempt timestamp
      await client.set(tsKey, String(Date.now()), { EX: BACKOFF_TTL_SECONDS });

      return true;
    } catch (err) {
      const errorInfo =
        err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
      this.logger.warn(
        { scopeId, error: errorInfo },
        'shouldRetryErrorScope: Redis error, failing open',
      );
      return true;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────────────────────────────────

let instance: SyncHealthCheckService | undefined;

/**
 * Get the SyncHealthCheckService singleton.
 */
export function getSyncHealthCheckService(): SyncHealthCheckService {
  if (!instance) {
    instance = new SyncHealthCheckService();
  }
  return instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function __resetSyncHealthCheckService(): void {
  instance = undefined;
}
