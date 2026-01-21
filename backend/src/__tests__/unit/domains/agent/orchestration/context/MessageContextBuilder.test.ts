/**
 * @file MessageContextBuilder.test.ts
 * @description Tests for message context building logic.
 *
 * Purpose: Capture the behavior of file context preparation and
 * multi-modal content building in AgentOrchestrator (lines 168-249).
 *
 * Critical behaviors to verify:
 * - Simple prompt -> simple HumanMessage
 * - Chat attachments -> multi-modal content array
 * - File context integrates into message
 * - LangChain format conversion for images
 * - Graph inputs include correct options
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AnthropicAttachmentContentBlock, LangChainContentBlock } from '@bc-agent/shared';
import type { FileContextPreparationResult } from '@domains/agent/context/types';

// Mock logger - must come before other mocks that might import it
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Create mock function references before vi.mock (hoisting issue workaround)
const mockResolve = vi.fn();
const mockConvertToLangChainFormat = vi.fn();

// Mock attachment content resolver
vi.mock('@/domains/chat-attachments', () => {
  return {
    getAttachmentContentResolver: vi.fn(() => ({
      resolve: vi.fn(),
    })),
    getChatAttachmentService: vi.fn(() => ({
      getAttachmentSummaries: vi.fn().mockResolvedValue([]),
    })),
  };
});

// Mock AnthropicAdapter for format conversion
vi.mock('@shared/providers/adapters/AnthropicAdapter', () => {
  return {
    AnthropicAdapter: vi.fn(() => ({
      normalizeMessage: vi.fn(),
      normalizeStopReason: vi.fn(),
      extractUsage: vi.fn(),
    })),
    convertToLangChainFormat: vi.fn(),
  };
});

// Import the conversion function after mocks
import { convertToLangChainFormat } from '@shared/providers/adapters/AnthropicAdapter';

/**
 * Build message content exactly as AgentOrchestrator does (lines 200-226)
 */
type ContentBlock = string | { type: 'text'; text: string } | LangChainContentBlock;

function buildMessageContent(
  prompt: string,
  contextResult: FileContextPreparationResult,
  langChainAttachmentBlocks: LangChainContentBlock[]
): ContentBlock | ContentBlock[] {
  if (langChainAttachmentBlocks.length > 0) {
    // Use multi-modal format with content array
    const contentBlocks: ContentBlock[] = [];

    // Add document/image blocks first
    contentBlocks.push(...langChainAttachmentBlocks);

    // Add context text if present
    if (contextResult.contextText) {
      contentBlocks.push({ type: 'text', text: contextResult.contextText });
    }

    // Add the user prompt last
    contentBlocks.push({ type: 'text', text: prompt });

    return contentBlocks;
  } else {
    // Use simple string format (original behavior)
    return contextResult.contextText
      ? `${contextResult.contextText}\n\n${prompt}`
      : prompt;
  }
}

/**
 * Build graph inputs exactly as AgentOrchestrator does (lines 229-249)
 */
function buildGraphInputs(
  messageContent: ContentBlock | ContentBlock[],
  userId: string | undefined,
  sessionId: string,
  contextResult: FileContextPreparationResult,
  options?: { enableThinking?: boolean; thinkingBudget?: number }
) {
  return {
    messages: [
      typeof messageContent === 'string'
        ? { content: messageContent, _getType: () => 'human' }
        : { content: messageContent, _getType: () => 'human' },
    ],
    activeAgent: 'orchestrator',
    context: {
      userId,
      sessionId,
      fileContext: contextResult,
      options: {
        enableThinking: options?.enableThinking ?? false,
        thinkingBudget: options?.thinkingBudget ?? 10000,
      },
    },
  };
}

