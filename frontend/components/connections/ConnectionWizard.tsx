'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Cloud,
  Check,
  Loader2,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Users,
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
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import type { ExternalFileItem, FolderListResult, ConnectionScopeDetail, ConnectionScopeWithStats, ScopeBatchResult } from '@bc-agent/shared'
import { CONNECTIONS_API, AGENT_DISPLAY_NAME, AGENT_ID, SUPPORTED_EXTENSIONS_DISPLAY } from '@bc-agent/shared'
import { env } from '@/lib/config/env'
import { useIntegrationListStore } from '@/src/domains/integrations'
import { toast } from 'sonner'
import { getFileIconType, FileIcon as FileTypeIcon, fileTypeColors } from '@/src/presentation/chat/file-type-utils'
import { ScopeDiffView } from './ScopeDiffView'
import type { TreeNodeData, SelectedScope, SyncState, ScopeProgressEntry, AuthInitiateResponse, SyncStatusResponse } from './wizard-utils'
import { findNode, sortItems, formatFileSize } from './wizard-utils'

// ============================================
// Types
// ============================================

interface ConnectionWizardProps {
  isOpen: boolean
  onClose: () => void
  /** When provided, skip step 1 (connect) and go directly to step 2 (browse) */
  initialConnectionId?: string | null
}

type WizardStep = 'connect' | 'browse' | 'sync'

type ExplicitSelection = 'include' | 'exclude'
const SYNC_ALL_KEY = '__ROOT__'

type BrowseTab = 'my-files' | 'shared'

// ============================================
// TreeNode — recursive folder/file row
// ============================================

interface TreeNodeProps {
  node: TreeNodeData
  depth: number
  selectedScopes: Map<string, SelectedScope>
  getCheckState: (itemId: string) => boolean | 'indeterminate'
  onToggleExpand: (itemId: string) => void
  onToggleSelect: (item: ExternalFileItem) => void
}

