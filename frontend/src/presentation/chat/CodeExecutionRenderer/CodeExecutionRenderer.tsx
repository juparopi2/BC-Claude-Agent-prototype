'use client';

import type { RendererProps } from '../AgentResultRenderer/types';
import { BashResultView } from './BashResultView';
import { TextEditorResultView } from './TextEditorResultView';

interface CodeExecutionResult {
  type?: string;
  [key: string]: unknown;
}

export function CodeExecutionRenderer({ data }: RendererProps) {
  const result = data as CodeExecutionResult;

  if (!result || typeof result !== 'object') {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        No execution result available.
      </div>
    );
  }

  if (result.type === 'bash_code_execution_result') {
    return <BashResultView result={result as Parameters<typeof BashResultView>[0]['result']} />;
  }

  if (result.type === 'text_editor_code_execution_result') {
    return <TextEditorResultView result={result as Parameters<typeof TextEditorResultView>[0]['result']} />;
  }

  // Fallback: try to detect from shape
  if ('stdout' in result || 'return_code' in result) {
    return <BashResultView result={result as Parameters<typeof BashResultView>[0]['result']} />;
  }

  if ('lines' in result || 'is_file_update' in result || 'file_type' in result) {
    return <TextEditorResultView result={result as Parameters<typeof TextEditorResultView>[0]['result']} />;
  }

  return (
    <div className="p-3 text-sm text-muted-foreground">
      Unknown code execution result format.
    </div>
  );
}
