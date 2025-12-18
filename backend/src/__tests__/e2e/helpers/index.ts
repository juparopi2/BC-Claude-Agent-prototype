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

// Golden flow configurations
export {
  configureGoldenFlow,
  configureSimpleTextResponse,
  configureThinkingResponse,
  configureToolUseResponse,
  configureApprovalResponse,
  configureErrorResponse,
  type GoldenFlowType,
} from './GoldenResponses';

// Test data factories
export {
  createTestBillingData,
  createTestFileData,
  createTestUsageData,
  createTestDataBatch,
  type TestBillingData,
  type TestFileData,
  type TestUsageData,
  type TestDataBatch,
} from './TestDataFactory';

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

// Database cleanup utilities
export {
  cleanSlateForSuite,
  verifyCleanSlate,
  type CleanSlateOptions,
  type CleanSlateResult,
  type CleanSlateVerification,
} from './CleanSlateDB';

// Response scenario registry
export {
  ResponseScenarioRegistry,
  getScenarioRegistry,
  resetScenarioRegistry,
  type AgentEvent,
  type ScenarioDatabaseMessage,
  type ScenarioDatabaseEvent,
  type ScenarioResult,
  type ScenarioDefinition,
  type ScenarioId,
} from './ResponseScenarioRegistry';

// Captured response validator
export {
  validateFakeAgainstCaptured,
  quickValidate,
  loadCapturedResponse,
  loadLatestCapturedResponse,
  listCapturedResponses,
  type CapturedResponse,
  type FakeStreamingEvent,
  type ValidationResult,
} from './CapturedResponseValidator';
