/**
 * Session Title Generator Service
 *
 * Generates concise, meaningful titles for chat sessions using Claude API.
 * Extracted from DirectAgentService to follow Single Responsibility Principle.
 *
 * @module services/sessions/SessionTitleGenerator
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/config';
import { logger } from '@/utils/logger';
import { executeQuery, SqlParams } from '@/config/database';

/**
 * Session Title Generator Class
 */
export class SessionTitleGenerator {
  private static instance: SessionTitleGenerator | null = null;
  private anthropic: Anthropic;

  private constructor() {
    this.anthropic = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });

    logger.info('SessionTitleGenerator initialized');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SessionTitleGenerator {
    if (!SessionTitleGenerator.instance) {
      SessionTitleGenerator.instance = new SessionTitleGenerator();
    }
    return SessionTitleGenerator.instance;
  }

  /**
   * Generate Title for Session
   *
   * Creates a concise title (max 50 chars) based on the user's first message.
   * Uses Claude API with a specific system prompt for title generation.
   *
   * @param userMessage - First message from user
   * @returns Generated title
   *
   * @example
   * ```typescript
   * const generator = getSessionTitleGenerator();
   * const title = await generator.generateTitle('Show me all customers');
   * // Returns: "List All Customers"
   * ```
   */
  public async generateTitle(userMessage: string): Promise<string> {
    try {
      logger.debug('Generating session title', {
        messageLength: userMessage.length,
      });

      const systemPrompt = `You are a helpful assistant that generates concise titles for chat sessions.

Rules:
- Maximum 50 characters
- Use Title Case
- Be descriptive but brief
- Capture the main intent of the message
- No quotes or special formatting
- No ending punctuation

Examples:
User: "Show me all customers from Spain"
Title: "List Spanish Customers"

User: "I need to create a new item with description 'Office Chair' and price 299.99"
Title: "Create Office Chair Item"

User: "What's the total revenue for Q3 2024?"
Title: "Q3 2024 Revenue Report"

Now generate a title for the user's message:`;

      const response = await this.anthropic.messages.create({
        model: env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
        temperature: 0.3, // Lower temperature for more consistent titles
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      });

      // Extract text from response
      const titleBlock = response.content[0];
      if (!titleBlock || titleBlock.type !== 'text') {
        throw new Error('Invalid response from Claude API');
      }

      let title = titleBlock.text.trim();

      // Sanitize title
      title = this.sanitizeTitle(title);

      // Fallback if title is too long or empty
      if (title.length === 0) {
        title = this.generateFallbackTitle(userMessage);
      } else if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }

      logger.debug('Session title generated', { title });

      return title;
    } catch (error) {
      logger.error('Failed to generate session title', { error });

      // Fallback to simple title
      return this.generateFallbackTitle(userMessage);
    }
  }

  /**
   * Update Session Title in Database
   *
   * Updates the title field for a session.
   *
   * @param sessionId - Session ID
   * @param title - Generated title
   */
  public async updateSessionTitle(
    sessionId: string,
    title: string
  ): Promise<void> {
    try {
      const params: SqlParams = {
        id: sessionId,
        title,
      };

      await executeQuery(
        `
        UPDATE sessions
        SET title = @title
        WHERE id = @id
        `,
        params
      );

      logger.debug('Session title updated', { sessionId, title });
    } catch (error) {
      logger.error('Failed to update session title', { error, sessionId });
      // Don't throw - title generation failure shouldn't break the flow
    }
  }

  /**
   * Generate and Update Session Title
   *
   * Combines generation and database update in one call.
   * Convenience method for common use case.
   *
   * @param sessionId - Session ID
   * @param userMessage - First user message
   * @returns Generated title
   */
  public async generateAndUpdateTitle(
    sessionId: string,
    userMessage: string
  ): Promise<string> {
    try {
      const title = await this.generateTitle(userMessage);
      await this.updateSessionTitle(sessionId, title);
      return title;
    } catch (error) {
      logger.error('Failed to generate and update title', {
        error,
        sessionId,
      });
      const fallbackTitle = this.generateFallbackTitle(userMessage);
      await this.updateSessionTitle(sessionId, fallbackTitle);
      return fallbackTitle;
    }
  }

  /**
   * Sanitize Title
   *
   * Removes unwanted characters and formats the title.
   *
   * @param title - Raw title from Claude
   * @returns Sanitized title
   */
  private sanitizeTitle(title: string): string {
    return title
      .replace(/^["']|["']$/g, '') // Remove leading/trailing quotes
      .replace(/[^\w\s\-\.\,\(\)]/g, '') // Remove special chars except basic punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Generate Fallback Title
   *
   * Creates a simple title from the first words of the message.
   * Used when Claude API fails or returns invalid title.
   *
   * @param userMessage - User message
   * @returns Fallback title
   */
  private generateFallbackTitle(userMessage: string): string {
    // Take first 50 chars of message
    let title = userMessage.substring(0, 50).trim();

    // If we cut mid-word, trim to last complete word
    if (userMessage.length > 50) {
      const lastSpace = title.lastIndexOf(' ');
      if (lastSpace > 20) {
        // Only trim if we have enough chars left
        title = title.substring(0, lastSpace);
      }
      title += '...';
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    return title;
  }

  /**
   * Batch Generate Titles
   *
   * Generates titles for multiple sessions in parallel.
   * Useful for backfilling titles for existing sessions.
   *
   * @param sessions - Array of { sessionId, userMessage }
   * @returns Array of { sessionId, title }
   */
  public async batchGenerateTitles(
    sessions: Array<{ sessionId: string; userMessage: string }>
  ): Promise<Array<{ sessionId: string; title: string }>> {
    logger.info('Batch generating titles', { count: sessions.length });

    const results = await Promise.allSettled(
      sessions.map(async (session) => {
        const title = await this.generateTitle(session.userMessage);
        return { sessionId: session.sessionId, title };
      })
    );

    const successfulResults: Array<{ sessionId: string; title: string }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulResults.push(result.value);
      } else {
        logger.error('Failed to generate title in batch', {
          sessionId: sessions[index].sessionId,
          error: result.reason,
        });
        // Add fallback title
        successfulResults.push({
          sessionId: sessions[index].sessionId,
          title: this.generateFallbackTitle(sessions[index].userMessage),
        });
      }
    });

    logger.info('Batch title generation completed', {
      total: sessions.length,
      successful: successfulResults.length,
    });

    return successfulResults;
  }
}

/**
 * Get SessionTitleGenerator singleton instance
 */
export function getSessionTitleGenerator(): SessionTitleGenerator {
  return SessionTitleGenerator.getInstance();
}
