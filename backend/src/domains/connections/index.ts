/**
 * Connections Domain
 *
 * Business logic and data access for external service connections
 * (OneDrive, SharePoint, Business Central, etc.).
 *
 * @module domains/connections
 */

export {
  ConnectionRepository,
  getConnectionRepository,
} from './ConnectionRepository';

export type { ConnectionRow, ScopeRow } from './ConnectionRepository';

export {
  ConnectionService,
  getConnectionService,
  ConnectionNotFoundError,
  ConnectionForbiddenError,
} from './ConnectionService';
