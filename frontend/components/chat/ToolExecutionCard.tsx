'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolExecutionCardProps {
  toolName: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export function ToolExecutionCard({
  toolName,
  args,
  status,
  result,
  error,
  durationMs,
}: ToolExecutionCardProps) {
  const [argsExpanded, setArgsExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);

  // Status styling
  const statusConfig = {
    pending: {
      icon: Clock,
      label: 'Pending',
      color: 'text-slate-400',
      bgColor: 'bg-slate-50 dark:bg-slate-900/50',
      borderColor: 'border-slate-200 dark:border-slate-800',
      iconAnimation: undefined,
    },
    running: {
      icon: Loader2,
      label: 'Running',
      color: 'text-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
      borderColor: 'border-blue-200 dark:border-blue-800',
      iconAnimation: 'animate-spin',
    },
    completed: {
      icon: CheckCircle2,
      label: 'Completed',
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
      borderColor: 'border-emerald-200 dark:border-emerald-800',
      iconAnimation: undefined,
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      color: 'text-red-500',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
      borderColor: 'border-red-200 dark:border-red-800',
      iconAnimation: undefined,
    },
  };

  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <div
      className={cn(
        'rounded-lg border p-4 space-y-3 transition-colors',
        config.bgColor,
        config.borderColor
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <StatusIcon className={cn('size-5', config.color, config.iconAnimation)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground">{toolName}</span>
            <span className={cn('text-sm', config.color)}>{config.label}</span>
            {durationMs !== undefined && (
              <span className="text-sm text-muted-foreground">
                ({durationMs}ms)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Input Arguments */}
      {Object.keys(args).length > 0 && (
        <div>
          <button
            onClick={() => setArgsExpanded(!argsExpanded)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {argsExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <span className="font-medium">Input</span>
            <span className="text-xs">
              ({Object.keys(args).length} {Object.keys(args).length === 1 ? 'arg' : 'args'})
            </span>
          </button>
          {argsExpanded && (
            <pre className="mt-2 p-3 bg-slate-100 dark:bg-slate-900 rounded text-xs overflow-x-auto">
              {JSON.stringify(args, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Result or Error */}
      {(result !== undefined || error) && (
        <div>
          <button
            onClick={() => setResultExpanded(!resultExpanded)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {resultExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <span className="font-medium">{error ? 'Error' : 'Result'}</span>
          </button>
          {resultExpanded && (
            <div className="mt-2">
              {error ? (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              ) : (
                <pre className="p-3 bg-slate-100 dark:bg-slate-900 rounded text-xs overflow-x-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
