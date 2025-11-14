# E2E Testing Guide - Playwright

> **Document Status**: Phase 3 Implementation Guide
> **Framework**: Playwright 1.49.1 (Cross-browser)
> **Last Updated**: 2025-11-14
> **Related**: `00-testing-strategy.md`, `02-integration-testing-guide.md`

---

## Table of Contents

1. [E2E Testing Overview](#e2e-testing-overview)
2. [Playwright Setup](#playwright-setup)
3. [Test Structure & Patterns](#test-structure--patterns)
4. [Critical User Journeys](#critical-user-journeys)
5. [Page Object Model](#page-object-model)
6. [Authentication Fixtures](#authentication-fixtures)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## E2E Testing Overview

**Definition**: End-to-End tests verify complete user journeys in a real browser (UI → Backend → Database).

**Scope**:
- Authentication flows (OAuth, login/logout)
- Chat interface (send message, streaming, history)
- Approval workflows (approval dialog, approve/reject)
- Todo list interactions (auto-generation, status updates)
- Error scenarios (network disconnect, session expiry)

**Coverage Target**: **5 critical user journeys**

---

## Playwright Setup

### Installation

```bash
# Install Playwright
npm install --save-dev --save-exact @playwright/test@1.49.1
npm install --save-dev --save-exact playwright@1.49.1

# Install browsers
npx playwright install chromium firefox

# Optional: Install all browsers (Chrome, Firefox, WebKit)
npx playwright install
```

---

### Configuration

**Create `playwright.config.ts`**:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Test directory
  testDir: './e2e',

  // Parallel execution
  fullyParallel: false,  // ⚠️ Critical: Sessions are stateful
  workers: 1,             // ⚠️ Single worker to avoid conflicts

  // Retries
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  // Reporter
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list']
  ],

  // Global options
  use: {
    // Base URL
    baseURL: 'http://localhost:3000',

    // Trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Action timeout
    actionTimeout: 10000,

    // Navigation timeout
    navigationTimeout: 30000
  },

  // Projects (browsers)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    }
    // Uncomment for Safari testing
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] }
    // }
  ],

  // Web server (start before tests)
  webServer: [
    {
      command: 'cd backend && npm run dev',
      port: 3002,
      timeout: 120000,
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'cd frontend && npm run dev',
      port: 3000,
      timeout: 120000,
      reuseExistingServer: !process.env.CI
    }
  ]
});
```

**Key Settings**:
- **`fullyParallel: false`** - Sessions are stateful, avoid race conditions
- **`workers: 1`** - Single worker prevents DB conflicts
- **`webServer`** - Auto-start backend + frontend before tests
- **`trace: 'on-first-retry'`** - Capture trace for debugging

---

### Test Directory Structure

```
e2e/
├── auth.spec.ts                # Authentication flows
├── chat.spec.ts                # Chat interface tests
├── approval.spec.ts            # Approval workflow tests
├── todo.spec.ts                # Todo list tests
├── errors.spec.ts              # Error scenarios
├── fixtures/
│   ├── auth.fixture.ts         # Authentication helpers
│   ├── session.fixture.ts      # Session creation helpers
│   └── data.fixture.ts         # Test data generators
└── pages/
    ├── LoginPage.ts            # Login page object
    ├── ChatPage.ts             # Chat page object
    ├── SidebarPage.ts          # Sidebar page object
    └── ApprovalDialogPage.ts   # Approval dialog page object
```

---

## Test Structure & Patterns

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Setup before each test
    await page.goto('/');
  });

  test('should do something', async ({ page }) => {
    // Arrange
    await page.fill('#input', 'test value');

    // Act
    await page.click('#submit-button');

    // Assert
    await expect(page.locator('#result')).toHaveText('Expected result');
  });
});
```

---

### Playwright Selectors

**Priority Order** (most reliable to least):

1. **Role** (best for accessibility):
   ```typescript
   await page.getByRole('button', { name: 'Send' }).click();
   await page.getByRole('textbox', { name: 'Message' }).fill('Hello');
   ```

2. **Label** (good for forms):
   ```typescript
   await page.getByLabel('Email').fill('test@example.com');
   ```

3. **Placeholder**:
   ```typescript
   await page.getByPlaceholder('Type a message...').fill('Hello');
   ```

