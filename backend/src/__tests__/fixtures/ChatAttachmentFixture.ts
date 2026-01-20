/**
 * ChatAttachmentFixture - Factory for chat attachment test data
 *
 * This fixture creates realistic test data for ephemeral chat attachments.
 * Follows the Builder pattern for fluent, readable test setup.
 *
 * Benefits:
 * - Reduces test boilerplate
 * - Provides realistic default values
 * - Easy to create multiple attachments
 * - Self-documenting test data
 *
 * Usage:
 * ```typescript
 * // Create a simple attachment
 * const attachment = ChatAttachmentFixture.createDbRecord();
 *
 * // Create a PDF attachment with overrides
 * const pdf = ChatAttachmentFixture.createDbRecord({
 *   name: 'invoice.pdf',
 *   mime_type: 'application/pdf',
 *   size_bytes: 512000,
 * });
 *
 * // Create a parsed attachment (API format)
 * const apiAttachment = ChatAttachmentFixture.createParsedAttachment({ name: 'report.pdf' });
 *
 * // Use presets for common scenarios
 * const expired = ChatAttachmentFixture.Presets.expiredAttachment();
 * const image = ChatAttachmentFixture.Presets.imageAttachment();
 * ```
 */

import type {
  ChatAttachmentDbRecord,
  ParsedChatAttachment,
  ChatAttachmentStatus,
} from '@bc-agent/shared';

/**
 * Chat Attachment Fixture Factory
 *
 * Creates realistic test data with complete typing.
 * Follows the pattern: provide realistic defaults, allow overrides.
 */
