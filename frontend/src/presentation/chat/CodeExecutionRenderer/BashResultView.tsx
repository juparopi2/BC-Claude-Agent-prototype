'use client';

import { useMemo } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSandboxFileDownload, useSandboxFileMetadata } from '@/src/domains/files';
import {
  getExtension,
  getFileIconType,
  FileIcon,
  fileTypeColors,
} from '../file-type-utils';

interface BashResult {
  type: string;
  stdout?: string;
  stderr?: string;
  return_code?: number;
  content?: Array<{ file_id?: string; type?: string }>;
}

interface BashResultViewProps {
  result: BashResult;
}

export function BashResultView({ result }: BashResultViewProps) {
  const returnCode = result.return_code ?? 0;
  const isSuccess = returnCode === 0;
  const generatedFiles = useMemo(
    () => result.content?.filter(c => c.file_id) ?? [],
    [result.content]
  );
  const { downloadSandboxFile, downloadingFileId, error, clearError } = useSandboxFileDownload();

  // Collect file IDs and fetch metadata for all generated files
  const fileIds = useMemo(
    () => generatedFiles.map(f => f.file_id!),
    [generatedFiles]
  );
  const { metadataMap, isLoading: isLoadingMetadata } = useSandboxFileMetadata(fileIds);

  return (
    <div className="space-y-2">
      {/* Return code indicator */}
      <div className="flex items-center gap-2">
        <span className={cn(
          'inline-block size-2 rounded-full',
          isSuccess ? 'bg-emerald-500' : 'bg-red-500'
        )} />
        <span className="text-xs font-mono text-muted-foreground">
          exit code {returnCode}
        </span>
      </div>

      {/* stdout */}
      {result.stdout && (
        <div className="rounded-md bg-zinc-900 dark:bg-zinc-950 border border-zinc-700 overflow-hidden">
          <div className="px-2.5 py-1 border-b border-zinc-700 bg-zinc-800">
            <span className="text-[10px] font-mono text-zinc-400">stdout</span>
          </div>
          <pre className="px-3 py-2 text-xs font-mono text-emerald-400 whitespace-pre-wrap break-words max-h-64 overflow-auto">
            {result.stdout}
          </pre>
        </div>
      )}

      {/* stderr */}
      {result.stderr && result.stderr.trim() && (
        <div className="rounded-md bg-red-950/50 dark:bg-red-950/30 border border-red-800/50 overflow-hidden">
          <div className="px-2.5 py-1 border-b border-red-800/50 bg-red-900/30">
            <span className="text-[10px] font-mono text-red-400">stderr</span>
          </div>
          <pre className="px-3 py-2 text-xs font-mono text-red-300 whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {result.stderr}
          </pre>
        </div>
      )}

      {/* Generated files */}
      {generatedFiles.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {generatedFiles.map((file, i) => {
            const fileId = file.file_id!;
            const isDownloading = downloadingFileId === fileId;
            const metadata = metadataMap.get(fileId);
            const isMetadataLoading = isLoadingMetadata && !metadata;

            // Derive icon type and colors from metadata if available
            const fileName = metadata?.filename ?? fileId;
            const mimeType = metadata?.mimeType;
            const iconType = metadata
              ? getFileIconType(fileName, mimeType)
              : 'file';
            const colorConfig = fileTypeColors[iconType];
            const ext = metadata ? getExtension(fileName).toUpperCase() : null;

            return (
              <button
                key={fileId ?? i}
                onClick={() => {
                  clearError();
                  downloadSandboxFile(fileId);
                }}
                disabled={isDownloading}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors w-full',
                  'border',
                  colorConfig
                    ? `${colorConfig.bg} border-current/10`
                    : 'bg-muted/50 border-border',
                  'hover:brightness-95 dark:hover:brightness-110',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  'disabled:opacity-60 disabled:cursor-wait',
                  'cursor-pointer'
                )}
              >
                {/* File type icon */}
                <div className={cn(
                  'flex shrink-0 items-center justify-center size-8 rounded-md',
                  colorConfig?.bg ?? 'bg-muted'
                )}>
                  <FileIcon iconType={iconType} className={cn(
                    'size-4',
                    colorConfig?.icon ?? 'text-muted-foreground'
                  )} />
                </div>

                {/* Filename + extension badge */}
                <div className="flex-1 min-w-0">
                  {isMetadataLoading ? (
                    <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                  ) : (
                    <span className="text-xs font-medium truncate block text-foreground">
                      {metadata?.filename ?? `file:${fileId.slice(0, 12)}...`}
                    </span>
                  )}
                  {ext && (
                    <span className={cn(
                      'text-[10px] font-mono font-semibold uppercase',
                      colorConfig?.icon ?? 'text-muted-foreground'
                    )}>
                      {ext}
                    </span>
                  )}
                </div>

                {/* Download icon */}
                <div className="shrink-0">
                  {isDownloading ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Download className="size-4 text-muted-foreground" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Download error */}
      {error && (
        <p className="text-[10px] text-red-500 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
