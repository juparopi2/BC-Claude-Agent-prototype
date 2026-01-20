'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Wrench, ChevronRight, ChevronDown, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import JsonView from '@uiw/react-json-view';
import { useTheme } from 'next-themes';

/**
 * Custom transparent theme for JsonView in light mode
 * Uses colors that work well on light backgrounds
 */
const transparentLightTheme: React.CSSProperties = {
  '--w-rjv-font-family': 'var(--font-geist-mono, monospace)',
  '--w-rjv-color': '#a2a3a7',
  '--w-rjv-key-string': '#a2a3a7',
  '--w-rjv-background-color': 'transparent',
  '--w-rjv-line-color': '#e8e8e8',
  '--w-rjv-arrow-color': '#6a737d',
  '--w-rjv-info-color': '#6a737d',
  '--w-rjv-curlybraces-color': '#a2a3a7',
  '--w-rjv-colon-color': '#a2a3a7',
  '--w-rjv-brackets-color': '#a2a3a7',
  '--w-rjv-quotes-color': '#50a14f',
  '--w-rjv-quotes-string-color': '#50a14f',
  '--w-rjv-type-string-color': '#50a14f',
  '--w-rjv-type-int-color': '#986801',
  '--w-rjv-type-float-color': '#986801',
  '--w-rjv-type-bigint-color': '#986801',
  '--w-rjv-type-boolean-color': '#0184bc',
  '--w-rjv-type-date-color': '#986801',
  '--w-rjv-type-null-color': '#e45649',
  '--w-rjv-type-undefined-color': '#e45649',
  '--w-rjv-type-nan-color': '#e45649',
} as React.CSSProperties;

/**
 * Custom transparent theme for JsonView in dark mode
 * Uses colors that work well on dark backgrounds
 */
const transparentDarkTheme: React.CSSProperties = {
  '--w-rjv-font-family': 'var(--font-geist-mono, monospace)',
  '--w-rjv-color': '#abb2bf',
  '--w-rjv-key-string': '#e5c07b',
  '--w-rjv-background-color': 'transparent',
  '--w-rjv-line-color': '#3e4451',
  '--w-rjv-arrow-color': '#6a737d',
  '--w-rjv-info-color': '#6a737d',
  '--w-rjv-curlybraces-color': '#abb2bf',
  '--w-rjv-colon-color': '#abb2bf',
  '--w-rjv-brackets-color': '#abb2bf',
  '--w-rjv-quotes-color': '#98c379',
  '--w-rjv-quotes-string-color': '#98c379',
  '--w-rjv-type-string-color': '#98c379',
  '--w-rjv-type-int-color': '#d19a66',
  '--w-rjv-type-float-color': '#d19a66',
  '--w-rjv-type-bigint-color': '#d19a66',
  '--w-rjv-type-boolean-color': '#56b6c2',
  '--w-rjv-type-date-color': '#d19a66',
  '--w-rjv-type-null-color': '#e06c75',
  '--w-rjv-type-undefined-color': '#e06c75',
  '--w-rjv-type-nan-color': '#e06c75',
} as React.CSSProperties;

/**
 * Try to parse JSON strings recursively
 * @param value - Value to parse (can be string, object, or primitive)
 * @returns Parsed object or wrapped value
 */
function tryParseJSON(value: unknown): object {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      // If parsed is an object, return it
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Not valid JSON, will wrap below
    }
  }

  // If value is already an object, return it
  if (typeof value === 'object' && value !== null) {
    return value;
  }

  // Wrap primitives or invalid JSON strings in object
  return { result: value };
}

interface ToolCardProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  durationMs?: number;
}

export function ToolCard({
  toolName,
  toolArgs,
  result,
  error,
  status,
  durationMs,
}: ToolCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { theme } = useTheme();

  // Extract values
  const displayName = toolName;
  const displayArgs = toolArgs;
  const displayResult = result;
  const displayError = error;
  const displayStatus = status;
  const displayDuration = durationMs;

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
              <div className="p-2 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Input</div>
                <JsonView
                  value={displayArgs}
                  style={theme === 'dark' ? transparentDarkTheme : transparentLightTheme}
                  collapsed={2}
                  displayDataTypes={false}
                  displayObjectSize={true}
                  enableClipboard={true}
                />
              </div>
            )}

            {/* Result (if completed) */}
            {displayStatus === 'completed' && displayResult !== undefined && (
              <div className="p-2 bg-emerald-50 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-700 rounded-lg">
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1">Result</div>
                <JsonView
                  value={tryParseJSON(displayResult)}
                  style={theme === 'dark' ? transparentDarkTheme : transparentLightTheme}
                  collapsed={2}
                  displayDataTypes={false}
                  displayObjectSize={true}
                  enableClipboard={true}
                />
              </div>
            )}

            {/* Error (if failed) */}
            {displayStatus === 'failed' && displayError && (
              <div className="p-2 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-lg">
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
