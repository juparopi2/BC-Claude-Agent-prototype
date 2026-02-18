/**
 * Batch Upload Error Classes (PRD-03)
 *
 * Domain-specific errors for the batch upload orchestrator.
 * Each error maps to a specific HTTP status code in the route controller.
 *
 * @module services/files/batch/errors
 */

export class BatchNotFoundError extends Error {
  constructor(batchId: string) {
    super(`Batch not found: ${batchId}`);
    this.name = 'BatchNotFoundError';
  }
}

export class BatchExpiredError extends Error {
  constructor(batchId: string) {
    super(`Batch has expired: ${batchId}`);
    this.name = 'BatchExpiredError';
  }
}

export class BatchCancelledError extends Error {
  constructor(batchId: string) {
    super(`Batch has been cancelled: ${batchId}`);
    this.name = 'BatchCancelledError';
  }
}

export class BatchAlreadyCompleteError extends Error {
  constructor(batchId: string) {
    super(`Batch is already complete: ${batchId}`);
    this.name = 'BatchAlreadyCompleteError';
  }
}

export class FileNotInBatchError extends Error {
  constructor(fileId: string, batchId: string) {
    super(`File ${fileId} not found in batch ${batchId}`);
    this.name = 'FileNotInBatchError';
  }
}

export class FileAlreadyConfirmedError extends Error {
  constructor(fileId: string, currentStatus: string) {
    super(`File ${fileId} already confirmed (current status: ${currentStatus})`);
    this.name = 'FileAlreadyConfirmedError';
  }
}

export class BlobNotFoundError extends Error {
  constructor(fileId: string, blobPath: string) {
    super(`Blob not found for file ${fileId} at path: ${blobPath}`);
    this.name = 'BlobNotFoundError';
  }
}

export class ConcurrentModificationError extends Error {
  constructor(fileId: string) {
    super(`Concurrent modification detected for file ${fileId}`);
    this.name = 'ConcurrentModificationError';
  }
}

export class InvalidTargetFolderError extends Error {
  constructor(folderId: string) {
    super(`Target folder not found or is not a folder: ${folderId}`);
    this.name = 'InvalidTargetFolderError';
  }
}

export class ManifestValidationError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ManifestValidationError';
    this.details = details;
  }
}
