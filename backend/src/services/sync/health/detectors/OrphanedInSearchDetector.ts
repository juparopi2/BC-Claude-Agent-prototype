/**
 * OrphanedInSearchDetector (PRD-304)
 *
 * Detects documents that exist in the Azure AI Search index but have no
 * matching 'ready' file row in the DB — orphaned search chunks that should
 * be cleaned up.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { SearchIndexComparator } from './SearchIndexComparator';
import type { DriftDetector, DetectionResult } from './types';

export class OrphanedInSearchDetector implements DriftDetector<string> {
  readonly name = 'OrphanedInSearchDetector';

  private readonly logger = createChildLogger({ service: 'OrphanedInSearchDetector' });
  private readonly comparator = new SearchIndexComparator();

  async detect(userId: string): Promise<DetectionResult<string>> {
    const { orphanedInSearch } = await this.comparator.compare(userId);

    this.logger.debug(
      { userId, count: orphanedInSearch.length },
      'OrphanedInSearchDetector: detection complete',
    );

    return { items: orphanedInSearch, count: orphanedInSearch.length };
  }
}
