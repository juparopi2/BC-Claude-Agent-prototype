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
import type { ExternalFileItem, FolderListResult, ConnectionScopeDetail } from '@bc-agent/shared'
import { CONNECTIONS_API } from '@bc-agent/shared'
import { env } from '@/lib/config/env'
import { useIntegrationListStore } from '@/src/domains/integrations'
import { toast } from 'sonner'

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

interface FolderNodeData {
  item: ExternalFileItem
  children: FolderNodeData[] | null
  isExpanded: boolean
  isLoading: boolean
}

interface SelectedScope {
  id: string
  name: string
  path: string | null
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

function findNode(nodes: FolderNodeData[], id: string): FolderNodeData | null {
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
// FolderNode — recursive folder row
// ============================================

interface FolderNodeProps {
  node: FolderNodeData
  depth: number
  selectedScopes: Map<string, SelectedScope>
  onToggleExpand: (itemId: string) => void
  onToggleSelect: (item: ExternalFileItem) => void
}

function FolderNode({ node, depth, selectedScopes, onToggleExpand, onToggleSelect }: FolderNodeProps) {
  const { item } = node
  const isSelected = selectedScopes.has(item.id)

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
          id={`folder-${item.id}`}
          checked={isSelected}
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
          className="text-sm truncate flex-1"
          onClick={() => onToggleExpand(item.id)}
        >
          {item.name}
        </span>
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
              <FolderNode
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
  const [rootNodes, setRootNodes] = useState<FolderNodeData[]>([])
  const [isBrowseLoading, setIsBrowseLoading] = useState(false)
  const [nodeMap, setNodeMap] = useState<Map<string, FolderNodeData>>(new Map())
  const [selectedScopes, setSelectedScopes] = useState<Map<string, SelectedScope>>(new Map())

  // Step 3: sync
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [scopeProgress, setScopeProgress] = useState<Map<string, ScopeProgressEntry>>(new Map())
  const [syncError, setSyncError] = useState<string | null>(null)
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
    (nodes: FolderNodeData[], map: Map<string, FolderNodeData>): void => {
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
        const response = await fetch(
          `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/browse`,
          { credentials: 'include' }
        )

        if (!response.ok) {
          throw new Error(`Failed to load folders: HTTP ${response.status}`)
        }

        const data: FolderListResult = await response.json()
        const folders = data.items.filter((i) => i.isFolder)

        const nodes: FolderNodeData[] = folders.map((item) => ({
          item,
          children: null,
          isExpanded: false,
          isLoading: false,
        }))

        const map = new Map<string, FolderNodeData>()
        buildNodeMap(nodes, map)

        setRootNodes(nodes)
        setNodeMap(map)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load OneDrive folders')
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
        const subFolders = data.items.filter((i) => i.isFolder)

        const children: FolderNodeData[] = subFolders.map((item) => ({
          item,
          children: null,
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
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.set(item.id, {
          id: item.id,
          name: item.name,
          path: item.parentPath,
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
            setSyncError('One or more folders failed to sync')
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
        // 1. Create scopes
        const scopesPayload = Array.from(selectedScopes.values()).map((s) => ({
          scopeType: 'folder',
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

        // 2. Trigger sync for each scope
        await Promise.all(
          createdScopes.map((scope) =>
            fetch(
              `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes/${scope.id}/sync`,
              {
                method: 'POST',
                credentials: 'include',
              }
            )
          )
        )

        // 3. Initialise progress map
        const initProgress = new Map<string, ScopeProgressEntry>()
        for (const scope of createdScopes) {
          initProgress.set(scope.id, { processedFiles: 0, totalFiles: 0, percentage: 0 })
        }
        setScopeProgress(initProgress)

        // 4. Start polling
        startPolling(connectionId, createdScopes.map((s) => s.id))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed'
        setSyncError(message)
        setSyncState('error')
        toast.error(message)
      }
    }

    void runSync()
  }, [step, connectionId, syncState, selectedScopes, startPolling])

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
              <DialogTitle>Select Folders to Sync</DialogTitle>
              <DialogDescription>
                Choose which OneDrive folders to make available for AI search.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-[200px] max-h-[300px] overflow-y-auto border rounded-md py-1">
              {isBrowseLoading ? (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Loading folders...</span>
                </div>
              ) : rootNodes.length === 0 ? (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                  <span className="text-sm">No folders found</span>
                </div>
              ) : (
                rootNodes.map((node) => (
                  <FolderNode
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
                {selectedScopes.size} folder{selectedScopes.size !== 1 ? 's' : ''} selected
              </p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep('connect')}
                className="gap-1.5"
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>
              <Button
                onClick={() => setStep('sync')}
                disabled={selectedScopes.size === 0}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ---- Step: sync ---- */}
        {step === 'sync' && (
          <>
            <DialogHeader>
              <DialogTitle>Syncing Files</DialogTitle>
              <DialogDescription>
                {syncState === 'complete'
                  ? 'Your OneDrive folders have been synced successfully.'
                  : syncState === 'error'
                    ? 'An error occurred while syncing.'
                    : 'Importing files from your selected OneDrive folders.'}
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
