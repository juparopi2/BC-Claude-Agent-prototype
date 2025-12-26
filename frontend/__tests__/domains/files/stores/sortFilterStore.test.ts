/**
 * sortFilterStore Tests
 *
 * Tests for file sorting and filtering preferences store.
 * TDD: Tests written FIRST before implementation.
 *
 * @module __tests__/domains/files/stores/sortFilterStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useSortFilterStore,
  resetSortFilterStore,
} from '@/src/domains/files/stores/sortFilterStore';

describe('sortFilterStore', () => {
  beforeEach(() => {
    resetSortFilterStore();
  });

  describe('initial state', () => {
    it('should have sortBy as "date" initially', () => {
      const state = useSortFilterStore.getState();
      expect(state.sortBy).toBe('date');
    });

    it('should have sortOrder as "desc" initially', () => {
      const state = useSortFilterStore.getState();
      expect(state.sortOrder).toBe('desc');
    });

    it('should have showFavoritesOnly as false initially', () => {
      const state = useSortFilterStore.getState();
      expect(state.showFavoritesOnly).toBe(false);
    });
  });

  describe('setSort', () => {
    it('should set sortBy correctly', () => {
      const { setSort } = useSortFilterStore.getState();
      setSort('name', 'asc');

      const state = useSortFilterStore.getState();
      expect(state.sortBy).toBe('name');
    });

    it('should set sortOrder correctly', () => {
      const { setSort } = useSortFilterStore.getState();
      setSort('size', 'asc');

      const state = useSortFilterStore.getState();
      expect(state.sortOrder).toBe('asc');
    });

    it('should keep current sortOrder if not provided', () => {
      const { setSort } = useSortFilterStore.getState();

      // First set to asc
      setSort('name', 'asc');
      expect(useSortFilterStore.getState().sortOrder).toBe('asc');

      // Then change only sortBy
      setSort('size');
      expect(useSortFilterStore.getState().sortOrder).toBe('asc');
      expect(useSortFilterStore.getState().sortBy).toBe('size');
    });
  });

  describe('toggleSortOrder', () => {
    it('should toggle from desc to asc', () => {
      const { toggleSortOrder } = useSortFilterStore.getState();

      // Initial is desc
      expect(useSortFilterStore.getState().sortOrder).toBe('desc');

      toggleSortOrder();
      expect(useSortFilterStore.getState().sortOrder).toBe('asc');
    });

    it('should toggle from asc to desc', () => {
      const { setSort, toggleSortOrder } = useSortFilterStore.getState();

      // Set to asc first
      setSort('name', 'asc');
      expect(useSortFilterStore.getState().sortOrder).toBe('asc');

      toggleSortOrder();
      expect(useSortFilterStore.getState().sortOrder).toBe('desc');
    });

    it('should toggle multiple times correctly', () => {
      const { toggleSortOrder } = useSortFilterStore.getState();

      toggleSortOrder(); // desc -> asc
      expect(useSortFilterStore.getState().sortOrder).toBe('asc');

      toggleSortOrder(); // asc -> desc
      expect(useSortFilterStore.getState().sortOrder).toBe('desc');

      toggleSortOrder(); // desc -> asc
      expect(useSortFilterStore.getState().sortOrder).toBe('asc');
    });
  });

  describe('toggleFavoritesFilter', () => {
    it('should toggle from false to true', () => {
      const { toggleFavoritesFilter } = useSortFilterStore.getState();

      expect(useSortFilterStore.getState().showFavoritesOnly).toBe(false);

      toggleFavoritesFilter();
      expect(useSortFilterStore.getState().showFavoritesOnly).toBe(true);
    });

    it('should toggle from true to false', () => {
      const { toggleFavoritesFilter } = useSortFilterStore.getState();

      toggleFavoritesFilter(); // false -> true
      expect(useSortFilterStore.getState().showFavoritesOnly).toBe(true);

      toggleFavoritesFilter(); // true -> false
      expect(useSortFilterStore.getState().showFavoritesOnly).toBe(false);
    });
  });

  describe('setShowFavoritesOnly', () => {
    it('should set to true', () => {
      const { setShowFavoritesOnly } = useSortFilterStore.getState();
      setShowFavoritesOnly(true);

      expect(useSortFilterStore.getState().showFavoritesOnly).toBe(true);
    });

    it('should set to false', () => {
      const { toggleFavoritesFilter, setShowFavoritesOnly } = useSortFilterStore.getState();

      toggleFavoritesFilter(); // Set to true first
      setShowFavoritesOnly(false);

      expect(useSortFilterStore.getState().showFavoritesOnly).toBe(false);
    });
  });

  describe('resetSortFilterStore', () => {
    it('should reset all state to initial values', () => {
      const { setSort, toggleFavoritesFilter } = useSortFilterStore.getState();

      // Change all values
      setSort('name', 'asc');
      toggleFavoritesFilter();

      // Verify changed
      expect(useSortFilterStore.getState().sortBy).toBe('name');
      expect(useSortFilterStore.getState().sortOrder).toBe('asc');
      expect(useSortFilterStore.getState().showFavoritesOnly).toBe(true);

      // Reset
      resetSortFilterStore();

      // Verify reset
      const state = useSortFilterStore.getState();
      expect(state.sortBy).toBe('date');
      expect(state.sortOrder).toBe('desc');
      expect(state.showFavoritesOnly).toBe(false);
    });
  });
});
