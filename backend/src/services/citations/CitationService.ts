/**
 * Citation Service
 *
 * Provides retrieval of persisted citations from the message_citations table.
 * Used to hydrate citations when loading historical messages from the API.
 *
 * @module services/citations/CitationService
 */

import { prisma } from '@/infrastructure/database/prisma';
import { createChildLogger } from '@/shared/utils/logger';
import { getFetchStrategy, type CitedFile, type SourceType } from '@bc-agent/shared';

/**
 * Singleton instance
 */
let instance: CitationService | null = null;

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
      const rows = await prisma.message_citations.findMany({
        where: {
          message_id: { in: messageIds },
        },
        orderBy: [
          { message_id: 'asc' },
          { relevance_score: 'desc' },
        ],
        select: {
          message_id: true,
          file_id: true,
          file_name: true,
          source_type: true,
          mime_type: true,
          relevance_score: true,
          is_image: true,
        },
      });

      // Group citations by message_id
      const citationMap = new Map<string, CitedFile[]>();
      for (const row of rows) {
        const citations = citationMap.get(row.message_id) ?? [];
        citations.push({
          fileName: row.file_name,
          fileId: row.file_id,
          sourceType: row.source_type as SourceType,
          mimeType: row.mime_type,
          relevanceScore: Number(row.relevance_score),
          isImage: row.is_image,
          fetchStrategy: getFetchStrategy(row.source_type as SourceType),
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
