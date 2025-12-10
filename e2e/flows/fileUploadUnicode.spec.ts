import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

test.describe('Unicode File Upload', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app and wait for it to load
    await page.goto('http://localhost:3001');
    await page.waitForLoadState('networkidle');
  });

  test('should preserve Danish characters in filename', async ({ page }) => {
    const fileName = 'Test – æøå • Rapport.pdf';

    // Create a temporary test file
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, Buffer.from('PDF test content'));

    try {
      // Find file input and upload file
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(filePath);

      // Wait for upload to complete
      await page.waitForTimeout(2000);

      // Verify original name displayed in file list (NOT sanitized)
      const fileListItem = page.locator(`text=${fileName}`).first();
      await expect(fileListItem).toBeVisible({ timeout: 10000 });

      console.log(`✅ File "${fileName}" displayed correctly with Unicode characters`);
    } finally {
      // Cleanup
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  test('should preserve emoji in filename', async ({ page }) => {
    const fileName = 'Report 🎉 2024.pdf';

    // Create a temporary test file
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, Buffer.from('PDF test content'));

    try {
      // Find file input and upload
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(filePath);

      // Wait for upload to complete
      await page.waitForTimeout(2000);

      // Verify emoji preserved in display
      const fileListItem = page.locator(`text=${fileName}`).first();
      await expect(fileListItem).toBeVisible({ timeout: 10000 });

      console.log(`✅ File "${fileName}" displayed correctly with emoji`);
    } finally {
      // Cleanup
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  test('should preserve special punctuation (en dash, bullet)', async ({ page }) => {
    const fileName = 'Order received – pro•duhk•tiv Learning Store.pdf';

    // Create a temporary test file
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, Buffer.from('PDF test content'));

    try {
      // Find file input and upload
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(filePath);

      // Wait for upload to complete
      await page.waitForTimeout(2000);

      // Verify special characters preserved
      const fileListItem = page.locator(`text=${fileName}`).first();
      await expect(fileListItem).toBeVisible({ timeout: 10000 });

      console.log(`✅ File "${fileName}" displayed correctly with special punctuation`);
    } finally {
      // Cleanup
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });
});
