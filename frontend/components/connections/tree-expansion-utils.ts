/**
 * Tree Expansion Utilities
 *
 * Shared helpers for managing tree node expansion state in the OneDrive and
 * SharePoint connection wizards. Includes deep-collapse, ancestor resolution
 * via API, level-by-level expansion orchestration, and localStorage preference
 * helpers.
 *
 * @module components/connections/tree-expansion-utils
 */

import type { TreeNodeData } from './wizard-utils'
import { sortItems } from './wizard-utils'
import type { ExternalFileItem, FolderListResult } from '@bc-agent/shared'
import { CONNECTIONS_API } from '@bc-agent/shared'
import { env } from '@/lib/config/env'

// ============================================
// Tree Collapse
// ============================================

/**
 * Deep-clone the given tree and set `isExpanded = false` on every node
 * recursively. Returns a new array; does not mutate the input.
 *
 * Used by both OneDrive and SharePoint wizards to reset the tree to a fully
 * collapsed state (e.g. when the user switches to "collapsed" view preference).
 */
export function collapseAllNodes(nodes: TreeNodeData[]): TreeNodeData[] {
  return nodes.map((node) => ({
    ...node,
    isExpanded: false,
    children: node.children ? collapseAllNodes(node.children) : null,
  }))
}

// ============================================
// Ancestor Resolution API Call
// ============================================

/**
 * Resolve ancestor chains for a set of item IDs by calling the backend
 * resolve-ancestors endpoint.
 *
 * @param connectionId - The connection whose items should be resolved.
 * @param itemIds - The scope item IDs whose ancestor chains are needed.
 * @param driveId - Optional drive ID (required for OneDrive; omitted for
 *   SharePoint where the drive is implicit in the item).
 * @returns A map of scopeId → ordered ancestor IDs (root first, direct parent
 *   last). Returns an empty object on network or parse errors.
 */
export async function resolveAncestors(
  connectionId: string,
  itemIds: string[],
  driveId?: string
): Promise<Record<string, string[]>> {
  const url = `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/resolve-ancestors`

  const body: { itemIds: string[]; driveId?: string } = { itemIds }
  if (driveId !== undefined) {
    body.driveId = driveId
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.error(
        `[resolveAncestors] Request failed: ${response.status} ${response.statusText}`
      )
      return {}
    }

    const data = (await response.json()) as { ancestors: Record<string, string[]> }
    return data.ancestors ?? {}
  } catch (error) {
    console.error('[resolveAncestors] Unexpected error:', error)
    return {}
  }
}

// ============================================
// Level-by-Level Expansion Orchestrator
// ============================================

/**
 * Parameters accepted by `expandToSyncRoots`.
 */
export interface ExpandToSyncRootsParams {
  /**
   * Map of scopeId → ordered ancestor IDs.
   *
   * Each value is an array where index 0 is the root-level ancestor and the
   * last entry is the direct parent of the scope item. The scope item itself
   * must NOT be included — this function only expands ancestors.
   *
   * Produced by `resolveAncestors()`.
   */
  ancestorChains: Record<string, string[]>

  /**
   * Wizard-specific function that fetches children for a node (if not yet
   * loaded) and sets `isExpanded = true` on it.
   *
   * The implementation is provided by each wizard so that it can update its
   * own React state / store correctly.
   */
  fetchAndExpandNode: (nodeId: string) => Promise<void>
}

/**
 * Expand the tree top-down so that all sync-root items are visible.
 *
 * The algorithm:
 * 1. Collect all unique ancestor IDs across all chains, grouped by their
 *    depth index within the chain (0 = root level, 1 = one level down, …).
 * 2. Iterate depth levels from 0 upward, expanding every node at the current
 *    depth before moving to the next (breadth-first).
 * 3. Nodes at the same depth level are expanded in parallel.
 * 4. The scope items themselves are NOT expanded — only their ancestors are.
 *
 * This ensures that parent nodes are fully loaded before their children are
 * expanded, which is required when expansion triggers a lazy data fetch.
 */
export async function expandToSyncRoots(params: ExpandToSyncRootsParams): Promise<void> {
  const { ancestorChains, fetchAndExpandNode } = params

  // Group ancestor IDs by depth level across all chains.
  // depthMap[depth] = Set of node IDs that appear at that depth.
  const depthMap = new Map<number, Set<string>>()

  for (const chain of Object.values(ancestorChains)) {
    chain.forEach((nodeId, depth) => {
      let bucket = depthMap.get(depth)
      if (!bucket) {
        bucket = new Set<string>()
        depthMap.set(depth, bucket)
      }
      bucket.add(nodeId)
    })
  }

  if (depthMap.size === 0) {
    return
  }

  // Sort depth levels ascending so we always expand parents before children.
  const sortedDepths = Array.from(depthMap.keys()).sort((a, b) => a - b)

  for (const depth of sortedDepths) {
    const nodeIds = depthMap.get(depth)!
    // Expand all nodes at this depth level in parallel, then await completion
    // before proceeding to the next level.
    await Promise.all(Array.from(nodeIds).map((nodeId) => fetchAndExpandNode(nodeId)))
  }
}

// ============================================
// Batch Fetch for Ancestor Contents
// ============================================

/**
 * Fetch the folder contents for all unique ancestor IDs across all chains in
 * a single parallel batch.
 *
 * @returns Map of nodeId → sorted child items. Failed fetches are logged with
 *   console.warn and omitted from the result (not thrown).
 */
