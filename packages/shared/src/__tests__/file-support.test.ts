import { describe, it, expect } from 'vitest';
import { isFileSyncSupported } from '../utils/file-support';

describe('isFileSyncSupported', () => {
  // All 18 supported MIME types from ALLOWED_MIME_TYPES
  const supportedMimeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
    'application/json',
    'text/javascript',
    'text/html',
    'text/css',
  ];

  it.each(supportedMimeTypes)('returns true for supported MIME type: %s', (mimeType) => {
    expect(isFileSyncSupported(mimeType)).toBe(true);
  });

  const unsupportedMimeTypes = [
    'application/zip',
    'application/x-msdownload',
    'application/octet-stream',
    'video/mp4',
    'audio/mpeg',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/vnd.ms-excel',
    'application/msword',
  ];

  it.each(unsupportedMimeTypes)('returns false for unsupported MIME type: %s', (mimeType) => {
    expect(isFileSyncSupported(mimeType)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFileSyncSupported(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isFileSyncSupported(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isFileSyncSupported('')).toBe(false);
  });
});
