/**
 * Folder Reader Tests
 *
 * TDD tests for folder reading utilities.
 * Tests written FIRST before implementation.
 *
 * @module __tests__/domains/files/utils/folderReader
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectDropType,
  readFolderRecursive,
  buildFolderStructure,
  validateFile,
  groupInvalidFilesByExtension,
} from '@/src/domains/files/utils/folderReader';
import type { FolderEntry, FileEntry } from '@/src/domains/files/types/folderUpload.types';

// Mock FileSystemEntry interfaces for testing
interface MockFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (callback: (file: File) => void, errorCallback?: (error: Error) => void) => void;
  createReader?: () => MockDirectoryReader;
}

interface MockDirectoryReader {
  readEntries: (callback: (entries: MockFileSystemEntry[]) => void, errorCallback?: (error: Error) => void) => void;
}

/**
 * Create a mock File object
 */
function createMockFile(name: string, type: string, size: number = 1024): File {
  return new File(['test content'], name, { type });
}

/**
 * Create a mock file entry (FileSystemFileEntry)
 */
function createMockFileEntry(name: string, fullPath: string, file: File): MockFileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (callback) => callback(file),
  };
}

/**
 * Create a mock directory entry (FileSystemDirectoryEntry)
 * The reader returns children on first call, then empty array (like real browser)
 */
function createMockDirectoryEntry(
  name: string,
  fullPath: string,
  children: MockFileSystemEntry[]
): MockFileSystemEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => {
      let called = false;
      return {
        readEntries: (callback) => {
          if (!called) {
            called = true;
            callback(children);
          } else {
            callback([]); // Empty array signals end of directory
          }
        },
      };
    },
  };
}

/**
 * Create a mock DataTransferItemList
 */
function createMockDataTransfer(items: MockFileSystemEntry[]): DataTransfer {
  const mockItems = items.map((entry) => ({
    kind: 'file' as const,
    type: '',
    webkitGetAsEntry: () => entry as unknown as FileSystemEntry,
    getAsFile: () => (entry.isFile && entry.file ? createMockFile(entry.name, 'text/plain') : null),
    getAsString: vi.fn(),
  }));

  // Create a proper DataTransferItemList-like object with index access and iterator
  const itemList = Object.assign(
    {
      length: mockItems.length,
      [Symbol.iterator]: function* () {
        for (let i = 0; i < mockItems.length; i++) {
          yield mockItems[i];
        }
      },
    },
    // Add numeric indices for array-like access
    Object.fromEntries(mockItems.map((item, idx) => [idx, item]))
  ) as unknown as DataTransferItemList;

  return {
    items: itemList,
    files: [] as unknown as FileList,
    types: ['Files'],
    dropEffect: 'none',
    effectAllowed: 'all',
    getData: vi.fn(),
    setData: vi.fn(),
    clearData: vi.fn(),
    setDragImage: vi.fn(),
  };
}

