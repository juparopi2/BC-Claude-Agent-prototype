'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolUseMessage as ToolUseMessageType } from '@/lib/types';
import { jsonToString } from '@/lib/json-utils';

interface ToolUseMessageProps {
  message: ToolUseMessageType;
  className?: string;
}

// Status icon component - moved outside render to avoid recreation
interface StatusIconProps {
  status: 'pending' | 'success' | 'error';
}

function StatusIcon({ status }: StatusIconProps) {
  switch (status) {
    case 'pending':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
  }
}

// Status badge component - moved outside render to avoid recreation
interface StatusBadgeProps {
  status: 'pending' | 'success' | 'error';
}

function StatusBadge({ status }: StatusBadgeProps) {
  const statusConfig = {
    pending: { label: 'Running', className: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300' },
    success: { label: 'Success', className: 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300' },
    error: { label: 'Failed', className: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300' },
  };

  const config = statusConfig[status];

  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', config.className)}>
      {config.label}
    </span>
  );
}

export function ToolUseMessage({ message, className }: ToolUseMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Format tool name to be more user-friendly
  const formatToolName = (toolName: string): string => {
    // Convert snake_case to Title Case
    return toolName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Format arguments for preview (compact, inline format)
  const formatArgsPreview = (args: Record<string, unknown> | undefined): string => {
    if (!args || Object.keys(args).length === 0) {
      return '';
    }

    try {
      const argsStr = JSON.stringify(args);
      // Truncate if too long (max 60 chars)
      return argsStr.length > 60 ? argsStr.substring(0, 57) + '...' : argsStr;
    } catch (error) {
      return '{ ... }';
    }
  };

  const argsPreview = formatArgsPreview(message.tool_args);

  return (
    <div className={cn('my-2 rounded-lg border bg-card text-card-foreground shadow-sm', className)}>
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors cursor-pointer rounded-t-lg"
      >
        {/* Expand/collapse icon */}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}

        {/* Tool icon */}
        <div className="p-1.5 rounded-md bg-purple-100 dark:bg-purple-950/30">
          <Wrench className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        </div>

        {/* Tool name and args preview */}
        <span className="text-sm font-medium flex-1 text-left flex flex-col gap-0.5">
          <span>{formatToolName(message.tool_name)}</span>
          {argsPreview && (
            <span className="text-xs font-mono font-normal text-muted-foreground truncate">
              {argsPreview}
            </span>
          )}
        </span>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {/* ⭐ Only show badge for pending and error, not for success (only icon) */}
          {message.status !== 'success' && <StatusBadge status={message.status} />}
          <StatusIcon status={message.status} />
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded ? (
        <div className="px-4 pb-4 space-y-3 border-t">
          {/* Arguments */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 mt-3">Arguments:</h4>
            <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
              {jsonToString(message.tool_args)}
            </pre>
          </div>

          {/* Result (only if status is success) */}
          {message.status === 'success' && message.tool_result && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">Result:</h4>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-96">
                {jsonToString(message.tool_result)}
              </pre>
            </div>
          )}

          {/* Error message (only if status is error) */}
          {message.status === 'error' && message.error_message && (
            <div>
              <h4 className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1.5">Error:</h4>
              <div className="text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-3 rounded-md">
                {message.error_message}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
