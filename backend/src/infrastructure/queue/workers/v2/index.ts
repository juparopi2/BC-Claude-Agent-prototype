/**
 * V2 Workers barrel exports (PRD-04)
 * @module infrastructure/queue/workers/v2
 */
export { FileExtractWorkerV2, getFileExtractWorkerV2, type V2ExtractJobData } from './FileExtractWorkerV2';
export { FileChunkWorkerV2, getFileChunkWorkerV2, type V2ChunkJobData } from './FileChunkWorkerV2';
export { FileEmbedWorkerV2, getFileEmbedWorkerV2, type V2EmbedJobData } from './FileEmbedWorkerV2';
export { FilePipelineCompleteWorker, getFilePipelineCompleteWorker, type V2PipelineCompleteJobData } from './FilePipelineCompleteWorker';
