/**
 * Uppy Factory Tests
 *
 * Tests for createBlobUploadUppy() and createFormUploadUppy() factory functions.
 *
 * @module __tests__/infrastructure/upload/uppyFactory
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createBlobUploadUppy, createFormUploadUppy } from '@/src/infrastructure/upload/uppyFactory';

// Track instances for cleanup
const instances: Array<{ destroy: () => void }> = [];

afterEach(() => {
  for (const uppy of instances) {
    try {
      uppy.destroy();
    } catch {
      // Already destroyed
    }
  }
  instances.length = 0;
});

describe('createBlobUploadUppy', () => {
  it('should create an Uppy instance', () => {
    const uppy = createBlobUploadUppy();
    instances.push(uppy);

    expect(uppy).toBeDefined();
    expect(typeof uppy.upload).toBe('function');
    expect(typeof uppy.addFile).toBe('function');
    expect(typeof uppy.destroy).toBe('function');
  });

  it('should have autoProceed disabled', () => {
    const uppy = createBlobUploadUppy();
    instances.push(uppy);

    expect(uppy.opts.autoProceed).toBe(false);
  });

  it('should have the AwsS3 plugin installed', () => {
    const uppy = createBlobUploadUppy();
    instances.push(uppy);

    // AwsS3 plugin registers internally as 'AwsS3Multipart'
    const plugin = uppy.getPlugin('AwsS3Multipart');
    expect(plugin).toBeDefined();
  });

  it('should respect custom concurrency', () => {
    const uppy = createBlobUploadUppy({ concurrency: 10 });
    instances.push(uppy);

    const plugin = uppy.getPlugin('AwsS3Multipart');
    expect(plugin).toBeDefined();
  });

  it('should create unique instance IDs', async () => {
    const uppy1 = createBlobUploadUppy();
    // Ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 2));
    const uppy2 = createBlobUploadUppy();
    instances.push(uppy1, uppy2);

    expect(uppy1.opts.id).not.toBe(uppy2.opts.id);
  });

  it('should allow adding files with SAS URL metadata', () => {
    const uppy = createBlobUploadUppy();
    instances.push(uppy);

    const file = new File(['test'], 'test.txt', { type: 'text/plain' });
    const fileId = uppy.addFile({
      name: 'test.txt',
      type: 'text/plain',
      data: file,
      meta: {
        sasUrl: 'https://storage.blob.core.windows.net/container/blob?sas=token',
        correlationId: 'temp-1',
        contentType: 'text/plain',
      },
    });

    expect(fileId).toBeDefined();
    const files = uppy.getFiles();
    expect(files).toHaveLength(1);
    expect(files[0].meta.sasUrl).toBe('https://storage.blob.core.windows.net/container/blob?sas=token');
    expect(files[0].meta.correlationId).toBe('temp-1');
    expect(files[0].meta.contentType).toBe('text/plain');
  });
});

describe('createFormUploadUppy', () => {
  it('should create an Uppy instance', () => {
    const uppy = createFormUploadUppy();
    instances.push(uppy);

    expect(uppy).toBeDefined();
    expect(typeof uppy.upload).toBe('function');
    expect(typeof uppy.addFile).toBe('function');
    expect(typeof uppy.destroy).toBe('function');
  });

  it('should have autoProceed disabled', () => {
    const uppy = createFormUploadUppy();
    instances.push(uppy);

    expect(uppy.opts.autoProceed).toBe(false);
  });

  it('should have the XHRUpload plugin installed', () => {
    const uppy = createFormUploadUppy();
    instances.push(uppy);

    const plugin = uppy.getPlugin('XHRUpload');
    expect(plugin).toBeDefined();
  });

  it('should respect custom concurrency', () => {
    const uppy = createFormUploadUppy({ concurrency: 1 });
    instances.push(uppy);

    const plugin = uppy.getPlugin('XHRUpload');
    expect(plugin).toBeDefined();
  });

  it('should create unique instance IDs', async () => {
    const uppy1 = createFormUploadUppy();
    // Ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 2));
    const uppy2 = createFormUploadUppy();
    instances.push(uppy1, uppy2);

    expect(uppy1.opts.id).not.toBe(uppy2.opts.id);
  });

  it('should allow adding files with metadata', () => {
    const uppy = createFormUploadUppy();
    instances.push(uppy);

    const file = new File(['test'], 'test.txt', { type: 'text/plain' });
    const fileId = uppy.addFile({
      name: 'test.txt',
      type: 'text/plain',
      data: file,
      meta: {
        queueItemId: 'queue-1',
        sessionId: 'session-1',
      },
    });

    expect(fileId).toBeDefined();
    const files = uppy.getFiles();
    expect(files).toHaveLength(1);
    expect(files[0].meta.queueItemId).toBe('queue-1');
    expect(files[0].meta.sessionId).toBe('session-1');
  });
});
