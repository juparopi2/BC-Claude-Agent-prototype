/**
 * Uppy Instance Factories
 *
 * Creates short-lived Uppy instances for each upload operation.
 * Two factories cover all upload paths:
 * - createBlobUploadUppy: SAS URL PUT uploads (bulk + folder)
 * - createFormUploadUppy: Multipart FormData POST uploads (single/multi + chat)
 *
 * Each upload creates a fresh instance (create -> upload -> destroy).
 * No shared singletons to prevent state bleed and memory leaks.
 *
 * @module infrastructure/upload/uppyFactory
 */

import Uppy, { type Meta } from '@uppy/core';
import AwsS3 from '@uppy/aws-s3';
import XHRUpload from '@uppy/xhr-upload';
import { env } from '@/lib/config/env';

// ============================================
// Types
// ============================================

export interface BlobUploadMeta extends Meta {
  sasUrl: string;
  correlationId: string;
  contentType: string;
  blobPath?: string;
}

export interface FormUploadMeta extends Meta {
  queueItemId: string;
  parentFolderId?: string;
  sessionId?: string;
}

interface BlobUploadOptions {
  /** Max concurrent uploads (default: 5) */
  concurrency?: number;
}

interface FormUploadOptions {
  /** Max concurrent uploads (default: 3) */
  concurrency?: number;
}

// ============================================
// Factories
// ============================================

/**
 * Create an Uppy instance for SAS URL PUT uploads (bulk + folder).
 *
 * Uses @uppy/aws-s3 in single-part mode with Azure-compatible headers.
 * Reads `file.meta.sasUrl` for each file's upload destination.
 */
export function createBlobUploadUppy(options?: BlobUploadOptions) {
  const concurrency = options?.concurrency ?? 5;

  const uppy = new Uppy<BlobUploadMeta, Record<string, never>>({
    autoProceed: false,
    id: `blob-upload-${Date.now()}`,
  });

  // AwsS3 plugin types require multipart upload functions in the union type,
  // but shouldUseMultipart: () => false means they're never called.
  // Using type assertion to bypass this.
  uppy.use(AwsS3, {
    shouldUseMultipart: () => false,
    limit: concurrency,
    retryDelays: [0, 1000, 3000, 5000],
    getUploadParameters(file: { meta: Record<string, unknown>; type?: string }) {
      const meta = file.meta as unknown as BlobUploadMeta;
      return {
        method: 'PUT' as const,
        url: meta.sasUrl,
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': meta.contentType || file.type || 'application/octet-stream',
        },
      };
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return uppy;
}

/**
 * Create an Uppy instance for multipart FormData POST uploads (single/multi + chat).
 *
 * Uses @uppy/xhr-upload with session cookies for authentication.
 * Sends files one at a time (bundle: false) matching current sequential behavior.
 */
export function createFormUploadUppy(options?: FormUploadOptions) {
  const concurrency = options?.concurrency ?? 3;

  const uppy = new Uppy<FormUploadMeta, Record<string, never>>({
    autoProceed: false,
    id: `form-upload-${Date.now()}`,
  });

  uppy.use(XHRUpload, {
    endpoint: `${env.apiUrl}/api/files/upload`,
    method: 'POST',
    formData: true,
    fieldName: 'files',
    bundle: false,
    withCredentials: true,
    limit: concurrency,
    timeout: 120_000,
    headers: {
      Accept: 'application/json',
    },
    allowedMetaFields: ['parentFolderId', 'sessionId'],
    getResponseData(xhr: XMLHttpRequest) {
      try {
        return JSON.parse(xhr.responseText);
      } catch {
        return {};
      }
    },
  });

  return uppy;
}
