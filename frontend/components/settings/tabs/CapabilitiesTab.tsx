'use client';

import { Zap } from 'lucide-react';

/**
 * Capabilities Tab
 *
 * Placeholder for AI model capabilities and feature toggles.
 * Coming soon.
 */
export function CapabilitiesTab() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Zap className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-medium">AI Capabilities</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Configure AI model preferences, enable experimental features,
        and customize agent behavior for your workflow.
      </p>
      <div className="mt-4 rounded-md bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        Coming Soon
      </div>
    </div>
  );
}
