/**
 * Session Title Generator Service
 *
 * Generates concise, meaningful titles for chat sessions using ModelFactory.
 * Extracted from DirectAgentService to follow Single Responsibility Principle.
 *
 * @module services/sessions/SessionTitleGenerator
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ModelFactory } from '@/core/langchain/ModelFactory';
import { createChildLogger } from '@/shared/utils/logger';
import { executeQuery, SqlParams } from '@/infrastructure/database/database';

const SESSION_TITLE_SYSTEM_PROMPT = `You are a title generator for MyWorkMate, an AI business assistant that helps users work with ERP systems, document management, and data visualization.

DOMAIN CONTEXT:
- "BC" = Business Central (Microsoft ERP system), never "British Columbia"
- Common topics: customers, vendors, invoices, sales orders, inventory, purchase orders, items, chart of accounts
- Users may ask about uploaded documents (PDF, Excel, Word, images), semantic search, or data visualizations (charts, KPIs, dashboards)
- The system has three specialist agents: ERP (Business Central), Knowledge Base (documents/RAG), and Data Visualization (charts/graphs)

Rules:
- Maximum 50 characters
- Use Title Case
- Be descriptive but brief
- Capture the main intent of the message
- No quotes or special formatting
- No ending punctuation

Examples:
User: "Show me all BC customers from Spain"
Title: "List BC Spanish Customers"

User: "Search my documents for Q3 revenue data"
Title: "Search Q3 Revenue Documents"

User: "Create a bar chart comparing sales by region"
Title: "Sales by Region Bar Chart"

User: "What endpoints does the Customer entity have?"
Title: "BC Customer Entity Endpoints"

Now generate a title for the user's message:`;

/**
 * Session Title Generator Class
 */
export class SessionTitleGenerator {
  private static instance: SessionTitleGenerator | null = null;
  private logger = createChildLogger({ service: 'SessionTitleGenerator' });

  private constructor() {
    this.logger.info('SessionTitleGenerator initialized');
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
   * Uses ModelFactory with the 'session_title' role for consistent model selection.
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
      this.logger.debug('Generating session title', {
        messageLength: userMessage.length,
      });

      const model = await ModelFactory.create('session_title');

      const response = await model.invoke([
        new SystemMessage(SESSION_TITLE_SYSTEM_PROMPT),
        new HumanMessage(userMessage),
      ]);

      // Extract text from response
      const content = response.content;
      if (typeof content !== 'string') {
        throw new Error('Invalid response from model');
      }

      let title = content.trim();

      // Sanitize title
      title = this.sanitizeTitle(title);

      // Fallback if title is too long or empty
      if (title.length === 0) {
        title = this.generateFallbackTitle(userMessage);
      } else if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }

      this.logger.debug('Session title generated', { title });

      return title;
    } catch (error) {
      this.logger.error('Failed to generate session title', { error });

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

      this.logger.debug('Session title updated', { sessionId, title });
    } catch (error) {
      this.logger.error('Failed to update session title', { error, sessionId });
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
      this.logger.error('Failed to generate and update title', {
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
   * @param title - Raw title from model
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
   * Used when model fails or returns invalid title.
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
    this.logger.info('Batch generating titles', { count: sessions.length });

    const results = await Promise.allSettled(
      sessions.map(async (session) => {
        const title = await this.generateTitle(session.userMessage);
        return { sessionId: session.sessionId, title };
      })
    );

    const successfulResults: Array<{ sessionId: string; title: string }> = [];

    results.forEach((result, index) => {
      const session = sessions[index];

      if (result.status === 'fulfilled') {
        successfulResults.push(result.value);
      } else {
        // Validate session exists (defensive programming)
        if (!session) {
          this.logger.warn('Session undefined in batch results', { index });
          return;
        }

        this.logger.error('Failed to generate title in batch', {
          sessionId: session.sessionId,
          error: result.reason,
        });
        // Add fallback title
        successfulResults.push({
          sessionId: session.sessionId,
          title: this.generateFallbackTitle(session.userMessage),
        });
      }
    });

    this.logger.info('Batch title generation completed', {
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
