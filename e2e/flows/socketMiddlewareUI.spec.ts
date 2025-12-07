
/**
 * Socket Middleware E2E Tests - UI Level
 *
 * Tests the socket middleware integration by interacting with the UI
 * and verifying store updates and visual feedback.
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - Frontend running on http://localhost:3000
 * - Redis accessible for session injection
 * - Database accessible with test data seeded
 *
 * @module e2e/flows/socketMiddlewareUI.spec
 */

import { test, expect } from '@playwright/test';
import {
  loginToApp,
  authenticateContext,
  TEST_SESSIONS,
  TIMEOUTS,
  FRONTEND_URL,
} from '../setup/testHelpers';
import { shouldRunClaudeTests } from '../setup/testConfig';

test.describe('Socket Middleware - UI Level', () => {
  
  test.beforeEach(async ({ context }) => {
    // Authenticate the browser context
    await authenticateContext(context, 'test');
  });

  /**
   * Test 1: Auto-connect on mount
   * Verifies that the socket connects automatically when the app loads
   */
  test('should auto-connect to WebSocket on mount', async ({ page }) => {
    // Login and navigate to test page
    await authenticateContext(page.context(), 'test');
    await page.goto(FRONTEND_URL + '/test-socket');

    // Wait for the app to load
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({ timeout: TIMEOUTS.medium });

    // Verify connection status
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected: Yes', { timeout: TIMEOUTS.medium });
    
    // Verify user info is loaded (store integration)
    await expect(page.locator('[data-testid="user-info"]')).not.toContainText('User: None');
  });

  /**
   * Test 2: Optimistic Message Creation
   * Verifies that a message appears immediately in the UI before server confirmation
   */
  test('should display optimistic message immediately', async ({ page }) => {
    await authenticateContext(page.context(), 'test');
    await page.goto(FRONTEND_URL + '/test-socket');

    const messageContent = `Optimistic Test ${Date.now()}`;

    // Type message
    await page.fill('[data-testid="chat-input"]', messageContent);

    // Click send
    await page.click('[data-testid="send-button"]');

    // Verify message appears immediately
    await expect(page.locator(`text=${messageContent}`)).toBeVisible({ timeout: 1000 });
    
    // Verify it's marked as optimistic (opacity-50 or "(sending...)")
    await expect(page.locator(`text=(sending...)`)).toBeVisible();
  });

  /**
   * Test 3: Session Switching
   * Verifies that switching sessions updates the socket room/context
   */
  test('should handle session switching correctly', async ({ page }) => {
    await authenticateContext(page.context(), 'test');
    await page.goto(FRONTEND_URL + '/test-socket');

    // Wait for connection
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected: Yes');

    // Join a specific session
    const sessionId = TEST_SESSIONS.withHistory;
    await page.fill('[data-testid="session-input"]', sessionId);
    await page.click('[data-testid="join-button"]');
    
    // Verify session info updates
    await expect(page.locator('[data-testid="session-info"]')).toContainText(`Session: ${sessionId}`);
    
    // Send message in this session
    const messageContent = `Session Switch Test ${Date.now()}`;
    await page.fill('[data-testid="chat-input"]', messageContent);
    await page.click('[data-testid="send-button"]');
    
    await expect(page.locator(`text=${messageContent}`)).toBeVisible();
  });

  /**
   * Test 4: Store Integration (via UI)
   * Verifies that incoming events update the UI
   *
   * @claude-api This test requires Claude API and only runs in production environment
   */
  test('should update UI when receiving agent events', async ({ page }) => {
    test.skip(!shouldRunClaudeTests(), 'Claude API test - only runs in production environment');

    await authenticateContext(page.context(), 'test');
    await page.goto(FRONTEND_URL + '/test-socket');
    
    const messageContent = 'Hello Agent';
    await page.fill('[data-testid="chat-input"]', messageContent);
    await page.click('[data-testid="send-button"]');

    // Wait for agent response (implies socket received events and store updated)
    // We look for a message that is NOT optimistic (no "sending...")
    // Or we can look for "assistant:" role
    await expect(page.locator('text=assistant:')).toBeVisible({ timeout: TIMEOUTS.medium });
  });

});
