/**
 * File Context Prompt Builder
 *
 * Phase 5: Chat Integration with Files
 * Formats retrieved file content for injection into LLM prompts.
 *
 * Output Format:
 * - Text content wrapped in XML <document> tags
 * - RAG chunks wrapped with chunk indices
 * - Base64 images excluded (sent via Claude's native image support)
 */

import type { RetrievedContent, ChunkContent } from './retrieval.types';

/** Image content for Claude Vision API */
export interface ImageContent {
  mimeType: string;
  data: string;
}

export class FileContextPromptBuilder {
  /**
   * Builds document context XML from retrieved contents
   *
   * @param contents - Retrieved file contents
   * @returns XML-formatted document context string
   *
   * @example
   * ```xml
   * <documents>
   *   <document id="file-123" name="report.pdf">
   *     Content of the document...
   *   </document>
   * </documents>
   * ```
   */
  buildDocumentContext(contents: RetrievedContent[]): string {
    // Filter out base64 content (handled separately for images)
    const textContents = contents.filter((c) => c.content.type !== 'base64');

    if (textContents.length === 0) {
      return '';
    }

    const documentTags = textContents.map((content) => this.formatDocument(content));

    return `<documents>\n${documentTags.join('\n')}\n</documents>`;
  }

  /**
   * Builds system instructions for citing attached documents
   *
   * @param fileNames - Names of attached files
   * @returns System instruction string for Claude
   */
  buildSystemInstructions(fileNames: string[]): string {
    if (fileNames.length === 0) {
      return '';
    }

    const fileList = fileNames.map((name) => `- ${name}`).join('\n');

    return `The user has attached the following documents to this conversation:
${fileList}

When answering questions, use information from these documents when relevant.
When citing information from a document, reference it by name using [document name] format.
For example: "According to [report.pdf], the revenue increased by 15%."

Be accurate when citing and only reference documents that contain the relevant information.`;
  }

  /**
   * Extracts image contents from retrieved contents for Claude Vision
   *
   * @param contents - Retrieved file contents
   * @returns Array of image content objects for Claude API
   */
  getImageContents(contents: RetrievedContent[]): ImageContent[] {
    return contents
      .filter((c) => c.content.type === 'base64')
      .map((c) => {
        const base64Content = c.content as { type: 'base64'; mimeType: string; data: string };
        return {
          mimeType: base64Content.mimeType,
          data: base64Content.data,
        };
      });
  }

  /**
   * Estimates token count for a single retrieved content
   *
   * @param content - Retrieved content
   * @returns Estimated token count
   */
  estimateTokens(content: RetrievedContent): number {
    switch (content.content.type) {
      case 'text':
        return this.estimateTextTokens(content.content.text);

      case 'chunks':
        return content.content.chunks.reduce(
          (sum, chunk) => sum + this.estimateTextTokens(chunk.text),
          0
        );

      case 'base64':
        // Images don't count against text token limit
        return 0;

      default:
        return 0;
    }
  }

  /**
   * Formats a single document as XML
   */
  private formatDocument(content: RetrievedContent): string {
    const { fileId, fileName } = content;

    if (content.content.type === 'text') {
      const escapedContent = this.escapeXml(content.content.text);
      return `<document id="${fileId}" name="${this.escapeXmlAttribute(fileName)}">\n${escapedContent}\n</document>`;
    }

    if (content.content.type === 'chunks') {
      const chunksXml = content.content.chunks
        .map((chunk) => this.formatChunk(chunk))
        .join('\n');
      return `<document id="${fileId}" name="${this.escapeXmlAttribute(fileName)}" strategy="RAG">\n${chunksXml}\n</document>`;
    }

    return '';
  }

  /**
   * Formats a single chunk as XML
   */
  private formatChunk(chunk: ChunkContent): string {
    const relevanceAttr = chunk.relevanceScore !== undefined
      ? ` relevance="${chunk.relevanceScore.toFixed(2)}"`
      : '';

    const escapedText = this.escapeXml(chunk.text);
    return `<chunk chunk="${chunk.chunkIndex}"${relevanceAttr}>\n${escapedText}\n</chunk>`;
  }

  /**
   * Escapes XML special characters in content
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Escapes XML special characters in attributes
   */
  private escapeXmlAttribute(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Estimates tokens for text content
   * Uses rough heuristic: ~4 characters per token
   */
  private estimateTextTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

// Singleton instance
let instance: FileContextPromptBuilder | null = null;

/**
 * Gets the singleton instance of FileContextPromptBuilder
 */
export function getFileContextPromptBuilder(): FileContextPromptBuilder {
  if (!instance) {
    instance = new FileContextPromptBuilder();
  }
  return instance;
}
