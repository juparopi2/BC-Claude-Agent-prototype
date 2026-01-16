/**
 * Bulk Upload Module
 *
 * Processes bulk file uploads via BullMQ queue.
 * Files are uploaded directly to Azure Blob Storage via SAS URLs,
 * then this processor creates the database records.
 *
 * @module domains/files/bulk-upload
 */

export * from './IBulkUploadProcessor';
export * from './BulkUploadProcessor';
export { getBulkUploadProcessor, __resetBulkUploadProcessor } from './BulkUploadProcessor';