4. **Test ID** (most stable):
   ```typescript
   await page.getByTestId('chat-input').fill('Hello');
   ```

5. **CSS/XPath** (last resort):
   ```typescript
   await page.locator('#chat-input').fill('Hello');
   ```

---

## Critical User Journeys

### Journey 1: Authentication Flow

**File**: `e2e/auth.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should redirect unauthenticated user to login', async ({ page }) => {
    // Act - Navigate to protected route
    await page.goto('/chat');

    // Assert - Redirected to login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Sign in with Microsoft/i)).toBeVisible();
  });

  test('should complete OAuth login flow', async ({ page, context }) => {
    // Arrange - Start at login page
    await page.goto('/login');

    // Act - Click Microsoft login button
    await page.getByRole('button', { name: /Sign in with Microsoft/i }).click();

    // Wait for OAuth redirect (mocked in dev)
    await page.waitForURL(/\/chat/, { timeout: 30000 });

    // Assert - User authenticated and redirected to chat
    await expect(page).toHaveURL('/chat');
    await expect(page.getByText(/New Chat/i)).toBeVisible();

    // Verify session cookie exists
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(c => c.name === 'connect.sid');
    expect(sessionCookie).toBeDefined();
  });

  test('should logout user and clear session', async ({ page, context }) => {
    // Arrange - Login first
    await page.goto('/login');
    await page.getByRole('button', { name: /Sign in/i }).click();
    await page.waitForURL('/chat');

    // Act - Logout
    await page.getByRole('button', { name: /Logout/i }).click();

    // Assert - Redirected to login
    await expect(page).toHaveURL(/\/login/);

    // Verify session cookie cleared
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(c => c.name === 'connect.sid');
    expect(sessionCookie).toBeUndefined();
  });

  test('should persist auth state across page reloads', async ({ page }) => {
    // Arrange - Login
    await page.goto('/login');
    await page.getByRole('button', { name: /Sign in/i }).click();
    await page.waitForURL('/chat');

    // Act - Reload page
    await page.reload();

    // Assert - Still authenticated
    await expect(page).toHaveURL('/chat');
    await expect(page.getByText(/New Chat/i)).toBeVisible();
  });
});
```

---

### Journey 2: Chat Interface

**File**: `e2e/chat.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { authenticateUser } from './fixtures/auth.fixture';

test.describe('Chat Interface', () => {
  test.beforeEach(async ({ page, context }) => {
    // Authenticate before each test
    await authenticateUser(page, context);
  });

  test('should send message and receive response', async ({ page }) => {
    // Arrange - Navigate to chat
    await page.goto('/chat');

    // Act - Send message
    const input = page.getByPlaceholder(/Type a message/i);
    await input.fill('What is Business Central?');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - User message appears
    await expect(page.getByText('What is Business Central?')).toBeVisible();

    // Assert - Assistant response appears (within 30s)
    await expect(
      page.getByText(/Business Central is/i)
    ).toBeVisible({ timeout: 30000 });

    // Assert - Input cleared and enabled
    await expect(input).toHaveValue('');
    await expect(input).toBeEnabled();
  });

  test('should disable input during streaming', async ({ page }) => {
    // Arrange
    await page.goto('/chat');

    // Act - Send message
    const input = page.getByPlaceholder(/Type a message/i);
    await input.fill('Complex query that takes time');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Input disabled while streaming
    await expect(input).toBeDisabled();
    await expect(page.getByRole('button', { name: /Send/i })).toBeDisabled();

    // Wait for response complete
    await page.waitForSelector('[data-testid="streaming-indicator"]', {
      state: 'hidden',
      timeout: 30000
    });

    // Assert - Input re-enabled after streaming
    await expect(input).toBeEnabled();
  });

  test('should display streaming indicator', async ({ page }) => {
    // Arrange
    await page.goto('/chat');

    // Act - Send message
    await page.getByPlaceholder(/Type a message/i).fill('Test streaming');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Streaming indicator visible
    await expect(
      page.getByTestId('streaming-indicator')
    ).toBeVisible({ timeout: 5000 });

    // Assert - Indicator disappears when done
    await expect(
      page.getByTestId('streaming-indicator')
    ).toBeHidden({ timeout: 30000 });
  });

  test('should load message history on session switch', async ({ page }) => {
    // Arrange - Create session with messages
    await page.goto('/chat');
    await page.getByPlaceholder(/Type a message/i).fill('First message');
    await page.getByRole('button', { name: /Send/i }).click();

    await expect(page.getByText('First message')).toBeVisible();

    // Create new session
    await page.getByRole('button', { name: /New Chat/i }).click();
    await page.getByPlaceholder(/Type a message/i).fill('Second message');
    await page.getByRole('button', { name: /Send/i }).click();

    await expect(page.getByText('Second message')).toBeVisible();

    // Act - Switch back to first session
    await page.getByText('First message').click();  // Click sidebar session

    // Assert - First session history loaded
    await expect(page.getByText('First message')).toBeVisible();
    await expect(page.getByText('Second message')).not.toBeVisible();
  });

  test('should show empty state when no messages', async ({ page }) => {
    // Act
    await page.goto('/chat');

    // Assert
    await expect(
      page.getByText(/Start a conversation/i)
    ).toBeVisible();
  });

  test('should show thinking messages with collapse', async ({ page }) => {
    // Arrange
    await page.goto('/chat');

    // Act - Trigger query that has thinking
    await page.getByPlaceholder(/Type a message/i).fill('Complex analysis task');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Thinking message appears
    const thinkingMessage = page.locator('[data-testid="thinking-message"]');
    await expect(thinkingMessage).toBeVisible({ timeout: 30000 });

    // Assert - Can collapse thinking
    const collapseButton = thinkingMessage.locator('button', { hasText: /Collapse/i });
    await collapseButton.click();

    await expect(
      thinkingMessage.locator('.thinking-content')
    ).toBeHidden();
  });
});
```

