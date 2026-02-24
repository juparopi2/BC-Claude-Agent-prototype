/**
 * Content Block Format Conversion Utility
 *
 * Converts Anthropic native content blocks to LangChain-compatible format.
 * Extracted from AnthropicAdapter for reuse across providers.
 *
 * @module shared/providers/utils/content-format
 */

import type {
  AnthropicAttachmentContentBlock,
  LangChainContentBlock,
} from '@bc-agent/shared';

/**
 * Convert Anthropic native content blocks to LangChain-compatible format.
 *
 * LangChain @langchain/anthropic uses OpenAI-style format for images:
 * - Native Anthropic: { type: 'image', source: { type: 'base64', media_type, data } }
 * - LangChain expects: { type: 'image_url', image_url: { url: 'data:mime;base64,data' } }
 *
 * Files API references (source.type === 'file') are passed through directly
 * for both images and documents — LangChain's ChatAnthropic forwards Anthropic-native
 * content blocks, so the file reference is sent as-is to the Anthropic API.
 *
 * Documents (base64 source) pass through unchanged (LangChain accepts Anthropic format).
 *
 * @see https://github.com/langchain-ai/langchainjs/issues/7839
 *
 * @param contentBlocks - Array of Anthropic native content blocks
 * @returns Array of LangChain-compatible content blocks
 */
export function convertToLangChainFormat(
  contentBlocks: AnthropicAttachmentContentBlock[]
): LangChainContentBlock[] {
  return contentBlocks.map((block): LangChainContentBlock => {
    // Files API references: pass through as-is (Anthropic native format)
    // LangChain ChatAnthropic forwards these directly to the Anthropic API
    if (block.source.type === 'file') {
      return {
        type: block.type,
        source: block.source,
      } as LangChainContentBlock;
    }

    if (block.type === 'image') {
      // Convert Anthropic native base64 image format to LangChain image_url format
      return {
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      };
    }

    // Documents (base64): LangChain accepts Anthropic format directly
    // Return with the full source object structure
    return {
      type: 'document',
      source: block.source,
    };
  });
}
