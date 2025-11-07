'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Clock, XCircle, Loader2 } from 'lucide-react';
import type { Todo } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface TodoItemProps {
  todo: Todo;
  showTimestamp?: boolean;
}

/**
 * TodoItem Component
 *
 * Displays a single todo item with status indicator and timestamp.
 * Visual feedback for different states: pending, in_progress, completed, failed.
 */
export function TodoItem({ todo, showTimestamp = true }: TodoItemProps) {
  const getStatusIcon = () => {
    switch (todo.status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />;
      case 'in_progress':
        return <Loader2 className="h-5 w-5 text-blue-500 shrink-0 animate-spin" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
      case 'pending':
      default:
        return <Circle className="h-5 w-5 text-muted-foreground shrink-0" />;
    }
  };

  const getStatusBadge = () => {
    switch (todo.status) {
      case 'completed':
        return (
          <Badge variant="default" className="bg-green-500/10 text-green-700 hover:bg-green-500/20">
            Completed
          </Badge>
        );
      case 'in_progress':
        return (
          <Badge variant="default" className="bg-blue-500/10 text-blue-700 hover:bg-blue-500/20">
            In Progress
          </Badge>
        );
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'pending':
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  const formatTimestamp = (timestamp?: string): string => {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  return (
    <Card
      className={cn(
        'p-3 transition-colors',
        todo.status === 'completed' && 'bg-green-500/5 border-green-500/20',
        todo.status === 'in_progress' && 'bg-blue-500/5 border-blue-500/20',
        todo.status === 'failed' && 'bg-red-500/5 border-red-500/20'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Status Icon */}
        <div className="mt-0.5">{getStatusIcon()}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-sm font-medium',
              todo.status === 'completed' && 'text-muted-foreground line-through'
            )}
          >
            {todo.content}
          </p>

          {/* Metadata */}
          <div className="flex items-center gap-2 mt-2">
            {getStatusBadge()}
            {showTimestamp && (todo.created_at || todo.completed_at) && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {todo.status === 'completed' && todo.completed_at
                  ? formatTimestamp(todo.completed_at)
                  : formatTimestamp(todo.created_at)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
