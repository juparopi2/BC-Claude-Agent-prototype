'use client';

/**
 * File Table Column Definitions
 *
 * TanStack Table column definitions for the file data table.
 * Provides sortable, resizable columns for all file metadata fields.
 *
 * @module components/files/file-columns
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { ParsedFile } from '@bc-agent/shared';
import { Star, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FileIcon } from './FileIcon';
import { FileStatusIndicator } from './FileStatusIndicator';
import { formatFileSize, formatDate } from '@/src/domains/files/utils/fileFormatters';

/**
 * Get the display date for a file — fileModifiedAt if available, else createdAt
 */
function getDisplayDate(file: ParsedFile): string {
  return file.fileModifiedAt ?? file.createdAt;
}

export function createFileColumns(callbacks: {
  onFavoriteToggle: (fileId: string, currentIsFavorite: boolean) => void;
}): ColumnDef<ParsedFile>[] {
  return [
    // Favorite column
    {
      id: 'favorite',
      accessorFn: (row) => row.isFavorite,
      header: () => <Star className="size-4 text-muted-foreground" />,
      cell: ({ row }) => {
        const file = row.original;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              callbacks.onFavoriteToggle(file.id, file.isFavorite);
            }}
            className={cn(
              'p-1 rounded hover:bg-accent transition-colors',
              file.isFavorite ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
            )}
            aria-label={file.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={cn(
              'size-4',
              file.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
            )} />
          </button>
        );
      },
      size: 40,
      minSize: 40,
      maxSize: 40,
      enableSorting: false,
      enableHiding: false,
    },
    // Name column
    {
      id: 'name',
      accessorKey: 'name',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Name
          <ArrowUpDown className="ml-2 size-3.5" />
        </Button>
      ),
      cell: ({ row }) => {
        const file = row.original;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <FileIcon className="shrink-0" file={file} />
            {!file.isFolder && (
              <FileStatusIndicator
                fileId={file.id}
                readinessState={file.readinessState}
                compact
              />
            )}
            <span className="truncate text-sm">{file.name}</span>
          </div>
        );
      },
      size: 300,
      minSize: 100,
      enableHiding: false,
    },
    // Size column
    {
      id: 'size',
      accessorKey: 'sizeBytes',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Size
          <ArrowUpDown className="ml-2 size-3.5" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatFileSize(row.original.sizeBytes)}
        </span>
      ),
      size: 90,
      minSize: 70,
    },
    // Date Modified column (fileModifiedAt ?? createdAt)
    {
      id: 'dateModified',
      accessorFn: (row) => getDisplayDate(row),
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Date Modified
          <ArrowUpDown className="ml-2 size-3.5" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(getDisplayDate(row.original))}
        </span>
      ),
      sortingFn: (rowA, rowB) => {
        const a = new Date(getDisplayDate(rowA.original)).getTime();
        const b = new Date(getDisplayDate(rowB.original)).getTime();
        return a - b;
      },
      size: 130,
      minSize: 100,
    },
    // Date Uploaded column
    {
      id: 'dateUploaded',
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Date Uploaded
          <ArrowUpDown className="ml-2 size-3.5" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      ),
      size: 130,
      minSize: 100,
    },
    // Status column
    {
      id: 'status',
      accessorKey: 'readinessState',
      header: 'Status',
      cell: ({ row }) => {
        const file = row.original;
        if (file.isFolder) return null;
        return (
          <FileStatusIndicator
            fileId={file.id}
            readinessState={file.readinessState}
          />
        );
      },
      enableSorting: false,
      size: 90,
      minSize: 70,
    },
    // Type column
    {
      id: 'type',
      accessorKey: 'mimeType',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Type
          <ArrowUpDown className="ml-2 size-3.5" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground truncate">
          {row.original.mimeType}
        </span>
      ),
      size: 150,
      minSize: 100,
    },
  ];
}