---

### Journey 3: Approval Workflow

**File**: `e2e/approval.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { authenticateUser } from './fixtures/auth.fixture';

test.describe('Approval Workflow', () => {
  test.beforeEach(async ({ page, context }) => {
    await authenticateUser(page, context);
    await page.goto('/chat');
  });

  test('should trigger approval dialog on write operation', async ({ page }) => {
    // Act - Send write operation request
    await page.getByPlaceholder(/Type a message/i).fill('Create a customer named John Doe');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Approval dialog appears
    const approvalDialog = page.getByRole('dialog', { name: /Approval Required/i });
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // Assert - Dialog shows operation details
    await expect(approvalDialog.getByText(/bc_create_customer/i)).toBeVisible();
    await expect(approvalDialog.getByText(/John Doe/i)).toBeVisible();
  });

  test('should approve operation and continue', async ({ page }) => {
    // Arrange - Trigger approval
    await page.getByPlaceholder(/Type a message/i).fill('Create customer Test User');
    await page.getByRole('button', { name: /Send/i }).click();

    // Wait for approval dialog
    const approvalDialog = page.getByRole('dialog');
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // Act - Approve
    await approvalDialog.getByRole('button', { name: /Approve/i }).click();

    // Assert - Dialog closes
    await expect(approvalDialog).toBeHidden({ timeout: 5000 });

    // Assert - Success message appears
    await expect(
      page.getByText(/Customer created successfully/i)
    ).toBeVisible({ timeout: 30000 });
  });

  test('should reject operation and cancel', async ({ page }) => {
    // Arrange - Trigger approval
    await page.getByPlaceholder(/Type a message/i).fill('Delete item ITEM-123');
    await page.getByRole('button', { name: /Send/i }).click();

    const approvalDialog = page.getByRole('dialog');
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // Act - Reject
    await approvalDialog.getByRole('button', { name: /Reject/i }).click();

    // Assert - Dialog closes
    await expect(approvalDialog).toBeHidden();

    // Assert - Operation cancelled message
    await expect(
      page.getByText(/Operation cancelled/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show multiple approvals in queue', async ({ page }) => {
    // Arrange - Trigger batch operation
    await page.getByPlaceholder(/Type a message/i).fill('Create 5 customers');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Multiple approval dialogs (or queue indicator)
    const approvalQueue = page.getByTestId('approval-queue');
    await expect(approvalQueue).toBeVisible({ timeout: 30000 });

    const approvalCount = await approvalQueue.getByTestId('approval-item').count();
    expect(approvalCount).toBeGreaterThan(0);
  });

  test('should timeout approval after 5 minutes', async ({ page }) => {
    // Arrange - Trigger approval
    await page.getByPlaceholder(/Type a message/i).fill('Update vendor address');
    await page.getByRole('button', { name: /Send/i }).click();

    const approvalDialog = page.getByRole('dialog');
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // Act - Wait (simulated, would need fake timers in real test)
    // In real scenario, mock the timeout on backend

    // Assert - Dialog shows timeout warning
    await expect(
      approvalDialog.getByText(/will expire in/i)
    ).toBeVisible({ timeout: 10000 });
  });
});
```

