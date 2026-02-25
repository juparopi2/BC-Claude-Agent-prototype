'use client';

import { Suspense, createElement, useMemo, type ReactNode } from 'react';
import { isAgentRenderedResult, detectServerToolResultType } from '@bc-agent/shared';
import { getRenderer } from './rendererRegistry';

interface AgentResultRendererProps {
  /** The tool result to render */
  result: unknown;
  /** Tool name for server tool result type detection */
  toolName?: string;
  /** Fallback component when no renderer matches */
  fallback: ReactNode;
}

/**
 * Routes tool results to specialized renderers based on `_type` field.
 * For server tools (web_search, web_fetch, code_execution), falls back to
 * toolName-based detection when `_type` is absent.
 * Falls back to provided fallback (typically JsonView) for unknown types.
 */
export function AgentResultRenderer({ result, toolName, fallback }: AgentResultRendererProps) {
  // Parse JSON strings — tool results arrive as strings via WebSocket
  // but as objects on page reload (messageTransformer parses them)
  const parsedResult = useMemo(() => {
    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch { /* not valid JSON, fall through */ }
    }
    return result;
  }, [result]);

  // Detect result type: first try _type discriminator, then server tool detection
  const resultType = useMemo(() => {
    if (isAgentRenderedResult(parsedResult)) return parsedResult._type;
    return detectServerToolResultType(toolName, parsedResult);
  }, [parsedResult, toolName]);

  const rendererElement = useMemo(() => {
    if (!resultType) return null;
    const Renderer = getRenderer(resultType);
    if (!Renderer) return null;
    return createElement(Renderer, { data: parsedResult });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- parsedResult identity is tied to resultType
  }, [resultType]);

  if (!rendererElement) {
    return <>{fallback}</>;
  }

  return (
    <Suspense fallback={<div className="animate-pulse h-32 bg-muted rounded-lg" />}>
      {rendererElement}
    </Suspense>
  );
}
