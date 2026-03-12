import type { ExternalFileItem } from '@bc-agent/shared'

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
