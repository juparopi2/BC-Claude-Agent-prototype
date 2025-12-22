/**
 * @module domains/agent/persistence
 *
 * Persistence domain for the agent orchestration system.
 * Handles all database and event store operations.
 *
 * Implemented Classes:
 * - PersistenceErrorAnalyzer: Categorizes persistence errors (~60 LOC)
 * - PersistenceCoordinator: Coordinates EventStore + MessageQueue (~120 LOC)
 */

// Types
export * from './types';

// PersistenceErrorAnalyzer
export {
  PersistenceErrorAnalyzer,
  getPersistenceErrorAnalyzer,
  __resetPersistenceErrorAnalyzer,
} from './PersistenceErrorAnalyzer';

// PersistenceCoordinator
export {
  PersistenceCoordinator,
  getPersistenceCoordinator,
  __resetPersistenceCoordinator,
} from './PersistenceCoordinator';
