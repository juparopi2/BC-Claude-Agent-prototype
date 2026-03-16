'use client';

/**
 * FileDataTable Component
 *
 * TanStack Table-based data table for file management.
 * Supports column resizing, sorting, visibility toggling, column reordering (dnd-kit),
 * row selection, keyboard navigation, context menus, and file preview.
 *
 * @module components/files/FileDataTable
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type Row,
  type Cell,
  type Header,
} from '@tanstack/react-table';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import type { ParsedFile } from '@bc-agent/shared';
import { FILE_SOURCE_TYPE, PROVIDER_ID } from '@bc-agent/shared';
import { Folder, Upload, GripVertical } from 'lucide-react';
import { OneDriveLogo, SharePointLogo } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useIntegrationListStore } from '@/src/domains/integrations';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { FileContextMenu } from './FileContextMenu';
import { MultiFileContextMenu } from './MultiFileContextMenu';
import { FilePreviewModal } from './modals/FilePreviewModal';
import { createFileColumns } from './file-columns';
import { useFiles, useFileSelection, useFolderNavigation, useFilePreviewStore, type FolderPreviewItem } from '@/src/domains/files';
import { useFileListStore } from '@/src/domains/files/stores/fileListStore';
import { useSelectionStore } from '@/src/domains/files/stores/selectionStore';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { triggerDownload } from '@/lib/download';
import { toast } from 'sonner';


function isPreviewableFile(mimeType: string): boolean {
  if (mimeType === 'application/pdf') return true;
  if (mimeType.startsWith('image/')) return true;
  const textTypes = [
    'text/plain', 'text/javascript', 'text/typescript', 'text/css',
    'text/html', 'text/xml', 'text/markdown', 'text/csv',
    'application/json', 'application/javascript', 'application/xml',
  ];
  return textTypes.includes(mimeType) || mimeType.startsWith('text/');
}

// ─── Draggable Header Cell ───────────────────────────────────────────────────

function DraggableHeader({ header }: { header: Header<ParsedFile, unknown> }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: header.column.id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    width: header.getSize(),
    maxWidth: header.getSize(),
    overflow: 'hidden',
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <TableHead
      ref={setNodeRef}
      style={style}
      className="relative select-none"
      colSpan={header.colSpan}
    >
      <div className="flex items-center">
        {/* Drag handle */}
        <button
          className="mr-1 cursor-grab opacity-0 group-hover/header:opacity-50 hover:!opacity-100 touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3" />
        </button>
        {/* Header content */}
        {header.isPlaceholder
          ? null
          : flexRender(header.column.columnDef.header, header.getContext())}
      </div>
      {/* Resize handle */}
      {header.column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onDoubleClick={() => header.column.resetSize()}
          className={cn(
            'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
            'hover:bg-primary/50',
            header.column.getIsResizing() && 'bg-primary'
          )}
        />
      )}
    </TableHead>
  );
}

// ─── Drag-along Cell (mirrors column reordering) ─────────────────────────────

