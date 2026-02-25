import type { CitedDocument } from '@bc-agent/shared';
import { getFetchStrategy } from '@bc-agent/shared';
import type { CitationInfo } from '@/lib/types/citation.types';

/**
 * Convert a CitedDocument (Zod-validated RAG result) to a CitationInfo (frontend preview type).
 */
export function citedDocumentToCitationInfo(doc: CitedDocument): CitationInfo {
  return {
    fileName: doc.fileName,
    fileId: doc.fileId,
    sourceType: doc.sourceType,
    mimeType: doc.mimeType,
    relevanceScore: doc.documentRelevance,
    isImage: doc.isImage,
    fetchStrategy: getFetchStrategy(doc.sourceType),
    isDeleted: false,
  };
}

/**
 * Convert an array of CitedDocuments to CitationInfo[].
 */
export function citedDocumentsToCitationInfos(docs: CitedDocument[]): CitationInfo[] {
  return docs.map(citedDocumentToCitationInfo);
}

/**
 * Deduplicate CitedDocuments by fileId, keeping the one with highest documentRelevance.
 * Falls back to fileName as key when fileId is null.
 */
export function deduplicateCitedDocuments(docs: CitedDocument[]): CitedDocument[] {
  const seen = new Map<string, CitedDocument>();
  for (const doc of docs) {
    const key = doc.fileId ?? doc.fileName;
    const existing = seen.get(key);
    if (!existing || doc.documentRelevance > existing.documentRelevance) {
      seen.set(key, doc);
    }
  }
  return Array.from(seen.values());
}
