'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Wrench, ChevronRight, ChevronDown, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolExecution } from '@/lib/stores/chatStore';

interface ToolCardProps {
  // For streaming tools
  tool?: ToolExecution;
  // For persisted tools (from database)
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  durationMs?: number;
}

export function ToolCard({
  tool,
  toolName,
  toolArgs,
  result,
  error,
  status,
  durationMs,
}: ToolCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Extract values (prefer tool prop if available)
  const displayName = tool?.toolName || toolName || 'Unknown Tool';
  const displayArgs = tool?.args || toolArgs || {};
  const displayResult = tool?.result || result;
  const displayError = tool?.error || error;
  const displayStatus = tool?.status || status || 'pending';
  const displayDuration = tool?.durationMs || durationMs;

  // Status configuration with color-coding
  const statusConfig = {
    pending: {
      icon: Clock,
      label: 'Pending',
      // Avatar colors (blue)
      avatarClass: 'bg-blue-100 dark:bg-blue-900',
      iconClass: 'text-blue-600 dark:text-blue-400',
      // Badge colors (blue)
      badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
      // Animation
      animate: false,
    },
    running: {
      icon: Loader2,
      label: 'Running',
      // Avatar colors (blue)
      avatarClass: 'bg-blue-100 dark:bg-blue-900',
      iconClass: 'text-blue-600 dark:text-blue-400',
      // Badge colors (blue)
      badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
      // Animation
      animate: true,
    },
    completed: {
      icon: CheckCircle2,
      label: 'Completed',
      // Avatar colors (green/emerald)
      avatarClass: 'bg-emerald-100 dark:bg-emerald-900',
      iconClass: 'text-emerald-600 dark:text-emerald-400',
      // Badge colors (green/emerald)
      badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
      // Animation
      animate: false,
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      // Avatar colors (red)
      avatarClass: 'bg-red-100 dark:bg-red-900',
      iconClass: 'text-red-600 dark:text-red-400',
      // Badge colors (red)
      badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
      // Animation
      animate: false,
    },
  };

  const config = statusConfig[displayStatus];
  const StatusIcon = config.icon;

  return (
    <div className="flex gap-3 py-2" data-testid="tool-card">
      {/* Avatar with wrench icon - color changes based on status */}
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className={cn('border-0', config.avatarClass)}>
          <Wrench className={cn('size-4', config.iconClass)} />
        </AvatarFallback>
      </Avatar>

      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="flex-1 min-w-0">
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
          {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <span className="font-medium text-sm truncate">{displayName}</span>

          {/* Status badge with icon */}
          <Badge variant="secondary" className={cn('ml-auto shrink-0', config.badgeClass)}>
            <StatusIcon className={cn('size-3 mr-1', config.animate && 'animate-spin')} />
            {config.label}
          </Badge>

          {/* Duration */}
          {displayDuration && (
            <span className="text-xs text-muted-foreground shrink-0">{displayDuration}ms</span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 space-y-2">
            {/* Input arguments */}
            {Object.keys(displayArgs).length > 0 && (
              <div className="p-2 bg-muted rounded-lg">
                <div className="text-xs font-medium text-muted-foreground mb-1">Input</div>
                <pre className="text-xs overflow-auto max-h-32">
                  {JSON.stringify(displayArgs, null, 2)}
                </pre>
              </div>
            )}

            {/* Result (if completed) */}
            {displayStatus === 'completed' && displayResult !== undefined && (
              <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1">Result</div>
                <pre className="text-xs overflow-auto max-h-48">
                  {typeof displayResult === 'string' ? displayResult : JSON.stringify(displayResult, null, 2)}
                </pre>
              </div>
            )}

            {/* Error (if failed) */}
            {displayStatus === 'failed' && displayError && (
              <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">Error</div>
                <p className="text-xs text-red-600 dark:text-red-400">{displayError}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
