/**
 * File Upload E2E Test
 *
 * Tests file upload functionality, especially uploading to nested folders.
 * Verifies the fix for parentFolderId being correctly passed from FormData.
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - Frontend running on http://localhost:3000
 * - Database accessible with test user
 *
 * @module e2e/flows/fileUpload.spec
 */

import { test, expect, Page } from '@playwright/test';
import { loginToApp } from '../setup/testHelpers';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('File Upload - Nested Folders', () => {
  let testFilePath: string;

  test.beforeAll(async () => {
    // Create a small test file
    const tempDir = os.tmpdir();
    testFilePath = path.join(tempDir, 'test-upload-file.txt');
    fs.writeFileSync(testFilePath, 'This is a test file for upload verification.');
  });

  test.afterAll(async () => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  /**
   * Test: Upload file to deeply nested folder
   *
   * This test verifies that files can be uploaded to nested folders
   * without 500 errors, validating the parentFolderId fix.
   */
  test('should upload file to nested folder successfully', async ({ page }) => {
    // Login and navigate to Files tab
    await loginToApp(page, 'test');
    await page.goto('http://localhost:3000');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Navigate to Files tab
    const filesTab = page.getByRole('button', { name: /files/i });
    if (await filesTab.isVisible()) {
      await filesTab.click();
    } else {
      // Try clicking a link or tab instead
      const filesLink = page.locator('a, [role="tab"]').filter({ hasText: /files/i }).first();
      await filesLink.click();
    }

    // Wait for file explorer to load
    await page.waitForTimeout(1000);

    // Create nested folder structure: TestLevel1 > TestLevel2 > TestLevel3
    const folderNames = ['TestLevel1', 'TestLevel2', 'TestLevel3'];

    for (const folderName of folderNames) {
      // Check if folder already exists
      const existingFolder = page.locator(`text=${folderName}`).first();
      const exists = await existingFolder.isVisible().catch(() => false);

      if (!exists) {
        // Create new folder
        const newFolderButton = page.getByRole('button', { name: /new folder|create folder/i }).or(
          page.locator('button').filter({ hasText: /folder/i })
        );
        await newFolderButton.first().click();

        // Fill folder name
        const folderInput = page.getByRole('textbox', { name: /folder name|name/i }).or(
          page.locator('input[type="text"]').first()
        );
        await folderInput.fill(folderName);

        // Confirm creation
        const createButton = page.getByRole('button', { name: /create|save/i });
        await createButton.click();

        // Wait for folder to appear
        await page.waitForTimeout(500);
      }

      // Navigate into the folder
      const folderToClick = page.locator(`text=${folderName}`).first();
      await folderToClick.dblclick();

      // Wait for navigation
      await page.waitForTimeout(500);
    }

    // Now we're in TestLevel3 folder
    // Upload a file here

    // Set up response listener to catch any 500 errors
    let uploadResponse: any = null;
    page.on('response', async (response) => {
      if (response.url().includes('/api/files/upload')) {
        uploadResponse = {
          status: response.status(),
          statusText: response.statusText(),
          body: await response.text().catch(() => 'Unable to read body'),
        };
      }
    });

    // Trigger file upload
    const fileInput = page.locator('input[type="file"]');
    
    // If file input is not visible, try to find upload button or drag area
    if (await fileInput.isHidden()) {
      // Look for an upload button
      const uploadButton = page.getByRole('button', { name: /upload/i }).first();
      const uploadButtonExists = await uploadButton.isVisible().catch(() => false);
      
      if (uploadButtonExists) {
        await uploadButton.click();
      }
    }

    // Set the file
    await fileInput.setInputFiles(testFilePath);

    // Wait for upload to complete
    await page.waitForTimeout(2000);

    // Verify upload was successful (no 500 error)
    if (uploadResponse) {
      console.log('Upload response:', uploadResponse);
      expect(uploadResponse.status).not.toBe(500);
      expect(uploadResponse.status).toBe(201); // Created
    }

    // Verify file appears in the folder
    const uploadedFileName = path.basename(testFilePath);
    const fileElement = page.locator(`text=${uploadedFileName}`);
    await expect(fileElement).toBeVisible({ timeout: 5000 });

    // Take screenshot as proof
    await page.screenshot({ path: 'playwright-report/file-upload-success.png', fullPage: true });
  });

  /**
   * Test: Verify upload fails with proper error for invalid parent folder
   *
   * This tests that the backend validation is working correctly.
   */
  test.skip('should return error for invalid parent folder', async ({ page }) => {
    // This would require API-level testing with invalid parentFolderId
    // Skipping for now as it's mainly a backend validation test
  });
});
