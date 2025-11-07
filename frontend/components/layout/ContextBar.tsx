'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Plus, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ContextItem {
  id: string;
  name: string;
  type: 'file' | 'entity';
}

interface ContextBarProps {
  className?: string;
}

export function ContextBar({ className }: ContextBarProps) {
  // TODO: Replace with actual context management from store
  const [contextItems, setContextItems] = useState<ContextItem[]>([
    { id: '1', name: 'customers.xlsx', type: 'file' },
    { id: '2', name: 'Customer entity schema', type: 'entity' },
  ]);

  // Handle remove context item
  const handleRemove = (id: string) => {
    setContextItems((items) => items.filter((item) => item.id !== id));
  };

  // Handle add context
  const handleAdd = () => {
    // TODO: Open file picker or entity selector
    console.log('[ContextBar] Add context clicked');
  };

  // If no context items, show minimal bar
  if (contextItems.length === 0) {
    return (
      <div
        className={cn(
          'border-t bg-background px-4 py-2 flex items-center justify-between',
          className
        )}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>No context added</span>
        </div>
        <Button variant="outline" size="sm" onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Context
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'border-t bg-background px-4 py-2 flex items-center gap-3',
        className
      )}
    >
      {/* Label */}
      <div className="flex items-center gap-2 text-sm font-medium flex-shrink-0">
        <FileText className="h-4 w-4" />
        <span>Active:</span>
      </div>

      {/* Context items */}
      <ScrollArea className="flex-1">
        <div className="flex gap-2">
          {contextItems.map((item) => (
            <Badge
              key={item.id}
              variant="secondary"
              className="flex items-center gap-1.5 pr-1"
            >
              <span className="text-xs">{item.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 rounded-sm hover:bg-muted"
                onClick={() => handleRemove(item.id)}
                aria-label={`Remove ${item.name}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      </ScrollArea>

      {/* Add button */}
      <Button
        variant="outline"
        size="sm"
        className="flex-shrink-0"
        onClick={handleAdd}
      >
        <Plus className="h-4 w-4 mr-2" />
        Add
      </Button>
    </div>
  );
}
