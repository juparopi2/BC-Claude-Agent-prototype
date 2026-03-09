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
  ArrowLeft,
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
import type { ExternalFileItem, FolderListResult, ConnectionScopeDetail, ConnectionScopeWithStats, ScopeBatchResult } from '@bc-agent/shared'
import { CONNECTIONS_API, AGENT_DISPLAY_NAME, AGENT_ID } from '@bc-agent/shared'
import { env } from '@/lib/config/env'
import { useIntegrationListStore } from '@/src/domains/integrations'
import { toast } from 'sonner'
import { getFileIconType, FileIcon as FileTypeIcon, fileTypeColors } from '@/src/presentation/chat/file-type-utils'
import { ScopeDiffView } from './ScopeDiffView'

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

type SyncState = 'idle' | 'syncing' | 'complete' | 'error'

interface TreeNodeData {
  item: ExternalFileItem
  children: TreeNodeData[] | null
  isExpanded: boolean
  isLoading: boolean
}

interface SelectedScope {
  id: string
  name: string
  path: string | null
  isFolder: boolean
  status: 'new' | 'existing' | 'removed'
  existingScopeId?: string
  fileCount?: number
}

interface ScopeProgressEntry {
  processedFiles: number
  totalFiles: number
  percentage: number
}

interface AuthInitiateResponse {
  status: 'connected' | 'requires_consent'
  connectionId?: string
  authUrl?: string
}

interface SyncStatusResponse {
  scopes: Array<{
    id: string
    syncStatus: string
    itemCount: number
    processedCount?: number
  }>
}

interface CreateScopesResponse {
  scopes: ConnectionScopeDetail[]
}

// ============================================
// Utility — find a node in the tree by id
// ============================================

