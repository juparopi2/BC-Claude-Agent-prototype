/**
 * Citation Service
 *
 * Provides retrieval of persisted citations from the message_citations table.
 * Used to hydrate citations when loading historical messages from the API.
 *
 * @module services/citations/CitationService
 */

import { executeQuery } from '@/infrastructure/database/database';
import { createChildLogger } from '@/shared/utils/logger';
import type { CitedFile, SourceType, FetchStrategy } from '@bc-agent/shared';

/**
 * Singleton instance
 */
let instance: CitationService | null = null;

/**
 * Get fetch strategy based on source type.
 * Determines how frontend should retrieve file content.
 */
function getFetchStrategy(sourceType: string): FetchStrategy {
  switch (sourceType) {
    case 'blob_storage':
      return 'internal_api';
    case 'sharepoint':
    case 'onedrive':
      return 'oauth_proxy';
    case 'web':
      return 'external';
    default:
      return 'internal_api';
  }
}

/**
 * Citation Service class.
 * Provides methods for retrieving persisted citations.
 */
export class CitationService {
  private readonly logger = createChildLogger({ service: 'CitationService' });

  /**
   * Get citations for multiple messages (batch query).
   * Returns Map<messageId, CitedFile[]>
   *
   * @param messageIds - Array of message IDs to fetch citations for
   * @returns Map of messageId to array of CitedFile
   */
  async getCitationsForMessages(
    messageIds: string[]
  ): Promise<Map<string, CitedFile[]>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    try {
      // Build parameterized query with positional parameters
      const placeholders = messageIds.map((_, i) => `@id${i}`).join(',');
      const params: Record<string, string> = {};
      messageIds.forEach((id, i) => {
        params[`id${i}`] = id;
      });

      const result = await executeQuery<{
        message_id: string;
        file_id: string | null;
        file_name: string;
        source_type: string;
        mime_type: string;
        relevance_score: number;
        is_image: boolean;
      }>(
        `
        SELECT message_id, file_id, file_name, source_type,
               mime_type, relevance_score, is_image
        FROM message_citations
        WHERE message_id IN (${placeholders})
        ORDER BY message_id, relevance_score DESC
        `,
        params
      );

      // Group citations by message_id
      const citationMap = new Map<string, CitedFile[]>();
      for (const row of result.recordset || []) {
        const citations = citationMap.get(row.message_id) ?? [];
        citations.push({
          fileName: row.file_name,
          fileId: row.file_id,
          sourceType: row.source_type as SourceType,
          mimeType: row.mime_type,
          relevanceScore: row.relevance_score,
          isImage: row.is_image,
          fetchStrategy: getFetchStrategy(row.source_type),
        });
        citationMap.set(row.message_id, citations);
      }

      this.logger.debug(
        {
          messageCount: messageIds.length,
          citationsFound: Array.from(citationMap.values()).flat().length,
        },
        'Citations retrieved for messages'
      );

      return citationMap;
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          messageCount: messageIds.length,
        },
        'Failed to retrieve citations'
      );
      // Return empty map on error (non-critical data)
      return new Map();
    }
  }

  /**
   * Get citations for a single message.
   *
   * @param messageId - Message ID to fetch citations for
   * @returns Array of CitedFile (empty if none found)
   */
  async getCitationsForMessage(messageId: string): Promise<CitedFile[]> {
    const citationMap = await this.getCitationsForMessages([messageId]);
    return citationMap.get(messageId) ?? [];
  }
}

/**
 * Get the singleton CitationService instance.
 * @returns The shared CitationService instance
 */
export function getCitationService(): CitationService {
  if (!instance) {
    instance = new CitationService();
  }
  return instance;
}

/**
 * Reset singleton for testing.
 * @internal Only for unit tests
 */
export function __resetCitationService(): void {
  instance = null;
}