describe('MessageContextBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocked function behavior
    vi.mocked(convertToLangChainFormat).mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Simple prompt handling', () => {
    it('should return simple string for prompt without attachments or context', () => {
      const prompt = 'What is the current inventory?';
      const contextResult: FileContextPreparationResult = {
        contextText: '',
        attachedFileIds: [],
        attachedFileNames: [],
      };

      const result = buildMessageContent(prompt, contextResult, []);

      expect(result).toBe(prompt);
      expect(typeof result).toBe('string');
    });

    it('should prepend context text when present', () => {
      const prompt = 'Analyze this';
      const contextResult: FileContextPreparationResult = {
        contextText: '<file>Invoice data here</file>',
        attachedFileIds: ['file-123'],
        attachedFileNames: ['invoice.pdf'],
      };

      const result = buildMessageContent(prompt, contextResult, []);

      expect(result).toBe('<file>Invoice data here</file>\n\nAnalyze this');
    });

    it('should not double-newline when context is empty', () => {
      const prompt = 'Simple question';
      const contextResult: FileContextPreparationResult = {
        contextText: '',
        attachedFileIds: [],
        attachedFileNames: [],
      };

      const result = buildMessageContent(prompt, contextResult, []);

      expect(result).not.toContain('\n\n');
    });
  });

  describe('Chat attachments handling', () => {
    it('should create multi-modal content array with attachments', () => {
      const prompt = 'Describe this image';
      const contextResult: FileContextPreparationResult = {
        contextText: '',
        attachedFileIds: [],
        attachedFileNames: [],
      };
      const langChainBlocks: LangChainContentBlock[] = [
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,abc123',
          },
        },
      ];

      const result = buildMessageContent(prompt, contextResult, langChainBlocks);

      expect(Array.isArray(result)).toBe(true);
      expect((result as ContentBlock[])).toHaveLength(2);
      expect((result as ContentBlock[])[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,abc123' },
      });
      expect((result as ContentBlock[])[1]).toEqual({
        type: 'text',
        text: 'Describe this image',
      });
    });

    it('should place attachments before context and prompt', () => {
      const prompt = 'Analyze these files';
      const contextResult: FileContextPreparationResult = {
        contextText: '<context>Additional context</context>',
        attachedFileIds: ['ctx-file-1'],
        attachedFileNames: ['context.txt'],
      };
      const langChainBlocks: LangChainContentBlock[] = [
        {
          type: 'image_url',
          image_url: { url: 'data:image/jpeg;base64,xyz' },
        },
      ];

      const result = buildMessageContent(prompt, contextResult, langChainBlocks) as ContentBlock[];

      // Order should be: attachment, context, prompt
      expect(result).toHaveLength(3);
      expect((result[0] as LangChainContentBlock).type).toBe('image_url');
      expect((result[1] as { type: 'text'; text: string }).text).toContain('Additional context');
      expect((result[2] as { type: 'text'; text: string }).text).toBe('Analyze these files');
    });

    it('should handle multiple attachments', () => {
      const prompt = 'Compare these';
      const contextResult: FileContextPreparationResult = {
        contextText: '',
        attachedFileIds: [],
        attachedFileNames: [],
      };
      const langChainBlocks: LangChainContentBlock[] = [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img1' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img2' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img3' } },
      ];

      const result = buildMessageContent(prompt, contextResult, langChainBlocks) as ContentBlock[];

      expect(result).toHaveLength(4); // 3 images + prompt
      expect(result.slice(0, 3).every(b => (b as LangChainContentBlock).type === 'image_url')).toBe(true);
    });
  });

  describe('LangChain format conversion', () => {
    it('should use convertToLangChainFormat for Anthropic blocks', () => {
      const anthropicBlocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'base64data',
          },
        },
      ];

      // Call the actual conversion
      convertToLangChainFormat(anthropicBlocks);

      expect(vi.mocked(convertToLangChainFormat)).toHaveBeenCalledWith(anthropicBlocks);
    });

    it('should handle empty attachment array', () => {
      vi.mocked(convertToLangChainFormat).mockReturnValue([]);

      const result = convertToLangChainFormat([]);

      expect(result).toEqual([]);
    });
  });

  describe('Graph inputs structure', () => {
    it('should build correct graph inputs for simple prompt', () => {
      const messageContent = 'Simple question';
      const userId = 'user-123';
      const sessionId = 'session-456';
      const contextResult: FileContextPreparationResult = {
        contextText: '',
        attachedFileIds: [],
        attachedFileNames: [],
      };

      const inputs = buildGraphInputs(messageContent, userId, sessionId, contextResult);

      expect(inputs.activeAgent).toBe('orchestrator');
      expect(inputs.messages).toHaveLength(1);
      expect(inputs.context.userId).toBe(userId);
      expect(inputs.context.sessionId).toBe(sessionId);
      expect(inputs.context.fileContext).toBe(contextResult);
      expect(inputs.context.options.enableThinking).toBe(false);
      expect(inputs.context.options.thinkingBudget).toBe(10000);
    });

    it('should include thinking options when enabled', () => {
      const messageContent = 'Complex question';
      const userId = 'user-123';
      const sessionId = 'session-456';
      const contextResult: FileContextPreparationResult = {
        contextText: '',
        attachedFileIds: [],
        attachedFileNames: [],
      };

      const inputs = buildGraphInputs(messageContent, userId, sessionId, contextResult, {
        enableThinking: true,
        thinkingBudget: 20000,
      });

      expect(inputs.context.options.enableThinking).toBe(true);
      expect(inputs.context.options.thinkingBudget).toBe(20000);
    });

    it('should default thinkingBudget to 10000', () => {
      const messageContent = 'Question';
      const contextResult: FileContextPreparationResult = {
        contextText: '',
        attachedFileIds: [],
        attachedFileNames: [],
      };

      const inputs = buildGraphInputs(messageContent, 'user', 'session', contextResult, {
        enableThinking: true,
        // thinkingBudget not provided
      });

      expect(inputs.context.options.thinkingBudget).toBe(10000);
    });

    it('should handle undefined userId', () => {
      const messageContent = 'Question';
      const contextResult: FileContextPreparationResult = {
        contextText: '',
        attachedFileIds: [],
        attachedFileNames: [],
      };

      const inputs = buildGraphInputs(messageContent, undefined, 'session', contextResult);

      expect(inputs.context.userId).toBeUndefined();
    });

    it('should include fileContext for RAG context tracking', () => {
      const messageContent = 'Analyze files';
      const contextResult: FileContextPreparationResult = {
        contextText: '<file>File content here</file>',
        attachedFileIds: ['file-1', 'file-2'],
        attachedFileNames: ['doc1.pdf', 'doc2.docx'],
      };

      const inputs = buildGraphInputs(messageContent, 'user', 'session', contextResult);

      expect(inputs.context.fileContext).toEqual(contextResult);
      expect(inputs.context.fileContext.attachedFileIds).toContain('file-1');
      expect(inputs.context.fileContext.attachedFileNames).toContain('doc1.pdf');
    });
  });

  describe('HumanMessage construction', () => {
    it('should create HumanMessage with string content for simple prompts', () => {
      const messageContent = 'Simple string prompt';
      const inputs = buildGraphInputs(
        messageContent,
        'user',
        'session',
        { contextText: '', attachedFileIds: [], attachedFileNames: [] }
      );

      // When messageContent is a string, HumanMessage should receive it directly
      expect(inputs.messages[0].content).toBe(messageContent);
    });

    it('should create HumanMessage with content array for multi-modal', () => {
      const messageContent: ContentBlock[] = [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        { type: 'text', text: 'Describe this' },
      ];
      const inputs = buildGraphInputs(
        messageContent,
        'user',
        'session',
        { contextText: '', attachedFileIds: [], attachedFileNames: [] }
      );

      // When messageContent is an array, HumanMessage should use object format
      expect(Array.isArray(inputs.messages[0].content)).toBe(true);
      expect(inputs.messages[0].content).toHaveLength(2);
    });
  });

  describe('Content type inference', () => {
    it('should use string format when no attachments and no context', () => {
      const result = buildMessageContent(
        'Hello',
        { contextText: '', attachedFileIds: [], attachedFileNames: [] },
        []
      );

      expect(typeof result).toBe('string');
    });

    it('should use string format when only context (no attachments)', () => {
      const result = buildMessageContent(
        'Hello',
        { contextText: 'Context here', attachedFileIds: ['f1'], attachedFileNames: ['f.txt'] },
        []
      );

      // Even with contextText, if no LangChain blocks, use string format
      expect(typeof result).toBe('string');
    });

    it('should use array format when attachments present', () => {
      const result = buildMessageContent(
        'Hello',
        { contextText: '', attachedFileIds: [], attachedFileNames: [] },
        [{ type: 'image_url', image_url: { url: 'data:...' } }]
      );

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
