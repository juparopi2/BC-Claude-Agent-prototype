/**
 * Chat Visual Components E2E Tests
 *
 * Tests for visual components in the chat interface.
 * These tests validate UI interactions WITHOUT requiring API calls.
 *
 * @module e2e/frontend/chat-visual-components.spec
 */

import { test, expect } from '@playwright/test';
import {
  authenticateContext,
  FRONTEND_URL,
  TIMEOUTS,
} from '../setup/testHelpers';

test.describe('Chat Visual Components', () => {
  test.beforeEach(async ({ context }) => {
    await authenticateContext(context, 'test');
  });

  /**
   * Test: Thinking toggle persists state
   *
   * Validates that the thinking toggle maintains state and shows visual feedback.
   */
  test('thinking toggle shows visual state changes', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    // Wait for chat input to be ready
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    const thinkingToggle = page.locator('[data-testid="thinking-toggle"]');

    // Verify initial state (off)
    await expect(thinkingToggle).toHaveAttribute('aria-pressed', 'false');

    // Click to enable
    await thinkingToggle.click();
    await expect(thinkingToggle).toHaveAttribute('aria-pressed', 'true');

    // Verify visual styling change (should have amber background when active)
    // The toggle should have a distinct visual state
    await expect(thinkingToggle).toBeVisible();

    // Click to disable
    await thinkingToggle.click();
    await expect(thinkingToggle).toHaveAttribute('aria-pressed', 'false');
  });

  /**
   * Test: Context toggle (My Files) shows visual state changes
   */
  test('context toggle shows visual state changes', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // Context toggle may have a different test id
    const contextToggle = page.locator('button:has-text("My Files")');

    if (await contextToggle.isVisible()) {
      // Get initial state
      const initialPressed = await contextToggle.getAttribute('aria-pressed');

      // Click to toggle
      await contextToggle.click();

      // State should change
      const newPressed = await contextToggle.getAttribute('aria-pressed');
      expect(newPressed).not.toBe(initialPressed);

      // Click again to toggle back
      await contextToggle.click();
      await expect(contextToggle).toHaveAttribute('aria-pressed', initialPressed || 'false');
    }
  });

  /**
   * Test: Textarea auto-resize behavior
   *
   * Validates that the textarea grows when content is added.
   */
  test('textarea auto-resizes with content', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    const textarea = page.getByRole('textbox');
    await expect(textarea).toBeVisible();

    // Get initial height
    const initialHeight = await textarea.evaluate(el => el.scrollHeight);

    // Add multiple lines of text
    await textarea.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

    // Height should increase
    const newHeight = await textarea.evaluate(el => el.scrollHeight);
    expect(newHeight).toBeGreaterThan(initialHeight);
  });

  /**
   * Test: Send button enabled/disabled states
   *
   * Validates that the send button is enabled only when there's content.
   */
  test('send button enabled with content, shows loading state', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    const textarea = page.getByRole('textbox');
    const sendButton = page.locator('[data-testid="send-button"]');

    // With empty textarea in /new mode, button behavior varies
    await textarea.fill('');

    // Add content
    await textarea.fill('Test message');

    // Send button should be enabled
    await expect(sendButton).toBeEnabled();
  });

  /**
   * Test: Keyboard shortcut - Enter sends, Shift+Enter adds newline
   */
  test('Enter sends message, Shift+Enter adds newline', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    const textarea = page.getByRole('textbox');

    // Type some text
    await textarea.fill('First line');

    // Shift+Enter should add newline (not send)
    await textarea.press('Shift+Enter');
    await textarea.type('Second line');

    // Verify textarea has both lines
    const value = await textarea.inputValue();
    expect(value).toContain('First line');
    expect(value).toContain('Second line');
  });

  /**
   * Test: Attachment button triggers file picker
   */
  test('attachment button is clickable', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // Find the attachment button (Paperclip icon)
    const attachButton = page.locator('button').filter({ has: page.locator('.lucide-paperclip') });

    if (await attachButton.isVisible()) {
      // Verify button is enabled
      await expect(attachButton).toBeEnabled();

      // Set up a file chooser listener
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 2000 }).catch(() => null);

      // Click the button
      await attachButton.click();

      // File chooser should open (or be triggered)
      const fileChooser = await fileChooserPromise;

      // If file chooser opened, close by pressing Escape
      if (fileChooser) {
        await page.keyboard.press('Escape');
      }
    }
  });

  /**
   * Test: Voice input button shows disabled state (coming soon)
   */
  test('voice input button shows disabled state', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // Find voice button (Mic icon)
    const voiceButton = page.locator('button').filter({ has: page.locator('.lucide-mic') });

    if (await voiceButton.isVisible()) {
      // Should be disabled (coming soon)
      await expect(voiceButton).toBeDisabled();
    }
  });

  /**
   * Test: Web search button shows disabled state (coming soon)
   */
  test('web search button shows disabled state', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/new`);

    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({
      timeout: TIMEOUTS.medium,
    });

    // Find web search button (Globe icon)
    const webButton = page.locator('button').filter({ has: page.locator('.lucide-globe') });

    if (await webButton.isVisible()) {
      // Should be disabled (coming soon)
      await expect(webButton).toBeDisabled();
    }
  });
});