export async function fetchAncestorContents(params: {
  ancestorChains: Record<string, string[]>
  browseUrlResolver: (nodeId: string) => string
}): Promise<Map<string, ExternalFileItem[]>> {
  const { ancestorChains, browseUrlResolver } = params

  // Collect all unique ancestor IDs
  const uniqueIds = new Set<string>()
  for (const chain of Object.values(ancestorChains)) {
    for (const id of chain) {
      uniqueIds.add(id)
    }
  }

  const result = new Map<string, ExternalFileItem[]>()
  if (uniqueIds.size === 0) return result

  // Fire one fetch per unique ancestor in parallel
  const entries = Array.from(uniqueIds)
  const fetches = entries.map(async (nodeId) => {
    try {
      const response = await fetch(browseUrlResolver(nodeId), {
        credentials: 'include',
      })
      if (!response.ok) {
        console.warn(`[fetchAncestorContents] Failed to fetch ${nodeId}: HTTP ${response.status}`)
        return
      }
      const data = (await response.json()) as FolderListResult
      result.set(nodeId, sortItems(data.items))
    } catch (error) {
      console.warn(`[fetchAncestorContents] Error fetching ${nodeId}:`, error)
    }
  })

  await Promise.all(fetches)
  return result
}

// ============================================
// Apply Expansion to Tree (Pure Function)
// ============================================

/**
 * Clone a tree and apply fetched ancestor contents to it in a single pass.
 * For each ancestor:
 * - If `children !== null` → just set `isExpanded = true` (preserves manual
 *   expansions, never toggles/collapses).
 * - If `children === null` and fetched content exists → set `children` from
 *   the fetched content and set `isExpanded = true`.
 *
 * Returns a new `{ nodes, nodeMap }` — the caller sets state once.
 */
export function applyExpansionToTree(params: {
  currentNodes: TreeNodeData[]
  currentNodeMap: Map<string, TreeNodeData>
  contentsByNodeId: Map<string, ExternalFileItem[]>
  ancestorChains: Record<string, string[]>
  remoteDriveIdMap?: Map<string, string>
}): { nodes: TreeNodeData[]; nodeMap: Map<string, TreeNodeData> } {
  const { currentNodes, contentsByNodeId, ancestorChains, remoteDriveIdMap } = params

  // Collect all ancestor IDs that need expansion
  const ancestorIds = new Set<string>()
  for (const chain of Object.values(ancestorChains)) {
    for (const id of chain) {
      ancestorIds.add(id)
    }
  }

  // Deep-clone the tree
  const clonedNodes: TreeNodeData[] = structuredClone(currentNodes)

  // Rebuild nodeMap from the clone so all references point to cloned nodes
  const newNodeMap = new Map<string, TreeNodeData>()
  const registerNodes = (nodes: TreeNodeData[]) => {
    for (const node of nodes) {
      newNodeMap.set(node.item.id, node)
      if (node.children) {
        registerNodes(node.children)
      }
    }
  }
  registerNodes(clonedNodes)

  // Apply expansions
  for (const nodeId of ancestorIds) {
    const node = newNodeMap.get(nodeId)
    if (!node) continue

    if (node.children !== null) {
      // Already has children — just expand (never toggle/collapse)
      node.isExpanded = true
    } else {
      // Children not loaded yet — apply fetched content
      const items = contentsByNodeId.get(nodeId)
      if (items) {
        // Determine remoteDriveId for this node (for shared items)
        const remoteDriveId = remoteDriveIdMap?.get(nodeId) ?? node.item.remoteDriveId
        const children: TreeNodeData[] = items.map((item) => ({
          item: remoteDriveId ? { ...item, remoteDriveId } : item,
          children: item.isFolder ? null : null,
          isExpanded: false,
          isLoading: false,
        }))
        node.children = children
        node.isExpanded = true
        // Register new children in nodeMap
        for (const child of children) {
          newNodeMap.set(child.item.id, child)
        }
      }
    }
  }

  return { nodes: clonedNodes, nodeMap: newNodeMap }
}

// ============================================
// localStorage Preference Helpers
// ============================================

const WIZARD_EXPAND_PREF_KEY = 'mwm-wizard-expand-pref'

/**
 * Retrieve the tree-expansion preference for a specific connection.
 *
 * Reads from `localStorage` using the key
 * `mwm-wizard-expand-pref:{connectionId}`.
 *
 * @returns `'auto-expand'` when the preference is absent or set to that value,
 *   `'collapsed'` when the user has explicitly chosen collapsed view.
 */
export function getWizardExpandPref(
  connectionId: string
): 'auto-expand' | 'collapsed' {
  try {
    const raw = localStorage.getItem(`${WIZARD_EXPAND_PREF_KEY}:${connectionId}`)
    if (raw === 'collapsed') return 'collapsed'
  } catch {
    // localStorage may be unavailable (SSR, private browsing restrictions).
  }
  return 'auto-expand'
}

/**
 * Persist the tree-expansion preference for a specific connection.
 *
 * Writes to `localStorage` using the key
 * `mwm-wizard-expand-pref:{connectionId}`.
 */
export function setWizardExpandPref(
  connectionId: string,
  pref: 'auto-expand' | 'collapsed'
): void {
  try {
    localStorage.setItem(`${WIZARD_EXPAND_PREF_KEY}:${connectionId}`, pref)
  } catch {
    // localStorage may be unavailable (SSR, private browsing restrictions).
  }
}
