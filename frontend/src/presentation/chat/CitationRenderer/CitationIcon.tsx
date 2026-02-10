'use client';

import { FileText, FileSpreadsheet, Image, File } from 'lucide-react';

interface CitationIconProps {
  mimeType: string;
  isImage: boolean;
  className?: string;
}

export function CitationIcon({ mimeType, isImage, className = 'w-5 h-5' }: CitationIconProps) {
  if (isImage) {
    return <Image className={`${className} text-violet-500`} />;
  }

  switch (mimeType) {
    case 'application/pdf':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'text/plain':
      return <FileText className={`${className} text-blue-500`} />;
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'text/csv':
      return <FileSpreadsheet className={`${className} text-emerald-500`} />;
    default:
      return <File className={`${className} text-gray-500`} />;
  }
}