export class ChatAttachmentFixture {
  /**
   * Generate a random UUID for testing (UPPERCASE per project conventions)
   */
  private static generateId(prefix = 'attachment'): string {
    return `${prefix.toUpperCase()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
  }

  /**
   * Generate a realistic blob path for chat attachments
   */
  private static generateBlobPath(userId: string, sessionId: string, filename: string): string {
    const timestamp = Date.now();
    return `chat-attachments/${userId}/${sessionId}/${timestamp}-${filename}`;
  }

  /**
   * Create a complete ChatAttachmentDbRecord with realistic defaults
   *
   * Default values represent a typical uploaded PDF:
   * - 1 MB size
   * - 24h TTL (expires tomorrow)
   * - Ready status
   *
   * @param overrides - Partial record to override defaults
   * @returns Complete attachment database record ready for tests
   *
   * @example
   * ```typescript
   * const invoice = ChatAttachmentFixture.createDbRecord({
   *   name: 'invoice-2024-01.pdf',
   *   user_id: 'USER-123',
   * });
   * ```
   */
  static createDbRecord(overrides?: Partial<ChatAttachmentDbRecord>): ChatAttachmentDbRecord {
    const userId = overrides?.user_id || ChatAttachmentFixture.generateId('user');
    const sessionId = overrides?.session_id || ChatAttachmentFixture.generateId('session');
    const name = overrides?.name || 'test-document.pdf';
    const createdAt = overrides?.created_at || new Date('2026-01-15T10:00:00Z');

    // Default expiration: 24 hours from creation
    const expiresAt =
      overrides?.expires_at || new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

    return {
      id: ChatAttachmentFixture.generateId('attachment'),
      user_id: userId,
      session_id: sessionId,
      name,
      mime_type: 'application/pdf',
      size_bytes: 1024000, // 1 MB
      blob_path: ChatAttachmentFixture.generateBlobPath(userId, sessionId, name),
      content_hash: null,
      expires_at: expiresAt,
      created_at: createdAt,
      is_deleted: false,
      deleted_at: null,
      ...overrides,
    };
  }

  /**
   * Create a ParsedChatAttachment (API response format)
   *
   * This is the camelCase version sent to clients.
   * Dates are ISO 8601 strings, not Date objects.
   *
   * @param overrides - Partial record to override defaults
   * @returns Complete parsed attachment ready for API tests
   *
   * @example
   * ```typescript
   * const apiAttachment = ChatAttachmentFixture.createParsedAttachment({
   *   name: 'report.pdf',
   *   userId: 'USER-123',
   * });
   *
   * // Test API response
   * expect(response.body.attachment).toMatchObject(apiAttachment);
   * ```
   */
  static createParsedAttachment(overrides?: Partial<ParsedChatAttachment>): ParsedChatAttachment {
    const userId = overrides?.userId || ChatAttachmentFixture.generateId('user');
    const sessionId = overrides?.sessionId || ChatAttachmentFixture.generateId('session');
    const name = overrides?.name || 'test-document.pdf';
    const createdAt = overrides?.createdAt || '2026-01-15T10:00:00.000Z';

    // Default expiration: 24 hours from creation
    const expiresAt =
      overrides?.expiresAt ||
      new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();

    return {
      id: ChatAttachmentFixture.generateId('attachment'),
      userId,
      sessionId,
      name,
      mimeType: 'application/pdf',
      sizeBytes: 1024000,
      status: 'ready' as ChatAttachmentStatus,
      expiresAt,
      createdAt,
      ...overrides,
    };
  }

  /**
   * Create multiple attachment records
   *
   * Useful for testing batch operations and listings.
   *
   * @param count - Number of attachments to create
   * @param overrides - Partial record applied to ALL attachments
   * @returns Array of attachment database records
   *
   * @example
   * ```typescript
   * // Create 5 attachments for a session
   * const attachments = ChatAttachmentFixture.createMultipleDbRecords(5, {
   *   user_id: 'USER-123',
   *   session_id: 'SESSION-456',
   * });
   *
   * expect(attachments).toHaveLength(5);
   * expect(attachments[0].name).toBe('attachment-1.pdf');
   * ```
   */
  static createMultipleDbRecords(
    count: number,
    overrides?: Partial<ChatAttachmentDbRecord>
  ): ChatAttachmentDbRecord[] {
    return Array.from({ length: count }, (_, i) =>
      ChatAttachmentFixture.createDbRecord({
        name: `attachment-${i + 1}.pdf`,
        ...overrides,
      })
    );
  }

  /**
   * Create multiple parsed attachments
   *
   * @param count - Number of attachments to create
   * @param overrides - Partial record applied to ALL attachments
   * @returns Array of parsed attachments
   */
  static createMultipleParsedAttachments(
    count: number,
    overrides?: Partial<ParsedChatAttachment>
  ): ParsedChatAttachment[] {
    return Array.from({ length: count }, (_, i) =>
      ChatAttachmentFixture.createParsedAttachment({
        name: `attachment-${i + 1}.pdf`,
        ...overrides,
      })
    );
  }

  /**
   * Common presets for typical attachment scenarios
   */
  static readonly Presets = {
    /**
     * A typical PDF document attachment
     */
    pdfAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'document.pdf',
        mime_type: 'application/pdf',
        size_bytes: 245760, // ~240 KB
      }),

    /**
     * A JPEG image attachment
     */
    imageAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'screenshot.jpeg',
        mime_type: 'image/jpeg',
        size_bytes: 512000, // ~500 KB
      }),

    /**
     * A PNG image attachment
     */
    pngAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'diagram.png',
        mime_type: 'image/png',
        size_bytes: 1024000, // ~1 MB
      }),

    /**
     * A text file attachment
     */
    textAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'notes.txt',
        mime_type: 'text/plain',
        size_bytes: 10240, // ~10 KB
      }),

    /**
     * A CSV file attachment
     */
    csvAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'data.csv',
        mime_type: 'text/csv',
        size_bytes: 102400, // ~100 KB
      }),

    /**
     * A Word document attachment
     */
    wordAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'report.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size_bytes: 512000, // ~500 KB
      }),

    /**
     * An Excel spreadsheet attachment
     */
    excelAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'budget.xlsx',
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size_bytes: 256000, // ~250 KB
      }),

    /**
     * An expired attachment (TTL exceeded)
     */
    expiredAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'expired-document.pdf',
        mime_type: 'application/pdf',
        size_bytes: 102400,
        created_at: new Date('2026-01-10T10:00:00Z'),
        expires_at: new Date('2026-01-11T10:00:00Z'), // Expired 4 days ago
      }),

    /**
     * A soft-deleted attachment
     */
    deletedAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'deleted-document.pdf',
        mime_type: 'application/pdf',
        size_bytes: 102400,
        is_deleted: true,
        deleted_at: new Date('2026-01-14T10:00:00Z'),
      }),

    /**
     * A large document near the size limit (32MB)
     */
    largeDocumentAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'large-report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 31 * 1024 * 1024, // 31 MB
      }),

    /**
     * A large image near the size limit (20MB)
     */
    largeImageAttachment: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'large-image.png',
        mime_type: 'image/png',
        size_bytes: 19 * 1024 * 1024, // 19 MB
      }),

    /**
     * Attachment with content hash (for dedup testing)
     */
    attachmentWithHash: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') =>
      ChatAttachmentFixture.createDbRecord({
        user_id: userId,
        session_id: sessionId,
        name: 'hashed-document.pdf',
        mime_type: 'application/pdf',
        size_bytes: 512000,
        content_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      }),

    /**
     * Multiple attachments for the same session
     */
    sessionWithMultipleAttachments: (userId = 'USER-TEST-123', sessionId = 'SESSION-TEST-123') => {
      return [
        ChatAttachmentFixture.createDbRecord({
          user_id: userId,
          session_id: sessionId,
          name: 'document-1.pdf',
          mime_type: 'application/pdf',
          size_bytes: 102400,
        }),
        ChatAttachmentFixture.createDbRecord({
          user_id: userId,
          session_id: sessionId,
          name: 'image-1.jpeg',
          mime_type: 'image/jpeg',
          size_bytes: 256000,
        }),
        ChatAttachmentFixture.createDbRecord({
          user_id: userId,
          session_id: sessionId,
          name: 'data.csv',
          mime_type: 'text/csv',
          size_bytes: 51200,
        }),
      ];
    },
  };
}
