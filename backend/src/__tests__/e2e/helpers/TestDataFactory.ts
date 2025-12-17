/**
 * TestDataFactory - Extended test data generation for E2E API tests
 *
 * This module provides factory functions for creating test data used in
 * E2E API tests. It extends beyond the basic session/user factories to
 * include specialized data for:
 * - Billing and invoicing
 * - File uploads and attachments
 * - Token usage tracking
 *
 * @module __tests__/e2e/helpers/TestDataFactory
 */

/**
 * Test billing invoice data
 */
export interface TestBillingData {
  /** Invoice identifier */
  invoiceId: string;
  /** Invoice amount in USD */
  amount: number;
  /** Billing period (YYYY-MM format) */
  period: string;
  /** Invoice status */
  status: 'paid' | 'pending' | 'overdue';
}

/**
 * Test file data for upload testing
 */
export interface TestFileData {
  /** File identifier */
  id: string;
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** File content buffer */
  content: Buffer;
}

/**
 * Test usage data for token tracking
 */
export interface TestUsageData {
  /** Number of input tokens */
  inputTokens: number;
  /** Number of output tokens */
  outputTokens: number;
  /** Number of cached tokens (prompt caching) */
  cachedTokens: number;
  /** Usage period (YYYY-MM format) */
  period: string;
}

/**
 * Generate test billing invoice data
 *
 * Creates a test invoice with realistic defaults that can be overridden.
 * Default invoice is pending for the current month.
 *
 * @param overrides - Partial billing data to override defaults
 * @returns Test billing data
 *
 * @example
 * ```typescript
 * const invoice = createTestBillingData({ amount: 250.00, status: 'paid' });
 * ```
 */
export function createTestBillingData(
  overrides?: Partial<TestBillingData>
): TestBillingData {
  return {
    invoiceId: `inv_${Date.now()}`,
    amount: 100.0,
    period: new Date().toISOString().slice(0, 7), // YYYY-MM
    status: 'pending',
    ...overrides,
  };
}

/**
 * Generate test file data
 *
 * Creates a test file buffer with realistic defaults. Default file is a
 * plain text file with sample content.
 *
 * @param overrides - Partial file data to override defaults
 * @returns Test file data
 *
 * @example
 * ```typescript
 * const file = createTestFileData({
 *   name: 'report.pdf',
 *   mimeType: 'application/pdf',
 * });
 * ```
 */
export function createTestFileData(overrides?: Partial<TestFileData>): TestFileData {
  const name = overrides?.name || `test-file-${Date.now()}.txt`;
  const content =
    overrides?.content || Buffer.from('Test file content for E2E testing');
  return {
    id: `file_${Date.now()}`,
    name,
    size: content.length,
    mimeType: 'text/plain',
    content,
    ...overrides,
  };
}

/**
 * Generate test usage data
 *
 * Creates test token usage data with realistic defaults for the current month.
 *
 * @param overrides - Partial usage data to override defaults
 * @returns Test usage data
 *
 * @example
 * ```typescript
 * const usage = createTestUsageData({ inputTokens: 5000, outputTokens: 2000 });
 * ```
 */
export function createTestUsageData(
  overrides?: Partial<TestUsageData>
): TestUsageData {
  return {
    inputTokens: 1000,
    outputTokens: 500,
    cachedTokens: 200,
    period: new Date().toISOString().slice(0, 7),
    ...overrides,
  };
}

/**
 * Batch of test data
 */
export interface TestDataBatch {
  /** Billing invoices */
  billing: TestBillingData[];
  /** File attachments */
  files: TestFileData[];
  /** Usage records */
  usage: TestUsageData[];
}

/**
 * Generate a batch of test data
 *
 * Creates multiple test data records of each type for batch testing scenarios.
 * Useful for testing pagination, bulk operations, and performance.
 *
 * @param count - Number of records to generate for each type
 * @returns Batch of test data
 *
 * @example
 * ```typescript
 * const batch = createTestDataBatch(10);
 * // batch.billing has 10 invoices
 * // batch.files has 10 files
 * // batch.usage has 10 usage records
 * ```
 */
export function createTestDataBatch(count: number): TestDataBatch {
  const billing: TestBillingData[] = [];
  const files: TestFileData[] = [];
  const usage: TestUsageData[] = [];

  for (let i = 0; i < count; i++) {
    billing.push(createTestBillingData({ invoiceId: `inv_batch_${i}` }));
    files.push(createTestFileData({ name: `batch-file-${i}.txt` }));
    usage.push(createTestUsageData({ inputTokens: 1000 * (i + 1) }));
  }

  return { billing, files, usage };
}
