/**
 * Upload Limit Store
 *
 * Zustand store for managing upload limit exceeded errors.
 * Shows modal when file count, size, or other limits are exceeded.
 *
 * @module domains/files/stores/uploadLimitStore
 */

import { create } from 'zustand';
import type { LimitExceededError } from '../types/folderUpload.types';

/**
 * Upload limit store state interface
 */
export interface UploadLimitState {
  /** Whether the error modal is open */
  isModalOpen: boolean;

  /** Array of limit errors */
  errors: LimitExceededError[];

  /** Actions */
  /** Show the error modal with the given errors */
  showErrors: (errors: LimitExceededError[]) => void;

  /** Close the modal */
  closeModal: () => void;

  /** Reset the store */
  reset: () => void;
}

/**
 * Initial state
 */
const initialState = {
  isModalOpen: false,
  errors: [] as LimitExceededError[],
};

/**
 * Upload limit store for managing limit exceeded errors
 *
 * @example
 * ```tsx
 * function FileUploadZone() {
 *   const { showErrors, isModalOpen, errors, closeModal } = useUploadLimitStore();
 *
 *   const handleDrop = (structure: FolderStructure) => {
 *     const validation = validateFolderLimits(structure);
 *     if (!validation.isValid) {
 *       showErrors(validation.errors);
 *       return;
 *     }
 *     // proceed with upload
 *   };
 *
 *   return (
 *     <>
 *       <DropZone onDrop={handleDrop} />
 *       <UploadLimitErrorModal
 *         isOpen={isModalOpen}
 *         errors={errors}
 *         onClose={closeModal}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export const useUploadLimitStore = create<UploadLimitState>((set) => ({
  ...initialState,

  showErrors: (errors: LimitExceededError[]) => {
    set({
      isModalOpen: true,
      errors,
    });
  },

  closeModal: () => {
    set({
      isModalOpen: false,
    });
  },

  reset: () => {
    set(initialState);
  },
}));

/**
 * Reset store to initial state (for testing)
 */
export function resetUploadLimitStore(): void {
  useUploadLimitStore.getState().reset();
}
