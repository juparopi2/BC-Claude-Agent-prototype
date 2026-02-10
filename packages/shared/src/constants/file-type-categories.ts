/**
 * File Type Categories for RAG Filtered Search
 *
 * Maps semantic categories to MIME types from ALLOWED_MIME_TYPES.
 * Used by the RAG agent's filtered_knowledge_search tool and
 * frontend display components.
 *
 * @module constants/file-type-categories
 */

export const FILE_TYPE_CATEGORIES = {
  images: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ],
  documents: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
  ],
  spreadsheets: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ],
  code: [
    'application/json',
    'text/javascript',
    'text/html',
    'text/css',
  ],
} as const;

export type FileTypeCategory = keyof typeof FILE_TYPE_CATEGORIES;

/** Get MIME types for a given category */
export function getMimeTypesForCategory(category: FileTypeCategory): readonly string[] {
  return FILE_TYPE_CATEGORIES[category];
}

/** Get all valid categories */
export function getValidCategories(): FileTypeCategory[] {
  return Object.keys(FILE_TYPE_CATEGORIES) as FileTypeCategory[];
}

/** Human-readable descriptions of supported file types by category */
export const FILE_TYPE_DISPLAY = {
  images: { label: 'Images', extensions: '.jpg, .png, .gif, .webp, .svg' },
  documents: { label: 'Documents', extensions: '.pdf, .docx, .txt, .md' },
  spreadsheets: { label: 'Spreadsheets', extensions: '.xlsx, .csv' },
  code: { label: 'Code', extensions: '.json, .js, .html, .css' },
} as const;

/** All supported extensions as a flat string for UX display */
export const SUPPORTED_EXTENSIONS_DISPLAY = 'PDF, DOCX, XLSX, CSV, TXT, MD, JPG, PNG, GIF, WebP, SVG, JSON, JS, HTML, CSS';
