/**
 * MissingFromSearchDetector (PRD-304)
 *
 * Detects files that are in DB as 'ready' but are absent from the Azure AI
 * Search index — meaning their chunks were never indexed (or were lost).
 */

import { createChildLogger } from '@/shared/utils/logger';
import { SearchIndexComparator } from './SearchIndexComparator';
import type { DriftDetector, DetectionResult } from './types';

export class MissingFromSearchDetector implements DriftDetector<string> {
  readonly name = 'MissingFromSearchDetector';

  private readonly logger = createChildLogger({ service: 'MissingFromSearchDetector' });
  private readonly comparator = new SearchIndexComparator();

  async detect(userId: string): Promise<DetectionResult<string>> {
    const { missingFromSearch } = await this.comparator.compare(userId);

    this.logger.debug(
      { userId, count: missingFromSearch.length },
      'MissingFromSearchDetector: detection complete',
    );

    return { items: missingFromSearch, count: missingFromSearch.length };
  }
}
