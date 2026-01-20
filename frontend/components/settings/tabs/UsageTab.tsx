'use client';

import { BarChart3 } from 'lucide-react';

/**
 * Usage Tab
 *
 * Placeholder for usage statistics and billing information.
 * Coming soon.
 */
export function UsageTab() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <BarChart3 className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-medium">Usage & Billing</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Track your token usage, API calls, and storage consumption.
        View billing history and manage your subscription.
      </p>
      <div className="mt-4 rounded-md bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        Coming Soon
      </div>
    </div>
  );
}
