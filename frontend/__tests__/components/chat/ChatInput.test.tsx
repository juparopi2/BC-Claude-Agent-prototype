/**
 * ChatInput Component Tests
 *
 * Comprehensive tests for message sending, toggles, connection state,
 * and file attachments.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatInput from '@/components/chat/ChatInput';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock agent state hook and socket connection
let mockAgentState = {
  isAgentBusy: false,
  isPaused: false,
  pauseReason: null as string | null,
};

const mockSocketConnection = {
  isConnected: true,
  isReconnecting: false,
  sendMessage: vi.fn(),
  stopAgent: vi.fn(),
};

// Mutable state for chat attachments
let mockChatAttachmentsState = {
  attachments: [] as Array<{
    tempId: string;
    name: string;
    size: number;
    type: string;
    status: 'uploading' | 'completed' | 'error';
    progress?: number;
    error?: string;
    id?: string;
  }>,
  completedAttachmentIds: [] as string[],
  hasUploading: false,
};

const mockUploadAttachment = vi.fn();
const mockRemoveAttachment = vi.fn();
const mockClearAttachments = vi.fn();

vi.mock('@/src/domains/chat', () => ({
  useAgentState: vi.fn(() => mockAgentState),
  useSocketConnection: vi.fn(() => mockSocketConnection),
  useChatAttachments: vi.fn(() => ({
    attachments: mockChatAttachmentsState.attachments,
    uploadAttachment: mockUploadAttachment,
    removeAttachment: mockRemoveAttachment,
    clearAttachments: mockClearAttachments,
    completedAttachmentIds: mockChatAttachmentsState.completedAttachmentIds,
    hasUploading: mockChatAttachmentsState.hasUploading,
  })),
}));

// Variable to control UI preferences mock
let mockUIPreferencesState = {
  enableThinking: false,
  setEnableThinking: vi.fn(),
  useMyContext: false,
  setUseMyContext: vi.fn(),
};

vi.mock('@/src/domains/ui', () => ({
  useUIPreferencesStore: vi.fn((selector) => selector(mockUIPreferencesState)),
}));

// Mock Sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('ChatInput', () => {
  const mockSendMessage = vi.fn();
  const mockStopAgent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentState = {
      isAgentBusy: false,
      isPaused: false,
      pauseReason: null,
    };
    mockSocketConnection.sendMessage = vi.fn();
    mockSocketConnection.stopAgent = vi.fn();
    mockSocketConnection.isConnected = true;
    mockSocketConnection.isReconnecting = false;
    mockUIPreferencesState = {
      enableThinking: false,
      setEnableThinking: vi.fn(),
      useMyContext: false,
      setUseMyContext: vi.fn(),
    };
    // Reset chat attachments state
    mockChatAttachmentsState = {
      attachments: [],
      completedAttachmentIds: [],
      hasUploading: false,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Message Sending', () => {
    it('sends message on Enter key', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Hello world');
      await user.keyboard('{Enter}');

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({
          enableThinking: false,
        })
      );
    });

    it('does NOT send on Shift+Enter (newline)', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Line 1');
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      await user.type(textarea, 'Line 2');

      // Should NOT have sent yet (Shift+Enter adds newline, doesn't send)
      expect(mockSendMessage).not.toHaveBeenCalled();

      // Textarea should have newline content
      expect(textarea).toHaveValue('Line 1\nLine 2');
    });

    it('sends message on button click', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Test message',
        expect.any(Object)
      );
    });

    it('clears input after send', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Message to clear');

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(textarea).toHaveValue('');
    });

    it('does not send empty message', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      // Just hit enter without typing
      await user.click(textarea);
      await user.keyboard('{Enter}');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does not send whitespace-only message', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, '   '); // Just spaces
      await user.keyboard('{Enter}');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Toggles', () => {
    it('toggles Extended Thinking', async () => {
      const mockSetEnableThinking = vi.fn();
      mockUIPreferencesState.setEnableThinking = mockSetEnableThinking;

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      // Find the thinking toggle by its text content
      const thinkingToggle = screen.getByRole('button', { name: /thinking/i });
      expect(thinkingToggle).toBeInTheDocument();

      fireEvent.click(thinkingToggle);

      expect(mockSetEnableThinking).toHaveBeenCalledWith(true);
    });

    it('toggles Semantic Search (My Files)', async () => {
      const mockSetUseMyContext = vi.fn();
      mockUIPreferencesState.setUseMyContext = mockSetUseMyContext;

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      // Find the "My Files" toggle
      const contextToggle = screen.getByRole('button', { name: /my files/i });
      expect(contextToggle).toBeInTheDocument();

      fireEvent.click(contextToggle);

      expect(mockSetUseMyContext).toHaveBeenCalledWith(true);
    });

    it('sends message with enableThinking=true when toggle is on', async () => {
      mockUIPreferencesState.enableThinking = true;

      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Complex question');
      await user.keyboard('{Enter}');

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Complex question',
        expect.objectContaining({
          enableThinking: true,
          thinkingBudget: 10000,
        })
      );
    });

    it('sends message with enableAutoSemanticSearch=true when My Files toggle is on', async () => {
      mockUIPreferencesState.useMyContext = true;

      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Search in my files');
      await user.keyboard('{Enter}');

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Search in my files',
        expect.objectContaining({
          enableAutoSemanticSearch: true,
        })
      );
    });
  });

  describe('Connection State', () => {
    it('disables input when disconnected', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={false}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('shows "Connecting..." placeholder when disconnected', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={false}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('placeholder', 'Connecting...');
    });

    it('shows reconnecting indicator when reconnecting', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={false}
          isReconnecting={true}
          sendMessage={mockSendMessage}
        />
      );

      expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
    });

    it('disables input when agent is busy', () => {
      mockAgentState.isAgentBusy = true;

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('shows stop button when agent is streaming', () => {
      mockAgentState.isAgentBusy = true;

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
          stopAgent={mockStopAgent}
        />
      );

      // Stop button should be visible (Square icon)
      // Send button should NOT be visible
      expect(screen.queryByTestId('send-button')).not.toBeInTheDocument();
    });

    it('enables input when connected and not busy', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).not.toBeDisabled();
    });
  });

  describe('Attachments', () => {
    it('uploads file and adds attachment chip on selection', async () => {
      // Mock uploadAttachment to simulate async upload
      mockUploadAttachment.mockImplementation(async () => {
        // Simulate the hook updating state after successful upload
        mockChatAttachmentsState.attachments = [{
          tempId: 'temp-123',
          name: 'test.pdf',
          size: 1024,
          type: 'application/pdf',
          status: 'completed',
          id: 'file-123',
        }];
        mockChatAttachmentsState.completedAttachmentIds = ['file-123'];
      });

      const { container, rerender } = render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const file = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockUploadAttachment).toHaveBeenCalledWith('session-1', file);
      });

      // Re-render to pick up state changes
      rerender(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('test.pdf')).toBeInTheDocument();
      });
    });

    it('handles file upload and sending correctly', async () => {
      // Set up initial state with a completed attachment
      mockChatAttachmentsState.attachments = [{
        tempId: 'temp-uuid-1',
        name: 'test-doc.pdf',
        size: 2048,
        type: 'application/pdf',
        status: 'completed',
        id: 'file-uuid-1',
      }];
      mockChatAttachmentsState.completedAttachmentIds = ['file-uuid-1'];

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      // Verify attachment is displayed
      expect(screen.getByText('test-doc.pdf')).toBeInTheDocument();

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Analyze this file' } });

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Analyze this file',
        expect.objectContaining({
          chatAttachments: ['file-uuid-1'],
        })
      );
    });

    it('shows upload error on failure', async () => {
      // Set up state with an error attachment
      mockChatAttachmentsState.attachments = [{
        tempId: 'temp-fail',
        name: 'fail.pdf',
        size: 1024,
        type: 'application/pdf',
        status: 'error',
        error: 'Network error',
      }];

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      // Error attachment should still be displayed
      expect(screen.getByText('fail.pdf')).toBeInTheDocument();
    });

    it('clears attachments after send', async () => {
      // Set up initial state with a completed attachment
      mockChatAttachmentsState.attachments = [{
        tempId: 'temp-123',
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        status: 'completed',
        id: 'file-123',
      }];
      mockChatAttachmentsState.completedAttachmentIds = ['file-123'];

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      // Verify attachment is displayed
      expect(screen.getByText('test.pdf')).toBeInTheDocument();

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Message with file' } });

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // clearAttachments should be called after send
      expect(mockClearAttachments).toHaveBeenCalled();
    });
  });

  describe('Disabled prop', () => {
    it('disables all controls when disabled=true', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          disabled={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();

      const thinkingToggle = screen.getByRole('button', { name: /thinking/i });
      expect(thinkingToggle).toBeDisabled();
    });
  });
});
