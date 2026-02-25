'use client';

import { FileCheck, FileText, FileDiff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TextEditorResult {
  type: string;
  // View result fields
  file_type?: string;
  content?: string;
  numLines?: number;
  startLine?: number;
  totalLines?: number;
  // Create result fields
  is_file_update?: boolean;
  // str_replace result fields
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  lines?: string[];
}

interface TextEditorResultViewProps {
  result: TextEditorResult;
}

function detectResultKind(result: TextEditorResult): 'view' | 'create' | 'edit' {
  if (result.lines && Array.isArray(result.lines)) return 'edit';
  if (result.is_file_update === false && !result.content) return 'create';
  return 'view';
}

export function TextEditorResultView({ result }: TextEditorResultViewProps) {
  const kind = detectResultKind(result);

  if (kind === 'create') {
    return (
      <div className="flex items-center gap-2 py-1">
        <FileCheck className="size-4 text-emerald-500" />
        <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
          File created successfully
        </span>
      </div>
    );
  }

  if (kind === 'edit' && result.lines) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <FileDiff className="size-4 text-indigo-500" />
          <span className="text-xs text-muted-foreground font-mono">
            Lines {result.oldStart}–{(result.oldStart ?? 0) + (result.oldLines ?? 0) - 1}
          </span>
        </div>
        <div className="rounded-md bg-zinc-900 dark:bg-zinc-950 border border-zinc-700 overflow-hidden">
          <pre className="px-3 py-2 text-xs font-mono max-h-48 overflow-auto">
            {result.lines.map((line, i) => {
              const isRemoved = line.startsWith('-');
              const isAdded = line.startsWith('+');
              return (
                <div
                  key={i}
                  className={cn(
                    isRemoved && 'text-red-400 bg-red-950/30',
                    isAdded && 'text-emerald-400 bg-emerald-950/30',
                    !isRemoved && !isAdded && 'text-zinc-400'
                  )}
                >
                  {line}
                </div>
              );
            })}
          </pre>
        </div>
      </div>
    );
  }

  // View result
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-indigo-500" />
        <span className="text-xs text-muted-foreground">
          {result.file_type ?? 'text'}
          {result.totalLines != null && ` · ${result.totalLines} lines`}
          {result.startLine != null && result.numLines != null && (
            <> · showing lines {result.startLine}–{result.startLine + result.numLines - 1}</>
          )}
        </span>
      </div>
      {result.content && (
        <div className="rounded-md bg-zinc-900 dark:bg-zinc-950 border border-zinc-700 overflow-hidden">
          <pre className="px-3 py-2 text-xs font-mono text-zinc-300 whitespace-pre-wrap break-words max-h-48 overflow-auto">
            {result.content}
          </pre>
        </div>
      )}
    </div>
  );
}
