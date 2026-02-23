/**
 * mergeFilesWithFolderContents Tests
 *
 * Validates the dedup logic that prevents folder-nested files from appearing
 * twice in the upload manifest (once as standalone, once from folder tree).
 *
 * @module __tests__/domains/files/hooks/mergeFilesWithFolderContents
 */

import { describe, it, expect } from 'vitest';
import {
  mergeFilesWithFolderContents,
  collectFolderFiles,
} from '@/src/domains/files/hooks/useBatchUpload';
import type { FolderEntry, FileEntry } from '@/src/domains/files/types/folderUpload.types';

function createMockFile(name: string, size: number = 1024): File {
  return new File(['x'.repeat(size)], name, { type: 'application/pdf' });
}

function createFileEntry(file: File, path: string): FileEntry {
  return { type: 'file', name: file.name, path, file, isValid: true };
}

function createFolderEntry(
  name: string,
  children: (FolderEntry | FileEntry)[],
  path?: string,
): FolderEntry {
  return { type: 'folder', name, path: path ?? name, children };
}

describe('mergeFilesWithFolderContents', () => {
  it('returns all files without parentTempId when no folders provided', () => {
    const f1 = createMockFile('a.pdf');
    const f2 = createMockFile('b.pdf');

    const result = mergeFilesWithFolderContents([f1, f2]);

    expect(result.allFiles).toHaveLength(2);
    expect(result.allFiles[0]).toEqual({ file: f1 });
    expect(result.allFiles[1]).toEqual({ file: f2 });
    expect(result.manifestFolders).toHaveLength(0);
  });

  it('returns all files without parentTempId when folders is undefined', () => {
    const f1 = createMockFile('a.pdf');

    const result = mergeFilesWithFolderContents([f1], undefined);

    expect(result.allFiles).toHaveLength(1);
    expect(result.allFiles[0]).toEqual({ file: f1 });
  });

  it('returns only folder files with parentTempId when folders provided and files array is empty', () => {
    const f1 = createMockFile('nested.pdf');
    const folder = createFolderEntry('MyFolder', [
      createFileEntry(f1, 'MyFolder/nested.pdf'),
    ]);

    const result = mergeFilesWithFolderContents([], [folder]);

    expect(result.allFiles).toHaveLength(1);
    expect(result.allFiles[0]!.file).toBe(f1);
    expect(result.allFiles[0]!.parentTempId).toBeDefined();
    expect(result.manifestFolders).toHaveLength(1);
    expect(result.manifestFolders[0]!.folderName).toBe('MyFolder');
  });

  it('deduplicates folder-nested files passed in both files array and folders', () => {
    // This is the exact bug scenario: same File object in both lists
    const nestedFile = createMockFile('report.pdf');
    const standaloneFile = createMockFile('standalone.pdf');

    const folder = createFolderEntry('Docs', [
      createFileEntry(nestedFile, 'Docs/report.pdf'),
    ]);

    // files array contains BOTH the standalone AND the nested file (bug scenario)
    const result = mergeFilesWithFolderContents(
      [standaloneFile, nestedFile],
      [folder],
    );

    // nestedFile should appear only once (from folder, with parentTempId)
    expect(result.allFiles).toHaveLength(2);

    const standalone = result.allFiles.find((f) => f.file === standaloneFile);
    expect(standalone).toBeDefined();
    expect(standalone!.parentTempId).toBeUndefined();

    const nested = result.allFiles.find((f) => f.file === nestedFile);
    expect(nested).toBeDefined();
    expect(nested!.parentTempId).toBeDefined();
  });

  it('handles nested subfolders — deep files deduplicated correctly', () => {
    const deepFile = createMockFile('deep.pdf');
    const midFile = createMockFile('mid.pdf');

    const subFolder = createFolderEntry('Sub', [
      createFileEntry(deepFile, 'Root/Sub/deep.pdf'),
    ], 'Root/Sub');

    const rootFolder = createFolderEntry('Root', [
      createFileEntry(midFile, 'Root/mid.pdf'),
      subFolder,
    ]);

    // Pass all files flat (bug scenario) + folder tree
    const result = mergeFilesWithFolderContents(
      [midFile, deepFile],
      [rootFolder],
    );

    // Both should appear once each, from the folder tree
    expect(result.allFiles).toHaveLength(2);
    expect(result.allFiles.every((f) => f.parentTempId !== undefined)).toBe(true);

    // Should have 2 manifest folders (Root + Root/Sub)
    expect(result.manifestFolders).toHaveLength(2);
  });

  it('keeps standalone files when folder is empty', () => {
    const f1 = createMockFile('standalone.pdf');
    const emptyFolder = createFolderEntry('EmptyFolder', []);

    const result = mergeFilesWithFolderContents([f1], [emptyFolder]);

    expect(result.allFiles).toHaveLength(1);
    expect(result.allFiles[0]!.file).toBe(f1);
    expect(result.allFiles[0]!.parentTempId).toBeUndefined();
    expect(result.manifestFolders).toHaveLength(1);
  });

  it('does not false-dedup files with same name but different File objects', () => {
    // Two different File objects that happen to have the same name
    const fileA = createMockFile('report.pdf');
    const fileB = createMockFile('report.pdf');

    const folder = createFolderEntry('Docs', [
      createFileEntry(fileB, 'Docs/report.pdf'),
    ]);

    // fileA is a standalone file, fileB is in the folder — both should survive
    const result = mergeFilesWithFolderContents([fileA], [folder]);

    expect(result.allFiles).toHaveLength(2);
    expect(result.allFiles.some((f) => f.file === fileA && f.parentTempId === undefined)).toBe(true);
    expect(result.allFiles.some((f) => f.file === fileB && f.parentTempId !== undefined)).toBe(true);
  });
});

