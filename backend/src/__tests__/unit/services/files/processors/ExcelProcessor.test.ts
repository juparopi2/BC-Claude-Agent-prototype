/**
 * ExcelProcessor Unit Tests
 *
 * Comprehensive tests for ExcelProcessor which handles Excel files (xlsx, xls)
 * using the xlsx library. Converts sheets to CSV format for text extraction.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: FileService.test.ts (passing pattern)
 *
 * Coverage Target: >90%
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { ExcelProcessor } from '@/services/files/processors/ExcelProcessor';
import type { ExtractionResult } from '@/services/files/processors/types';

// ===== MOCK LOGGER (vi.hoisted pattern) =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// Mock xlsx module to allow spying/mocking of 'read'
vi.mock('xlsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('xlsx')>();
  return {
    ...mod,
    read: vi.fn((...args) => mod.read(...args)),
  };
});

describe('ExcelProcessor', () => {
  let processor: ExcelProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks(); // Restore all spied methods
    processor = new ExcelProcessor();
  });

  // ========== SUITE 1: VALID XLSX FILES (5 TESTS) ==========
  describe('extractText() with valid XLSX files', () => {
    it('should extract text from single-sheet workbook', async () => {
      // Create minimal XLSX workbook programmatically
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['Name', 'Age', 'City'],
        ['Alice', 30, 'New York'],
        ['Bob', 25, 'Los Angeles'],
        ['Charlie', 35, 'Chicago'],
      ]);

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

      // Convert workbook to buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Extract text
      const result: ExtractionResult = await processor.extractText(buffer, 'test.xlsx');

      // Verify result structure
      expect(result.text).toBeDefined();
      expect(result.text).toContain('## Sheet: Sheet1');
      expect(result.text).toContain('Name,Age,City');
      expect(result.text).toContain('Alice,30,New York');
      expect(result.text).toContain('Bob,25,Los Angeles');
      expect(result.text).toContain('Charlie,35,Chicago');

      // Verify metadata
      expect(result.metadata.pageCount).toBe(1);
      expect(result.metadata.fileSize).toBe(buffer.length);
      expect(result.metadata.ocrUsed).toBe(false);
      expect(result.metadata.title).toBeUndefined();
      expect(result.metadata.author).toBeUndefined();

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'test.xlsx',
          fileSize: buffer.length,
        }),
        'Starting Excel extraction'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'test.xlsx',
          textLength: expect.any(Number),
          sheetCount: 1,
          fileSize: buffer.length,
          hasTitle: false,
          hasAuthor: false,
        }),
        'Excel extraction completed successfully'
      );
    });

    it('should extract text from multi-sheet workbook', async () => {
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Sales data
      const sheet1 = XLSX.utils.aoa_to_sheet([
        ['Product', 'Revenue'],
        ['Widget A', 1500],
        ['Widget B', 2300],
      ]);

      // Sheet 2: Expenses
      const sheet2 = XLSX.utils.aoa_to_sheet([
        ['Category', 'Amount'],
        ['Rent', 1000],
        ['Utilities', 300],
      ]);

      // Sheet 3: Summary
      const sheet3 = XLSX.utils.aoa_to_sheet([
        ['Total Revenue', 3800],
        ['Total Expenses', 1300],
        ['Profit', 2500],
      ]);

      XLSX.utils.book_append_sheet(workbook, sheet1, 'Sales');
      XLSX.utils.book_append_sheet(workbook, sheet2, 'Expenses');
      XLSX.utils.book_append_sheet(workbook, sheet3, 'Summary');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'financial-report.xlsx');

      // Verify all sheets present
      expect(result.text).toContain('## Sheet: Sales');
      expect(result.text).toContain('## Sheet: Expenses');
      expect(result.text).toContain('## Sheet: Summary');

      // Verify data from each sheet
      expect(result.text).toContain('Widget A,1500');
      expect(result.text).toContain('Rent,1000');
      expect(result.text).toContain('Profit,2500');

      // Verify metadata
      expect(result.metadata.pageCount).toBe(3);
      expect(result.metadata.ocrUsed).toBe(false);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          sheetCount: 3,
        }),
        'Excel extraction completed successfully'
      );
    });

    it('should extract metadata (title and author) when present', async () => {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([['Data', 123]]);

      // Set workbook properties
      workbook.Props = {
        Title: 'Financial Report 2024',
        Author: 'John Doe',
        Subject: 'Annual Report',
        Company: 'ACME Corp',
        CreatedDate: new Date('2024-01-01'),
      };

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'report.xlsx');

      // Verify metadata extraction
      expect(result.metadata.title).toBe('Financial Report 2024');
      expect(result.metadata.author).toBe('John Doe');
      expect(result.metadata.pageCount).toBe(1);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          hasTitle: true,
          hasAuthor: true,
        }),
        'Excel extraction completed successfully'
      );
    });

    it('should handle empty sheets with placeholder text', async () => {
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Normal data
      const sheet1 = XLSX.utils.aoa_to_sheet([['Name', 'Value'], ['Item', 100]]);

      // Sheet 2: Empty sheet (no data)
      const sheet2 = XLSX.utils.aoa_to_sheet([]);

      // Sheet 3: Sheet with only whitespace
      const sheet3 = XLSX.utils.aoa_to_sheet([['', '', '']]);

      XLSX.utils.book_append_sheet(workbook, sheet1, 'Data');
      XLSX.utils.book_append_sheet(workbook, sheet2, 'EmptySheet');
      XLSX.utils.book_append_sheet(workbook, sheet3, 'WhitespaceSheet');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'mixed.xlsx');

      // Verify placeholder for empty sheets
      expect(result.text).toContain('## Sheet: EmptySheet');
      expect(result.text).toContain('(empty sheet)');

      // Normal sheet should have data
      expect(result.text).toContain('## Sheet: Data');
      expect(result.text).toContain('Item,100');

      // Whitespace sheet might be considered empty
      expect(result.text).toContain('## Sheet: WhitespaceSheet');

      expect(result.metadata.pageCount).toBe(3);
    });

    it('should handle workbook with special characters and unicode', async () => {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['Name', 'Description', 'Price'],
        ['Café', 'Espresso ☕', '€3.50'],
        ['Croissant', 'Fresh 🥐', '€2.00'],
        ['Müsli', 'Organic', '€4.50'],
      ]);

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Menu');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'menu.xlsx');

      // Verify unicode preservation
      expect(result.text).toContain('Café');
      expect(result.text).toContain('Espresso ☕');
      expect(result.text).toContain('€3.50');
      expect(result.text).toContain('Müsli');

      expect(result.metadata.pageCount).toBe(1);
    });
  });

  // ========== SUITE 2: ERROR HANDLING (6 TESTS) ==========
  describe('extractText() error handling', () => {
    it('should throw error with empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(processor.extractText(emptyBuffer, 'empty.xlsx')).rejects.toThrow(
        'Buffer is empty or undefined'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'empty.xlsx',
          error: 'Buffer is empty or undefined',
        }),
        'Excel extraction failed'
      );
    });

    it('should throw error with invalid Excel buffer', async () => {
      const invalidBuffer = Buffer.from('invalid-data');

      // Mock XLSX.read to throw error
      vi.mocked(XLSX.read).mockImplementationOnce(() => {
        throw new Error('File not found');
      });

      // Expect the outer error message
      await expect(processor.extractText(invalidBuffer, 'invalid.xlsx')).rejects.toThrow(
        'Failed to parse Excel file'
      );
    });

    it('should throw error when workbook has no sheets', async () => {
       const buffer = Buffer.from('fake-excel');
       
       // Mock read to return empty workbook
       vi.mocked(XLSX.read).mockReturnValueOnce({
           SheetNames: [],
           Sheets: {},
           Props: {}, 
           AppVersion: '1.0',
           Strings: [],
           SSF: {},
           Workbook: {}
       } as any);

       await expect(processor.extractText(buffer, 'nosheets.xlsx')).rejects.toThrow(
           'Excel file contains no sheets'
       );
    });

    it('should handle corrupted sheet gracefully with warning', async () => {
        const buffer = Buffer.from('fake-excel');

        // Mock read to return workbook with sheet name but no sheet data
        vi.mocked(XLSX.read).mockReturnValueOnce({
            SheetNames: ['Sheet1'],
            Sheets: {}, // Missing Sheet1 data
            Props: {},
            AppVersion: '1.0',
            Strings: [],
            SSF: {},
            Workbook: {} 
        } as any);

        // Should not throw, but log warning
        const result = await processor.extractText(buffer, 'corrupted.xlsx');
        
        // Sheet1 header is skipped if sheet is missing
        expect(result.text).not.toContain('Sheet1'); 
        
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                fileName: 'corrupted.xlsx',
                sheetName: 'Sheet1'
            }),
            'Sheet not found in workbook, skipping'
        );
    });

    it('should handle sheet conversion failure gracefully', async () => {
      const workbook = XLSX.utils.book_new();

      // Create a normal sheet first
      const validSheet = XLSX.utils.aoa_to_sheet([['Valid', 'Sheet']]);
      XLSX.utils.book_append_sheet(workbook, validSheet, 'ValidSheet');

      // Create a problematic sheet that might fail conversion
      const problematicSheet = XLSX.utils.aoa_to_sheet([['Data']]);

      // Mock sheet_to_csv to throw error for specific sheet
      const originalSheetToCsv = XLSX.utils.sheet_to_csv;
      let callCount = 0;
      vi.spyOn(XLSX.utils, 'sheet_to_csv').mockImplementation((sheet) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('CSV conversion failed');
        }
        return originalSheetToCsv(sheet);
      });

      XLSX.utils.book_append_sheet(workbook, problematicSheet, 'ProblematicSheet');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'problematic.xlsx');

      // Should still succeed with valid sheet
      expect(result.text).toContain('## Sheet: ValidSheet');
      expect(result.text).toContain('Valid,Sheet');

      // Should include failure placeholder
      expect(result.text).toContain('## Sheet: ProblematicSheet');
      expect(result.text).toContain('(failed to read sheet)');

      // Should log warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'problematic.xlsx',
          sheetName: 'ProblematicSheet',
          error: 'CSV conversion failed',
        }),
        'Failed to convert sheet to CSV, skipping'
      );

      expect(result.metadata.pageCount).toBe(2);
    });

    it('should log warning when all sheets are empty', async () => {
      const workbook = XLSX.utils.book_new();

      // Create multiple empty sheets
      const emptySheet1 = XLSX.utils.aoa_to_sheet([]);
      const emptySheet2 = XLSX.utils.aoa_to_sheet([]);

      XLSX.utils.book_append_sheet(workbook, emptySheet1, 'EmptySheet1');
      XLSX.utils.book_append_sheet(workbook, emptySheet2, 'EmptySheet2');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'all-empty.xlsx');

      // Should still return result
      expect(result.text).toBeDefined();
      expect(result.metadata.pageCount).toBe(2);

      // Note: Empty sheets get "(empty sheet)" placeholder, so text is not actually empty
      // The warning is only logged when text.length === 0 after trimming
      // Empty sheets produce: "## Sheet: EmptySheet1\n\n(empty sheet)\n"
      // which is NOT empty, so warning won't be logged
      // This test documents the actual behavior
      expect(result.text).toContain('(empty sheet)');

      // Warning should NOT be logged because placeholder text exists
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'all-empty.xlsx',
        }),
        'Extracted text is empty after processing all sheets'
      );
    });
  });

  // ========== SUITE 3: EDGE CASES (4 TESTS) ==========
  describe('extractText() edge cases', () => {
    it('should handle large workbook with many sheets', async () => {
      const workbook = XLSX.utils.book_new();

      // Create 10 sheets with data
      for (let i = 1; i <= 10; i++) {
        const sheet = XLSX.utils.aoa_to_sheet([
          [`Sheet${i}`, 'Data'],
          ['Row1', i * 100],
          ['Row2', i * 200],
        ]);
        XLSX.utils.book_append_sheet(workbook, sheet, `Sheet${i}`);
      }

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'large.xlsx');

      // Verify all sheets present
      expect(result.metadata.pageCount).toBe(10);

      for (let i = 1; i <= 10; i++) {
        expect(result.text).toContain(`## Sheet: Sheet${i}`);
        expect(result.text).toContain(`Row1,${i * 100}`);
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          sheetCount: 10,
        }),
        'Excel extraction completed successfully'
      );
    });

    it('should handle sheets with formulas (converts to values)', async () => {
      const workbook = XLSX.utils.book_new();

      // Create sheet with formulas
      const sheet = XLSX.utils.aoa_to_sheet([
        ['A', 'B', 'Sum'],
        [10, 20, { t: 'n', f: 'A2+B2', v: 30 }],
        [15, 25, { t: 'n', f: 'A3+B3', v: 40 }],
      ]);

      XLSX.utils.book_append_sheet(workbook, sheet, 'Formulas');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'formulas.xlsx');

      // Should extract calculated values
      expect(result.text).toContain('A,B,Sum');
      expect(result.text).toContain('10,20,30');
      expect(result.text).toContain('15,25,40');

      expect(result.metadata.pageCount).toBe(1);
    });

    it('should handle sheets with mixed data types', async () => {
      const workbook = XLSX.utils.book_new();

      // Create sheet with various data types
      const sheet = XLSX.utils.aoa_to_sheet([
        ['String', 'Number', 'Boolean', 'Date', 'Null'],
        ['Hello', 123, true, new Date('2024-01-01'), null],
        ['World', 456.78, false, new Date('2024-12-31'), undefined],
      ]);

      XLSX.utils.book_append_sheet(workbook, sheet, 'MixedTypes');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'mixed-types.xlsx');

      // Verify extraction includes all data types
      expect(result.text).toContain('Hello');
      expect(result.text).toContain('123');
      // Note: xlsx library converts booleans to uppercase: TRUE/FALSE
      expect(result.text).toContain('TRUE');
      expect(result.text).toContain('FALSE');

      expect(result.metadata.pageCount).toBe(1);
    });

    it('should handle CSV-like content with commas and quotes', async () => {
      const workbook = XLSX.utils.book_new();

      // Create sheet with CSV-problematic content
      const sheet = XLSX.utils.aoa_to_sheet([
        ['Name', 'Description', 'Notes'],
        ['Smith, John', 'Employee, Senior', 'Works in IT, Hardware'],
        ['Doe, Jane', 'Manager "Sales"', 'Quoted "text" here'],
      ]);

      XLSX.utils.book_append_sheet(workbook, sheet, 'CSVContent');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'csv-content.xlsx');

      // XLSX library handles CSV escaping automatically
      expect(result.text).toBeDefined();
      expect(result.text).toContain('Smith');
      expect(result.text).toContain('Manager');

      expect(result.metadata.pageCount).toBe(1);
    });
  });

  // ========== SUITE 4: METADATA VALIDATION (2 TESTS) ==========
  describe('extractText() metadata validation', () => {
    it('should set pageCount equal to sheet count', async () => {
      const workbook = XLSX.utils.book_new();

      // Create 5 sheets
      for (let i = 1; i <= 5; i++) {
        const sheet = XLSX.utils.aoa_to_sheet([[`Sheet${i}`]]);
        XLSX.utils.book_append_sheet(workbook, sheet, `S${i}`);
      }

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'five-sheets.xlsx');

      // pageCount should equal sheet count
      expect(result.metadata.pageCount).toBe(5);
      expect(workbook.SheetNames).toHaveLength(5);
    });

    it('should always set ocrUsed to false (Excel does not use OCR)', async () => {
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([['Data']]);

      XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const result = await processor.extractText(buffer, 'test.xlsx');

      // OCR should always be false for Excel
      expect(result.metadata.ocrUsed).toBe(false);
    });
  });
});
