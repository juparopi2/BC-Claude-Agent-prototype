'use client';

import { useState } from 'react';
import { Globe, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RendererProps } from '../AgentResultRenderer/types';

const MAX_PREVIEW_LENGTH = 600;

interface WebFetchResult {
  type: string;
  url: string;
  content?: {
    type?: string;
    source?: {
      type?: string;
      media_type?: string;
      data?: string;
    };
    title?: string;
  };
  retrieved_at?: string;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function WebFetchRenderer({ data }: RendererProps) {
  const [expanded, setExpanded] = useState(false);
  const result = data as WebFetchResult;

  if (!result || !result.url) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        No page content available.
      </div>
    );
  }

  const title = result.content?.title || extractDomain(result.url);
  const domain = extractDomain(result.url);
  const textContent = result.content?.source?.type === 'text' ? result.content.source.data : null;
  const isLong = textContent ? textContent.length > MAX_PREVIEW_LENGTH : false;
  const displayContent = expanded || !isLong
    ? textContent
    : textContent?.slice(0, MAX_PREVIEW_LENGTH) + '...';

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800/50 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-950/40">
        <Globe className="size-4 text-indigo-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate text-foreground">{title}</p>
          <p className="text-[10px] text-muted-foreground truncate">{domain}</p>
        </div>
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="size-3.5 text-indigo-500" />
        </a>
      </div>

      {/* Content preview */}
      {textContent ? (
        <div className="px-3 py-2">
          <pre className={cn(
            'text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed',
            !expanded && isLong && 'max-h-40 overflow-hidden'
          )}>
            {displayContent}
          </pre>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp className="size-3" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="size-3" />
                  Show more
                </>
              )}
            </button>
          )}
        </div>
      ) : (
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground italic">
            Binary or non-text content
          </p>
        </div>
      )}

      {/* Footer */}
      {result.retrieved_at && (
        <div className="px-3 py-1.5 border-t border-indigo-100 dark:border-indigo-800/30 bg-muted/30">
          <p className="text-[10px] text-muted-foreground">
            Retrieved {formatTimestamp(result.retrieved_at)}
          </p>
        </div>
      )}
    </div>
  );
}
