'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Globe,
  Check,
  Loader2,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Folder,
  FolderOpen,
  AlertTriangle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import type {
  ExternalFileItem,
  FolderListResult,
  ConnectionScopeWithStats,
  ScopeBatchResult,
  SharePointSite,
  SharePointLibrary,
  SharePointSiteListResult,
  SharePointLibraryListResult,
} from '@bc-agent/shared'
import { CONNECTIONS_API, AGENT_DISPLAY_NAME, AGENT_ID, CONNECTION_STATUS } from '@bc-agent/shared'
import { env } from '@/lib/config/env'
import { useIntegrationListStore } from '@/src/domains/integrations'
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore'
import { toast } from 'sonner'
import type { TreeNodeData, SelectedScope, SyncState, ScopeProgressEntry, AuthInitiateResponse, SyncStatusResponse } from './wizard-utils'
import { findNode, sortItems, formatFileSize } from './wizard-utils'
import { SitePickerGrid } from './sharepoint/SitePickerGrid'

// ============================================
// Types
// ============================================

interface SharePointWizardProps {
  isOpen: boolean
  onClose: () => void
  initialConnectionId?: string | null
}

type SPWizardStep = 'connect' | 'sites' | 'libraries' | 'sync'

interface LibraryWithState extends SharePointLibrary {
  isSelected: boolean
  folders: TreeNodeData[] | null
  isExpanded: boolean
  isFoldersLoading: boolean
}

interface SiteLibraries {
  site: SharePointSite
  libraries: LibraryWithState[]
  isLoading: boolean
  isLoaded: boolean
}

// ============================================
// Library Folder TreeNode (for subfolder selection within libraries)
// ============================================

interface LibFolderNodeProps {
  node: TreeNodeData
  depth: number
  selectedFolders: Set<string>
  onToggleFolder: (folderId: string, folderName: string, folderPath: string | null) => void
  onToggleExpand: (nodeId: string) => void
}

