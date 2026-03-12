'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Loader2,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Folder,
  Check,
} from 'lucide-react'
import { SharePointLogo } from '@/components/icons'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type {
  FolderListResult,
  ConnectionScopeWithStats,
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
import type { TreeNodeData, AuthInitiateResponse, NodeInfo } from './wizard-utils'
import { findNode, sortItems, formatFileSize, SYNC_ALL_KEY, type ExplicitSelection } from './wizard-utils'
import { useTriStateSelection } from './useTriStateSelection'
import { SitePickerGrid } from './sharepoint/SitePickerGrid'
import { getFileIconType, FileIcon as FileTypeIcon, fileTypeColors } from '@/src/presentation/chat/file-type-utils'
import { triggerSyncOperation } from '@/src/domains/integrations/hooks/useSyncOperation'

// ============================================
// Types
// ============================================

interface SharePointWizardProps {
  isOpen: boolean
  onClose: () => void
  initialConnectionId?: string | null
}

type SPWizardStep = 'connect' | 'sites' | 'libraries'

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
  getCheckState: (itemId: string) => boolean | 'indeterminate'
  onToggleSelect: (item: { id: string; isFolder: boolean }) => void
  onToggleExpand: (nodeId: string) => void
}

function LibFolderNode({ node, depth, getCheckState, onToggleSelect, onToggleExpand }: LibFolderNodeProps) {
  const { item } = node

  if (!item.isFolder) {
    const iconType = getFileIconType(item.name, item.mimeType ?? undefined)
    const colors = fileTypeColors[iconType]
    return (
      <div
        className="flex items-center gap-1.5 py-1 pr-2 rounded-md select-none"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <span className="size-4 shrink-0" />
        <span className="size-4 shrink-0" />
        <FileTypeIcon iconType={iconType} className={`size-4 shrink-0 ${colors?.icon ?? 'text-muted-foreground'}`} />
        <span className="text-sm truncate flex-1 text-muted-foreground">{item.name}</span>
        {item.sizeBytes != null && item.sizeBytes > 0 && (
          <span className="text-xs text-muted-foreground/60 shrink-0">{formatFileSize(item.sizeBytes)}</span>
        )}
      </div>
    )
  }

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
          checked={getCheckState(item.id)}
          onCheckedChange={() => onToggleSelect({ id: item.id, isFolder: item.isFolder })}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${item.name}`}
        />

        {node.isExpanded ? (
          <Folder className="size-4 shrink-0 text-amber-600" />
        ) : (
          <Folder className="size-4 shrink-0 text-amber-500" />
        )}

        <span className="text-sm truncate flex-1" onClick={() => onToggleExpand(item.id)}>
          {item.name}
        </span>
      </div>

      {node.isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <LibFolderNode
              key={child.item.id}
              node={child}
              depth={depth + 1}
              getCheckState={getCheckState}
              onToggleSelect={onToggleSelect}
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

  // Step 3: Existing scopes (for reconfigure)
  const [existingScopes, setExistingScopes] = useState<ConnectionScopeWithStats[]>([])

  // Step 3: Saving state for the "Save & Sync" button
  const [isSaving, setIsSaving] = useState(false)

  // ============================================
  // Tri-state selection via hook
  // ============================================

  const findNodeForHook = useCallback((id: string): NodeInfo | null => {
    for (const [, siteEntry] of siteLibraries) {
      for (const lib of siteEntry.libraries) {
        // Check if id is a library (driveId)
        if (lib.driveId === id) {
          const childIds = lib.folders?.map(n => n.item.id) ?? []
          return { id, parentId: null, isFolder: true, childIds }
        }
        // Check folders within library
        if (lib.folders) {
          const found = findNode(lib.folders, id)
          if (found) {
            return {
              id: found.item.id,
              parentId: found.item.parentId ?? lib.driveId,
              isFolder: found.item.isFolder,
              childIds: found.children?.map(c => c.item.id) ?? [],
            }
          }
        }
      }
    }
    return null
  }, [siteLibraries])

  const { explicitSelections, isSyncAll, getCheckState, toggleSelect, toggleSyncAll, setExplicitSelections, reset: resetTriState } = useTriStateSelection({ findNode: findNodeForHook })

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
    resetTriState()
    setExistingScopes([])
    setIsSaving(false)
  }, [resetTriState])

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(resetWizard, 300)
      return () => clearTimeout(t)
    }
  }, [isOpen, resetWizard])

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

      // Pre-populate explicitSelections from existing scopes
      if (existingScopes.length > 0) {
        const preExplicit = new Map<string, ExplicitSelection>()
        for (const scope of existingScopes) {
          if (scope.scopeType === 'root' && scope.scopeResourceId) {
            preExplicit.set(SYNC_ALL_KEY, 'include')
          } else if (scope.scopeResourceId) {
            preExplicit.set(
              scope.scopeResourceId,
              (scope as { scopeMode?: string }).scopeMode === 'exclude' ? 'exclude' : 'include'
            )
          }
        }
        if (preExplicit.size > 0) {
          setExplicitSelections(preExplicit)
        }
      }
    }

    fetchAllLibraries()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, connectionId])

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
      const nodes: TreeNodeData[] = sorted.map(item => ({
        item,
        children: item.isFolder ? null : [],
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
      const children: TreeNodeData[] = sorted.map(item => ({
        item,
        children: item.isFolder ? null : [],
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

  // ============================================
  // Done / Close
  // ============================================

  const handleClose = useCallback(() => {
    fetchConnections()
    useFolderTreeStore.getState().invalidateTreeFolder('sharepoint-root')
    onClose()
  }, [fetchConnections, onClose])

  // ============================================
  // Scope generation helpers
  // ============================================

  const findLibraryAndSiteForItem = useCallback((itemId: string) => {
    for (const [siteId, siteEntry] of siteLibraries) {
      for (const lib of siteEntry.libraries) {
        if (lib.driveId === itemId) {
          return { lib, siteId, siteName: siteEntry.site.displayName, folder: null as TreeNodeData | null }
        }
        if (lib.folders) {
          const found = findNode(lib.folders, itemId)
          if (found) {
            return { lib, siteId, siteName: siteEntry.site.displayName, folder: found }
          }
        }
      }
    }
    return null
  }, [siteLibraries])

  const buildAndTriggerSync = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!connectionId) return { success: false, error: 'No connection ID' }

    const existingScopeMap = new Map<string, ConnectionScopeWithStats>()
    for (const scope of existingScopes) {
      if (scope.scopeResourceId) {
        existingScopeMap.set(scope.scopeResourceId, scope)
      }
      if (scope.scopeType === 'root') {
        existingScopeMap.set(SYNC_ALL_KEY, scope)
      }
    }

    const toAdd: Array<{
      scopeType: string
      scopeResourceId: string
      scopeDisplayName: string
      scopePath?: string
      scopeSiteId?: string
      scopeMode?: 'include' | 'exclude'
      remoteDriveId?: string
    }> = []
    const toRemove: string[] = []

    for (const [resourceId, mode] of explicitSelections) {
      if (resourceId === SYNC_ALL_KEY) {
        if (mode === 'include') {
          const hasExistingRoot = existingScopes.some(s => s.scopeType === 'root')
          if (!hasExistingRoot) {
            toAdd.push({
              scopeType: 'root',
              scopeResourceId: 'root',
              scopeDisplayName: 'All Libraries',
              scopeMode: 'include',
            })
          }
        }
        continue
      }

      const existingScope = existingScopeMap.get(resourceId)
      const info = findLibraryAndSiteForItem(resourceId)

      if (mode === 'include') {
        if (!existingScope || (existingScope as { scopeMode?: string }).scopeMode === 'exclude') {
          if (info) {
            const isLibrary = info.folder === null
            toAdd.push({
              scopeType: isLibrary ? 'library' : 'folder',
              scopeResourceId: resourceId,
              scopeDisplayName: isLibrary ? info.lib.displayName : (info.folder?.item.name ?? resourceId),
              scopePath: isLibrary
                ? `${info.siteName} / ${info.lib.displayName}`
                : `${info.siteName} / ${info.lib.displayName}${info.folder?.item.parentPath ? ` / ${info.folder.item.parentPath}` : ''}`,
              scopeSiteId: info.siteId,
              scopeMode: 'include',
              remoteDriveId: isLibrary ? undefined : info.lib.driveId,
            })
          }
          if (existingScope && (existingScope as { scopeMode?: string }).scopeMode === 'exclude') {
            toRemove.push(existingScope.id)
          }
        }
      } else if (mode === 'exclude') {
        if (!existingScope || (existingScope as { scopeMode?: string }).scopeMode !== 'exclude') {
          if (info) {
            const isLibrary = info.folder === null
            toAdd.push({
              scopeType: isLibrary ? 'library' : 'folder',
              scopeResourceId: resourceId,
              scopeDisplayName: isLibrary ? info.lib.displayName : (info.folder?.item.name ?? resourceId),
              scopePath: isLibrary
                ? `${info.siteName} / ${info.lib.displayName}`
                : `${info.siteName} / ${info.lib.displayName}${info.folder?.item.parentPath ? ` / ${info.folder.item.parentPath}` : ''}`,
              scopeSiteId: info.siteId,
              scopeMode: 'exclude',
              remoteDriveId: isLibrary ? undefined : info.lib.driveId,
            })
          }
        }
      }
    }

    // Existing scopes no longer in explicitSelections → remove
    for (const scope of existingScopes) {
      if (!scope.scopeResourceId) continue
      if (scope.scopeType === 'root' && !explicitSelections.has(SYNC_ALL_KEY)) {
        toRemove.push(scope.id)
      } else if (scope.scopeType !== 'root' && !explicitSelections.has(scope.scopeResourceId)) {
        if (isSyncAll && (scope as { scopeMode?: string }).scopeMode !== 'exclude') {
          toRemove.push(scope.id)
        } else if (!isSyncAll) {
          toRemove.push(scope.id)
        }
      }
    }

    if (toAdd.length === 0 && toRemove.length === 0) {
      return { success: true }
    }

    return triggerSyncOperation({
      connectionId,
      providerId: 'sharepoint',
      toAdd,
      toRemove,
    })
  }, [connectionId, existingScopes, explicitSelections, findLibraryAndSiteForItem, isSyncAll])

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
                <SharePointLogo className="size-8" />
              </div>

              <Button
                onClick={handleConnect}
                disabled={isConnecting}
                className="gap-2 bg-[#038387] hover:bg-[#026c6f] text-white w-full"
              >
                {isConnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <SharePointLogo className="size-4" />
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
              <div className="flex items-center justify-between px-3 py-1.5 border-b">
                <span className="text-sm font-medium text-muted-foreground">Libraries</span>
                <Button
                  variant={isSyncAll ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleSyncAll}
                  className="text-xs h-7"
                >
                  {isSyncAll ? <Check className="size-3 mr-1" /> : null}
                  Sync All
                </Button>
              </div>

              {Array.from(siteLibraries.entries()).map(([siteId, siteEntry]) => (
                <div key={siteId}>
                  {/* Site header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b">
                    <SharePointLogo className="size-4" />
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
                      const checkState = getCheckState(lib.driveId)

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
                              onCheckedChange={() => toggleSelect({ id: lib.driveId, isFolder: true })}
                              aria-label={`Select ${lib.displayName}`}
                            />

                            <BookOpen className="size-4 shrink-0 text-[#038387]" />

                            <div className="flex-1 min-w-0">
                              <span className="text-sm">{lib.displayName}</span>
                              <span className="text-xs text-muted-foreground ml-2">
                                {lib.itemCount != null ? `${lib.itemCount} items, ` : ''}{formatFileSize(lib.sizeBytes)}
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
                                    getCheckState={getCheckState}
                                    onToggleSelect={toggleSelect}
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

            {explicitSelections.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {isSyncAll
                  ? 'All libraries selected'
                  : (() => {
                      const inclusions = Array.from(explicitSelections.values()).filter(m => m === 'include').length
                      const exclusions = Array.from(explicitSelections.values()).filter(m => m === 'exclude').length
                      const parts: string[] = []
                      if (inclusions > 0) parts.push(`${inclusions} included`)
                      if (exclusions > 0) parts.push(`${exclusions} excluded`)
                      return parts.join(', ')
                    })()
                }
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep('sites')}>
                Back
              </Button>
              <Button
                onClick={async () => {
                  setIsSaving(true)
                  const result = await buildAndTriggerSync()
                  setIsSaving(false)
                  if (result.success) {
                    useFolderTreeStore.getState().invalidateTreeFolder('sharepoint-root')
                    onClose()
                  } else {
                    toast.error('Failed to start sync', { description: result.error })
                  }
                }}
                disabled={explicitSelections.size === 0 || isSaving}
              >
                {isSaving ? (
                  <><Loader2 className="size-4 animate-spin mr-2" />Saving...</>
                ) : 'Save & Sync'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