function TreeNode({ node, depth, selectedScopes, getCheckState, onToggleExpand, onToggleSelect }: TreeNodeProps) {
  const { item } = node

  if (item.isFolder) {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 py-1.5 pr-2 rounded-md hover:bg-muted/50 cursor-pointer select-none"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {/* Expand chevron */}
          <button
            type="button"
            className="size-4 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(item.id)
            }}
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

          {/* Checkbox */}
          <Checkbox
            id={`item-${item.id}`}
            checked={getCheckState(item.id)}
            onCheckedChange={() => onToggleSelect(item)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${item.name}`}
          />

          {/* Folder icon */}
          {node.isExpanded ? (
            <FolderOpen className="size-4 shrink-0 text-blue-500" />
          ) : (
            <Folder className="size-4 shrink-0 text-muted-foreground" />
          )}

          {/* Name */}
          <span
            className={`text-sm truncate flex-1 ${selectedScopes.get(item.id)?.status === 'removed' ? 'line-through text-muted-foreground' : ''}`}
            onClick={() => onToggleExpand(item.id)}
          >
            {item.name}
          </span>
          {item.isShared && item.sharedBy && (
            <span className="text-[10px] text-blue-500 dark:text-blue-400 shrink-0 ml-1 flex items-center gap-0.5">
              <Users className="size-2.5" />
              {item.sharedBy}
            </span>
          )}
          {selectedScopes.get(item.id)?.status === 'existing' && (
            <span className="text-[10px] text-green-600 dark:text-green-400 shrink-0 ml-1">
              Synced{selectedScopes.get(item.id)?.fileCount ? ` · ${selectedScopes.get(item.id)?.fileCount} files` : ''}
            </span>
          )}
          {selectedScopes.get(item.id)?.status === 'removed' && (
            <span className="text-[10px] text-red-500 shrink-0 ml-1">Will remove</span>
          )}
        </div>

        {/* Children */}
        {node.isExpanded && node.children !== null && (
          <div>
            {node.children.length === 0 ? (
              <div
                className="text-xs text-muted-foreground py-1"
                style={{ paddingLeft: `${8 + (depth + 1) * 16 + 22}px` }}
              >
                Empty folder
              </div>
            ) : (
              node.children.map((child) => (
                <TreeNode
                  key={child.item.id}
                  node={child}
                  depth={depth + 1}
                  selectedScopes={selectedScopes}
                  getCheckState={getCheckState}
                  onToggleExpand={onToggleExpand}
                  onToggleSelect={onToggleSelect}
                />
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  // File row
  const iconType = getFileIconType(item.name, item.mimeType ?? undefined)
  const colors = fileTypeColors[iconType]
  const isUnsupported = item.isSupported === false

  const fileRow = (
    <div
      className={`flex items-center gap-1.5 py-1.5 pr-2 rounded-md select-none ${isUnsupported ? 'opacity-50' : 'hover:bg-muted/50'}`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      {/* Spacer (no chevron for files) */}
      <span className="size-4 shrink-0" />

      {/* Checkbox or spacer for unsupported files */}
      {isUnsupported ? (
        <span className="size-4 shrink-0" />
      ) : (
        <Checkbox
          id={`item-${item.id}`}
          checked={getCheckState(item.id)}
          onCheckedChange={() => onToggleSelect(item)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${item.name}`}
        />
      )}

      {/* File type icon */}
      <FileTypeIcon
        iconType={iconType}
        className={`size-4 shrink-0 ${isUnsupported ? 'text-muted-foreground' : (colors?.icon ?? 'text-muted-foreground')}`}
      />

      {/* Name */}
      <span className={`text-sm truncate flex-1 ${isUnsupported ? 'text-muted-foreground' : selectedScopes.get(item.id)?.status === 'removed' ? 'line-through text-muted-foreground' : ''}`}>
        {item.name}
      </span>
      {item.isShared && item.sharedBy && (
        <span className="text-[10px] text-blue-500 dark:text-blue-400 shrink-0 ml-1 flex items-center gap-0.5">
          <Users className="size-2.5" />
          {item.sharedBy}
        </span>
      )}
      {isUnsupported && (
        <span className="text-[10px] text-muted-foreground shrink-0 ml-1">Unsupported</span>
      )}
      {!isUnsupported && selectedScopes.get(item.id)?.status === 'existing' && (
        <span className="text-[10px] text-green-600 dark:text-green-400 shrink-0 ml-1">Synced</span>
      )}
      {!isUnsupported && selectedScopes.get(item.id)?.status === 'removed' && (
        <span className="text-[10px] text-red-500 shrink-0 ml-1">Will remove</span>
      )}

      {/* File size */}
      {item.sizeBytes > 0 && (
        <span className="text-xs text-muted-foreground shrink-0 ml-2">
          {formatFileSize(item.sizeBytes)}
        </span>
      )}
    </div>
  )

  if (isUnsupported) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>{fileRow}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            <p>Supported formats: {SUPPORTED_EXTENSIONS_DISPLAY}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return fileRow
}

// ============================================
// ConnectionWizard
// ============================================

