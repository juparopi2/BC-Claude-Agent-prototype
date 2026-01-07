'use client';

/**
 * SourcePreviewModal Component
 *
 * Enhanced modal for previewing citation sources with navigation.
 * Supports left/right navigation between sources, keyboard controls,
 * and "Go to Path" functionality.
 *
 * @module components/modals/SourcePreviewModal
 */

import { useEffect, useState, useCallback } from 'react';
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
  FolderOpen,
  Loader2,
} from 'lucide-react';
import { env } from '@/lib/config/env';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import type { CitationInfo } from '@/lib/types/citation.types';

interface SourcePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  citations: CitationInfo[];
  currentIndex: number;
  onNavigateNext: () => void;
  onNavigatePrev: () => void;
  onGoToPath?: (fileId: string) => Promise<void>;
  isGoingToPath?: boolean;
}

/**
 * Get the file content URL for API calls
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

  const lang = mimeToLang[mimeType];
  if (lang) return lang;

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
        <Loader2 className="size-6 animate-spin mr-2" />
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
 * SourcePreviewModal Component
 *
 * Modal for previewing citation sources with:
 * - Left/right navigation arrows
 * - Position indicator (e.g., "2 of 5")
 * - Keyboard navigation (ArrowLeft, ArrowRight, Escape)
 * - "Go to Path" button to navigate to file in browser
 */
export function SourcePreviewModal({
  isOpen,
  onClose,
  citations,
  currentIndex,
  onNavigateNext,
  onNavigatePrev,
  onGoToPath,
  isGoingToPath = false,
}: SourcePreviewModalProps) {
  const currentCitation = citations[currentIndex];
  const hasMultiple = citations.length > 1;
  const canGoNext = currentIndex < citations.length - 1;
  const canGoPrev = currentIndex > 0;

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          if (canGoPrev) {
            e.preventDefault();
            onNavigatePrev();
          }
          break;
        case 'ArrowRight':
          if (canGoNext) {
            e.preventDefault();
            onNavigateNext();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, canGoNext, canGoPrev, onClose, onNavigateNext, onNavigatePrev]);

  const handleGoToPath = useCallback(async () => {
    if (!currentCitation?.fileId || !onGoToPath) return;
    await onGoToPath(currentCitation.fileId);
    onClose();
  }, [currentCitation, onGoToPath, onClose]);

  if (!currentCitation || !currentCitation.fileId) {
    return null;
  }

  const previewType = getPreviewType(currentCitation.mimeType);
  const icon = getFileIcon(previewType);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogOverlay data-testid="dialog-overlay" />
      <DialogContent
        className="max-w-6xl max-h-[90vh] overflow-hidden"
        aria-label={`File preview: ${currentCitation.fileName}`}
      >
        <DialogHeader className="flex flex-row items-center justify-between pr-8">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {icon}
            <DialogTitle className="text-base font-medium truncate">
              {currentCitation.fileName}
            </DialogTitle>
            {hasMultiple && (
              <span className="text-sm text-muted-foreground ml-2 shrink-0">
                {currentIndex + 1} of {citations.length}
              </span>
            )}
          </div>
        </DialogHeader>
        <DialogDescription className="sr-only">
          Preview of {currentCitation.fileName}
        </DialogDescription>

        {/* Navigation + Content */}
        <div className="flex items-center gap-2 mt-4">
          {/* Left Arrow */}
          {hasMultiple && (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 size-10 disabled:opacity-30"
              onClick={onNavigatePrev}
              disabled={!canGoPrev}
              aria-label="Previous source"
            >
              <ChevronLeft className="size-5" />
            </Button>
          )}

          {/* Preview Content */}
          <div className="flex-1 min-h-[300px]">
            {previewType === 'pdf' && <PDFPreview fileId={currentCitation.fileId} />}
            {previewType === 'image' && (
              <ImagePreview fileId={currentCitation.fileId} fileName={currentCitation.fileName} />
            )}
            {previewType === 'text' && (
              <TextPreview
                fileId={currentCitation.fileId}
                fileName={currentCitation.fileName}
                mimeType={currentCitation.mimeType}
              />
            )}
            {previewType === 'unsupported' && (
              <DownloadFallback fileId={currentCitation.fileId} fileName={currentCitation.fileName} />
            )}
          </div>

          {/* Right Arrow */}
          {hasMultiple && (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 size-10 disabled:opacity-30"
              onClick={onNavigateNext}
              disabled={!canGoNext}
              aria-label="Next source"
            >
              <ChevronRight className="size-5" />
            </Button>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-start items-center gap-2 mt-4">
          {onGoToPath && (
            <Button
              variant="outline"
              onClick={handleGoToPath}
              disabled={isGoingToPath}
              aria-label="Go to file location"
            >
              {isGoingToPath ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <FolderOpen className="size-4" />
              )}
              Go to Path
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              const link = document.createElement('a');
              link.href = getFileContentUrl(currentCitation.fileId);
              link.download = currentCitation.fileName;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            aria-label="Download file"
          >
            <Download className="size-4" />
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
