import type { ExternalFileItem } from '@bc-agent/shared'

// ============================================
// Tri-State Selection Types & Pure Functions
// ============================================

export type ExplicitSelection = 'include' | 'exclude'
export const SYNC_ALL_KEY = '__ROOT__'

/** Provider-agnostic node descriptor used by the tri-state selection logic. */
export interface NodeInfo {
  id: string
  parentId: string | null
  isFolder: boolean
  childIds: string[]  // IDs of loaded children
}

/**
 * Compute the effective check state for an item given the explicit selections,
 * tree structure, and whether "Sync All" is active.
 */
export function getEffectiveCheckState(
  itemId: string,
  explicitSelections: Map<string, ExplicitSelection>,
  findNode: (id: string) => NodeInfo | null,
  isSyncAll: boolean
): boolean | 'indeterminate' {
  const explicit = explicitSelections.get(itemId)

  if (explicit === 'exclude') return false

  if (explicit === 'include') {
    // Check if any loaded children are excluded → indeterminate
    const node = findNode(itemId)
    if (node?.isFolder && node.childIds.length > 0) {
      const hasExcluded = node.childIds.some(childId =>
        explicitSelections.get(childId) === 'exclude'
      )
      if (hasExcluded) return 'indeterminate'
    }
    return true
  }

  // No explicit selection — inherit from parent
  const node = findNode(itemId)
  if (node?.parentId) {
    const parentState = getEffectiveCheckState(node.parentId, explicitSelections, findNode, isSyncAll)
    if (parentState === true || parentState === 'indeterminate') return true
    // Parent is explicitly excluded — item is inside an excluded subtree.
    // Do NOT override with isSyncAll; exclusions always win over Sync All.
    if (parentState === false) return false
  }

  // "Sync All" — root include means everything is checked by default
  if (isSyncAll) return true

  return false
}

/**
 * Compute the new explicit selections map after toggling an item.
 * Returns a new Map (does not mutate the input).
 */
export function computeToggleSelect(
  item: { id: string; isFolder: boolean },
  explicitSelections: Map<string, ExplicitSelection>,
  findNode: (id: string) => NodeInfo | null,
  isSyncAll: boolean
): Map<string, ExplicitSelection> {
  const next = new Map(explicitSelections)
  const currentState = getEffectiveCheckState(item.id, explicitSelections, findNode, isSyncAll)

  if (currentState) {
    // UNCHECKING
    const node = findNode(item.id)
    const parentId = node?.parentId
    const parentIsIncluded = parentId
      ? getEffectiveCheckState(parentId, explicitSelections, findNode, isSyncAll) !== false
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
        const folderNode = findNode(folderId)
        if (folderNode) {
          for (const childId of folderNode.childIds) {
            next.delete(childId)
            const childNode = findNode(childId)
            if (childNode?.isFolder) clearDescendants(childId)
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
        const folderNode = findNode(folderId)
        if (folderNode) {
          for (const childId of folderNode.childIds) {
            if (next.get(childId) === 'exclude') {
              next.delete(childId)
            }
            const childNode = findNode(childId)
            if (childNode?.isFolder) removeDescendantExclusions(childId)
          }
        }
      }
      removeDescendantExclusions(item.id)
    }
  }

  return next
}

/**
 * Compute the new explicit selections map after toggling "Sync All".
 * Returns a new Map (does not mutate the input).
 */
export function computeSyncAllToggle(
  explicitSelections: Map<string, ExplicitSelection>
): Map<string, ExplicitSelection> {
  if (explicitSelections.get(SYNC_ALL_KEY) === 'include') {
    // Toggle off: clear everything
    return new Map()
  }
  // Toggle on: set root include, clear everything else
  return new Map([[SYNC_ALL_KEY, 'include' as ExplicitSelection]])
}

// ============================================
// Shared Types
// ============================================

export interface TreeNodeData {
  item: ExternalFileItem
  children: TreeNodeData[] | null
  isExpanded: boolean
  isLoading: boolean
}

export interface SelectedScope {
  id: string
  name: string
  path: string | null
  isFolder: boolean
  status: 'new' | 'existing' | 'removed'
  existingScopeId?: string
  fileCount?: number
  remoteDriveId?: string
  remoteItemId?: string
  scopeMode?: 'include' | 'exclude'
  scopeSiteId?: string
}

export type SyncState = 'idle' | 'syncing' | 'complete' | 'error'

export interface ScopeProgressEntry {
  processedFiles: number
  totalFiles: number
  percentage: number
}

export interface AuthInitiateResponse {
  status: 'connected' | 'requires_consent'
  connectionId?: string
  authUrl?: string
}

export interface SyncStatusResponse {
  scopes: Array<{
    id: string
    syncStatus: string
    itemCount: number
    processedCount?: number
  }>
}

// ============================================
// Utility Functions
// ============================================

/** Find a node in a tree by id (recursive) */
export function findNode(nodes: TreeNodeData[], id: string): TreeNodeData | null {
  for (const node of nodes) {
    if (node.item.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

/** Sort folders first, then files, both alphabetically */
export function sortItems(items: ExternalFileItem[]): ExternalFileItem[] {
  return [...items].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** Format file size for display */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