describe('folderReader', () => {
  describe('detectDropType', () => {
    it('should detect single folder drop', () => {
      const folderEntry = createMockDirectoryEntry('MyFolder', '/MyFolder', []);
      const dataTransfer = createMockDataTransfer([folderEntry]);

      const result = detectDropType(dataTransfer);

      expect(result).toBe('folder');
    });

    it('should detect multiple files drop', () => {
      const file1 = createMockFile('doc1.pdf', 'application/pdf');
      const file2 = createMockFile('doc2.pdf', 'application/pdf');
      const entry1 = createMockFileEntry('doc1.pdf', '/doc1.pdf', file1);
      const entry2 = createMockFileEntry('doc2.pdf', '/doc2.pdf', file2);
      const dataTransfer = createMockDataTransfer([entry1, entry2]);

      const result = detectDropType(dataTransfer);

      expect(result).toBe('files');
    });

    it('should detect mixed (folder + files)', () => {
      const file = createMockFile('doc.pdf', 'application/pdf');
      const fileEntry = createMockFileEntry('doc.pdf', '/doc.pdf', file);
      const folderEntry = createMockDirectoryEntry('MyFolder', '/MyFolder', []);
      const dataTransfer = createMockDataTransfer([fileEntry, folderEntry]);

      const result = detectDropType(dataTransfer);

      expect(result).toBe('mixed');
    });

    it('should return empty for empty drop', () => {
      const dataTransfer = createMockDataTransfer([]);

      const result = detectDropType(dataTransfer);

      expect(result).toBe('empty');
    });

    it('should handle multiple folders as folder type', () => {
      const folder1 = createMockDirectoryEntry('Folder1', '/Folder1', []);
      const folder2 = createMockDirectoryEntry('Folder2', '/Folder2', []);
      const dataTransfer = createMockDataTransfer([folder1, folder2]);

      const result = detectDropType(dataTransfer);

      expect(result).toBe('folder');
    });
  });

  describe('readFolderRecursive', () => {
    it('should read empty folder', async () => {
      const folderEntry = createMockDirectoryEntry('EmptyFolder', '/EmptyFolder', []);

      const result = await readFolderRecursive(folderEntry as unknown as FileSystemEntry, '');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('folder');
      expect(result!.name).toBe('EmptyFolder');
      expect((result as FolderEntry).children).toEqual([]);
    });

    it('should read folder with files', async () => {
      const file1 = createMockFile('doc1.pdf', 'application/pdf');
      const file2 = createMockFile('doc2.txt', 'text/plain');
      const fileEntry1 = createMockFileEntry('doc1.pdf', '/MyFolder/doc1.pdf', file1);
      const fileEntry2 = createMockFileEntry('doc2.txt', '/MyFolder/doc2.txt', file2);
      const folderEntry = createMockDirectoryEntry('MyFolder', '/MyFolder', [fileEntry1, fileEntry2]);

      const result = await readFolderRecursive(folderEntry as unknown as FileSystemEntry, '');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('folder');
      const folder = result as FolderEntry;
      expect(folder.children).toHaveLength(2);
      expect(folder.children.every((c) => c.type === 'file')).toBe(true);
    });

    it('should read nested folder structure (3 levels)', async () => {
      const deepFile = createMockFile('deep.txt', 'text/plain');
      const deepFileEntry = createMockFileEntry('deep.txt', '/Root/Level1/Level2/deep.txt', deepFile);
      const level2 = createMockDirectoryEntry('Level2', '/Root/Level1/Level2', [deepFileEntry]);
      const level1 = createMockDirectoryEntry('Level1', '/Root/Level1', [level2]);
      const root = createMockDirectoryEntry('Root', '/Root', [level1]);

      const result = await readFolderRecursive(root as unknown as FileSystemEntry, '');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('folder');

      const rootFolder = result as FolderEntry;
      expect(rootFolder.children).toHaveLength(1);
      expect(rootFolder.children[0].type).toBe('folder');

      const level1Folder = rootFolder.children[0] as FolderEntry;
      expect(level1Folder.name).toBe('Level1');
      expect(level1Folder.children).toHaveLength(1);
      expect(level1Folder.children[0].type).toBe('folder');

      const level2Folder = level1Folder.children[0] as FolderEntry;
      expect(level2Folder.name).toBe('Level2');
      expect(level2Folder.children).toHaveLength(1);
      expect(level2Folder.children[0].type).toBe('file');
    });

    it('should build correct path strings', async () => {
      const file = createMockFile('file.txt', 'text/plain');
      const fileEntry = createMockFileEntry('file.txt', '/Parent/Child/file.txt', file);
      const childFolder = createMockDirectoryEntry('Child', '/Parent/Child', [fileEntry]);
      const parentFolder = createMockDirectoryEntry('Parent', '/Parent', [childFolder]);

      const result = await readFolderRecursive(parentFolder as unknown as FileSystemEntry, '');

      expect(result).not.toBeNull();
      const parent = result as FolderEntry;
      expect(parent.path).toBe('Parent');

      const child = parent.children[0] as FolderEntry;
      expect(child.path).toBe('Parent/Child');

      const fileResult = child.children[0] as FileEntry;
      expect(fileResult.path).toBe('Parent/Child/file.txt');
    });

    it('should handle file entry directly', async () => {
      const file = createMockFile('standalone.pdf', 'application/pdf');
      const fileEntry = createMockFileEntry('standalone.pdf', '/standalone.pdf', file);

      const result = await readFolderRecursive(fileEntry as unknown as FileSystemEntry, '');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('file');
      expect((result as FileEntry).file).toBe(file);
    });

    it('should identify invalid MIME types', async () => {
      const validFile = createMockFile('doc.pdf', 'application/pdf');
      const invalidFile = createMockFile('app.exe', 'application/x-msdownload');
      const validEntry = createMockFileEntry('doc.pdf', '/Folder/doc.pdf', validFile);
      const invalidEntry = createMockFileEntry('app.exe', '/Folder/app.exe', invalidFile);
      const folder = createMockDirectoryEntry('Folder', '/Folder', [validEntry, invalidEntry]);

      const result = await readFolderRecursive(folder as unknown as FileSystemEntry, '');

      const folderResult = result as FolderEntry;
      const validFileEntry = folderResult.children.find((c) => c.name === 'doc.pdf') as FileEntry;
      const invalidFileEntry = folderResult.children.find((c) => c.name === 'app.exe') as FileEntry;

      expect(validFileEntry.isValid).toBe(true);
      expect(invalidFileEntry.isValid).toBe(false);
      expect(invalidFileEntry.invalidReason).toContain('type');
    });
  });

  describe('buildFolderStructure', () => {
    it('should build structure from single folder', async () => {
      const file = createMockFile('test.txt', 'text/plain');
      const fileEntry = createMockFileEntry('test.txt', '/Folder/test.txt', file);
      const folder = createMockDirectoryEntry('Folder', '/Folder', [fileEntry]);
      const dataTransfer = createMockDataTransfer([folder]);

      const result = await buildFolderStructure(dataTransfer);

      expect(result.rootFolders).toHaveLength(1);
      expect(result.totalFiles).toBe(1);
      expect(result.totalFolders).toBe(1);
      expect(result.allFiles).toHaveLength(1);
    });

    it('should count total files and folders correctly', async () => {
      const file1 = createMockFile('f1.txt', 'text/plain');
      const file2 = createMockFile('f2.txt', 'text/plain');
      const file3 = createMockFile('f3.txt', 'text/plain');
      const entry1 = createMockFileEntry('f1.txt', '/Root/f1.txt', file1);
      const entry2 = createMockFileEntry('f2.txt', '/Root/Sub/f2.txt', file2);
      const entry3 = createMockFileEntry('f3.txt', '/Root/Sub/f3.txt', file3);
      const subFolder = createMockDirectoryEntry('Sub', '/Root/Sub', [entry2, entry3]);
      const rootFolder = createMockDirectoryEntry('Root', '/Root', [entry1, subFolder]);
      const dataTransfer = createMockDataTransfer([rootFolder]);

      const result = await buildFolderStructure(dataTransfer);

      expect(result.totalFiles).toBe(3);
      expect(result.totalFolders).toBe(2); // Root + Sub
      expect(result.allFiles).toHaveLength(3);
    });

    it('should separate valid and invalid files', async () => {
      const validFile = createMockFile('doc.pdf', 'application/pdf');
      const invalidFile = createMockFile('app.exe', 'application/x-msdownload');
      const validEntry = createMockFileEntry('doc.pdf', '/Folder/doc.pdf', validFile);
      const invalidEntry = createMockFileEntry('app.exe', '/Folder/app.exe', invalidFile);
      const folder = createMockDirectoryEntry('Folder', '/Folder', [validEntry, invalidEntry]);
      const dataTransfer = createMockDataTransfer([folder]);

      const result = await buildFolderStructure(dataTransfer);

      expect(result.validFiles).toHaveLength(1);
      expect(result.invalidFiles).toHaveLength(1);
      expect(result.validFiles[0].name).toBe('doc.pdf');
      expect(result.invalidFiles[0].name).toBe('app.exe');
    });

    it('should handle multiple root folders', async () => {
      const file1 = createMockFile('f1.txt', 'text/plain');
      const file2 = createMockFile('f2.txt', 'text/plain');
      const entry1 = createMockFileEntry('f1.txt', '/Folder1/f1.txt', file1);
      const entry2 = createMockFileEntry('f2.txt', '/Folder2/f2.txt', file2);
      const folder1 = createMockDirectoryEntry('Folder1', '/Folder1', [entry1]);
      const folder2 = createMockDirectoryEntry('Folder2', '/Folder2', [entry2]);
      const dataTransfer = createMockDataTransfer([folder1, folder2]);

      const result = await buildFolderStructure(dataTransfer);

      expect(result.rootFolders).toHaveLength(2);
      expect(result.totalFolders).toBe(2);
      expect(result.totalFiles).toBe(2);
    });

    it('should handle mixed drop (files + folders)', async () => {
      const standaloneFile = createMockFile('standalone.txt', 'text/plain');
      const folderFile = createMockFile('folder.txt', 'text/plain');
      const standaloneEntry = createMockFileEntry('standalone.txt', '/standalone.txt', standaloneFile);
      const folderFileEntry = createMockFileEntry('folder.txt', '/Folder/folder.txt', folderFile);
      const folder = createMockDirectoryEntry('Folder', '/Folder', [folderFileEntry]);
      const dataTransfer = createMockDataTransfer([standaloneEntry, folder]);

      const result = await buildFolderStructure(dataTransfer);

      expect(result.rootFolders).toHaveLength(1);
      expect(result.totalFiles).toBe(2);
      expect(result.allFiles).toHaveLength(2);
    });
  });

  describe('validateFile', () => {
    it('should validate PDF files', () => {
      const file = createMockFile('document.pdf', 'application/pdf');
      const result = validateFile(file);
      expect(result.isValid).toBe(true);
    });

    it('should validate text files', () => {
      const file = createMockFile('readme.txt', 'text/plain');
      const result = validateFile(file);
      expect(result.isValid).toBe(true);
    });

    it('should validate image files', () => {
      const file = createMockFile('photo.jpg', 'image/jpeg');
      const result = validateFile(file);
      expect(result.isValid).toBe(true);
    });

    it('should reject executable files', () => {
      const file = createMockFile('app.exe', 'application/x-msdownload');
      const result = validateFile(file);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should reject files exceeding size limit', () => {
      const largeFile = new File(['x'.repeat(101 * 1024 * 1024)], 'huge.pdf', {
        type: 'application/pdf',
      });
      // Note: File constructor doesn't actually create a file of that size
      // We need to mock the size property
      Object.defineProperty(largeFile, 'size', { value: 101 * 1024 * 1024 });

      const result = validateFile(largeFile);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('size');
    });

    it('should validate images within size limit', () => {
      const image = createMockFile('photo.png', 'image/png', 25 * 1024 * 1024);
      Object.defineProperty(image, 'size', { value: 25 * 1024 * 1024 });

      const result = validateFile(image);
      expect(result.isValid).toBe(true);
    });

    it('should reject images exceeding image size limit', () => {
      const largeImage = createMockFile('huge.png', 'image/png');
      Object.defineProperty(largeImage, 'size', { value: 35 * 1024 * 1024 });

      const result = validateFile(largeImage);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('size');
    });
  });

  describe('groupInvalidFilesByExtension', () => {
    it('should group invalid files by extension', () => {
      const invalidFiles: FileEntry[] = [
        {
          type: 'file',
          name: 'app1.exe',
          path: '/app1.exe',
          file: createMockFile('app1.exe', 'application/x-msdownload'),
          isValid: false,
          invalidReason: 'Unsupported type',
        },
        {
          type: 'file',
          name: 'app2.exe',
          path: '/app2.exe',
          file: createMockFile('app2.exe', 'application/x-msdownload'),
          isValid: false,
          invalidReason: 'Unsupported type',
        },
        {
          type: 'file',
          name: 'library.dll',
          path: '/library.dll',
          file: createMockFile('library.dll', 'application/x-msdownload'),
          isValid: false,
          invalidReason: 'Unsupported type',
        },
      ];

      const result = groupInvalidFilesByExtension(invalidFiles);

      expect(result).toHaveLength(2);

      const exeGroup = result.find((g) => g.extension === '.exe');
      expect(exeGroup).toBeDefined();
      expect(exeGroup!.count).toBe(2);
      expect(exeGroup!.files).toHaveLength(2);

      const dllGroup = result.find((g) => g.extension === '.dll');
      expect(dllGroup).toBeDefined();
      expect(dllGroup!.count).toBe(1);
    });

    it('should handle files without extensions', () => {
      const invalidFiles: FileEntry[] = [
        {
          type: 'file',
          name: 'Makefile',
          path: '/Makefile',
          file: createMockFile('Makefile', 'application/octet-stream'),
          isValid: false,
          invalidReason: 'Unsupported type',
        },
      ];

      const result = groupInvalidFilesByExtension(invalidFiles);

      expect(result).toHaveLength(1);
      expect(result[0].extension).toBe('(no extension)');
    });

    it('should return empty array for no invalid files', () => {
      const result = groupInvalidFilesByExtension([]);
      expect(result).toEqual([]);
    });

    it('should sort groups by count descending', () => {
      const invalidFiles: FileEntry[] = [
        {
          type: 'file',
          name: 'a.exe',
          path: '/a.exe',
          file: createMockFile('a.exe', 'application/x-msdownload'),
          isValid: false,
        },
        {
          type: 'file',
          name: 'b.dll',
          path: '/b.dll',
          file: createMockFile('b.dll', 'application/x-msdownload'),
          isValid: false,
        },
        {
          type: 'file',
          name: 'c.dll',
          path: '/c.dll',
          file: createMockFile('c.dll', 'application/x-msdownload'),
          isValid: false,
        },
        {
          type: 'file',
          name: 'd.dll',
          path: '/d.dll',
          file: createMockFile('d.dll', 'application/x-msdownload'),
          isValid: false,
        },
      ];

      const result = groupInvalidFilesByExtension(invalidFiles);

      expect(result[0].extension).toBe('.dll');
      expect(result[0].count).toBe(3);
      expect(result[1].extension).toBe('.exe');
      expect(result[1].count).toBe(1);
    });
  });
});
