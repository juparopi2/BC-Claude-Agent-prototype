/**
 * ContentProviderFactory
 *
 * Maps file source types to their corresponding IFileContentProvider implementations.
 * Supports local blob storage now; OneDrive and SharePoint providers are planned for
 * PRD-101 and PRD-103 respectively.
 *
 * @module services/connectors
 */

import { FILE_SOURCE_TYPE } from '@bc-agent/shared';
import { createChildLogger } from '@/shared/utils/logger';
import { getBlobContentProvider } from './BlobContentProvider';
import { getGraphApiContentProvider } from './GraphApiContentProvider';
import type { IFileContentProvider } from './IFileContentProvider';

const logger = createChildLogger({ service: 'ContentProviderFactory' });

export class ContentProviderFactory {
  /**
   * Get the IFileContentProvider for the given source type.
   *
   * @param sourceType - One of FILE_SOURCE_TYPE values ('local', 'onedrive', 'sharepoint')
   * @throws Error if the provider is not yet implemented
   */
  getProvider(sourceType: string): IFileContentProvider {
    logger.info({ sourceType }, 'Resolving content provider');

    switch (sourceType) {
      case FILE_SOURCE_TYPE.LOCAL:
        return getBlobContentProvider();

      case FILE_SOURCE_TYPE.ONEDRIVE:
        return getGraphApiContentProvider();

      case FILE_SOURCE_TYPE.SHAREPOINT:
        throw new Error(`Provider not implemented: ${sourceType} (PRD-101/PRD-103)`);

      default:
        throw new Error(`Unknown source type: ${sourceType}`);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ContentProviderFactory | undefined;

/**
 * Get the ContentProviderFactory singleton.
 */
export function getContentProviderFactory(): ContentProviderFactory {
  if (!instance) {
    instance = new ContentProviderFactory();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetContentProviderFactory(): void {
  instance = undefined;
}