function DragAlongCell({ cell }: { cell: Cell<ParsedFile, unknown> }) {
  const { isDragging, setNodeRef, transform } = useSortable({
    id: cell.column.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    width: cell.column.getSize(),
    maxWidth: cell.column.getSize(),
    overflow: 'hidden',
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <TableCell ref={setNodeRef} style={style}>
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </TableCell>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function FileDataTable() {
  const { sortedFiles: files, isLoading, toggleFavorite } = useFiles();
  const { selectedFileIds, selectFile, selectAll } = useFileSelection();
  const { navigateToFolder } = useFolderNavigation();

  const deletingFileIds = useFileListStore((state) => state.deletingFileIds);
  const focusedFileId = useSelectionStore((state) => state.focusedFileId);
  const moveFocus = useSelectionStore((state) => state.moveFocus);
  const extendSelection = useSelectionStore((state) => state.extendSelection);

  // OneDrive empty state detection
  const sourceTypeFilter = useSortFilterStore((s) => s.sourceTypeFilter);
  const openWizard = useIntegrationListStore((s) => s.openWizard);

  // Table preferences from store
  const columnVisibility = useSortFilterStore((s) => s.columnVisibility);
  const columnOrder = useSortFilterStore((s) => s.columnOrder);
  const columnSizing = useSortFilterStore((s) => s.columnSizing);
  const setColumnVisibility = useSortFilterStore((s) => s.setColumnVisibility);
  const setColumnOrder = useSortFilterStore((s) => s.setColumnOrder);
  const setColumnSizing = useSortFilterStore((s) => s.setColumnSizing);

  // File preview store
  const openFolderPreview = useFilePreviewStore((s) => s.openFolderPreview);
  const previewIsOpen = useFilePreviewStore((s) => s.isOpen);
  const isFolderNav = useFilePreviewStore((s) => s.isFolderNavigationMode);
  const previewFileId = useFilePreviewStore((s) => s.fileId);
  const previewFileName = useFilePreviewStore((s) => s.fileName);
  const previewMimeType = useFilePreviewStore((s) => s.mimeType);
  const previewIndex = useFilePreviewStore((s) => s.currentIndex);
  const previewNavMode = useFilePreviewStore((s) => s.isNavigationMode);
  const folderFiles = useFilePreviewStore((s) => s.folderFiles);
  const closePreview = useFilePreviewStore((s) => s.closePreview);
  const navigateNextPreview = useFilePreviewStore((s) => s.navigateNext);
  const navigatePrevPreview = useFilePreviewStore((s) => s.navigatePrev);

  // Local sorting state (TanStack sorts client-side; backend sort is separate)
  const [sorting, setSorting] = useState<SortingState>([]);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleFavoriteToggle = useCallback((fileId: string, currentIsFavorite: boolean) => {
    toggleFavorite(fileId, currentIsFavorite);
  }, [toggleFavorite]);

  // Create columns with stable reference
  const columns = useMemo(
    () => createFileColumns({ onFavoriteToggle: handleFavoriteToggle }),
    [handleFavoriteToggle]
  );

  const table = useReactTable({
    data: files,
    columns,
    state: {
      sorting,
      columnVisibility,
      columnOrder,
      columnSizing,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnVisibility) : updater;
      setColumnVisibility(next);
    },
    onColumnOrderChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnOrder) : updater;
      setColumnOrder(next);
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnSizing) : updater;
      setColumnSizing(next);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    getRowId: (row) => row.id,
  });

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (active && over && active.id !== over.id) {
        const oldIndex = columnOrder.indexOf(active.id as string);
        const newIndex = columnOrder.indexOf(over.id as string);
        if (oldIndex !== -1 && newIndex !== -1) {
          setColumnOrder(arrayMove(columnOrder, oldIndex, newIndex));
        }
      }
    },
    [columnOrder, setColumnOrder]
  );

  // File actions
  const handleSelect = useCallback(
    (fileId: string, multi: boolean) => {
      selectFile(fileId, multi);
    },
    [selectFile]
  );

  const handleRowClick = useCallback(
    (file: ParsedFile, e: React.MouseEvent) => {
      const normalizedId = file.id.toUpperCase();
      if (deletingFileIds.has(normalizedId)) return;
      handleSelect(file.id, e.ctrlKey || e.metaKey);
    },
    [handleSelect, deletingFileIds]
  );

  // Compute previewable sibling files for folder navigation
  const previewableFiles: FolderPreviewItem[] = useMemo(
    () =>
      files
        .filter((f) => !f.isFolder && isPreviewableFile(f.mimeType))
        .map((f) => ({ fileId: f.id, fileName: f.name, mimeType: f.mimeType })),
    [files]
  );

  const handleDoubleClick = useCallback(
    async (file: ParsedFile) => {
      if (file.isFolder) {
        navigateToFolder(file.id, file);
        return;
      }
      // OneDrive files open in OneDrive's web viewer (PRD-107)
      if (file.sourceType === FILE_SOURCE_TYPE.ONEDRIVE && file.externalUrl) {
        window.open(file.externalUrl, '_blank');
        return;
      }
      if (isPreviewableFile(file.mimeType)) {
        const startIndex = previewableFiles.findIndex((f) => f.fileId === file.id);
        openFolderPreview(previewableFiles, Math.max(0, startIndex));
        return;
      }
      try {
        const fileApi = getFileApiClient();
        toast.message('Downloading file', { description: `Downloading ${file.name}...` });
        const response = await fileApi.downloadFile(file.id);
        if (response.success) {
          triggerDownload(response.data, file.name);
          toast.success('Download started', { description: `${file.name} is downloading.` });
        } else {
          toast.error('Download failed', { description: response.error.message || 'Could not download file' });
        }
      } catch {
        toast.error('Download failed', { description: 'An unexpected error occurred' });
      }
    },
    [navigateToFolder, previewableFiles, openFolderPreview]
  );

  // Keyboard navigation
  const allFileIds = files.map((f) => f.id);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !containerRef.current?.contains(document.activeElement) &&
        document.activeElement !== containerRef.current
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const direction = e.key === 'ArrowUp' ? 'up' : 'down';
        if (e.shiftKey) {
          extendSelection(direction, allFileIds);
        } else {
          moveFocus(direction, allFileIds);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [allFileIds, selectAll, moveFocus, extendSelection]);

  // Loading state
  if (isLoading) {
    return (
      <div className="p-2 space-y-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (files.length === 0) {
    // OneDrive empty state — prompt to configure sync
    if (sourceTypeFilter === FILE_SOURCE_TYPE.ONEDRIVE) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg px-8 py-12 w-full max-w-md flex flex-col items-center">
            <OneDriveLogo className="size-16 mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground/80 mb-1">No synced files</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Configure which OneDrive folders to sync
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openWizard(PROVIDER_ID.ONEDRIVE)}
            >
              Configure Sync
            </Button>
          </div>
        </div>
      );
    }

    // SharePoint empty state — prompt to configure sync
    if (sourceTypeFilter === FILE_SOURCE_TYPE.SHAREPOINT) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg px-8 py-12 w-full max-w-md flex flex-col items-center">
            <SharePointLogo className="size-16 mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground/80 mb-1">No synced files</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Configure which SharePoint libraries to sync
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openWizard(PROVIDER_ID.SHAREPOINT)}
            >
              Configure Sync
            </Button>
          </div>
        </div>
      );
    }

    // Local empty state — prompt to upload
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg px-8 py-12 w-full max-w-md flex flex-col items-center">
          <Folder className="size-16 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium text-foreground/80 mb-1">No files yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Drop files here or click upload to get started
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Upload className="size-4" />
            <span>Drag and drop to upload</span>
          </div>
        </div>
      </div>
    );
  }

  const selectedFiles = files.filter((f) => selectedFileIds.has(f.id));
  const hasMultipleSelected = selectedFiles.length > 1;

  const renderRow = (row: Row<ParsedFile>) => {
    const file = row.original;
    const normalizedId = file.id.toUpperCase();
    const isSelected = selectedFileIds.has(file.id);
    const isDeleting = deletingFileIds.has(normalizedId);
    const isFocused = focusedFileId === file.id;

    const rowContent = (
      <TableRow
        key={row.id}
        data-state={isSelected ? 'selected' : undefined}
        className={cn(
          'group/row cursor-pointer',
          isFocused && 'ring-2 ring-primary ring-offset-1',
          isDeleting && 'opacity-50 pointer-events-none'
        )}
        onClick={(e) => handleRowClick(file, e)}
        onDoubleClick={() => handleDoubleClick(file)}
        draggable
        onDragStart={(e) => {
          const filesToDrag = (isSelected && hasMultipleSelected)
            ? selectedFiles
            : [file];

          const mentions = filesToDrag.map(f => ({
            fileId: f.id,
            name: f.name,
            isFolder: f.isFolder,
            mimeType: f.mimeType || '',
          }));

          e.dataTransfer.setData(
            'application/x-file-mention',
            JSON.stringify(mentions)
          );
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        {row.getVisibleCells().map((cell) => (
          <DragAlongCell key={cell.id} cell={cell} />
        ))}
      </TableRow>
    );

    if (isSelected && hasMultipleSelected) {
      return (
        <MultiFileContextMenu key={row.id} files={selectedFiles}>
          {rowContent}
        </MultiFileContextMenu>
      );
    }
    return (
      <FileContextMenu key={row.id} file={file}>
        {rowContent}
      </FileContextMenu>
    );
  };

  return (
    <>
      <div ref={containerRef} tabIndex={0} className="outline-none h-full min-h-0 flex flex-col">
        {/* Table */}
        <ScrollArea
          className={cn(
            "flex-1 min-h-0",
            "[&_[data-slot=table-container]]:overflow-visible",
            "[&_[data-slot=scroll-area-thumb]]:bg-foreground/20",
            "[&_[data-slot=scroll-area-scrollbar]:hover_[data-slot=scroll-area-thumb]]:bg-foreground/40"
          )}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis]}
            onDragEnd={handleDragEnd}
          >
            <Table style={{ width: table.getTotalSize(), tableLayout: 'fixed' }}>
              <TableHeader className="group/header sticky top-0 bg-background z-10">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    <SortableContext
                      items={columnOrder}
                      strategy={horizontalListSortingStrategy}
                    >
                      {headerGroup.headers.map((header) => (
                        <DraggableHeader key={header.id} header={header} />
                      ))}
                    </SortableContext>
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => renderRow(row))}
              </TableBody>
            </Table>
          </DndContext>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {previewIsOpen && isFolderNav && previewFileId && previewFileName && previewMimeType && (
        <FilePreviewModal
          isOpen={previewIsOpen}
          onClose={closePreview}
          fileId={previewFileId}
          fileName={previewFileName}
          mimeType={previewMimeType}
          hasNavigation={previewNavMode}
          canGoPrev={previewIndex > 0}
          canGoNext={previewIndex < folderFiles.length - 1}
          onNavigatePrev={navigatePrevPreview}
          onNavigateNext={navigateNextPreview}
          currentPosition={previewIndex + 1}
          totalItems={folderFiles.length}
        />
      )}
    </>
  );
}
