'use client';

import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ListTodo } from 'lucide-react';
import { useTodos } from '@/hooks';
import { TodoItem } from './TodoItem';
import type { Todo } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface TodoListProps {
  sessionId: string;
  className?: string;
}

interface GroupedTodos {
  inProgress: Todo[];
  pending: Todo[];
  completed: Todo[];
  failed: Todo[];
}

/**
 * TodoList Component
 *
 * Displays all todos for a session with:
 * - Progress bar showing completion percentage
 * - Grouping by status (in_progress, pending, completed, failed)
 * - Real-time updates via useTodos hook
 * - Collapsible completed section
 */
export function TodoList({ sessionId, className }: TodoListProps) {
  const { todos, isLoading } = useTodos(sessionId);

  // Group todos by status
  const groupedTodos: GroupedTodos = useMemo(() => {
    const groups: GroupedTodos = {
      inProgress: [],
      pending: [],
      completed: [],
      failed: [],
    };

    todos.forEach((todo) => {
      switch (todo.status) {
        case 'in_progress':
          groups.inProgress.push(todo);
          break;
        case 'pending':
          groups.pending.push(todo);
          break;
        case 'completed':
          groups.completed.push(todo);
          break;
        case 'failed':
          groups.failed.push(todo);
          break;
      }
    });

    return groups;
  }, [todos]);

  // Calculate progress
  const totalTodos = todos.length;
  const completedCount = groupedTodos.completed.length;
  const progressPercentage = totalTodos > 0 ? (completedCount / totalTodos) * 100 : 0;

  if (isLoading) {
    return (
      <div className={cn('p-4', className)}>
        <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 rounded-lg border border-border/40 bg-muted/20">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          <span className="text-sm font-medium text-muted-foreground">Loading todos...</span>
        </div>
      </div>
    );
  }

  if (totalTodos === 0) {
    return (
      <div className={cn('p-4', className)}>
        <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 rounded-lg border-2 border-dashed border-border/40 bg-muted/30 text-center">
          <div className="p-2 rounded-full bg-muted/50">
            <ListTodo className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No todos yet</p>
            <p className="text-xs text-muted-foreground mt-1">Tasks will appear here as you chat</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Progress Section */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Progress</span>
          <Badge variant="secondary">
            {completedCount} / {totalTodos}
          </Badge>
        </div>
        <Progress value={progressPercentage} className="h-2" />
        <p className="text-xs text-muted-foreground mt-2">
          {Math.round(progressPercentage)}% complete
        </p>
      </Card>

      {/* Todos List */}
      <ScrollArea className="flex-1">
        <div className="space-y-4">
          {/* In Progress */}
          {groupedTodos.inProgress.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-semibold text-blue-700">In Progress</h3>
                <Badge variant="default" className="bg-blue-500/10 text-blue-700">
                  {groupedTodos.inProgress.length}
                </Badge>
              </div>
              {groupedTodos.inProgress.map((todo) => (
                <TodoItem key={todo.id} todo={todo} />
              ))}
            </div>
          )}

          {/* Pending */}
          {groupedTodos.pending.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-semibold">Pending</h3>
                <Badge variant="secondary">{groupedTodos.pending.length}</Badge>
              </div>
              {groupedTodos.pending.map((todo) => (
                <TodoItem key={todo.id} todo={todo} />
              ))}
            </div>
          )}

          {/* Failed */}
          {groupedTodos.failed.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-semibold text-red-700">Failed</h3>
                <Badge variant="destructive">{groupedTodos.failed.length}</Badge>
              </div>
              {groupedTodos.failed.map((todo) => (
                <TodoItem key={todo.id} todo={todo} />
              ))}
            </div>
          )}

          {/* Completed (Collapsible) */}
          {groupedTodos.completed.length > 0 && (
            <Collapsible defaultOpen={false}>
              <CollapsibleTrigger className="flex items-center gap-2 px-1 w-full hover:opacity-70 transition-opacity cursor-pointer">
                <h3 className="text-sm font-semibold text-green-700">Completed</h3>
                <Badge variant="default" className="bg-green-500/10 text-green-700">
                  {groupedTodos.completed.length}
                </Badge>
                <ChevronDown className="h-4 w-4 ml-auto transition-transform ui-expanded:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {groupedTodos.completed.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
