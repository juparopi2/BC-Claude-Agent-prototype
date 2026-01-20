'use client';

import { CreditCard } from 'lucide-react';

/**
 * Billing Tab
 *
 * Placeholder for billing management and payment settings.
 * Coming soon.
 */
export function BillingTab() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <CreditCard className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-medium">Billing & Payments</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Manage your subscription, view invoices, update payment methods,
        and track your billing history.
      </p>
      <div className="mt-4 rounded-md bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        Coming Soon
      </div>
    </div>
  );
}