export function ConnectionWizard({ isOpen, onClose, initialConnectionId }: ConnectionWizardProps) {
  // Step state
  const [step, setStep] = useState<WizardStep>('connect')

  // Step 1: connect
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionId, setConnectionId] = useState<string | null>(null)

  // Step 2: browse
  const [rootNodes, setRootNodes] = useState<TreeNodeData[]>([])
  const [isBrowseLoading, setIsBrowseLoading] = useState(false)
  const [browseAuthError, setBrowseAuthError] = useState(false)
  const [browseRefreshKey, setBrowseRefreshKey] = useState(0)
  const [nodeMap, setNodeMap] = useState<Map<string, TreeNodeData>>(new Map())

  // Shared tab state (PRD-110)
  const [browseTab, setBrowseTab] = useState<BrowseTab>('my-files')
  const [sharedNodes, setSharedNodes] = useState<TreeNodeData[]>([])
  const [isSharedLoading, setIsSharedLoading] = useState(false)
  const [sharedLoadedOnce, setSharedLoadedOnce] = useState(false)
  const [sharedNodeMap, setSharedNodeMap] = useState<Map<string, TreeNodeData>>(new Map())
  const [selectedScopes, setSelectedScopes] = useState<Map<string, SelectedScope>>(new Map())
  const [existingScopes, setExistingScopes] = useState<ConnectionScopeWithStats[]>([])
  const isReconfiguring = existingScopes.length > 0

  // PRD-112: Tri-state selection
  const [explicitSelections, setExplicitSelections] = useState<Map<string, ExplicitSelection>>(new Map())
  const isSyncAll = explicitSelections.get(SYNC_ALL_KEY) === 'include'

  // Step 3: sync
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [scopeProgress, setScopeProgress] = useState<Map<string, ScopeProgressEntry>>(new Map())
  const [syncError, setSyncError] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchConnections = useIntegrationListStore((s) => s.fetchConnections)

  // ============================================
  // Reset on dialog close
  // ============================================

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  const resetWizard = useCallback(() => {
    setStep('connect')
    setIsConnecting(false)
    setConnectionId(null)
    setRootNodes([])
    setIsBrowseLoading(false)
    setBrowseAuthError(false)
    setBrowseRefreshKey(0)
    setNodeMap(new Map())
    setSelectedScopes(new Map())
    setExplicitSelections(new Map())
    setExistingScopes([])
    setBrowseTab('my-files')
    setSharedNodes([])
    setIsSharedLoading(false)
    setSharedLoadedOnce(false)
    setSharedNodeMap(new Map())
    setShowDiff(false)
    setSyncState('idle')
    setScopeProgress(new Map())
    setSyncError(null)
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

  // Skip to browse step if initialConnectionId is provided (post-OAuth)
  useEffect(() => {
    if (initialConnectionId) {
      setConnectionId(initialConnectionId)
      setStep('browse')
    }
  }, [initialConnectionId])

  // ============================================
  // PRD-112: Tri-state selection helpers
  // ============================================

  const findNodeInMaps = useCallback((id: string): TreeNodeData | null => {
    return nodeMap.get(id) ?? sharedNodeMap.get(id) ?? null
  }, [nodeMap, sharedNodeMap])

  const getEffectiveCheckState = useCallback((itemId: string): boolean | 'indeterminate' => {
    const explicit = explicitSelections.get(itemId)

    if (explicit === 'exclude') return false

    if (explicit === 'include') {
      // Check if any loaded children are excluded → indeterminate
      const node = findNodeInMaps(itemId)
      if (node?.item.isFolder && node.children && node.children.length > 0) {
        const hasExcluded = node.children.some(c =>
          explicitSelections.get(c.item.id) === 'exclude'
        )
        if (hasExcluded) return 'indeterminate'
      }
      return true
    }

    // No explicit selection — inherit from parent
    const node = findNodeInMaps(itemId)
    if (node?.item.parentId) {
      const parentState = getEffectiveCheckState(node.item.parentId)
      if (parentState === true || parentState === 'indeterminate') return true
    }

    // "Sync All" — root include means everything is checked by default
    if (isSyncAll) return true

    return false
  }, [explicitSelections, findNodeInMaps, isSyncAll])

  const handleSyncAll = useCallback(() => {
    setExplicitSelections(prev => {
      if (prev.get(SYNC_ALL_KEY) === 'include') {
        // Toggle off: clear everything
        return new Map()
      }
      // Toggle on: set root include, clear everything else
      return new Map([[SYNC_ALL_KEY, 'include' as ExplicitSelection]])
    })
  }, [])

  // ============================================
  // Step 1: Initiate Microsoft OAuth
  // ============================================

  const handleConnect = useCallback(async () => {
    setIsConnecting(true)
    try {
      const response = await fetch(
        `${env.apiUrl}${CONNECTIONS_API.BASE}/onedrive/auth/initiate`,
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
        setStep('browse')
      } else if (data.status === 'requires_consent' && data.authUrl) {
        window.location.href = data.authUrl
      } else {
        throw new Error('Unexpected response from auth initiation')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect to OneDrive')
    } finally {
      setIsConnecting(false)
    }
  }, [])

  // ============================================
  // Step 2: Fetch root folders on browse step entry
  // ============================================

  const buildNodeMap = useCallback(
    (nodes: TreeNodeData[], map: Map<string, TreeNodeData>): void => {
      for (const node of nodes) {
        map.set(node.item.id, node)
        if (node.children) {
          buildNodeMap(node.children, map)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (step !== 'browse' || !connectionId) return

    const fetchRoot = async () => {
      setIsBrowseLoading(true)
      try {
        // Fetch root folder contents and existing scopes in parallel
        const [browseResponse, scopesResponse] = await Promise.all([
          fetch(
            `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/browse`,
            { credentials: 'include' }
          ),
          fetch(
            `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes`,
            { credentials: 'include' }
          ),
        ])

        if (browseResponse.status === 401) {
          setBrowseAuthError(true)
          return
        }

        if (!browseResponse.ok) {
          throw new Error(`Failed to load folders: HTTP ${browseResponse.status}`)
        }

        const data: FolderListResult = await browseResponse.json()
        const sorted = sortItems(data.items)

        // Parse existing scopes
        let fetchedScopes: ConnectionScopeWithStats[] = []
        if (scopesResponse.ok) {
          const scopesData = await scopesResponse.json() as { scopes: ConnectionScopeWithStats[] }
          fetchedScopes = scopesData.scopes ?? []
        }
        setExistingScopes(fetchedScopes)

        // Build a set of existing scope resource IDs for matching
        const existingScopeMap = new Map<string, ConnectionScopeWithStats>()
        for (const scope of fetchedScopes) {
          if (scope.scopeResourceId) {
            existingScopeMap.set(scope.scopeResourceId, scope)
          }
        }

        const nodes: TreeNodeData[] = sorted.map((item) => ({
          item,
          children: item.isFolder ? null : null,
          isExpanded: false,
          isLoading: false,
        }))

        const map = new Map<string, TreeNodeData>()
        buildNodeMap(nodes, map)

        setRootNodes(nodes)
        setNodeMap(map)

        // Pre-populate selectedScopes with existing scopes
        if (fetchedScopes.length > 0) {
          const preSelected = new Map<string, SelectedScope>()
          for (const scope of fetchedScopes) {
            if (scope.scopeResourceId) {
              preSelected.set(scope.scopeResourceId, {
                id: scope.scopeResourceId,
                name: scope.scopeDisplayName ?? scope.scopeResourceId,
                path: null,
                isFolder: scope.scopeType === 'folder' || scope.scopeType === 'root',
                status: 'existing',
                existingScopeId: scope.id,
                fileCount: scope.fileCount,
              })
            }
          }
          setSelectedScopes(preSelected)

          // PRD-112: Pre-populate explicitSelections
          const preExplicit = new Map<string, ExplicitSelection>()
          for (const scope of fetchedScopes) {
            if (scope.scopeResourceId) {
              if (scope.scopeType === 'root') {
                preExplicit.set(SYNC_ALL_KEY, 'include')
              } else {
                preExplicit.set(
                  scope.scopeResourceId,
                  (scope as { scopeMode?: string }).scopeMode === 'exclude' ? 'exclude' : 'include'
                )
              }
            }
          }
          setExplicitSelections(preExplicit)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load OneDrive contents')
      } finally {
        setIsBrowseLoading(false)
      }
    }

    fetchRoot()
  }, [step, connectionId, buildNodeMap, browseRefreshKey])

  // Fetch shared items when switching to shared tab for the first time (PRD-110)
  useEffect(() => {
    if (step !== 'browse' || !connectionId || browseTab !== 'shared' || sharedLoadedOnce) return

    const fetchShared = async () => {
      setIsSharedLoading(true)
      try {
        const response = await fetch(
          `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/browse-shared`,
          { credentials: 'include' }
        )

        if (response.status === 401) {
          setBrowseAuthError(true)
          return
        }

        if (!response.ok) {
          throw new Error(`Failed to load shared items: HTTP ${response.status}`)
        }

        const data: FolderListResult = await response.json()
        const sorted = sortItems(data.items)

        const nodes: TreeNodeData[] = sorted.map((item) => ({
          item,
          children: item.isFolder ? null : null,
          isExpanded: false,
          isLoading: false,
        }))

        const map = new Map<string, TreeNodeData>()
        buildNodeMap(nodes, map)

        setSharedNodes(nodes)
        setSharedNodeMap(map)
        setSharedLoadedOnce(true)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load shared items')
      } finally {
        setIsSharedLoading(false)
      }
    }

    fetchShared()
  }, [step, connectionId, browseTab, sharedLoadedOnce, buildNodeMap])

  // ============================================
  // Step 2: Toggle folder expand (lazy load children)
  // ============================================

  const handleToggleExpand = useCallback(
    async (itemId: string) => {
      if (!connectionId) return

      // Determine which tree this node belongs to
      const isInShared = sharedNodeMap.has(itemId)
      const currentNodeMap = isInShared ? sharedNodeMap : nodeMap
      const setCurrentNodes = isInShared ? setSharedNodes : setRootNodes
      const setCurrentNodeMap = isInShared ? setSharedNodeMap : setNodeMap

      const node = currentNodeMap.get(itemId)
      if (!node) return

      // Files cannot be expanded
      if (!node.item.isFolder) return

      // Already have children — just toggle visibility
      if (node.children !== null) {
        setCurrentNodes((prev) => {
          const cloned = structuredClone(prev)
          const target = findNode(cloned, itemId)
          if (target) target.isExpanded = !target.isExpanded
          return cloned
        })
        return
      }

      // Mark as loading + expanded optimistically
      setCurrentNodes((prev) => {
        const cloned = structuredClone(prev)
        const target = findNode(cloned, itemId)
        if (target) {
          target.isLoading = true
          target.isExpanded = true
        }
        return cloned
      })

      try {
        // PRD-110: Use shared folder endpoint for items with remoteDriveId
        const remoteDriveId = node.item.remoteDriveId
        const browseUrl = remoteDriveId
          ? `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/browse-shared/${remoteDriveId}/${itemId}`
          : `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/browse/${itemId}`

        const response = await fetch(browseUrl, { credentials: 'include' })

        if (response.status === 401) {
          setBrowseAuthError(true)
          return
        }

        if (!response.ok) {
          throw new Error(`Failed to load folder contents: HTTP ${response.status}`)
        }

        const data: FolderListResult = await response.json()
        const sorted = sortItems(data.items)

        // PRD-110: Children of shared folders inherit remoteDriveId
        const children: TreeNodeData[] = sorted.map((item) => ({
          item: remoteDriveId ? { ...item, remoteDriveId } : item,
          children: item.isFolder ? null : null,
          isExpanded: false,
          isLoading: false,
        }))

        setCurrentNodes((prev) => {
          const cloned = structuredClone(prev)
          const target = findNode(cloned, itemId)
          if (target) {
            target.children = children
            target.isLoading = false
          }
          return cloned
        })

        setCurrentNodeMap((prev) => {
          const next = new Map(prev)
          const updatedParent: TreeNodeData = { ...node, children, isLoading: false, isExpanded: true }
          next.set(itemId, updatedParent)
          for (const child of children) {
            next.set(child.item.id, child)
          }
          return next
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load folder')
        setCurrentNodes((prev) => {
          const cloned = structuredClone(prev)
          const target = findNode(cloned, itemId)
          if (target) {
            target.isLoading = false
            target.isExpanded = false
          }
          return cloned
        })
        setCurrentNodeMap((prev) => {
          const next = new Map(prev)
          next.set(itemId, { ...node, isLoading: false, isExpanded: false })
          return next
        })
      }
    },
    [connectionId, nodeMap, sharedNodeMap]
  )

  // ============================================
  // Step 2: Toggle folder selection
  // ============================================

  const handleToggleSelect = useCallback((item: ExternalFileItem) => {
    if (!item.isFolder && item.isSupported === false) return

    setExplicitSelections(prev => {
      const next = new Map(prev)
      const currentState = getEffectiveCheckState(item.id)

      if (currentState) {
        // UNCHECKING
        const node = findNodeInMaps(item.id)
        const parentId = node?.item.parentId
        const parentIsIncluded = parentId
          ? getEffectiveCheckState(parentId) !== false
          : isSyncAll

        if (parentIsIncluded && !next.has(item.id)) {
          // Item inherits from parent or "Sync All" — create explicit exclusion
          next.set(item.id, 'exclude')
        } else if (next.get(item.id) === 'include') {
          // Item was explicitly included — remove it
          next.delete(item.id)
        }

        // If folder, clear descendant explicit entries
        if (item.isFolder) {
          const clearDescendants = (folderId: string) => {
            const folderNode = findNodeInMaps(folderId)
            if (folderNode?.children) {
              for (const child of folderNode.children) {
                next.delete(child.item.id)
                if (child.item.isFolder) clearDescendants(child.item.id)
              }
            }
          }
          clearDescendants(item.id)
        }
      } else {
        // CHECKING
        next.set(item.id, 'include')

        // If folder, remove descendant exclusions (they inherit)
        if (item.isFolder) {
          const removeDescendantExclusions = (folderId: string) => {
            const folderNode = findNodeInMaps(folderId)
            if (folderNode?.children) {
              for (const child of folderNode.children) {
                if (next.get(child.item.id) === 'exclude') {
                  next.delete(child.item.id)
                }
                if (child.item.isFolder) removeDescendantExclusions(child.item.id)
              }
            }
          }
          removeDescendantExclusions(item.id)
        }
      }

      return next
    })
  }, [getEffectiveCheckState, findNodeInMaps, isSyncAll])

  // ============================================
  // Polling logic for sync status
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

          const relevantScopes = scopes.filter((s) => scopeIds.includes(s.id))
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
  // Step 3: Trigger sync when entering sync step
  // ============================================

  useEffect(() => {
    if (step !== 'sync' || !connectionId || syncState !== 'idle') return

    const runSync = async () => {
      setSyncState('syncing')
      setSyncError(null)

      try {
        // PRD-112: Build toAdd/toRemove from explicitSelections
        const existingScopeMap = new Map<string, ConnectionScopeWithStats>()
        for (const scope of existingScopes) {
          if (scope.scopeResourceId) {
            existingScopeMap.set(scope.scopeResourceId, scope)
          }
          // Also map root scopes
          if (scope.scopeType === 'root') {
            existingScopeMap.set(SYNC_ALL_KEY, scope)
          }
        }

        const toAdd: Array<{
          scopeType: string
          scopeResourceId: string
          scopeDisplayName: string
          scopePath?: string | null
          remoteDriveId?: string
          scopeMode?: 'include' | 'exclude'
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
                  scopeDisplayName: 'All Files',
                  scopeMode: 'include',
                })
              }
            }
            continue
          }

          const existingScope = existingScopeMap.get(resourceId)

          if (mode === 'include') {
            if (!existingScope || (existingScope as { scopeMode?: string }).scopeMode === 'exclude') {
              const node = findNodeInMaps(resourceId)
              toAdd.push({
                scopeType: node?.item.isFolder ? 'folder' : 'file',
                scopeResourceId: resourceId,
                scopeDisplayName: node?.item.name ?? resourceId,
                scopePath: node?.item.parentPath,
                remoteDriveId: node?.item.remoteDriveId,
                scopeMode: 'include',
              })
              // If there was an existing exclude scope, remove it
              if (existingScope && (existingScope as { scopeMode?: string }).scopeMode === 'exclude') {
                toRemove.push(existingScope.id)
              }
            }
          } else if (mode === 'exclude') {
            if (!existingScope || (existingScope as { scopeMode?: string }).scopeMode !== 'exclude') {
              const node = findNodeInMaps(resourceId)
              toAdd.push({
                scopeType: node?.item.isFolder ? 'folder' : 'file',
                scopeResourceId: resourceId,
                scopeDisplayName: node?.item.name ?? resourceId,
                scopePath: node?.item.parentPath,
                scopeMode: 'exclude',
              })
            }
          }
        }

        // Existing scopes no longer in explicitSelections → remove
        for (const scope of existingScopes) {
          if (scope.scopeResourceId && !explicitSelections.has(scope.scopeResourceId)) {
            if (scope.scopeType === 'root' && !explicitSelections.has(SYNC_ALL_KEY)) {
              toRemove.push(scope.id)
            } else if (scope.scopeType !== 'root') {
              // When switching to Sync All, remove individual include scopes (superseded by root)
              if (isSyncAll && (scope as { scopeMode?: string }).scopeMode !== 'exclude') {
                toRemove.push(scope.id)
              } else if (!isSyncAll) {
                toRemove.push(scope.id)
              }
            }
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
            newIncludeScopes.map((scope) =>
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
          startPolling(connectionId, newIncludeScopes.map((s) => s.id))
        } else {
          // Only exclusions/removals — done immediately
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
  }, [step, connectionId, syncState, explicitSelections, existingScopes, startPolling, findNodeInMaps, isSyncAll])

  // ============================================
  // Derived — aggregate progress across scopes
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
  // Done / Close handlers
  // ============================================

  const handleDone = useCallback(() => {
    fetchConnections()
    onClose()
  }, [fetchConnections, onClose])

  const handleClose = useCallback(() => {
    stopPolling()
    onClose()
  }, [stopPolling, onClose])

  // ============================================
  // Render
  // ============================================

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="sm:max-w-md">

        {/* ---- Step: connect ---- */}
        {step === 'connect' && (
          <>
            <DialogHeader>
              <DialogTitle>Connect to OneDrive</DialogTitle>
              <DialogDescription>
                Sign in with your Microsoft account to browse and sync your OneDrive files.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-4">
              <div className="size-16 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
                <Cloud className="size-8 text-[#0078D4]" />
              </div>

              <Button
                onClick={handleConnect}
                disabled={isConnecting}
                className="gap-2 bg-[#0078D4] hover:bg-[#106EBE] text-white w-full"
              >
                {isConnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Cloud className="size-4" />
                )}
                {isConnecting ? 'Connecting...' : 'Connect with Microsoft'}
              </Button>
            </div>
          </>
        )}

        {/* ---- Step: browse ---- */}
        {step === 'browse' && (
          <>
            <DialogHeader>
              <DialogTitle>Select Items to Sync</DialogTitle>
              <DialogDescription>
                {`Choose which OneDrive folders or files to make available for the ${AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT]} agent.`}
              </DialogDescription>
            </DialogHeader>

            {/* PRD-110: Tab selector */}
            <div className="flex border-b mb-2">
              <button
                type="button"
                className={`flex-1 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  browseTab === 'my-files'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setBrowseTab('my-files')}
              >
                My Files
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  browseTab === 'shared'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setBrowseTab('shared')}
              >
                Shared with me
              </button>
            </div>

            {/* PRD-112: Sync All toggle */}
            <div className="flex items-center justify-between px-2 py-1.5 border-b mb-1">
              <span className="text-sm font-medium">Select items to sync</span>
              <Button
                variant={isSyncAll ? 'default' : 'outline'}
                size="sm"
                onClick={handleSyncAll}
                className="text-xs h-7"
              >
                {isSyncAll ? <Check className="size-3 mr-1" /> : null}
                Sync All
              </Button>
            </div>

            <div className="min-h-[200px] max-h-[300px] overflow-y-auto border rounded-md py-1">
              {browseAuthError ? (
                <div className="flex flex-col items-center justify-center h-[200px] gap-3 px-4">
                  <Cloud className="size-8 text-muted-foreground" />
                  <p className="text-sm text-center text-muted-foreground">
                    Your OneDrive session has expired. Please sign in again to continue.
                  </p>
                  <Button
                    size="sm"
                    onClick={async () => {
                      setBrowseAuthError(false)
                      await handleConnect()
                      // Bump refresh key to re-trigger browse fetch after re-auth
                      setBrowseRefreshKey((k) => k + 1)
                    }}
                    disabled={isConnecting}
                    className="gap-1.5 bg-[#0078D4] hover:bg-[#106EBE] text-white"
                  >
                    {isConnecting ? <Loader2 className="size-3.5 animate-spin" /> : <Cloud className="size-3.5" />}
                    {isConnecting ? 'Reconnecting...' : 'Reconnect'}
                  </Button>
                </div>
              ) : isBrowseLoading ? (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Loading contents...</span>
                </div>
              ) : browseTab === 'my-files' ? (
                rootNodes.length === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                    <span className="text-sm">No items found</span>
                  </div>
                ) : (
                  rootNodes.map((node) => (
                    <TreeNode
                      key={node.item.id}
                      node={node}
                      depth={0}
                      selectedScopes={selectedScopes}
                      getCheckState={getEffectiveCheckState}
                      onToggleExpand={handleToggleExpand}
                      onToggleSelect={handleToggleSelect}
                    />
                  ))
                )
              ) : isSharedLoading ? (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Loading shared items...</span>
                </div>
              ) : sharedNodes.length === 0 ? (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                  <span className="text-sm">No shared items found</span>
                </div>
              ) : (
                sharedNodes.map((node) => (
                  <TreeNode
                    key={node.item.id}
                    node={node}
                    depth={0}
                    selectedScopes={selectedScopes}
                    getCheckState={getEffectiveCheckState}
                    onToggleExpand={handleToggleExpand}
                    onToggleSelect={handleToggleSelect}
                  />
                ))
              )}
            </div>

            {(explicitSelections.size > 0 || selectedScopes.size > 0) && (
              <p className="text-xs text-muted-foreground">
                {isSyncAll
                  ? 'All files selected'
                  : (() => {
                      const inclusions = Array.from(explicitSelections.entries()).filter(([, m]) => m === 'include' && true)
                      const exclusions = Array.from(explicitSelections.entries()).filter(([, m]) => m === 'exclude')
                      const parts: string[] = []
                      if (inclusions.length > 0) parts.push(`${inclusions.length} included`)
                      if (exclusions.length > 0) parts.push(`${exclusions.length} excluded`)
                      return parts.length > 0 ? parts.join(', ') : `${selectedScopes.size} selected`
                    })()
                }
              </p>
            )}

            {isReconfiguring && showDiff && (
              <ScopeDiffView
                selectedScopes={selectedScopes}
                onConfirm={() => {
                  setShowDiff(false)
                  setStep('sync')
                }}
                onCancel={() => setShowDiff(false)}
              />
            )}

            {!showDiff && (
              <DialogFooter>
                <Button
                  onClick={() => {
                    if (isReconfiguring) {
                      const values = Array.from(selectedScopes.values())
                      const hasChanges = explicitSelections.size > 0 || values.some((s) => s.status === 'new' || s.status === 'removed')
                      if (hasChanges) {
                        setShowDiff(true)
                      } else {
                        onClose()
                      }
                    } else {
                      setStep('sync')
                    }
                  }}
                  disabled={!isReconfiguring && explicitSelections.size === 0}
                >
                  {isReconfiguring ? 'Save Changes' : 'Continue'}
                </Button>
              </DialogFooter>
            )}
          </>
        )}

        {/* ---- Step: sync ---- */}
        {step === 'sync' && (
          <>
            <DialogHeader>
              <DialogTitle>{isReconfiguring ? 'Updating Scopes' : 'Syncing Files'}</DialogTitle>
              <DialogDescription>
                {syncState === 'complete'
                  ? isReconfiguring
                    ? 'Your sync scopes have been updated successfully.'
                    : 'Your OneDrive items have been synced successfully.'
                  : syncState === 'error'
                    ? 'An error occurred while syncing.'
                    : isReconfiguring
                      ? 'Applying scope changes...'
                      : 'Importing files from your selected OneDrive items.'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-4">
              {syncState === 'complete' && (
                <>
                  <div className="size-16 rounded-full bg-green-50 dark:bg-green-950 flex items-center justify-center">
                    <Check className="size-8 text-green-600" />
                  </div>
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    Sync complete!
                  </p>
                </>
              )}

              {syncState === 'error' && (
                <>
                  <p className="text-sm text-destructive text-center">{syncError}</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSyncState('idle')
                      setSyncError(null)
                      setScopeProgress(new Map())
                    }}
                  >
                    Retry
                  </Button>
                </>
              )}

              {(syncState === 'idle' || syncState === 'syncing') && (
                <>
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                  <div className="w-full space-y-2">
                    <Progress value={aggregatedProgress.percentage} className="h-2" />
                    <p className="text-xs text-center text-muted-foreground">
                      {aggregatedProgress.totalFiles > 0
                        ? `Syncing... ${aggregatedProgress.totalProcessed} / ${aggregatedProgress.totalFiles} files`
                        : 'Preparing sync...'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {syncState === 'complete' && (
              <DialogFooter>
                <Button onClick={handleDone}>Done</Button>
              </DialogFooter>
            )}
          </>
        )}

      </DialogContent>
    </Dialog>
  )
}
