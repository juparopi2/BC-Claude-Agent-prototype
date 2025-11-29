
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupE2ETest } from './setup.e2e';

describe('Debug E2E Setup', () => {
  const setup = setupE2ETest();

  it('should start the server', () => {
    expect(setup.isServerRunning()).toBe(true);
    expect(setup.getBaseUrl()).toBeDefined();
  });
});
