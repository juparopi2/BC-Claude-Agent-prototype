/**
 * Sort & Filter Store
 *
 * Zustand store for managing file sorting and filtering preferences.
 * Persisted to localStorage for consistent UX across sessions.
 *
 * @module domains/files/stores/sortFilterStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FileSortBy, SortOrder } from '@bc-agent/shared';

/**
 * Sort and filter state
 */
export interface SortFilterState {
  /** Field to sort by */
  sortBy: FileSortBy;
  /** Sort order (ascending or descending) */
  sortOrder: SortOrder;
  /** Show only favorite files */
  showFavoritesOnly: boolean;
}

/**
 * Sort and filter actions
 */
export interface SortFilterActions {
  /** Set sort field and optionally order */
  setSort: (sortBy: FileSortBy, sortOrder?: SortOrder) => void;
  /** Toggle sort order between asc and desc */
  toggleSortOrder: () => void;
  /** Toggle favorites filter */
  toggleFavoritesFilter: () => void;
  /** Set favorites filter explicitly */
  setShowFavoritesOnly: (show: boolean) => void;
}

/**
 * Initial state
 */
const initialState: SortFilterState = {
  sortBy: 'date',
  sortOrder: 'desc',
  showFavoritesOnly: false,
};

/**
 * Sort & Filter store
 *
 * Manages file sorting and filtering preferences.
 * All state is persisted to localStorage.
 *
 * @example
 * ```tsx
 * function FileSortControls() {
 *   const { sortBy, sortOrder, setSort, toggleSortOrder } = useSortFilterStore();
 *   return (
 *     <Button onClick={() => setSort('name')}>
 *       Sort by Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
 *     </Button>
 *   );
 * }
 * ```
 */
export const useSortFilterStore = create<SortFilterState & SortFilterActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setSort: (sortBy, sortOrder) => {
        set({
          sortBy,
          sortOrder: sortOrder ?? get().sortOrder,
        });
      },

      toggleSortOrder: () => {
        set((state) => ({
          sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc',
        }));
      },

      toggleFavoritesFilter: () => {
        set((state) => ({
          showFavoritesOnly: !state.showFavoritesOnly,
        }));
      },

      setShowFavoritesOnly: (show) => {
        set({ showFavoritesOnly: show });
      },
    }),
    {
      name: 'bc-agent-file-sort-filter',
      partialize: (state) => ({
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        showFavoritesOnly: state.showFavoritesOnly,
      }),
    }
  )
);

/**
 * Reset store to initial state (for testing)
 */
export function resetSortFilterStore(): void {
  useSortFilterStore.setState(initialState);
}