function findNode(nodes: TreeNodeData[], id: string): TreeNodeData | null {
  for (const node of nodes) {
    if (node.item.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

// ============================================
// Utility — sort folders first, then files, both alphabetically
// ============================================

function sortItems(items: ExternalFileItem[]): ExternalFileItem[] {
  return [...items].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

// ============================================
// Utility — format file size for display
// ============================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// ============================================
// TreeNode — recursive folder/file row
// ============================================

interface TreeNodeProps {
  node: TreeNodeData
  depth: number
  selectedScopes: Map<string, SelectedScope>
  onToggleExpand: (itemId: string) => void
  onToggleSelect: (item: ExternalFileItem) => void
}

function TreeNode({ node, depth, selectedScopes, onToggleExpand, onToggleSelect }: TreeNodeProps) {
  const { item } = node
  const isSelected = selectedScopes.has(item.id)

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
            checked={isSelected && selectedScopes.get(item.id)?.status !== 'removed'}
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

  return (
    <div
      className="flex items-center gap-1.5 py-1.5 pr-2 rounded-md hover:bg-muted/50 select-none"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      {/* Spacer (no chevron for files) */}
      <span className="size-4 shrink-0" />

      {/* Checkbox */}
      <Checkbox
        id={`item-${item.id}`}
        checked={isSelected && selectedScopes.get(item.id)?.status !== 'removed'}
        onCheckedChange={() => onToggleSelect(item)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${item.name}`}
      />

      {/* File type icon */}
      <FileTypeIcon
        iconType={iconType}
        className={`size-4 shrink-0 ${colors?.icon ?? 'text-muted-foreground'}`}
      />

      {/* Name */}
      <span className={`text-sm truncate flex-1 ${selectedScopes.get(item.id)?.status === 'removed' ? 'line-through text-muted-foreground' : ''}`}>
        {item.name}
      </span>
      {selectedScopes.get(item.id)?.status === 'existing' && (
        <span className="text-[10px] text-green-600 dark:text-green-400 shrink-0 ml-1">Synced</span>
      )}
      {selectedScopes.get(item.id)?.status === 'removed' && (
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
  const [nodeMap, setNodeMap] = useState<Map<string, TreeNodeData>>(new Map())
  const [selectedScopes, setSelectedScopes] = useState<Map<string, SelectedScope>>(new Map())
  const [existingScopes, setExistingScopes] = useState<ConnectionScopeWithStats[]>([])
  const isReconfiguring = existingScopes.length > 0

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
    setNodeMap(new Map())
    setSelectedScopes(new Map())
    setExistingScopes([])
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
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load OneDrive contents')
      } finally {
        setIsBrowseLoading(false)
      }
    }

    fetchRoot()
  }, [step, connectionId, buildNodeMap])

  // ============================================
  // Step 2: Toggle folder expand (lazy load children)
  // ============================================

  const handleToggleExpand = useCallback(
    async (itemId: string) => {
      if (!connectionId) return

      const node = nodeMap.get(itemId)
      if (!node) return

      // Files cannot be expanded
      if (!node.item.isFolder) return

      // Already have children — just toggle visibility
      if (node.children !== null) {
        setRootNodes((prev) => {
          const cloned = structuredClone(prev)
          const target = findNode(cloned, itemId)
          if (target) target.isExpanded = !target.isExpanded
          return cloned
        })
        return
      }

      // Mark as loading + expanded optimistically
      setRootNodes((prev) => {
        const cloned = structuredClone(prev)
        const target = findNode(cloned, itemId)
        if (target) {
          target.isLoading = true
          target.isExpanded = true
        }
        return cloned
      })

      try {
        const response = await fetch(
          `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/browse/${itemId}`,
          { credentials: 'include' }
        )

        if (!response.ok) {
          throw new Error(`Failed to load folder contents: HTTP ${response.status}`)
        }

        const data: FolderListResult = await response.json()
        const sorted = sortItems(data.items)

        const children: TreeNodeData[] = sorted.map((item) => ({
          item,
          children: item.isFolder ? null : null,
          isExpanded: false,
          isLoading: false,
        }))

        setRootNodes((prev) => {
          const cloned = structuredClone(prev)
          const target = findNode(cloned, itemId)
          if (target) {
            target.children = children
            target.isLoading = false
          }
          return cloned
        })

        setNodeMap((prev) => {
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
        setRootNodes((prev) => {
          const cloned = structuredClone(prev)
          const target = findNode(cloned, itemId)
          if (target) {
            target.isLoading = false
            target.isExpanded = false
          }
          return cloned
        })
        setNodeMap((prev) => {
          const next = new Map(prev)
          next.set(itemId, { ...node, isLoading: false, isExpanded: false })
          return next
        })
      }
    },
    [connectionId, nodeMap]
  )

  // ============================================
  // Step 2: Toggle folder selection
  // ============================================

  const handleToggleSelect = useCallback((item: ExternalFileItem) => {
    setSelectedScopes((prev) => {
      const next = new Map(prev)
      const existing = next.get(item.id)

      if (existing) {
        if (existing.status === 'existing') {
          // Mark existing scope for removal
          next.set(item.id, { ...existing, status: 'removed' })
        } else if (existing.status === 'removed') {
          // Restore existing scope
          next.set(item.id, { ...existing, status: 'existing' })
        } else {
          // Remove new selection
          next.delete(item.id)
        }
      } else {
        // New selection
        next.set(item.id, {
          id: item.id,
          name: item.name,
          path: item.parentPath,
          isFolder: item.isFolder,
          status: 'new',
        })
      }
      return next
    })
  }, [])

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
        if (isReconfiguring) {
          // Batch mode: add new scopes, remove deleted ones
          const scopeValues = Array.from(selectedScopes.values())
          const toAdd = scopeValues
            .filter((s) => s.status === 'new')
            .map((s) => ({
              scopeType: s.isFolder ? 'folder' : 'file',
              scopeResourceId: s.id,
              scopeDisplayName: s.name,
              scopePath: s.path,
            }))
          const toRemove = scopeValues
            .filter((s) => s.status === 'removed' && s.existingScopeId)
            .map((s) => s.existingScopeId!)

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
          const newScopes = batchResult.added ?? []

          if (newScopes.length > 0) {
            // Trigger sync for new scopes
            await Promise.all(
              newScopes.map((scope) =>
                fetch(
                  `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes/${scope.id}/sync`,
                  { method: 'POST', credentials: 'include' }
                )
              )
            )

            const initProgress = new Map<string, ScopeProgressEntry>()
            for (const scope of newScopes) {
              initProgress.set(scope.id, { processedFiles: 0, totalFiles: 0, percentage: 0 })
            }
            setScopeProgress(initProgress)
            startPolling(connectionId, newScopes.map((s) => s.id))
          } else {
            // Only removals — done immediately
            setSyncState('complete')
            useIntegrationListStore.getState().fetchConnections()
          }
        } else {
          // First-time setup: original flow
          const scopesPayload = Array.from(selectedScopes.values()).map((s) => ({
            scopeType: s.isFolder ? 'folder' : 'file',
            scopeResourceId: s.id,
            scopeDisplayName: s.name,
            scopePath: s.path,
          }))

          const scopesResponse = await fetch(
            `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scopes: scopesPayload }),
            }
          )

          if (!scopesResponse.ok) {
            const body = await scopesResponse.json().catch(() => ({})) as { message?: string }
            throw new Error(body.message ?? `Failed to create scopes: HTTP ${scopesResponse.status}`)
          }

          const scopesData = await scopesResponse.json() as CreateScopesResponse
          const createdScopes = scopesData.scopes ?? []

          await Promise.all(
            createdScopes.map((scope) =>
              fetch(
                `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes/${scope.id}/sync`,
                { method: 'POST', credentials: 'include' }
              )
            )
          )

          const initProgress = new Map<string, ScopeProgressEntry>()
          for (const scope of createdScopes) {
            initProgress.set(scope.id, { processedFiles: 0, totalFiles: 0, percentage: 0 })
          }
          setScopeProgress(initProgress)
          startPolling(connectionId, createdScopes.map((s) => s.id))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed'
        setSyncError(message)
        setSyncState('error')
        toast.error(message)
      }
    }

    void runSync()
  }, [step, connectionId, syncState, selectedScopes, startPolling, isReconfiguring])

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

            <div className="min-h-[200px] max-h-[300px] overflow-y-auto border rounded-md py-1">
              {isBrowseLoading ? (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Loading contents...</span>
                </div>
              ) : rootNodes.length === 0 ? (
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
                    onToggleExpand={handleToggleExpand}
                    onToggleSelect={handleToggleSelect}
                  />
                ))
              )}
            </div>

            {selectedScopes.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {(() => {
                  const values = Array.from(selectedScopes.values())
                  const folderCount = values.filter((s) => s.isFolder).length
                  const fileCount = values.filter((s) => !s.isFolder).length
                  const parts: string[] = []
                  if (folderCount > 0) parts.push(`${folderCount} folder${folderCount !== 1 ? 's' : ''}`)
                  if (fileCount > 0) parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''}`)
                  return `${parts.join(', ')} selected`
                })()}
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
                {!isReconfiguring && (
                  <Button
                    variant="outline"
                    onClick={() => setStep('connect')}
                    className="gap-1.5"
                  >
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                )}
                <Button
                  onClick={() => {
                    if (isReconfiguring) {
                      const values = Array.from(selectedScopes.values())
                      const hasChanges = values.some((s) => s.status === 'new' || s.status === 'removed')
                      if (hasChanges) {
                        setShowDiff(true)
                      } else {
                        onClose()
                      }
                    } else {
                      setStep('sync')
                    }
                  }}
                  disabled={!isReconfiguring && selectedScopes.size === 0}
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
