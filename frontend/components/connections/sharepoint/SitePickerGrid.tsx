'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Globe, Search, Loader2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { SharePointSite } from '@bc-agent/shared'

interface SitePickerGridProps {
  sites: SharePointSite[]
  selectedSiteIds: Set<string>
  onToggleSite: (siteId: string) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  isLoading: boolean
  onLoadMore: () => void
  hasMore: boolean
  isLoadingMore: boolean
}

export function SitePickerGrid({
  sites,
  selectedSiteIds,
  onToggleSite,
  searchQuery,
  onSearchChange,
  isLoading,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: SitePickerGridProps) {
  const [localQuery, setLocalQuery] = useState(searchQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearchChange(localQuery)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [localQuery, onSearchChange])

  const formatDate = useCallback((dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }, [])

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          placeholder="Search sites..."
          className="pl-9 h-9"
        />
      </div>

      {/* Site list */}
      <div className="min-h-[200px] max-h-[300px] overflow-y-auto border rounded-md">
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground gap-2">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Loading sites...</span>
          </div>
        ) : sites.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground">
            <span className="text-sm">
              {searchQuery ? 'No sites match your search' : 'No accessible sites found'}
            </span>
          </div>
        ) : (
          <div className="divide-y">
            {sites.map((site) => (
              <label
                key={site.siteId}
                className="flex items-start gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={selectedSiteIds.has(site.siteId)}
                  onCheckedChange={() => onToggleSite(site.siteId)}
                  className="mt-0.5"
                  aria-label={`Select ${site.displayName}`}
                />
                <Globe className="size-4 mt-0.5 shrink-0 text-[#038387]" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{site.displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{site.webUrl}</p>
                  {site.lastModifiedAt && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Last modified: {formatDate(site.lastModifiedAt)}
                    </p>
                  )}
                </div>
              </label>
            ))}

            {/* Load more button */}
            {hasMore && (
              <div className="p-3 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  className="text-xs"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="size-3 animate-spin mr-1.5" />
                      Loading...
                    </>
                  ) : (
                    'Load more sites...'
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selection count */}
      {selectedSiteIds.size > 0 && (
        <p className="text-xs text-muted-foreground">
          {selectedSiteIds.size} site{selectedSiteIds.size !== 1 ? 's' : ''} selected
          {selectedSiteIds.size > 10 && (
            <span className="text-amber-500 ml-1"> — syncing many sites may take a while</span>
          )}
        </p>
      )}
    </div>
  )
}
