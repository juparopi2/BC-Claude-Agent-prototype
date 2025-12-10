'use client';

import { useCallback } from 'react';
import type { FileSortBy } from '@bc-agent/shared';
import { ArrowUpDown, ArrowUp, ArrowDown, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useFileStore } from '@/lib/stores/fileStore';

const SORT_OPTIONS: { value: FileSortBy; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Date modified' },
  { value: 'size', label: 'Size' },
];

export function FileSortControls({ isCompact = false }: { isCompact?: boolean }) {
  const sortBy = useFileStore(state => state.sortBy);
  const sortOrder = useFileStore(state => state.sortOrder);
  const { setSort, toggleSortOrder } = useFileStore();

  const handleSortChange = useCallback((newSortBy: FileSortBy) => {
    setSort(newSortBy);
  }, [setSort]);

  const currentLabel = SORT_OPTIONS.find(o => o.value === sortBy)?.label || 'Sort';

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1">
            <ArrowUpDown className="size-4" />
            {!isCompact && <span className="hidden sm:inline">{currentLabel}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {SORT_OPTIONS.map(option => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => handleSortChange(option.value)}
              className="flex items-center justify-between"
            >
              {option.label}
              {sortBy === option.value && (
                <Check className="size-4 ml-2" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={toggleSortOrder}
            className="flex items-center justify-between"
          >
            {sortOrder === 'asc' ? 'Ascending' : 'Descending'}
            {sortOrder === 'asc' ? (
              <ArrowUp className="size-4 ml-2" />
            ) : (
              <ArrowDown className="size-4 ml-2" />
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
