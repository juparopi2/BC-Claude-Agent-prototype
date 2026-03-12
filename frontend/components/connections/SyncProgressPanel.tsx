'use client';

/**
 * SyncProgressPanel (PRD-116)
 *
 * Floating panel at bottom-right showing active/completed sync operations.
 * Supports collapsed (badge) and expanded (card) views.
 * Auto-dismisses completed operations after 3 seconds.
 *
 * @module components/connections/SyncProgressPanel
 */

import { useState, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  useSyncStatusStore,
  selectVisibleOperations,
  selectHasActiveOperations,
} from '@/src/domains/integrations/stores/syncStatusStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ChevronDown, X, Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const AUTO_DISMISS_DELAY_MS = 3000;

export function SyncProgressPanel() {
  const operations = useSyncStatusStore(useShallow(selectVisibleOperations));
  const hasActive = useSyncStatusStore(selectHasActiveOperations);
  const dismissOperation = useSyncStatusStore((s) => s.dismissOperation);
  const removeOperation = useSyncStatusStore((s) => s.removeOperation);

  // User preference: collapsed = true means user manually collapsed the panel.
  // Panel always shows expanded when there are active operations.
  const [userCollapsed, setUserCollapsed] = useState(false);

  // Track auto-dismiss timers per operation key
  const autoDismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Auto-dismiss completed operations after 3 seconds
  useEffect(() => {
    for (const op of operations) {
      if (op.status === 'complete' && !op.dismissed) {
        if (!autoDismissTimers.current.has(op.operationKey)) {
          const timer = setTimeout(() => {
            dismissOperation(op.operationKey);
            autoDismissTimers.current.delete(op.operationKey);
          }, AUTO_DISMISS_DELAY_MS);
          autoDismissTimers.current.set(op.operationKey, timer);
        }
      }
    }

    // Clean up timers for operations that are no longer visible
    const visibleKeys = new Set(operations.map((op) => op.operationKey));
    for (const [key, timer] of autoDismissTimers.current) {
      if (!visibleKeys.has(key)) {
        clearTimeout(timer);
        autoDismissTimers.current.delete(key);
      }
    }
  }, [operations, dismissOperation]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = autoDismissTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  if (operations.length === 0) return null;

  // Always expanded when active operations exist; otherwise respect user preference
  const isExpanded = hasActive || !userCollapsed;

  const activeCount = operations.filter((op) => op.status === 'syncing').length;

  // Collapsed view: button badge
  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          size="sm"
          variant="secondary"
          className="shadow-lg gap-2"
          onClick={() => setUserCollapsed(false)}
        >
          <RefreshCw
            className={cn('size-4', activeCount > 0 && 'animate-spin')}
          />
          {activeCount > 0
            ? `${activeCount} sync${activeCount !== 1 ? 's' : ''} in progress`
            : 'Sync complete'}
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96">
      <Card className="shadow-xl">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
          <CardTitle className="text-sm font-medium">File Sync</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setUserCollapsed(true)}
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3 max-h-64 overflow-y-auto">
          {operations.map((op) => (
            <div key={op.operationKey} className="flex items-center gap-3 text-sm">
              {op.status === 'syncing' && (
                <RefreshCw className="size-4 text-blue-500 animate-spin shrink-0" />
              )}
              {op.status === 'complete' && (
                <Check className="size-4 text-green-500 shrink-0" />
              )}
              {op.status === 'error' && (
                <AlertTriangle className="size-4 text-red-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{op.providerName}</p>
                <p className="text-xs text-muted-foreground">
                  {op.scopeIds.length} scope{op.scopeIds.length !== 1 ? 's' : ''}
                  {op.status === 'syncing' && ' syncing...'}
                  {op.status === 'complete' && ' synced'}
                  {op.status === 'error' && ' failed'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={() => removeOperation(op.operationKey)}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
