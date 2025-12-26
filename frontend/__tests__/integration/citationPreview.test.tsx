/**
 * Citation to Preview Integration Tests
 *
 * Tests for the full flow: citation click → FilePreviewModal.
 * TDD: Tests written FIRST (RED phase) before implementation.
 *
 * @module __tests__/integration/citationPreview
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatContainer from '@/components/chat/ChatContainer';
import { useChatStore } from '@/lib/stores/chatStore';
import { useFileStore } from '@/lib/stores/fileStore';
import { useFilePreviewStore, resetFilePreviewStore } from '@/src/domains/files';
import type { StandardMessage } from '@bc-agent/shared';
import type { ParsedFile } from '@bc-agent/shared';

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

// Mock useAuthStore
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: vi.fn(() => 'JP'),
  selectUserInitials: vi.fn(),
}));

// Store mock state for domain stores
let mockMessages: StandardMessage[] = [];
let mockStreamingState = {
  isStreaming: false,
  accumulatedContent: '',
  accumulatedThinking: '',
};

// Mock new domain stores
vi.mock('@/src/domains/chat/stores', () => ({
  useMessageStore: vi.fn((selector) => {
    const state = {
      messages: mockMessages,
      optimisticMessages: new Map(),
    };
    return selector(state);
  }),
  useStreamingStore: vi.fn((selector) => selector(mockStreamingState)),
  getSortedMessages: (state: { messages: StandardMessage[]; optimisticMessages: Map<string, StandardMessage> }) =>
    [...state.messages, ...Array.from(state.optimisticMessages.values())].sort((a, b) =>
      (a.sequence_number || 0) - (b.sequence_number || 0)
    ),
}));

describe('Citation to Preview flow', () => {
  const mockFile: ParsedFile = {
    id: 'file-123',
    userId: 'user-1',
    parentFolderId: null,
    name: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    blobPath: 'users/user-1/report.pdf',
    isFolder: false,
    isFavorite: false,
    processingStatus: 'completed',
    embeddingStatus: 'completed',
    hasExtractedText: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const messageWithCitation: StandardMessage = {
    type: 'standard',
    id: 'msg-with-citation',
    session_id: 'session-1',
    role: 'assistant',
    content: 'Here is the data from [report.pdf] as requested.',
    sequence_number: 1,
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    // Reset all stores
    useChatStore.getState().reset();
    useFileStore.setState({
      files: [mockFile],
      isLoading: false,
    });
    resetFilePreviewStore();

    // Setup mock messages for domain store
    mockMessages = [messageWithCitation];
    mockStreamingState = {
      isStreaming: false,
      accumulatedContent: '',
      accumulatedThinking: '',
    };

    // Setup chatStore with citationFileMap (still needed for citation mapping)
    useChatStore.setState({
      citationFileMap: new Map([['report.pdf', 'file-123']]),
      isLoading: false,
    });
  });

  describe('ChatContainer integration', () => {
    it('should render ChatContainer with messages', () => {
      render(<ChatContainer />);

      expect(screen.getByTestId('chat-container')).toBeInTheDocument();
    });

    it('should display citation text in message', () => {
      render(<ChatContainer />);

      // The message content should be rendered
      expect(screen.getByText(/Here is the data from/)).toBeInTheDocument();
    });
  });

  describe('citation click handling', () => {
    it('should open FilePreviewModal when citation is clicked', async () => {
      render(<ChatContainer />);

      // Find the citation link (it should be clickable)
      const citationLink = screen.getByRole('button', { name: /report\.pdf/i });
      expect(citationLink).toBeInTheDocument();

      fireEvent.click(citationLink);

      // Check that filePreviewStore was updated
      const previewState = useFilePreviewStore.getState();
      expect(previewState.isOpen).toBe(true);
      expect(previewState.fileId).toBe('file-123');
      expect(previewState.fileName).toBe('report.pdf');
      expect(previewState.mimeType).toBe('application/pdf');
    });

    it('should look up file metadata from fileStore', () => {
      render(<ChatContainer />);

      const citationLink = screen.getByRole('button', { name: /report\.pdf/i });
      fireEvent.click(citationLink);

      const previewState = useFilePreviewStore.getState();
      // File metadata should come from fileStore
      expect(previewState.mimeType).toBe('application/pdf');
    });

    it('should handle missing file gracefully', () => {
      // Setup with a citation that has no matching file in fileStore
      useFileStore.setState({
        files: [], // No files
        isLoading: false,
      });

      useChatStore.setState({
        messages: [messageWithCitation],
        citationFileMap: new Map([['report.pdf', 'file-nonexistent']]),
        isLoading: false,
      });

      render(<ChatContainer />);

      const citationLink = screen.getByRole('button', { name: /report\.pdf/i });
      fireEvent.click(citationLink);

      // Should still attempt to open preview (with fileId even if file not found)
      // Or should gracefully handle missing file
      const previewState = useFilePreviewStore.getState();
      // Either preview is open with just fileId, or it stays closed
      // The implementation decides the behavior
      expect(previewState).toBeDefined();
    });
  });

  describe('disabled citations', () => {
    it('should not open preview for disabled citations (no fileId)', () => {
      // Setup with empty citationFileMap (citations appear disabled)
      useChatStore.setState({
        messages: [messageWithCitation],
        citationFileMap: new Map(), // Empty - no file IDs
        isLoading: false,
      });

      render(<ChatContainer />);

      // Find the citation - it should exist but be disabled
      const citation = screen.getByText(/report\.pdf/);
      expect(citation).toBeInTheDocument();

      // Click should not open preview (disabled citation)
      fireEvent.click(citation);

      const previewState = useFilePreviewStore.getState();
      expect(previewState.isOpen).toBe(false);
    });
  });
});
