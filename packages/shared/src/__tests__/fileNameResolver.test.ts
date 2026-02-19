import { describe, it, expect } from 'vitest';
import { generateUniqueFileName, splitFileName, extractSuffix } from '../utils/fileNameResolver';

describe('splitFileName', () => {
  it('splits name with extension', () => {
    expect(splitFileName('report.pdf')).toEqual({ baseName: 'report', extension: '.pdf' });
  });

  it('handles compound extensions', () => {
    expect(splitFileName('archive.tar.gz')).toEqual({ baseName: 'archive.tar', extension: '.gz' });
  });

  it('handles no extension', () => {
    expect(splitFileName('README')).toEqual({ baseName: 'README', extension: '' });
  });

  it('handles dotfile', () => {
    expect(splitFileName('.gitignore')).toEqual({ baseName: '.gitignore', extension: '' });
  });
});

describe('extractSuffix', () => {
  it('extracts numeric suffix', () => {
    expect(extractSuffix('report (1)')).toEqual({ cleanBase: 'report', suffix: 1 });
  });

  it('returns null suffix when none present', () => {
    expect(extractSuffix('report')).toEqual({ cleanBase: 'report', suffix: null });
  });

  it('extracts higher suffix', () => {
    expect(extractSuffix('report (3)')).toEqual({ cleanBase: 'report', suffix: 3 });
  });
});

describe('generateUniqueFileName', () => {
  it('returns original name when no conflict', () => {
    expect(generateUniqueFileName('photo.jpg', ['other.jpg'])).toBe('photo.jpg');
  });

  it('returns original name with empty existing set', () => {
    expect(generateUniqueFileName('report.pdf', [])).toBe('report.pdf');
  });

  it('appends (1) on first conflict', () => {
    expect(generateUniqueFileName('report.pdf', ['report.pdf'])).toBe('report (1).pdf');
  });

  it('finds next available suffix with multiple conflicts', () => {
    expect(
      generateUniqueFileName('report.pdf', ['report.pdf', 'report (1).pdf']),
    ).toBe('report (2).pdf');
  });

  it('skips gaps in suffix numbering', () => {
    expect(
      generateUniqueFileName('report.pdf', ['report.pdf', 'report (1).pdf', 'report (3).pdf']),
    ).toBe('report (4).pdf');
  });

  it('treats names with existing (N) suffix literally — does NOT strip suffix', () => {
    // "file (1).pdf" already exists → should suggest "file (1) (1).pdf", NOT "file (2).pdf"
    expect(
      generateUniqueFileName('file (1).pdf', ['file (1).pdf']),
    ).toBe('file (1) (1).pdf');
  });

  it('treats names with existing (N) suffix literally — increments from family', () => {
    expect(
      generateUniqueFileName('file (1).pdf', ['file (1).pdf', 'file (1) (1).pdf']),
    ).toBe('file (1) (2).pdf');
  });

  it('does NOT group into a family — only matches literal base name', () => {
    // Uploading "file (1).pdf" when "file.pdf", "file (1).pdf", "file (2).pdf" all exist
    // Should suggest "file (1) (1).pdf", NOT "file (3).pdf"
    expect(
      generateUniqueFileName('file (1).pdf', ['file.pdf', 'file (1).pdf', 'file (2).pdf']),
    ).toBe('file (1) (1).pdf');
  });

  it('handles files without extensions', () => {
    expect(generateUniqueFileName('README', ['README'])).toBe('README (1)');
  });

  it('handles files without extensions — multiple conflicts', () => {
    expect(
      generateUniqueFileName('README', ['README', 'README (1)']),
    ).toBe('README (2)');
  });

  it('handles special regex characters in file name', () => {
    expect(
      generateUniqueFileName('file[1].pdf', ['file[1].pdf']),
    ).toBe('file[1] (1).pdf');
  });

  it('handles parentheses in file name that are not suffix pattern', () => {
    expect(
      generateUniqueFileName('budget (Q1 2025).xlsx', ['budget (Q1 2025).xlsx']),
    ).toBe('budget (Q1 2025) (1).xlsx');
  });

  it('accepts a Set as existingNames', () => {
    const existing = new Set(['report.pdf', 'report (1).pdf']);
    expect(generateUniqueFileName('report.pdf', existing)).toBe('report (2).pdf');
  });
});
