'use client';

/**
 * FilePreviewModal
 *
 * Modal component for previewing files of different types.
 * Supports: PDF (iframe), images (img), text/code (syntax highlight), fallback (download)
 *
 * @module components/files/modals/FilePreviewModal
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogOverlay,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText,
  Image as ImageIcon,
  Code,
  Download,
  FileQuestion,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { env } from '@/lib/config/env';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { UseAsContextButton } from '@/src/presentation/chat/UseAsContextButton';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
  mimeType: string;
  /** Whether navigation arrows should be shown */
  hasNavigation?: boolean;
  /** Whether previous navigation is available */
  canGoPrev?: boolean;
  /** Whether next navigation is available */
  canGoNext?: boolean;
  /** Navigate to previous file */
  onNavigatePrev?: () => void;
  /** Navigate to next file */
  onNavigateNext?: () => void;
  /** Current position (1-based) */
  currentPosition?: number;
  /** Total items for position indicator */
  totalItems?: number;
}

/**
 * Get the file content URL for API calls
 * Uses full backend URL to avoid relative URL resolution issues
 */
function getFileContentUrl(fileId: string): string {
  return `${env.apiUrl}/api/files/${fileId}/content`;
}

/**
 * Determine preview type from mimeType
 */
function getPreviewType(mimeType: string): 'pdf' | 'image' | 'text' | 'unsupported' {
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  // Text-based types
  const textTypes = [
    'text/plain',
    'text/javascript',
    'text/typescript',
    'text/css',
    'text/html',
    'text/xml',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/javascript',
    'application/xml',
  ];

  if (textTypes.includes(mimeType) || mimeType.startsWith('text/')) {
    return 'text';
  }

  return 'unsupported';
}

/**
 * Get syntax highlighter language from mimeType
 */
function getLanguage(mimeType: string, fileName: string): string {
  const mimeToLang: Record<string, string> = {
    'application/json': 'json',
    'text/javascript': 'javascript',
    'application/javascript': 'javascript',
    'text/typescript': 'typescript',
    'text/css': 'css',
    'text/html': 'html',
    'text/xml': 'xml',
    'application/xml': 'xml',
    'text/markdown': 'markdown',
    'text/csv': 'csv',
    'text/plain': 'plaintext',
  };

  // Try mimeType first
  const lang = mimeToLang[mimeType];
  if (lang) return lang;

  // Fallback to file extension
  const ext = fileName.split('.').pop()?.toLowerCase();
  const extToLang: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    css: 'css',
    html: 'html',
    xml: 'xml',
    json: 'json',
    md: 'markdown',
    py: 'python',
    java: 'java',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    go: 'go',
    rs: 'rust',
    sql: 'sql',
    sh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
  };

  return extToLang[ext ?? ''] ?? 'plaintext';
}

/**
 * Get icon for file type
 */
function getFileIcon(previewType: 'pdf' | 'image' | 'text' | 'unsupported') {
  switch (previewType) {
    case 'pdf':
      return <FileText className="size-5 text-red-500" />;
    case 'image':
      return <ImageIcon className="size-5 text-blue-500" />;
    case 'text':
      return <Code className="size-5 text-green-500" />;
    default:
      return <FileQuestion className="size-5 text-muted-foreground" />;
  }
}

/**
 * PDF Preview Component
 */
function PDFPreview({ fileId }: { fileId: string }) {
  const src = getFileContentUrl(fileId);

  return (
    <iframe
      data-testid="pdf-preview-iframe"
      src={src}
      className="w-full h-[70vh] border-0 rounded-md"
      title="PDF Preview"
    />
  );
}

/**
 * Image Preview Component
 */
function ImagePreview({ fileId, fileName }: { fileId: string; fileName: string }) {
  const src = getFileContentUrl(fileId);

  return (
    <div className="flex items-center justify-center p-4 bg-muted/50 rounded-md">
      <img
        data-testid="image-preview"
        src={src}
        alt={`Preview of ${fileName}`}
        className="max-w-full max-h-[70vh] object-contain rounded-md"
      />
    </div>
  );
}

/**
 * Text/Code Preview Component
 */
