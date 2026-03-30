/**
 * ScopeIntegrityDetector
 *
 * Detects scopes where the metadata count diverges from the actual file count
 * in the database, or where processing has been stuck for too long.
 *
 * Three detection reasons:
 *
 *   1. zero_files — scope is 'synced' with item_count > 0, but zero actual
 *      files exist in the DB for that scope. Indicates a failed initial sync
 *      or a sync that silently dropped all files.
 *
 *   2. count_mismatch — scope is 'synced' with item_count > 0, and the
 *      absolute difference between item_count and actual file count is greater
 *      than 20%. Indicates partial sync loss or ingestion failure.
 *
 *   3. processing_stuck — scope has processing_status='processing' but
 *      updated_at is older than 1 hour. Indicates the processing pipeline
 *      has stalled and the scope counter will never resolve.
 *
 * Only connected scopes are inspected (JOIN connections WHERE status='connected').
 *
 * @module services/sync/health/detectors
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { ScopeIntegrityRow } from '../types';
import type { DriftDetector, DetectionResult } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const PROCESSING_STUCK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const COUNT_MISMATCH_THRESHOLD = 0.20; // 20% divergence

// ──────────────────────────────────────────────────────────────────────────────
// Detector
// ──────────────────────────────────────────────────────────────────────────────

export class ScopeIntegrityDetector implements DriftDetector<ScopeIntegrityRow> {
  readonly name = 'ScopeIntegrityDetector';

  private readonly logger = createChildLogger({ service: 'ScopeIntegrityDetector' });

  async detect(userId: string): Promise<DetectionResult<ScopeIntegrityRow>> {
    const stuckThreshold = new Date(Date.now() - PROCESSING_STUCK_THRESHOLD_MS);

    // Fetch all scopes for connected connections owned by this user
    const scopes = await prisma.connection_scopes.findMany({
      where: {
        connections: {
          user_id: userId,
          status: 'connected',
        },
      },
      select: {
        id: true,
        connection_id: true,
        sync_status: true,
        item_count: true,
        processing_status: true,
        updated_at: true,
        scope_display_name: true,
      },
    });

    const issues: ScopeIntegrityRow[] = [];

    for (const scope of scopes) {
      // ── 3. processing_stuck check ──────────────────────────────────────────
      // Check first — independent of sync_status
      if (scope.processing_status === 'processing' && scope.updated_at < stuckThreshold) {
        issues.push({
          scopeId: scope.id.toUpperCase(),
          connectionId: scope.connection_id.toUpperCase(),
          reason: 'processing_stuck',
          scopeName: scope.scope_display_name,
          syncStatus: scope.sync_status,
          itemCount: scope.item_count ?? 0,
          actualFileCount: 0, // Not relevant for this reason
          processingStatus: scope.processing_status,
        });
        continue;
      }

      // ── zero_files and count_mismatch: only apply to 'synced' scopes ──────
      if (scope.sync_status !== 'synced') continue;

      const itemCount = scope.item_count ?? 0;
      if (itemCount === 0) continue; // No files expected — nothing to check

      // Count actual non-folder files in DB for this scope
      const actualFileCount = await prisma.files.count({
        where: {
          connection_scope_id: scope.id,
          deleted_at: null,
          is_folder: false,
        },
      });

      // ── 1. zero_files ──────────────────────────────────────────────────────
      if (actualFileCount === 0) {
        issues.push({
          scopeId: scope.id.toUpperCase(),
          connectionId: scope.connection_id.toUpperCase(),
          reason: 'zero_files',
          scopeName: scope.scope_display_name,
          syncStatus: scope.sync_status,
          itemCount,
          actualFileCount,
          processingStatus: scope.processing_status,
        });
        continue;
      }

      // ── 2. count_mismatch ──────────────────────────────────────────────────
      const divergence = Math.abs(actualFileCount - itemCount) / itemCount;
      if (divergence > COUNT_MISMATCH_THRESHOLD) {
        issues.push({
          scopeId: scope.id.toUpperCase(),
          connectionId: scope.connection_id.toUpperCase(),
          reason: 'count_mismatch',
          scopeName: scope.scope_display_name,
          syncStatus: scope.sync_status,
          itemCount,
          actualFileCount,
          processingStatus: scope.processing_status,
        });
      }
    }

    this.logger.debug(
      { userId, scopesChecked: scopes.length, issuesFound: issues.length },
      'ScopeIntegrityDetector: detection complete',
    );

    return { items: issues, count: issues.length };
  }
}