describe('collectFolderFiles', () => {
  it('assigns unique parentTempId per folder', () => {
    const f1 = createMockFile('a.pdf');
    const f2 = createMockFile('b.pdf');

    const folder1 = createFolderEntry('Folder1', [
      createFileEntry(f1, 'Folder1/a.pdf'),
    ]);
    const folder2 = createFolderEntry('Folder2', [
      createFileEntry(f2, 'Folder2/b.pdf'),
    ]);

    const result = collectFolderFiles([folder1, folder2]);

    expect(result.files).toHaveLength(2);

    const parentIds = result.files.map((f) => f.parentTempId);
    // Each file should have a parentTempId and they should be different
    expect(parentIds[0]).toBeDefined();
    expect(parentIds[1]).toBeDefined();
    expect(parentIds[0]).not.toBe(parentIds[1]);
  });

  it('derives folder lastModified from max of children file dates', () => {
    const older = new File([], 'old.pdf', { lastModified: 1700000000000 });
    const newer = new File([], 'new.pdf', { lastModified: 1700100000000 });

    const folder = createFolderEntry('Docs', [
      createFileEntry(older, 'Docs/old.pdf'),
      createFileEntry(newer, 'Docs/new.pdf'),
    ]);

    const result = collectFolderFiles([folder]);

    const manifestFolder = result.manifoldFolders.find((f) => f.folderName === 'Docs');
    expect(manifestFolder?.lastModified).toBe(1700100000000);
  });

  it('propagates nested subfolder dates bottom-up', () => {
    const deepFile = new File([], 'deep.pdf', { lastModified: 1700200000000 });
    const shallowFile = new File([], 'shallow.pdf', { lastModified: 1700000000000 });

    const subFolder = createFolderEntry('Sub', [
      createFileEntry(deepFile, 'Root/Sub/deep.pdf'),
    ], 'Root/Sub');

    const rootFolder = createFolderEntry('Root', [
      createFileEntry(shallowFile, 'Root/shallow.pdf'),
      subFolder,
    ]);

    const result = collectFolderFiles([rootFolder]);

    // Sub folder should have the deep file's date
    const subManifest = result.manifoldFolders.find((f) => f.folderName === 'Sub');
    expect(subManifest?.lastModified).toBe(1700200000000);

    // Root folder should bubble up the deep file's date (newer than shallow)
    const rootManifest = result.manifoldFolders.find((f) => f.folderName === 'Root');
    expect(rootManifest?.lastModified).toBe(1700200000000);
  });

  it('empty folder has no lastModified', () => {
    const emptyFolder = createFolderEntry('Empty', []);

    const result = collectFolderFiles([emptyFolder]);

    const manifestFolder = result.manifoldFolders.find((f) => f.folderName === 'Empty');
    expect(manifestFolder?.lastModified).toBeUndefined();
  });

  it('multiple root folders get independent dates', () => {
    const file1 = new File([], 'a.pdf', { lastModified: 1700000000000 });
    const file2 = new File([], 'b.pdf', { lastModified: 1700500000000 });

    const folder1 = createFolderEntry('FolderA', [
      createFileEntry(file1, 'FolderA/a.pdf'),
    ]);
    const folder2 = createFolderEntry('FolderB', [
      createFileEntry(file2, 'FolderB/b.pdf'),
    ]);

    const result = collectFolderFiles([folder1, folder2]);

    const manifestA = result.manifoldFolders.find((f) => f.folderName === 'FolderA');
    const manifestB = result.manifoldFolders.find((f) => f.folderName === 'FolderB');

    expect(manifestA?.lastModified).toBe(1700000000000);
    expect(manifestB?.lastModified).toBe(1700500000000);
  });
});
