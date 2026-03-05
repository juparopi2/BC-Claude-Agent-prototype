/**
 * GraphApiContentProvider (PRD-101)
 *
 * Implements IFileContentProvider for files sourced from Microsoft Graph API
 * (OneDrive and SharePoint). Looks up file and connection records from the DB
 * and delegates actual HTTP downloads to OneDriveService.
 *
 * @module services/connectors
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { getOneDriveService } from './onedrive/OneDriveService';
import type { IFileContentProvider, FileContentResult } from './IFileContentProvider';

const logger = createChildLogger({ service: 'GraphApiContentProvider' });

// ============================================================================
// Internal DB helpers
// ============================================================================

interface FileRecord {
  connectionId: string;
  externalId: string;
  mimeType: string | null;
}

/**
 * Fetch the minimal file fields needed to perform a download.
 * Verifies the file belongs to the given user.
 */
async function getFileRecord(fileId: string, userId: string): Promise<FileRecord | null> {
  const file = await prisma.files.findFirst({
    where: { id: fileId, user_id: userId },
    select: {
      connection_id: true,
      external_id: true,
      mime_type: true,
    },
  });

  if (!file || !file.connection_id || !file.external_id) {
    return null;
  }

  return {
    connectionId: file.connection_id,
    externalId: file.external_id,
    mimeType: file.mime_type,
  };
}

// ============================================================================
// GraphApiContentProvider
// ============================================================================

export class GraphApiContentProvider implements IFileContentProvider {
  /**
   * Download file content from OneDrive via Microsoft Graph.
   *
   * @throws Error if the file or connection is not found.
   */
  async getContent(fileId: string, userId: string): Promise<FileContentResult> {
    logger.info({ fileId, userId }, 'Fetching Graph API file content');

    const fileRecord = await getFileRecord(fileId, userId);

    if (!fileRecord) {
      logger.warn({ fileId, userId }, 'File not found or missing connection/external ID');
      throw new Error(`File not found or not accessible: ${fileId}`);
    }

    const { connectionId, externalId, mimeType } = fileRecord;

    const { buffer } = await getOneDriveService().downloadFileContent(connectionId, externalId);

    logger.info(
      { fileId, userId, connectionId, externalId, sizeBytes: buffer.length },
      'Graph API file content fetched successfully'
    );

    return {
      buffer,
      mimeType: mimeType ?? undefined,
    };
  }

  /**
   * Check whether a file is accessible via the Graph API.
   * Returns false on any error rather than throwing.
   */
  async isAccessible(fileId: string, userId: string): Promise<boolean> {
    try {
      const file = await prisma.files.findFirst({
        where: { id: fileId, user_id: userId },
        select: {
          connection_id: true,
          external_id: true,
          connections: {
            select: { status: true },
          },
        },
      });

      if (!file || !file.connection_id || !file.external_id) {
        return false;
      }

      if (!file.connections || file.connections.status !== 'connected') {
        return false;
      }

      return true;
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
      logger.warn({ fileId, userId, error: errorInfo }, 'Accessibility check failed');
      return false;
    }
  }

  /**
   * Get a short-lived pre-authenticated download URL for the file.
   *
   * @throws Error if the file or connection is not found.
   */
  async getDownloadUrl(fileId: string, userId: string): Promise<string> {
    logger.info({ fileId, userId }, 'Fetching Graph API download URL');

    const fileRecord = await getFileRecord(fileId, userId);

    if (!fileRecord) {
      logger.warn({ fileId, userId }, 'File not found or missing connection/external ID');
      throw new Error(`File not found or not accessible: ${fileId}`);
    }

    const { connectionId, externalId } = fileRecord;

    const url = await getOneDriveService().getDownloadUrl(connectionId, externalId);

    logger.info({ fileId, userId, connectionId, externalId }, 'Download URL fetched');
    return url;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: GraphApiContentProvider | undefined;

/**
 * Get the GraphApiContentProvider singleton.
 */
export function getGraphApiContentProvider(): GraphApiContentProvider {
  if (!instance) {
    instance = new GraphApiContentProvider();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetGraphApiContentProvider(): void {
  instance = undefined;
}
