'use client';

/**
 * MentionAutocomplete Component
 *
 * Floating dropdown for @mention file autocomplete in chat input.
 * Shows files/folders matching the query typed after @.
 *
 * @module presentation/chat/MentionAutocomplete
 */

import { useRef, useEffect } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { FILE_SOURCE_TYPE, MENTION_MIME_TYPE } from '@bc-agent/shared';
import { useFileMentionSearch } from '@/src/domains/files';
import { getFileSourceUI } from '@/src/domains/files/utils/fileSourceUI';
import { FileText, Folder, Globe, Image, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MentionAutocompleteProps {
  /** Text typed after @ */
  query: string;
  /** Whether the autocomplete is visible */
  isOpen: boolean;
  /** Called when user selects a file */
  onSelect: (file: ParsedFile) => void;
  /** Called when autocomplete should close */
  onClose: () => void;
  /** Currently highlighted index (keyboard nav) */
  highlightedIndex: number;
  /** Set highlighted index */
  onHighlightChange: (index: number) => void;
  /** Ref to expose current results to parent for keyboard selection */
  resultsRef?: React.MutableRefObject<ParsedFile[]>;
}

/**
 * Get icon for file type with source overlay (OneDrive/SharePoint badge)
 */
function getFileIcon(file: ParsedFile) {
  // Site results use the Globe icon with no overlay
  if (file.mimeType === MENTION_MIME_TYPE.SITE) {
    return (
      <span className="relative inline-flex flex-shrink-0">
        <Globe className="size-4 text-teal-600" />
      </span>
    );
  }

  const sourceUI = getFileSourceUI(file.sourceType);
  const baseIcon = file.isFolder
    ? <Folder className="size-4 text-amber-500" />
    : file.mimeType?.startsWith('image/')
      ? <Image className="size-4 text-purple-500" />
      : <FileText className="size-4 text-blue-500" />;

  return (
    <span className="relative inline-flex flex-shrink-0">
      {baseIcon}
      {file.sourceType !== FILE_SOURCE_TYPE.LOCAL && sourceUI.accentColor && (
        <sourceUI.Icon className="absolute -bottom-0.5 -right-1 size-2.5" />
      )}
    </span>
  );
}

export function MentionAutocomplete({
  query,
  isOpen,
  onSelect,
  onClose,
  highlightedIndex,
  onHighlightChange,
  resultsRef,
}: MentionAutocompleteProps) {
  const { results, isSearching } = useFileMentionSearch(query);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync results to parent ref for keyboard Enter selection
  useEffect(() => {
    if (resultsRef) resultsRef.current = results;
  }, [results, resultsRef]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll('[data-mention-item]');
      items[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const showLoading = isSearching && results.length === 0;
  const showEmpty = !isSearching && results.length === 0 && query.length > 0;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-[240px] overflow-y-auto"
      role="listbox"
    >
      {showLoading && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Searching...</span>
        </div>
      )}

      {showEmpty && (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No files found
        </div>
      )}

      {results.map((file, index) => (
        <div
          key={file.id}
          data-mention-item
          role="option"
          aria-selected={index === highlightedIndex}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer',
            'hover:bg-accent hover:text-accent-foreground',
            index === highlightedIndex && 'bg-accent text-accent-foreground'
          )}
          onClick={() => onSelect(file)}
          onMouseEnter={() => onHighlightChange(index)}
        >
          {getFileIcon(file)}
          <span className="truncate flex-1">{file.name}</span>
          {file.mimeType === MENTION_MIME_TYPE.SITE ? (
            <span className="text-xs text-teal-600 ml-1">SharePoint site</span>
          ) : file.sourceType !== FILE_SOURCE_TYPE.LOCAL ? (
            <span
              className="text-xs ml-1"
              style={{ color: getFileSourceUI(file.sourceType).accentColor }}
            >
              {getFileSourceUI(file.sourceType).displayName}
            </span>
          ) : (
            <>
              {file.isFolder && (
                <span className="text-xs text-muted-foreground ml-1">folder</span>
              )}
              {file.mimeType?.startsWith('image/') && (
                <span className="text-xs text-muted-foreground ml-1">image</span>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
