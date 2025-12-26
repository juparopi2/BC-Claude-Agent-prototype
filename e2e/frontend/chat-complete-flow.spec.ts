/**
 * Chat Complete Flow E2E Test
 *
 * Mega-test that validates the complete chat flow from UI perspective.
 * This test sends ONE message that triggers Extended Thinking and validates:
 * 1. Message sending via UI
 * 2. Streaming indicator appears
 * 3. Thinking blocks appear (when Extended Thinking enabled)
 * 4. Assistant message appears
 * 5. Complete state (streaming stops)
 * 6. Page refresh reconstructs the conversation
 *
 * Uses real API calls - designed for efficient token usage.
 *
 * @module e2e/frontend/chat-complete-flow.spec
 */

import { test, expect } from '@playwright/test';
import {
  authenticateContext,
  FRONTEND_URL,
  TIMEOUTS,
} from '../setup/testHelpers';
import { shouldRunClaudeTests } from '../setup/testConfig';

test.describe('Chat Complete Flow - Frontend UI', () => {
  test.beforeEach(async ({ context }) => {
    await authenticateContext(context, 'test');
  });

  /**
   * Mega-test: Complete chat flow with Extended Thinking
   *
   * This single test validates the entire chat UI flow with one API call:
   * - User message appears
   * - Streaming indicator shows
   * - Thinking block appears (Extended Thinking)
   * - Assistant response appears
   * - Page refresh reconstructs everything
   *
   * @claude-api Requires real Claude API
   */
  test('validates full chat flow with Extended Thinking', async ({ page }) => {
    test.skip(!shouldRunClaudeTests(), 'Requires Claude API - only runs in production');

    // 1. Navigate to create new session
    await page.goto(`${FRONTEND_URL}/new`);

    // Wait for the chat input to be ready
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // 2. Enable Extended Thinking toggle
    const thinkingToggle = page.locator('[data-testid="thinking-toggle"]');
    await expect(thinkingToggle).toBeVisible();
    await thinkingToggle.click();

    // Verify toggle is now pressed/active (has the active class)
    await expect(thinkingToggle).toHaveAttribute('aria-pressed', 'true');

    // 3. Type a message that will trigger thoughtful response
    const testMessage = 'Explain step by step how to calculate compound interest. Be concise.';
    const textarea = page.getByRole('textbox');
    await textarea.fill(testMessage);

    // 4. Click send button
    const sendButton = page.locator('[data-testid="send-button"]');
    await sendButton.click();

    // 5. Verify user message appears (optimistic or confirmed)
    await expect(page.locator('[data-testid="user-message"]').first()).toBeVisible({
      timeout: TIMEOUTS.short,
    });

    // 6. Verify streaming indicator appears
    await expect(page.locator('[data-testid="streaming-indicator"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // 7. Verify thinking block appears (Extended Thinking is enabled)
    await expect(page.locator('[data-testid="thinking-block"]')).toBeVisible({
      timeout: TIMEOUTS.long,
    });

    // 8. Wait for assistant message to appear (response complete)
    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({
      timeout: TIMEOUTS.extraLong,
    });

    // 9. Verify streaming indicator disappears (complete state)
    await expect(page.locator('[data-testid="streaming-indicator"]')).not.toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // Get the current URL (should be /chat/[sessionId] after redirect)
    const currentUrl = page.url();
    expect(currentUrl).toContain('/chat/');

    // 10. Page refresh to test reconstruction
    await page.reload();

    // Wait for page to load
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // 11. Verify messages are reconstructed after refresh
    // User message should still be visible
    await expect(page.locator('[data-testid="user-message"]')).toBeVisible({
      timeout: TIMEOUTS.short,
    });

    // Assistant message should still be visible
    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({
      timeout: TIMEOUTS.short,
    });

    // Thinking block should still be visible (persisted thinking)
    await expect(page.locator('[data-testid="thinking-block"]')).toBeVisible({
      timeout: TIMEOUTS.short,
    });
  });

  /**
   * Test: Simple chat flow without Extended Thinking
   *
   * Validates basic chat flow without thinking enabled.
   * Faster test for CI/CD validation.
   *
   * @claude-api Requires real Claude API
   */
  test('validates basic chat flow without Extended Thinking', async ({ page }) => {
    test.skip(!shouldRunClaudeTests(), 'Requires Claude API - only runs in production');

    // Navigate to create new session
    await page.goto(`${FRONTEND_URL}/new`);

    // Wait for chat input
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // Ensure thinking toggle is OFF (default)
    const thinkingToggle = page.locator('[data-testid="thinking-toggle"]');
    await expect(thinkingToggle).toHaveAttribute('aria-pressed', 'false');

    // Send simple message
    const textarea = page.getByRole('textbox');
    await textarea.fill('What is 2 + 2?');
    await page.locator('[data-testid="send-button"]').click();

    // Verify user message appears
    await expect(page.locator('[data-testid="user-message"]')).toBeVisible({
      timeout: TIMEOUTS.short,
    });

    // Verify streaming indicator appears
    await expect(page.locator('[data-testid="streaming-indicator"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // Wait for assistant message (should be quick for simple math)
    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({
      timeout: TIMEOUTS.long,
    });

    // Streaming should stop
    await expect(page.locator('[data-testid="streaming-indicator"]')).not.toBeVisible({
      timeout: TIMEOUTS.short,
    });

    // NO thinking block should be visible (thinking was disabled)
    await expect(page.locator('[data-testid="thinking-block"]')).not.toBeVisible();
  });

  /**
   * Test: Chat input UI controls
   *
   * Non-API test that validates UI controls work correctly.
   * Does NOT send actual message (no API cost).
   */
  test('validates chat input UI controls', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    // Wait for chat input
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // Test thinking toggle
    const thinkingToggle = page.locator('[data-testid="thinking-toggle"]');
    await expect(thinkingToggle).toBeVisible();
    await expect(thinkingToggle).toHaveAttribute('aria-pressed', 'false');

    await thinkingToggle.click();
    await expect(thinkingToggle).toHaveAttribute('aria-pressed', 'true');

    await thinkingToggle.click();
    await expect(thinkingToggle).toHaveAttribute('aria-pressed', 'false');

    // Test textarea input
    const textarea = page.getByRole('textbox');
    await textarea.fill('Test message');
    await expect(textarea).toHaveValue('Test message');

    // Test send button enabled when message present
    const sendButton = page.locator('[data-testid="send-button"]');
    await expect(sendButton).toBeEnabled();

    // Clear message - send button should still be enabled due to new session mode
    // (In new session mode, the component doesn't check connection status the same way)
    await textarea.fill('');
    // Note: In "new" mode without sessionId, send is controlled differently
  });
});
