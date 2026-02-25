'use client';

import { FileOutput } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const generatedFiles = result.content?.filter(c => c.file_id) ?? [];

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
        <div className="flex flex-wrap gap-1.5">
          {generatedFiles.map((file, i) => (
            <span
              key={file.file_id ?? i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-[10px] font-mono text-indigo-700 dark:text-indigo-300"
            >
              <FileOutput className="size-3" />
              {file.file_id ? `file:${file.file_id.slice(0, 8)}...` : 'generated file'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
