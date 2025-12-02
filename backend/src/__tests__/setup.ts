import { beforeAll, afterAll, afterEach } from 'vitest';
import { server } from './mocks/server';

// MSW Server setup
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mock-database-url';
process.env.REDIS_URL = 'mock-redis-url';
process.env.ANTHROPIC_API_KEY = 'mock-api-key';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef'; // 32 bytes for AES-256
process.env.SESSION_SECRET = 'test-session-secret-for-testing-only';
process.env.MICROSOFT_CLIENT_ID = 'mock-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'mock-client-secret';
process.env.MICROSOFT_TENANT_ID = 'common';
process.env.MICROSOFT_REDIRECT_URI = 'http://localhost:3002/api/auth/callback';
process.env.BC_API_URL = 'https://api.businesscentral.dynamics.com/v2.0';
