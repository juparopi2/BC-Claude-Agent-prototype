// ========================================================================
// Primary API (unchanged)
// ========================================================================
export { FileService, getFileService, __resetFileService } from './FileService';
export { FileUploadService, getFileUploadService, __resetFileUploadService } from './FileUploadService';
export {
  MessageChatAttachmentService,
  getMessageChatAttachmentService,
  resetMessageChatAttachmentService,
  type RecordAttachmentsResult,
} from './MessageChatAttachmentService';

// ========================================================================
// Repository Layer (new exports)
// ========================================================================
export {
  FileRepository,
  getFileRepository,
  __resetFileRepository,
  type IFileRepository,
  type FileMetadata,
} from './repository';

export {
  FileQueryBuilder,
  getFileQueryBuilder,
  __resetFileQueryBuilder,
  type QueryResult,
  type GetFilesQueryOptions,
  type GetFileCountOptions,
  type InClauseResult,
} from './repository';

// ========================================================================
// Operations Layer (new exports)
// ========================================================================
export {
  FileDeletionService,
  getFileDeletionService,
  __resetFileDeletionService,
  type IFileDeletionService,
  type DeletionOptions,
} from './operations';

export {
  FileDuplicateService,
  getFileDuplicateService,
  __resetFileDuplicateService,
  type IFileDuplicateService,
  type DuplicateCheckResult,
  type BatchNameDuplicateResult,
  type BatchHashDuplicateResult,
} from './operations';

export {
  FileMetadataService,
  getFileMetadataService,
  __resetFileMetadataService,
  type IFileMetadataService,
} from './operations';
