'use client';

import { Suspense, createElement, useMemo, type ReactNode } from 'react';
import { isAgentRenderedResult } from '@bc-agent/shared';
import { getRenderer } from './rendererRegistry';

interface AgentResultRendererProps {
  /** The tool result to render */
  result: unknown;
  /** Fallback component when no renderer matches */
  fallback: ReactNode;
}

/**
 * Routes tool results to specialized renderers based on `_type` field.
 * Falls back to provided fallback (typically JsonView) for unknown types.
 */
export function AgentResultRenderer({ result, fallback }: AgentResultRendererProps) {
  const resultType = isAgentRenderedResult(result) ? result._type : null;

  const rendererElement = useMemo(() => {
    if (!resultType) return null;
    const Renderer = getRenderer(resultType);
    if (!Renderer) return null;
    return createElement(Renderer, { data: result });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- result identity is tied to resultType
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
