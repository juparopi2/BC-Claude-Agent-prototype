/**
 * @module domains/agent/persistence
 *
 * Persistence domain for the agent orchestration system.
 * Handles all database and event store operations.
 *
 * Implemented Classes:
 * - PersistenceErrorAnalyzer: Categorizes persistence errors (~60 LOC)
 *
 * TODO: Implement remaining classes:
 * - PersistenceCoordinator: Coordinates EventStore + MessageQueue (~120 LOC)
 */

// Types
export * from './types';

// Implemented classes
export {
  PersistenceErrorAnalyzer,
  getPersistenceErrorAnalyzer,
  __resetPersistenceErrorAnalyzer,
} from './PersistenceErrorAnalyzer';

// TODO: Export PersistenceCoordinator when implemented
