'use client';

import { useState } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchResult {
  type: string;
  url: string;
  title: string;
  encrypted_content?: string;
  page_age?: string;
}

interface SearchResultCardProps {
  result: SearchResult;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export function SearchResultCard({ result }: SearchResultCardProps) {
  const domain = extractDomain(result.url);
  const [faviconError, setFaviconError] = useState(false);

  return (
    <div className="flex items-start gap-2.5 py-2 px-1">
      {faviconError ? (
        <Globe className="size-4 shrink-0 mt-0.5 text-indigo-500" />
      ) : (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
          alt=""
          width={16}
          height={16}
          className="size-4 shrink-0 mt-0.5"
          onError={() => setFaviconError(true)}
        />
      )}
      <div className="min-w-0 flex-1">
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'text-sm font-medium leading-tight line-clamp-2',
            'text-foreground hover:text-indigo-600 dark:hover:text-indigo-400',
            'hover:underline transition-colors'
          )}
        >
          {result.title || result.url}
        </a>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">{domain}</span>
          {result.page_age && (
            <span className="text-[10px] text-muted-foreground/70 shrink-0">
              {result.page_age}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
