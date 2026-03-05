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
import type { VisibilityState, ColumnSizingState } from '@tanstack/react-table';

/**
 * Sort and filter state
 */
export interface SortFilterState {
  /** Field to sort by */
  sortBy: FileSortBy;
  /** Sort order (ascending or descending) */
  sortOrder: SortOrder;
  /** Show favorites only (filter preference) */
  showFavoritesOnly: boolean;
  /** Filter by source type (null = all, 'onedrive' = only OneDrive files) */
  sourceTypeFilter: string | null;
  /** TanStack Table column visibility state */
  columnVisibility: VisibilityState;
  /** TanStack Table column order */
  columnOrder: string[];
  /** TanStack Table column sizing state */
  columnSizing: ColumnSizingState;
}

/**
 * Sort and filter actions
 */
export interface SortFilterActions {
  /** Set sort field and optionally order */
  setSort: (sortBy: FileSortBy, sortOrder?: SortOrder) => void;
  /** Toggle sort order between asc and desc */
  toggleSortOrder: () => void;
  /** Toggle favorites only filter */
  toggleFavoritesOnly: () => void;
  /** Set favorites only explicitly */
  setShowFavoritesOnly: (show: boolean) => void;
  /** Set source type filter */
  setSourceTypeFilter: (sourceType: string | null) => void;
  /** Set column visibility */
  setColumnVisibility: (visibility: VisibilityState) => void;
  /** Set column order */
  setColumnOrder: (order: string[]) => void;
  /** Set column sizing */
  setColumnSizing: (sizing: ColumnSizingState) => void;
  /** Reset table preferences to defaults */
  resetTablePreferences: () => void;
}

const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
  favorite: true,
  name: true,
  size: true,
  dateModified: true,
  dateUploaded: false,
  status: true,
  type: false,
};

const DEFAULT_COLUMN_ORDER: string[] = [
  'favorite', 'name', 'size', 'dateModified', 'dateUploaded', 'status', 'type',
];

/**
 * Initial state
 */
const initialState: SortFilterState = {
  sortBy: 'date',
  sortOrder: 'desc',
  showFavoritesOnly: false,
  sourceTypeFilter: null,
  columnVisibility: DEFAULT_COLUMN_VISIBILITY,
  columnOrder: DEFAULT_COLUMN_ORDER,
  columnSizing: {},
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

      toggleFavoritesOnly: () => {
        set((state) => ({
          showFavoritesOnly: !state.showFavoritesOnly,
        }));
      },

      setShowFavoritesOnly: (show) => {
        set({ showFavoritesOnly: show });
      },

      setSourceTypeFilter: (sourceType) => {
        set({ sourceTypeFilter: sourceType });
      },

      setColumnVisibility: (visibility) => {
        set({ columnVisibility: visibility });
      },

      setColumnOrder: (order) => {
        set({ columnOrder: order });
      },

      setColumnSizing: (sizing) => {
        set({ columnSizing: sizing });
      },

      resetTablePreferences: () => {
        set({
          columnVisibility: DEFAULT_COLUMN_VISIBILITY,
          columnOrder: DEFAULT_COLUMN_ORDER,
          columnSizing: {},
        });
      },
    }),
    {
      name: 'bc-agent-file-sort-filter',
      partialize: (state) => ({
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        showFavoritesOnly: state.showFavoritesOnly,
        sourceTypeFilter: state.sourceTypeFilter,
        columnVisibility: state.columnVisibility,
        columnOrder: state.columnOrder,
        columnSizing: state.columnSizing,
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

// Re-export defaults for use in other modules
export { DEFAULT_COLUMN_VISIBILITY, DEFAULT_COLUMN_ORDER };