---

### Journey 4: Todo List

**File**: `e2e/todo.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { authenticateUser } from './fixtures/auth.fixture';

test.describe('Todo List', () => {
  test.beforeEach(async ({ page, context }) => {
    await authenticateUser(page, context);
    await page.goto('/chat');
  });

  test('should auto-generate todos for complex task', async ({ page }) => {
    // Act - Send complex task
    await page.getByPlaceholder(/Type a message/i).fill(
      'Analyze all customers, find duplicates, and merge them'
    );
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Todo list appears in sidebar
    const todoPanel = page.getByTestId('todo-panel');
    await expect(todoPanel).toBeVisible({ timeout: 30000 });

    // Assert - Multiple todos generated
    const todoItems = todoPanel.getByTestId('todo-item');
    const count = await todoItems.count();
    expect(count).toBeGreaterThan(0);

    // Assert - First todo is marked in_progress
    const firstTodo = todoItems.first();
    await expect(firstTodo.getByText(/in progress/i)).toBeVisible();
  });

  test('should mark todo as completed', async ({ page }) => {
    // Arrange - Generate todos
    await page.getByPlaceholder(/Type a message/i).fill('Create report with 5 sections');
    await page.getByRole('button', { name: /Send/i }).click();

    const todoPanel = page.getByTestId('todo-panel');
    await expect(todoPanel).toBeVisible({ timeout: 30000 });

    // Wait for first todo to complete
    const firstTodo = todoPanel.getByTestId('todo-item').first();
    await expect(firstTodo.getByText(/completed/i)).toBeVisible({ timeout: 60000 });

    // Assert - Check icon visible
    await expect(firstTodo.locator('[data-icon="check"]')).toBeVisible();

    // Assert - Second todo becomes in_progress
    const secondTodo = todoPanel.getByTestId('todo-item').nth(1);
    await expect(secondTodo.getByText(/in progress/i)).toBeVisible();
  });

  test('should show empty state when no todos', async ({ page }) => {
    // Act - Navigate to chat (no complex task yet)
    await page.goto('/chat');

    // Assert
    const todoPanel = page.getByTestId('todo-panel');
    await expect(todoPanel.getByText(/No tasks/i)).toBeVisible();
  });
});
```

---

### Journey 5: Error Scenarios

**File**: `e2e/errors.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { authenticateUser } from './fixtures/auth.fixture';

test.describe('Error Scenarios', () => {
  test.beforeEach(async ({ page, context }) => {
    await authenticateUser(page, context);
  });

  test('should show error banner on network disconnect', async ({ page, context }) => {
    // Arrange
    await page.goto('/chat');

    // Act - Simulate network offline
    await context.setOffline(true);

    // Send message (will fail)
    await page.getByPlaceholder(/Type a message/i).fill('Test offline');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Error banner visible
    await expect(
      page.getByText(/Network error/i)
    ).toBeVisible({ timeout: 10000 });

    // Restore network
    await context.setOffline(false);
  });

  test('should handle WebSocket disconnection', async ({ page }) => {
    // Arrange
    await page.goto('/chat');

    // Wait for connection
    await expect(page.getByTestId('connection-indicator')).toHaveText(/Connected/i);

    // Act - Stop backend server (simulated)
    // In real test, would use a test endpoint to force disconnect

    // Assert - Disconnection indicator
    await expect(
      page.getByTestId('connection-indicator')
    ).toHaveText(/Disconnected/i, { timeout: 10000 });

    // Assert - Reconnection attempt
    await expect(
      page.getByText(/Reconnecting/i)
    ).toBeVisible({ timeout: 5000 });
  });

  test('should handle session expiry', async ({ page, context }) => {
    // Arrange
    await page.goto('/chat');

    // Act - Clear session cookie (simulate expiry)
    await context.clearCookies();

    // Send message (will trigger 401)
    await page.getByPlaceholder(/Type a message/i).fill('Test session expiry');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Redirected to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should show error when agent fails', async ({ page }) => {
    // Arrange
    await page.goto('/chat');

    // Act - Trigger query that causes agent error (mock on backend)
    await page.getByPlaceholder(/Type a message/i).fill('TRIGGER_ERROR');
    await page.getByRole('button', { name: /Send/i }).click();

    // Assert - Error message in chat
    await expect(
      page.getByText(/An error occurred/i)
    ).toBeVisible({ timeout: 30000 });
  });
});
```