function TextPreview({
  fileId,
  fileName,
  mimeType,
}: {
  fileId: string;
  fileName: string;
  mimeType: string;
}) {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchContent() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(getFileContentUrl(fileId));
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.statusText}`);
        }
        const text = await response.text();
        setContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
      } finally {
        setIsLoading(false);
      }
    }

    fetchContent();
  }, [fileId]);

  const language = getLanguage(mimeType, fileName);

  if (isLoading) {
    return (
      <div
        data-testid="text-preview"
        className="flex items-center justify-center h-[50vh] text-muted-foreground"
      >
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="text-preview"
        className="flex items-center justify-center h-[50vh] text-destructive"
      >
        {error}
      </div>
    );
  }

  return (
    <ScrollArea data-testid="text-preview" className="h-[70vh] rounded-md border">
      <SyntaxHighlighter
        language={language}
        style={atomOneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.375rem',
          minHeight: '100%',
        }}
        showLineNumbers
      >
        {content}
      </SyntaxHighlighter>
    </ScrollArea>
  );
}

/**
 * Download Fallback Component
 */
function DownloadFallback({
  fileId,
  fileName,
}: {
  fileId: string;
  fileName: string;
}) {
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = getFileContentUrl(fileId);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      data-testid="download-fallback"
      className="flex flex-col items-center justify-center py-16 text-center space-y-6"
    >
      <div className="bg-muted p-6 rounded-full">
        <FileQuestion className="size-12 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Preview not available</h3>
        <p className="text-muted-foreground text-sm max-w-[80%] mx-auto">
          This file type cannot be previewed. You can download it instead.
        </p>
      </div>
      <Button onClick={handleDownload}>
        <Download className="size-4 mr-2" />
        Download {fileName}
      </Button>
    </div>
  );
}

/**
 * FilePreviewModal Component
 *
 * Supports optional prev/next navigation for browsing sibling files in a folder.
 */
export function FilePreviewModal({
  isOpen,
  onClose,
  fileId,
  fileName,
  mimeType,
  hasNavigation = false,
  canGoPrev = false,
  canGoNext = false,
  onNavigatePrev,
  onNavigateNext,
  currentPosition,
  totalItems,
}: FilePreviewModalProps) {
  const previewType = getPreviewType(mimeType);
  const icon = getFileIcon(previewType);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          if (hasNavigation && canGoPrev && onNavigatePrev) {
            e.preventDefault();
            onNavigatePrev();
          }
          break;
        case 'ArrowRight':
          if (hasNavigation && canGoNext && onNavigateNext) {
            e.preventDefault();
            onNavigateNext();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, hasNavigation, canGoPrev, canGoNext, onNavigatePrev, onNavigateNext]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogOverlay data-testid="dialog-overlay" />
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-hidden"
        aria-label={`File preview: ${fileName}`}
      >
        <DialogHeader className="flex flex-row items-center justify-between pr-8">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {icon}
            <DialogTitle className="text-base font-medium truncate">
              {fileName}
            </DialogTitle>
            {hasNavigation && currentPosition != null && totalItems != null && (
              <span className="text-sm text-muted-foreground ml-2 shrink-0">
                {currentPosition} of {totalItems}
              </span>
            )}
          </div>
        </DialogHeader>
        <DialogDescription className="sr-only">
          Preview of {fileName}
        </DialogDescription>

        {/* Navigation + Content */}
        <div className="flex items-center gap-2 mt-4">
          {/* Left Arrow */}
          {hasNavigation && (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 size-10 disabled:opacity-30"
              onClick={onNavigatePrev}
              disabled={!canGoPrev}
              aria-label="Previous file"
            >
              <ChevronLeft className="size-5" />
            </Button>
          )}

          {/* Preview Content */}
          <div key={fileId} className="flex-1 min-h-[300px]">
            {previewType === 'pdf' && <PDFPreview fileId={fileId} />}
            {previewType === 'image' && (
              <ImagePreview fileId={fileId} fileName={fileName} />
            )}
            {previewType === 'text' && (
              <TextPreview fileId={fileId} fileName={fileName} mimeType={mimeType} />
            )}
            {previewType === 'unsupported' && (
              <DownloadFallback fileId={fileId} fileName={fileName} />
            )}
          </div>

          {/* Right Arrow */}
          {hasNavigation && (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 size-10 disabled:opacity-30"
              onClick={onNavigateNext}
              disabled={!canGoNext}
              aria-label="Next file"
            >
              <ChevronRight className="size-5" />
            </Button>
          )}
        </div>

        <div className="flex justify-between items-center mt-4">
          <UseAsContextButton
            fileId={fileId}
            fileName={fileName}
            mimeType={mimeType}
          />
          <Button variant="outline" onClick={onClose} aria-label="Close preview">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
