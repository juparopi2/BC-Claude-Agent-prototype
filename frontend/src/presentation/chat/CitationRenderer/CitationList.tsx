'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { CitedDocument } from '@bc-agent/shared';
import { CitationCard } from './CitationCard';

interface CitationListProps {
  documents: CitedDocument[];
  totalResults: number;
  query: string;
}

export function CitationList({ documents, totalResults }: CitationListProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());

  const toggleDoc = (docId: string) => {
    setExpandedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const ListIcon = isOpen ? ChevronUp : ChevronDown;

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-2"
      >
        <ListIcon className="w-4 h-4 text-muted-foreground" />
        Sources ({totalResults})
      </button>

      {isOpen && (
        <div className="space-y-2">
          {documents.map((doc) => {
            const docKey = doc.fileId ?? doc.fileName;
            return (
              <CitationCard
                key={docKey}
                document={doc}
                isExpanded={expandedDocIds.has(docKey)}
                onToggle={() => toggleDoc(docKey)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
