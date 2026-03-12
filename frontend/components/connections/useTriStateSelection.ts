import { useState, useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  type ExplicitSelection,
  type NodeInfo,
  SYNC_ALL_KEY,
  getEffectiveCheckState,
  computeToggleSelect,
  computeSyncAllToggle,
} from './wizard-utils'

interface UseTriStateSelectionParams {
  findNode: (id: string) => NodeInfo | null
}

interface UseTriStateSelectionReturn {
  explicitSelections: Map<string, ExplicitSelection>
  isSyncAll: boolean
  getCheckState: (itemId: string) => boolean | 'indeterminate'
  toggleSelect: (item: { id: string; isFolder: boolean; isSupported?: boolean }) => void
  toggleSyncAll: () => void
  setExplicitSelections: Dispatch<SetStateAction<Map<string, ExplicitSelection>>>
  reset: () => void
}

export function useTriStateSelection({ findNode }: UseTriStateSelectionParams): UseTriStateSelectionReturn {
  const [explicitSelections, setExplicitSelections] = useState<Map<string, ExplicitSelection>>(new Map())
  const isSyncAll = explicitSelections.get(SYNC_ALL_KEY) === 'include'

  const getCheckState = useCallback(
    (itemId: string) => getEffectiveCheckState(itemId, explicitSelections, findNode, isSyncAll),
    [explicitSelections, findNode, isSyncAll]
  )

  const toggleSelect = useCallback(
    (item: { id: string; isFolder: boolean; isSupported?: boolean }) => {
      if (!item.isFolder && item.isSupported === false) return
      setExplicitSelections(prev => {
        const syncAll = prev.get(SYNC_ALL_KEY) === 'include'
        return computeToggleSelect(item, prev, findNode, syncAll)
      })
    },
    [findNode]
  )

  const toggleSyncAll = useCallback(() => {
    setExplicitSelections(prev => computeSyncAllToggle(prev))
  }, [])

  const reset = useCallback(() => {
    setExplicitSelections(new Map())
  }, [])

  return {
    explicitSelections,
    isSyncAll,
    getCheckState,
    toggleSelect,
    toggleSyncAll,
    setExplicitSelections,
    reset,
  }
}
