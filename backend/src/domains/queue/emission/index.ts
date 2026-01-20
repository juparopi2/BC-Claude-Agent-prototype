/**
 * Queue Emission Module
 *
 * WebSocket event emitters for background job notifications.
 *
 * @module domains/queue/emission
 */

export {
  JobFailureEventEmitter,
  getJobFailureEventEmitter,
  __resetJobFailureEventEmitter,
} from './JobFailureEventEmitter';

export type { JobFailureEventEmitterDependencies } from './JobFailureEventEmitter';
