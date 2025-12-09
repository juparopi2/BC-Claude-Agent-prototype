/**
 * File Management Components
 *
 * Barrel export for all file-related UI components.
 * Phase 2: File Navigation UI
 *
 * @module components/files
 */

// Main container
export { FileExplorer } from './FileExplorer';

// Core components
export { FileItem } from './FileItem';
export { FileList } from './FileList';
export { FileBreadcrumb } from './FileBreadcrumb';
export { FileToolbar } from './FileToolbar';

// Upload
export { FileUploadZone, useFileUploadTrigger } from './FileUploadZone';

// Folder tree
export { FolderTree } from './FolderTree';
export { FolderTreeItem } from './FolderTreeItem';

// Controls
export { FileSortControls } from './FileSortControls';
export { CreateFolderDialog } from './CreateFolderDialog';
export { FileContextMenu } from './FileContextMenu';
