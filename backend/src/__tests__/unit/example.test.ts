import { describe, it, expect } from 'vitest';

describe('Example Test Suite', () => {
  it('should pass a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should verify environment variables are loaded', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.ANTHROPIC_API_KEY).toBe('mock-api-key');
  });

  it('should handle async operations', async () => {
    const result = await Promise.resolve('test-value');
    expect(result).toBe('test-value');
  });
});
