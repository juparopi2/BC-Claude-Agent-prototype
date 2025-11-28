/**
 * E2E Test Helpers - Exports
 *
 * @module __tests__/e2e/helpers
 */

// Main test client
export {
  E2ETestClient,
  createE2ETestClient,
  type E2ETestClientOptions,
  type E2EHttpResponse,
  type E2EReceivedEvent,
} from './E2ETestClient';

// Validators
export {
  SequenceValidator,
  type ValidationResult,
  type DatabaseMessage,
} from './SequenceValidator';

export {
  ErrorValidator,
  type ExpectedError,
  type ErrorValidationResult,
  type StandardErrorResponse,
} from './ErrorValidator';

// Re-export test session factory from integration helpers
// (can be reused in E2E tests)
export {
  TestSessionFactory,
  createTestSessionFactory,
  type TestUser,
  type TestChatSession,
  TEST_PREFIX,
  TEST_EMAIL_DOMAIN,
  TEST_SESSION_SECRET,
} from '../../integration/helpers/TestSessionFactory';

// Re-export test socket client from integration helpers
export {
  TestSocketClient,
  createTestSocketClient,
  type TestSocketClientOptions,
  type ReceivedEvent,
} from '../../integration/helpers/TestSocketClient';
