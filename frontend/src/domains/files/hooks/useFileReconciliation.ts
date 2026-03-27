/**
 * useFileReconciliation Hook
 *
 * Provides on-demand file health reconciliation for the current user.
 * Calls POST /api/sync/health/reconcile and manages cooldown state.
 *
 * @module domains/files/hooks/useFileReconciliation
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getApiClient, type ReconciliationResponse } from '@/src/infrastructure/api/httpClient';
import { toast } from 'sonner';

export interface UseFileReconciliationReturn {
  /** Trigger on-demand reconciliation */
  triggerReconciliation: () => Promise<void>;
  /** Whether reconciliation is currently running */
  isReconciling: boolean;
  /** Seconds remaining in cooldown (0 = ready) */
  cooldownRemaining: number;
  /** Last reconciliation report (null if never run) */
  lastReport: ReconciliationResponse['report'] | null;
}

export function useFileReconciliation(): UseFileReconciliationReturn {
  const [isReconciling, setIsReconciling] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [lastReport, setLastReport] = useState<ReconciliationResponse['report'] | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldownTimer = useCallback((seconds: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCooldownRemaining(seconds);
    timerRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const triggerReconciliation = useCallback(async () => {
    if (isReconciling || cooldownRemaining > 0) return;

    setIsReconciling(true);

    try {
      const api = getApiClient();
      const result = await api.triggerReconciliation('manual');

      if (result.success) {
        const report = result.data.report;
        setLastReport(report);

        const totalIssues =
          report.missingFromSearchCount +
          report.orphanedInSearchCount +
          report.failedRetriableCount +
          report.stuckFilesCount +
          report.imagesMissingEmbeddingsCount;

        const totalRepairs =
          report.repairs.missingRequeued +
          report.repairs.orphansDeleted +
          report.repairs.failedRequeued +
          report.repairs.stuckRequeued +
          report.repairs.imageRequeued;

        if (totalIssues === 0) {
          toast.success('File health check complete', {
            description: `All ${report.dbReadyFiles} files are healthy.`,
          });
        } else if (report.dryRun) {
          toast.warning('File health check complete', {
            description: `${totalIssues} issue${totalIssues !== 1 ? 's' : ''} detected (dry-run mode — no repairs applied).`,
          });
        } else {
          toast.success('File health check complete', {
            description: `${totalRepairs} issue${totalRepairs !== 1 ? 's' : ''} repaired. Files are being re-processed.`,
          });
        }

        // Start a conservative cooldown on success
        startCooldownTimer(300);
      } else {
        const errorMsg = result.error.message;

        if (errorMsg.includes('recently ran') || errorMsg.includes('cooldown')) {
          const retryAfter =
            (result.error.details?.retryAfterSeconds as number | undefined) ?? 300;
          startCooldownTimer(retryAfter);
          toast.info('File health check recently completed', {
            description: `Please wait ${Math.ceil(retryAfter / 60)} minute${retryAfter >= 120 ? 's' : ''} before running again.`,
          });
        } else if (errorMsg.includes('in progress')) {
          toast.info('File health check already in progress', {
            description: 'A check is currently running. Results will appear shortly.',
          });
        } else {
          toast.error('File health check failed', {
            description: result.error.message || 'An unexpected error occurred.',
          });
        }
      }
    } catch {
      toast.error('File health check failed', {
        description: 'Could not reach the server. Please check your connection.',
      });
    } finally {
      setIsReconciling(false);
    }
  }, [isReconciling, cooldownRemaining, startCooldownTimer]);

  return {
    triggerReconciliation,
    isReconciling,
    cooldownRemaining,
    lastReport,
  };
}