function LibFolderNode({ node, depth, selectedFolders, onToggleFolder, onToggleExpand }: LibFolderNodeProps) {
  const { item } = node

  if (!item.isFolder) return null

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 pr-2 rounded-md hover:bg-muted/50 cursor-pointer select-none"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <button
          type="button"
          className="size-4 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(item.id) }}
          aria-label={node.isExpanded ? 'Collapse folder' : 'Expand folder'}
        >
          {node.isLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : node.isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>

        <Checkbox
          checked={selectedFolders.has(item.id)}
          onCheckedChange={() => onToggleFolder(item.id, item.name, item.parentPath ?? null)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${item.name}`}
        />

        {node.isExpanded ? (
          <FolderOpen className="size-4 shrink-0 text-blue-500" />
        ) : (
          <Folder className="size-4 shrink-0 text-muted-foreground" />
        )}

        <span className="text-sm truncate flex-1" onClick={() => onToggleExpand(item.id)}>
          {item.name}
        </span>
      </div>

      {node.isExpanded && node.children && (
        <div>
          {node.children.filter(c => c.item.isFolder).map(child => (
            <LibFolderNode
              key={child.item.id}
              node={child}
              depth={depth + 1}
              selectedFolders={selectedFolders}
              onToggleFolder={onToggleFolder}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================
// Main SharePointWizard Component
// ============================================

export function SharePointWizard({ isOpen, onClose, initialConnectionId }: SharePointWizardProps) {
  const fetchConnections = useIntegrationListStore((s) => s.fetchConnections)

  // Step state
  const [step, setStep] = useState<SPWizardStep>('connect')

  // Step 1: Connect
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionId, setConnectionId] = useState<string | null>(initialConnectionId ?? null)

  // Step 2: Sites
  const [sites, setSites] = useState<SharePointSite[]>([])
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<string>>(new Set())
  const [isSitesLoading, setIsSitesLoading] = useState(false)
  const [siteSearchQuery, setSiteSearchQuery] = useState('')
  const [siteNextPageToken, setSiteNextPageToken] = useState<string | null>(null)
  const [isSitesLoadingMore, setIsSitesLoadingMore] = useState(false)

  // Step 3: Libraries
  const [siteLibraries, setSiteLibraries] = useState<Map<string, SiteLibraries>>(new Map())
  const [selectedLibraries, setSelectedLibraries] = useState<Set<string>>(new Set())
  const [selectedFolders, setSelectedFolders] = useState<Map<string, { name: string; path: string | null; driveId: string; siteId: string; siteName: string; libraryName: string }>>(new Map())

  // Step 3: Existing scopes (for reconfigure)
  const [existingScopes, setExistingScopes] = useState<ConnectionScopeWithStats[]>([])

  // Step 4: Sync
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [scopeProgress, setScopeProgress] = useState<Map<string, ScopeProgressEntry>>(new Map())
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  const resetWizard = useCallback(() => {
    setStep('connect')
    setIsConnecting(false)
    setConnectionId(null)
    setSites([])
    setSelectedSiteIds(new Set())
    setIsSitesLoading(false)
    setSiteSearchQuery('')
    setSiteNextPageToken(null)
    setIsSitesLoadingMore(false)
    setSiteLibraries(new Map())
    setSelectedLibraries(new Set())
    setSelectedFolders(new Map())
    setExistingScopes([])
    setSyncState('idle')
    setSyncError(null)
    setScopeProgress(new Map())
    stopPolling()
  }, [stopPolling])

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(resetWizard, 300)
      return () => clearTimeout(t)
    }
  }, [isOpen, resetWizard])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // Skip to sites step if initialConnectionId is provided (post-OAuth)
  useEffect(() => {
    if (initialConnectionId) {
      setConnectionId(initialConnectionId)
      const connection = useIntegrationListStore.getState().connections.find(
        (c) => c.id === initialConnectionId
      )
      if (connection?.status === CONNECTION_STATUS.EXPIRED) {
        setStep('connect')
      } else {
        setStep('sites')
      }
    }
  }, [initialConnectionId])

  // ============================================
  // Step 1: Initiate SharePoint OAuth
  // ============================================

  const handleConnect = useCallback(async () => {
    setIsConnecting(true)
    try {
      const response = await fetch(
        `${env.apiUrl}${CONNECTIONS_API.BASE}/sharepoint/auth/initiate`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      )

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string }
        throw new Error(body.message ?? `HTTP ${response.status}`)
      }

      const data = await response.json() as AuthInitiateResponse

      if (data.status === 'connected' && data.connectionId) {
        setConnectionId(data.connectionId)
        setStep('sites')
        useIntegrationListStore.getState().fetchConnections()
      } else if (data.status === 'requires_consent' && data.authUrl) {
        window.location.href = data.authUrl
      } else {
        throw new Error('Unexpected response from auth initiation')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect to SharePoint')
    } finally {
      setIsConnecting(false)
    }
  }, [])

  // ============================================
  // Step 2: Fetch sites
  // ============================================

  useEffect(() => {
    if (step !== 'sites' || !connectionId) return

    let cancelled = false

    const fetchSites = async () => {
      setIsSitesLoading(true)
      try {
        const params = new URLSearchParams()
        if (siteSearchQuery) params.set('search', siteSearchQuery)

        const [sitesResponse, scopesResponse] = await Promise.all([
          fetch(
            `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/sites?${params}`,
            { credentials: 'include' }
          ),
          fetch(
            `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes`,
            { credentials: 'include' }
          ),
        ])

        if (!sitesResponse.ok) {
          throw new Error(`Failed to load sites: HTTP ${sitesResponse.status}`)
        }

        const data = await sitesResponse.json() as SharePointSiteListResult

        if (!cancelled) {
          setSites(data.sites)
          setSiteNextPageToken(data.nextPageToken)
        }

        // Parse existing scopes for pre-selection
        if (scopesResponse.ok) {
          const scopesData = await scopesResponse.json() as { scopes: ConnectionScopeWithStats[] }
          const fetched = scopesData.scopes ?? []
          if (!cancelled) {
            setExistingScopes(fetched)
            // Pre-select sites that have existing scopes
            const scopedSiteIds = new Set<string>()
            for (const scope of fetched) {
              if ((scope as { scopeSiteId?: string }).scopeSiteId) {
                scopedSiteIds.add((scope as { scopeSiteId?: string }).scopeSiteId!)
              }
            }
            if (scopedSiteIds.size > 0) {
              setSelectedSiteIds(scopedSiteIds)
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load SharePoint sites')
        }
      } finally {
        if (!cancelled) setIsSitesLoading(false)
      }
    }

    fetchSites()
    return () => { cancelled = true }
  }, [step, connectionId, siteSearchQuery])

  const handleLoadMoreSites = useCallback(async () => {
    if (!connectionId || !siteNextPageToken || isSitesLoadingMore) return

    setIsSitesLoadingMore(true)
    try {
      const params = new URLSearchParams()
      if (siteSearchQuery) params.set('search', siteSearchQuery)
      params.set('pageToken', siteNextPageToken)

      const response = await fetch(
        `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/sites?${params}`,
        { credentials: 'include' }
      )

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json() as SharePointSiteListResult
      setSites(prev => [...prev, ...data.sites])
      setSiteNextPageToken(data.nextPageToken)
    } catch (err) {
      toast.error('Failed to load more sites')
    } finally {
      setIsSitesLoadingMore(false)
    }
  }, [connectionId, siteNextPageToken, siteSearchQuery, isSitesLoadingMore])

  const handleToggleSite = useCallback((siteId: string) => {
    setSelectedSiteIds(prev => {
      const next = new Set(prev)
      if (next.has(siteId)) {
        next.delete(siteId)
      } else {
        next.add(siteId)
      }
      return next
    })
  }, [])

  const handleSiteSearchChange = useCallback((query: string) => {
    setSiteSearchQuery(query)
    setSites([])
    setSiteNextPageToken(null)
  }, [])

  // ============================================
  // Step 3: Fetch libraries for selected sites
  // ============================================

  useEffect(() => {
    if (step !== 'libraries' || !connectionId) return

    const fetchAllLibraries = async () => {
      const newSiteLibs = new Map<string, SiteLibraries>()

      // Initialize entries for selected sites
      for (const siteId of selectedSiteIds) {
        const site = sites.find(s => s.siteId === siteId)
        if (!site) continue

        const existing = siteLibraries.get(siteId)
        if (existing?.isLoaded) {
          newSiteLibs.set(siteId, existing)
          continue
        }

        newSiteLibs.set(siteId, {
          site,
          libraries: [],
          isLoading: true,
          isLoaded: false,
        })
      }

      setSiteLibraries(new Map(newSiteLibs))

      // Fetch libraries in parallel for all unloaded sites
      const unloadedSiteIds = Array.from(selectedSiteIds).filter(id => !newSiteLibs.get(id)?.isLoaded)

      await Promise.all(
        unloadedSiteIds.map(async (siteId) => {
          try {
            const response = await fetch(
              `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/sites/${siteId}/libraries`,
              { credentials: 'include' }
            )

            if (!response.ok) throw new Error(`HTTP ${response.status}`)

            const data = await response.json() as SharePointLibraryListResult

            const libsWithState: LibraryWithState[] = data.libraries.map(lib => ({
              ...lib,
              isSelected: false,
              folders: null,
              isExpanded: false,
              isFoldersLoading: false,
            }))

            setSiteLibraries(prev => {
              const next = new Map(prev)
              const entry = next.get(siteId)
              if (entry) {
                next.set(siteId, {
                  ...entry,
                  libraries: libsWithState,
                  isLoading: false,
                  isLoaded: true,
                })
              }
              return next
            })
          } catch (err) {
            toast.error(`Failed to load libraries for site`)
            setSiteLibraries(prev => {
              const next = new Map(prev)
              const entry = next.get(siteId)
              if (entry) {
                next.set(siteId, { ...entry, isLoading: false, isLoaded: true })
              }
              return next
            })
          }
        })
      )

      // Pre-select libraries from existing scopes
      if (existingScopes.length > 0) {
        const preSelectedLibs = new Set<string>()
        for (const scope of existingScopes) {
          if ((scope.scopeType === 'library') && scope.scopeResourceId) {
            preSelectedLibs.add(scope.scopeResourceId)
          }
        }
        if (preSelectedLibs.size > 0) {
          setSelectedLibraries(preSelectedLibs)
        }
      }
    }

    fetchAllLibraries()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, connectionId])

  const handleToggleLibrary = useCallback((driveId: string) => {
    setSelectedLibraries(prev => {
      const next = new Set(prev)
      if (next.has(driveId)) {
        next.delete(driveId)
        // Also remove any folder selections within this library
        setSelectedFolders(prevFolders => {
          const nextFolders = new Map(prevFolders)
          for (const [folderId, info] of nextFolders) {
            if (info.driveId === driveId) nextFolders.delete(folderId)
          }
          return nextFolders
        })
      } else {
        next.add(driveId)
      }
      return next
    })
  }, [])

  // Expand library to browse its folders
  const handleToggleLibraryExpand = useCallback(async (siteId: string, driveId: string) => {
    if (!connectionId) return

    setSiteLibraries(prev => {
      const next = new Map(prev)
      const siteEntry = next.get(siteId)
      if (!siteEntry) return prev

      const updatedLibs = siteEntry.libraries.map(lib => {
        if (lib.driveId !== driveId) return lib

        // Already loaded — just toggle
        if (lib.folders !== null) {
          return { ...lib, isExpanded: !lib.isExpanded }
        }

        // Need to load
        return { ...lib, isExpanded: true, isFoldersLoading: true }
      })

      next.set(siteId, { ...siteEntry, libraries: updatedLibs })
      return next
    })

    // Check if we need to load folders
    const siteEntry = siteLibraries.get(siteId)
    const lib = siteEntry?.libraries.find(l => l.driveId === driveId)
    if (lib?.folders !== null) return // Already loaded, toggle handled above

    try {
      const response = await fetch(
        `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/sites/${siteId}/libraries/${driveId}/browse`,
        { credentials: 'include' }
      )

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json() as FolderListResult
      const sorted = sortItems(data.items)
      const nodes: TreeNodeData[] = sorted.filter(item => item.isFolder).map(item => ({
        item,
        children: null,
        isExpanded: false,
        isLoading: false,
      }))

      setSiteLibraries(prev => {
        const next = new Map(prev)
        const entry = next.get(siteId)
        if (!entry) return prev

        const updatedLibs = entry.libraries.map(l => {
          if (l.driveId !== driveId) return l
          return { ...l, folders: nodes, isFoldersLoading: false }
        })

        next.set(siteId, { ...entry, libraries: updatedLibs })
        return next
      })
    } catch {
      toast.error('Failed to load library folders')
      setSiteLibraries(prev => {
        const next = new Map(prev)
        const entry = next.get(siteId)
        if (!entry) return prev

        const updatedLibs = entry.libraries.map(l => {
          if (l.driveId !== driveId) return l
          return { ...l, isFoldersLoading: false, isExpanded: false }
        })

        next.set(siteId, { ...entry, libraries: updatedLibs })
        return next
      })
    }
  }, [connectionId, siteLibraries])

  // Expand a subfolder within a library
  const handleToggleFolderExpand = useCallback(async (nodeId: string) => {
    if (!connectionId) return

    // Find which library this folder belongs to
    let targetSiteId: string | null = null
    let targetDriveId: string | null = null
    let targetNode: TreeNodeData | null = null

    for (const [siteId, siteEntry] of siteLibraries) {
      for (const lib of siteEntry.libraries) {
        if (lib.folders) {
          const found = findNode(lib.folders, nodeId)
          if (found) {
            targetSiteId = siteId
            targetDriveId = lib.driveId
            targetNode = found
            break
          }
        }
      }
      if (targetNode) break
    }

    if (!targetSiteId || !targetDriveId || !targetNode) return
    if (!targetNode.item.isFolder) return

    // Already loaded — toggle
    if (targetNode.children !== null) {
      setSiteLibraries(prev => {
        const next = new Map(prev)
        const entry = next.get(targetSiteId!)
        if (!entry) return prev

        const updatedLibs = entry.libraries.map(lib => {
          if (lib.driveId !== targetDriveId) return lib
          if (!lib.folders) return lib

          const cloned = structuredClone(lib.folders)
          const node = findNode(cloned, nodeId)
          if (node) node.isExpanded = !node.isExpanded

          return { ...lib, folders: cloned }
        })

        next.set(targetSiteId!, { ...entry, libraries: updatedLibs })
        return next
      })
      return
    }

    // Mark loading
    setSiteLibraries(prev => {
      const next = new Map(prev)
      const entry = next.get(targetSiteId!)
      if (!entry) return prev

      const updatedLibs = entry.libraries.map(lib => {
        if (lib.driveId !== targetDriveId) return lib
        if (!lib.folders) return lib

        const cloned = structuredClone(lib.folders)
        const node = findNode(cloned, nodeId)
        if (node) { node.isLoading = true; node.isExpanded = true }

        return { ...lib, folders: cloned }
      })

      next.set(targetSiteId!, { ...entry, libraries: updatedLibs })
      return next
    })

    try {
      const response = await fetch(
        `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/sites/${targetSiteId}/libraries/${targetDriveId}/browse/${nodeId}`,
        { credentials: 'include' }
      )

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json() as FolderListResult
      const sorted = sortItems(data.items)
      const children: TreeNodeData[] = sorted.filter(item => item.isFolder).map(item => ({
        item,
        children: null,
        isExpanded: false,
        isLoading: false,
      }))

      setSiteLibraries(prev => {
        const next = new Map(prev)
        const entry = next.get(targetSiteId!)
        if (!entry) return prev

        const updatedLibs = entry.libraries.map(lib => {
          if (lib.driveId !== targetDriveId) return lib
          if (!lib.folders) return lib

          const cloned = structuredClone(lib.folders)
          const node = findNode(cloned, nodeId)
          if (node) { node.children = children; node.isLoading = false }

          return { ...lib, folders: cloned }
        })

        next.set(targetSiteId!, { ...entry, libraries: updatedLibs })
        return next
      })
    } catch {
      toast.error('Failed to load folder')
      setSiteLibraries(prev => {
        const next = new Map(prev)
        const entry = next.get(targetSiteId!)
        if (!entry) return prev

        const updatedLibs = entry.libraries.map(lib => {
          if (lib.driveId !== targetDriveId) return lib
          if (!lib.folders) return lib

          const cloned = structuredClone(lib.folders)
          const node = findNode(cloned, nodeId)
          if (node) { node.isLoading = false; node.isExpanded = false }

          return { ...lib, folders: cloned }
        })

        next.set(targetSiteId!, { ...entry, libraries: updatedLibs })
        return next
      })
    }
  }, [connectionId, siteLibraries])

  const handleToggleFolder = useCallback((folderId: string, folderName: string, folderPath: string | null) => {
    // Find which library this folder belongs to
    for (const [siteId, siteEntry] of siteLibraries) {
      for (const lib of siteEntry.libraries) {
        if (lib.folders) {
          const found = findNode(lib.folders, folderId)
          if (found) {
            setSelectedFolders(prev => {
              const next = new Map(prev)
              if (next.has(folderId)) {
                next.delete(folderId)
              } else {
                next.set(folderId, {
                  name: folderName,
                  path: folderPath,
                  driveId: lib.driveId,
                  siteId: siteId,
                  siteName: siteEntry.site.displayName,
                  libraryName: lib.displayName,
                })
              }
              return next
            })
            return
          }
        }
      }
    }
  }, [siteLibraries])

  // ============================================
  // Polling logic
  // ============================================

  const startPolling = useCallback(
    (connId: string, scopeIds: string[]) => {
      stopPolling()

      const poll = async () => {
        try {
          const response = await fetch(
            `${env.apiUrl}${CONNECTIONS_API.BASE}/${connId}/sync-status`,
            { credentials: 'include' }
          )
          if (!response.ok) return

          const data = await response.json() as SyncStatusResponse
          const scopes = data.scopes ?? []
          const relevantScopes = scopes.filter(s => scopeIds.includes(s.id))
          if (relevantScopes.length === 0) return

          const newProgress = new Map<string, ScopeProgressEntry>()
          let allDone = true
          let hasError = false

          for (const scope of relevantScopes) {
            const processed = scope.processedCount ?? 0
            const total = scope.itemCount ?? 0
            const pct = total > 0 ? Math.round((processed / total) * 100) : 0

            newProgress.set(scope.id, {
              processedFiles: processed,
              totalFiles: total,
              percentage: pct,
            })

            if (scope.syncStatus === 'syncing') allDone = false
            if (scope.syncStatus === 'error') hasError = true
          }

          setScopeProgress(newProgress)

          if (hasError) {
            stopPolling()
            setSyncState('error')
            setSyncError('One or more items failed to sync')
            return
          }

          if (allDone) {
            stopPolling()
            setSyncState('complete')
            useIntegrationListStore.getState().fetchConnections()
          }
        } catch {
          // Non-fatal — keep polling
        }
      }

      pollIntervalRef.current = setInterval(poll, 2000)
      void poll()
    },
    [stopPolling]
  )

  // ============================================
  // Step 4: Trigger sync
  // ============================================

  useEffect(() => {
    if (step !== 'sync' || !connectionId || syncState !== 'idle') return

    const runSync = async () => {
      setSyncState('syncing')
      setSyncError(null)

      try {
        // Build scope additions
        const toAdd: Array<{
          scopeType: string
          scopeResourceId: string
          scopeDisplayName: string
          scopePath?: string | null
          scopeSiteId?: string
          scopeMode?: 'include' | 'exclude'
        }> = []
        const toRemove: string[] = []

        // Existing scope IDs for comparison
        const existingScopeResourceIds = new Set(
          existingScopes.map(s => s.scopeResourceId).filter(Boolean)
        )

        // Add selected libraries
        for (const driveId of selectedLibraries) {
          if (existingScopeResourceIds.has(driveId)) continue

          // Find the library details
          for (const [siteId, siteEntry] of siteLibraries) {
            const lib = siteEntry.libraries.find(l => l.driveId === driveId)
            if (lib) {
              toAdd.push({
                scopeType: 'library',
                scopeResourceId: driveId,
                scopeDisplayName: lib.displayName,
                scopePath: `${siteEntry.site.displayName} / ${lib.displayName}`,
                scopeSiteId: siteId,
                scopeMode: 'include',
              })
              break
            }
          }
        }

        // Add selected folders
        for (const [folderId, info] of selectedFolders) {
          if (existingScopeResourceIds.has(folderId)) continue

          toAdd.push({
            scopeType: 'folder',
            scopeResourceId: folderId,
            scopeDisplayName: info.name,
            scopePath: `${info.siteName} / ${info.libraryName}${info.path ? ` / ${info.path}` : ''}`,
            scopeSiteId: info.siteId,
            scopeMode: 'include',
          })
        }

        // Remove existing scopes that are no longer selected
        for (const scope of existingScopes) {
          if (!scope.scopeResourceId) continue
          const isStillSelected =
            selectedLibraries.has(scope.scopeResourceId) ||
            selectedFolders.has(scope.scopeResourceId)
          if (!isStillSelected) {
            toRemove.push(scope.id)
          }
        }

        if (toAdd.length === 0 && toRemove.length === 0) {
          setSyncState('complete')
          return
        }

        const batchResponse = await fetch(
          `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes/batch`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ add: toAdd, remove: toRemove }),
          }
        )

        if (!batchResponse.ok) {
          const body = await batchResponse.json().catch(() => ({})) as { message?: string }
          throw new Error(body.message ?? `Failed to update scopes: HTTP ${batchResponse.status}`)
        }

        const batchResult = await batchResponse.json() as ScopeBatchResult
        const newIncludeScopes = (batchResult.added ?? []).filter(
          s => (s as { scopeMode?: string }).scopeMode !== 'exclude'
        )

        if (newIncludeScopes.length > 0) {
          // Trigger sync for new include scopes
          await Promise.all(
            newIncludeScopes.map(scope =>
              fetch(
                `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes/${scope.id}/sync`,
                { method: 'POST', credentials: 'include' }
              )
            )
          )

          const initProgress = new Map<string, ScopeProgressEntry>()
          for (const scope of newIncludeScopes) {
            initProgress.set(scope.id, { processedFiles: 0, totalFiles: 0, percentage: 0 })
          }
          setScopeProgress(initProgress)
          startPolling(connectionId, newIncludeScopes.map(s => s.id))
        } else {
          setSyncState('complete')
          useIntegrationListStore.getState().fetchConnections()
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed'
        setSyncError(message)
        setSyncState('error')
        toast.error(message)
      }
    }

    void runSync()
  }, [step, connectionId, syncState, selectedLibraries, selectedFolders, existingScopes, siteLibraries, startPolling])

  // ============================================
  // Derived — aggregate progress
  // ============================================

  const aggregatedProgress = (() => {
    let totalProcessed = 0
    let totalFiles = 0

    for (const entry of scopeProgress.values()) {
      totalProcessed += entry.processedFiles
      totalFiles += entry.totalFiles
    }

    const percentage = totalFiles > 0 ? Math.round((totalProcessed / totalFiles) * 100) : 0
    return { totalProcessed, totalFiles, percentage }
  })()

  // ============================================
  // Done / Close
  // ============================================

  const handleDone = useCallback(() => {
    fetchConnections()
    useFolderTreeStore.getState().invalidateTreeFolder('sharepoint-root')
    onClose()
  }, [fetchConnections, onClose])

  const handleClose = useCallback(() => {
    stopPolling()
    fetchConnections()
    useFolderTreeStore.getState().invalidateTreeFolder('sharepoint-root')
    onClose()
  }, [stopPolling, fetchConnections, onClose])

  // ============================================
  // Selection summary for libraries step
  // ============================================

  const totalSelectedItems = selectedLibraries.size + selectedFolders.size

  // ============================================
  // Render
  // ============================================

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="sm:max-w-lg">

        {/* ---- Step: connect ---- */}
        {step === 'connect' && (
          <>
            <DialogHeader>
              <DialogTitle>Connect to SharePoint</DialogTitle>
              <DialogDescription>
                Sign in with your Microsoft account to browse and sync SharePoint document libraries.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-4">
              <div className="size-16 rounded-full bg-teal-50 dark:bg-teal-950 flex items-center justify-center">
                <Globe className="size-8 text-[#038387]" />
              </div>

              <Button
                onClick={handleConnect}
                disabled={isConnecting}
                className="gap-2 bg-[#038387] hover:bg-[#026c6f] text-white w-full"
              >
                {isConnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Globe className="size-4" />
                )}
                {isConnecting ? 'Connecting...' : 'Connect with Microsoft'}
              </Button>
            </div>
          </>
        )}

        {/* ---- Step: sites ---- */}
        {step === 'sites' && (
          <>
            <DialogHeader>
              <DialogTitle>Select SharePoint Sites</DialogTitle>
              <DialogDescription>
                Choose which SharePoint sites to browse for document libraries.
              </DialogDescription>
            </DialogHeader>

            <SitePickerGrid
              sites={sites}
              selectedSiteIds={selectedSiteIds}
              onToggleSite={handleToggleSite}
              searchQuery={siteSearchQuery}
              onSearchChange={handleSiteSearchChange}
              isLoading={isSitesLoading}
              onLoadMore={handleLoadMoreSites}
              hasMore={!!siteNextPageToken}
              isLoadingMore={isSitesLoadingMore}
            />

            <DialogFooter>
              <Button
                onClick={() => setStep('libraries')}
                disabled={selectedSiteIds.size === 0}
              >
                Next: Libraries
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ---- Step: libraries ---- */}
        {step === 'libraries' && (
          <>
            <DialogHeader>
              <DialogTitle>Select Libraries & Folders</DialogTitle>
              <DialogDescription>
                {`Choose which document libraries to sync for the ${AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT]} agent.`}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-[200px] max-h-[350px] overflow-y-auto border rounded-md py-1 space-y-2">
              {Array.from(siteLibraries.entries()).map(([siteId, siteEntry]) => (
                <div key={siteId}>
                  {/* Site header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b">
                    <Globe className="size-4 text-[#038387]" />
                    <span className="text-sm font-medium">{siteEntry.site.displayName}</span>
                  </div>

                  {siteEntry.isLoading ? (
                    <div className="flex items-center justify-center py-4 text-muted-foreground gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span className="text-sm">Loading libraries...</span>
                    </div>
                  ) : siteEntry.libraries.length === 0 ? (
                    <div className="py-3 px-4 text-sm text-muted-foreground">
                      No document libraries found
                    </div>
                  ) : (
                    siteEntry.libraries.map(lib => {
                      const isLibSelected = selectedLibraries.has(lib.driveId)
                      const hasFolderSelections = Array.from(selectedFolders.values()).some(
                        f => f.driveId === lib.driveId
                      )
                      const checkState: boolean | 'indeterminate' = isLibSelected
                        ? true
                        : hasFolderSelections
                          ? 'indeterminate'
                          : false

                      return (
                        <div key={lib.driveId}>
                          <div className="flex items-center gap-1.5 py-1.5 px-3 hover:bg-muted/50">
                            {/* Expand chevron */}
                            <button
                              type="button"
                              className="size-4 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                              onClick={() => handleToggleLibraryExpand(siteId, lib.driveId)}
                              aria-label={lib.isExpanded ? 'Collapse' : 'Expand'}
                            >
                              {lib.isFoldersLoading ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : lib.isExpanded ? (
                                <ChevronDown className="size-3.5" />
                              ) : (
                                <ChevronRight className="size-3.5" />
                              )}
                            </button>

                            <Checkbox
                              checked={checkState}
                              onCheckedChange={() => handleToggleLibrary(lib.driveId)}
                              aria-label={`Select ${lib.displayName}`}
                            />

                            <BookOpen className="size-4 shrink-0 text-[#038387]" />

                            <div className="flex-1 min-w-0">
                              <span className="text-sm">{lib.displayName}</span>
                              <span className="text-xs text-muted-foreground ml-2">
                                {lib.itemCount} items, {formatFileSize(lib.sizeBytes)}
                              </span>
                            </div>
                          </div>

                          {/* Expanded folder list */}
                          {lib.isExpanded && lib.folders && (
                            <div className="ml-4">
                              {lib.folders.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-2 pl-8">No subfolders</p>
                              ) : (
                                lib.folders.map(folderNode => (
                                  <LibFolderNode
                                    key={folderNode.item.id}
                                    node={folderNode}
                                    depth={0}
                                    selectedFolders={selectedFolders instanceof Map ? new Set(selectedFolders.keys()) : new Set()}
                                    onToggleFolder={handleToggleFolder}
                                    onToggleExpand={handleToggleFolderExpand}
                                  />
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              ))}
            </div>

            {totalSelectedItems > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedLibraries.size > 0 && `${selectedLibraries.size} librar${selectedLibraries.size !== 1 ? 'ies' : 'y'}`}
                {selectedLibraries.size > 0 && selectedFolders.size > 0 && ', '}
                {selectedFolders.size > 0 && `${selectedFolders.size} folder${selectedFolders.size !== 1 ? 's' : ''}`}
                {' '}selected
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep('sites')}>
                Back
              </Button>
              <Button
                onClick={() => setStep('sync')}
                disabled={totalSelectedItems === 0}
              >
                Start Sync
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ---- Step: sync ---- */}
        {step === 'sync' && (
          <>
            <DialogHeader>
              <DialogTitle>Syncing SharePoint Files</DialogTitle>
              <DialogDescription>
                {syncState === 'complete'
                  ? 'Your SharePoint libraries have been synced successfully.'
                  : syncState === 'error'
                    ? 'There was a problem syncing your files.'
                    : 'Please wait while your selected libraries are synced...'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-6">
              {syncState === 'syncing' && (
                <>
                  <Loader2 className="size-8 text-[#038387] animate-spin" />
                  <Progress value={aggregatedProgress.percentage} className="w-full" />
                  <p className="text-sm text-muted-foreground">
                    {aggregatedProgress.totalFiles > 0
                      ? `${aggregatedProgress.totalProcessed} of ${aggregatedProgress.totalFiles} files synced (${aggregatedProgress.percentage}%)`
                      : 'Starting sync...'}
                  </p>
                </>
              )}

              {syncState === 'complete' && (
                <>
                  <div className="size-16 rounded-full bg-green-50 dark:bg-green-950 flex items-center justify-center">
                    <Check className="size-8 text-green-600 dark:text-green-400" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Your files are now available for the {AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT]} agent.
                  </p>
                </>
              )}

              {syncState === 'error' && (
                <>
                  <div className="size-16 rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center">
                    <AlertTriangle className="size-8 text-red-600 dark:text-red-400" />
                  </div>
                  <p className="text-sm text-destructive">{syncError}</p>
                </>
              )}
            </div>

            <DialogFooter>
              {syncState === 'complete' && (
                <Button onClick={handleDone} className="bg-[#038387] hover:bg-[#026c6f] text-white">
                  Done
                </Button>
              )}
              {syncState === 'error' && (
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
