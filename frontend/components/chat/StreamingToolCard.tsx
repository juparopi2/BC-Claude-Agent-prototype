'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Wrench, ChevronRight, ChevronDown, Clock, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolExecution } from '@/lib/stores/chatStore';

interface StreamingToolCardProps {
  tool: ToolExecution;
}

export function StreamingToolCard({ tool }: StreamingToolCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const statusConfig = {
    pending: { icon: Clock, color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', label: 'Pending', animate: false },
    running: { icon: Loader2, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300', label: 'Running', animate: true },
    completed: { icon: Check, color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300', label: 'Completed', animate: false },
    failed: { icon: X, color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300', label: 'Failed', animate: false },
  };

  const config = statusConfig[tool.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="flex gap-3 py-2" data-testid="streaming-tool-card">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-blue-100 dark:bg-blue-900 border-0">
          <Wrench className="size-4 text-blue-600 dark:text-blue-400" />
        </AvatarFallback>
      </Avatar>

      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="flex-1 min-w-0">
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
          {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <span className="font-medium text-sm truncate">{tool.toolName}</span>
          <Badge variant="secondary" className={cn('ml-auto shrink-0', config.color)}>
            <StatusIcon className={cn('size-3 mr-1', config.animate && 'animate-spin')} />
            {config.label}
          </Badge>
          {tool.durationMs && (
            <span className="text-xs text-muted-foreground shrink-0">{tool.durationMs}ms</span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 space-y-2">
            {/* Input args */}
            <div className="p-2 bg-muted rounded-lg">
              <div className="text-xs font-medium text-muted-foreground mb-1">Input</div>
              <pre className="text-xs overflow-auto max-h-32">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>

            {/* Result (if completed) */}
            {tool.status === 'completed' && tool.result !== undefined && (
              <div className="p-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="text-xs font-medium text-green-700 dark:text-green-300 mb-1">Result</div>
                <pre className="text-xs overflow-auto max-h-48">
                  {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                </pre>
              </div>
            )}

            {/* Error (if failed) */}
            {tool.status === 'failed' && tool.error && (
              <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">Error</div>
                <p className="text-xs text-red-600 dark:text-red-400">{tool.error}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