---

## Page Object Model

### Example: ChatPage

**File**: `e2e/pages/ChatPage.ts`

```typescript
import { Page, Locator } from '@playwright/test';

export class ChatPage {
  readonly page: Page;
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  readonly messageList: Locator;
  readonly streamingIndicator: Locator;

  constructor(page: Page) {
    this.page = page;
    this.messageInput = page.getByPlaceholder(/Type a message/i);
    this.sendButton = page.getByRole('button', { name: /Send/i });
    this.messageList = page.getByTestId('message-list');
    this.streamingIndicator = page.getByTestId('streaming-indicator');
  }

  async goto() {
    await this.page.goto('/chat');
  }

  async sendMessage(content: string) {
    await this.messageInput.fill(content);
    await this.sendButton.click();
  }

  async waitForResponse(timeout = 30000) {
    await this.streamingIndicator.waitFor({ state: 'hidden', timeout });
  }

  async getLastMessage(): Promise<string> {
    const messages = this.messageList.locator('[data-testid="message"]');
    const lastMessage = messages.last();
    return await lastMessage.textContent() || '';
  }
}
```

**Usage**:
```typescript
test('should send message', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  await chatPage.sendMessage('Hello');
  await chatPage.waitForResponse();

  const response = await chatPage.getLastMessage();
  expect(response).toContain('Hi');
});
```

---

## Authentication Fixtures

**File**: `e2e/fixtures/auth.fixture.ts`

```typescript
import { Page, BrowserContext } from '@playwright/test';

export async function authenticateUser(page: Page, context: BrowserContext) {
  // Navigate to login
  await page.goto('/login');

  // Click login button (triggers mock OAuth)
  await page.getByRole('button', { name: /Sign in/i }).click();

  // Wait for redirect to chat
  await page.waitForURL('/chat', { timeout: 30000 });

  // Verify session cookie exists
  const cookies = await context.cookies();
  const sessionCookie = cookies.find(c => c.name === 'connect.sid');

  if (!sessionCookie) {
    throw new Error('Authentication failed: No session cookie');
  }
}

export async function createAuthenticatedContext(context: BrowserContext) {
  // Alternative: Set cookies directly (if you have a test user token)
  await context.addCookies([
    {
      name: 'connect.sid',
      value: 'test-session-token',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false
    }
  ]);
}
```

---

## Best Practices

### 1. Use Data Test IDs

```tsx
// Component
<div data-testid="chat-interface">
  <input data-testid="chat-input" />
  <button data-testid="send-button">Send</button>
</div>

// Test
await page.getByTestId('chat-input').fill('Hello');
await page.getByTestId('send-button').click();
```

---

### 2. Wait for Network Idle

```typescript
await page.goto('/chat', { waitUntil: 'networkidle' });
```

---

### 3. Handle Flaky Tests with Auto-Wait

```typescript
// ✅ GOOD - Playwright auto-waits for element
await expect(page.getByText('Success')).toBeVisible();

// ❌ BAD - Manual waits are flaky
await page.waitForTimeout(5000);
```

---

### 4. Test Accessibility

```typescript
test('should have proper ARIA labels', async ({ page }) => {
  await page.goto('/chat');

  const input = page.getByRole('textbox', { name: /Message/i });
  await expect(input).toHaveAttribute('aria-label', 'Message input');
});
```

---

## Troubleshooting

### Issue 1: "Browser not found"

**Solution**:
```bash
npx playwright install chromium
```

---

### Issue 2: "Test timeout"

**Solution**: Increase timeout:
```typescript
test('slow test', async ({ page }) => {
  test.setTimeout(60000);  // 60 seconds
  // ...
});
```

---

### Issue 3: "Element not visible"

**Solution**: Add explicit wait:
```typescript
await page.waitForSelector('[data-testid="element"]', { state: 'visible' });
```

---

**Document Version**: 1.0
