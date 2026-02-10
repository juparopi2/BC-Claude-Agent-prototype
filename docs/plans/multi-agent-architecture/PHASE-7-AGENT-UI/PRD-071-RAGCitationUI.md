# PRD-071: RAG Citation UI + Tool Improvements

**Estado**: Draft (Desbloqueado - PRD-070 completado 2026-02-09)
**Prioridad**: Media
**Dependencias**: PRD-070 (Agent-Specific Rendering Framework) ✅, PRD-060 (Agent Selector UI) ✅
**Bloquea**: Ninguno

---

## 1. Objetivo

Implementar rendering personalizado de citaciones para el RAG Agent, reemplazando la presentacion actual de texto plano con **citation cards interactivas**. Incluye:

- **Backend**: Mejoras al output del RAG agent tool para retornar metadata enriquecida de citaciones con `_type: 'citation_result'`
- **Frontend**: Componentes `CitationRenderer`, `CitationCard`, `CitationList`, e `InlineCitation` registrados en el framework PRD-070
- **UX**: Citaciones clickeables con excerpts, relevance scores, iconos de tipo de archivo, y preview expandible

---

## 2. Contexto

### 2.1 Estado Actual de Citaciones

El sistema ya tiene infraestructura parcial de citaciones:

- **`CitedFile` type** (`packages/shared/src/types/agent.types.ts`): Define `fileName`, `fileId`, `sourceType`, `mimeType`, `relevanceScore`, `isImage`, `fetchStrategy`
- **`CompleteEvent.citedFiles`**: Array de `CitedFile[]` emitido al completar ejecucion
- **`Citation` interface**: Define `type`, `cited_text`, `document_index`, `start_char_index`, etc.
- **`citationStore`** (frontend): Ya existe store para citaciones

Lo que **falta**:
1. El RAG agent tool result no incluye metadata enriquecida de citaciones
2. No hay componente visual para mostrar citaciones inline
3. No hay integracion con el framework de rendering PRD-070

### 2.2 Patron PRD-070

Este PRD sigue el patron de discriminador `_type` establecido en PRD-070:

```typescript
// RAG tool result con _type discriminador
{
  _type: 'citation_result',
  citations: [...],
  summary: '...',
  totalResults: 5,
}
```

El `AgentResultRenderer` de PRD-070 detecta `_type: 'citation_result'` y lazy-loads `CitationRenderer`.

---

## 3. Backend: RAG Agent Tool Improvements

### 3.1 Nuevo Output Schema para `knowledgeSearchTool`

```typescript
// schemas/citation-result.schema.ts (en @bc-agent/shared)
import { z } from 'zod';

/**
 * Individual citation passage from a document.
 * Represents a specific excerpt that was relevant to the query.
 */
export const CitationPassageSchema = z.object({
  /** Unique ID for this citation */
  citationId: z.string(),
  /** Text excerpt from the document */
  excerpt: z.string().max(500),
  /** Relevance score (0-1) */
  relevanceScore: z.number().min(0).max(1),
  /** Page number (for PDFs) */
  pageNumber: z.number().optional(),
  /** Character offset in source document */
  startOffset: z.number().optional(),
  endOffset: z.number().optional(),
});

/**
 * Cited document with its passages.
 * Groups multiple citation passages from the same source file.
 */
export const CitedDocumentSchema = z.object({
  /** File ID for lookup/preview */
  fileId: z.string().nullable(),
  /** Display file name */
  fileName: z.string(),
  /** MIME type for icon rendering */
  mimeType: z.string(),
  /** Source type for fetch routing */
  sourceType: z.enum(['upload', 'sharepoint', 'onedrive', 'url']),
  /** Whether this is an image file */
  isImage: z.boolean(),
  /** Overall relevance of this document */
  documentRelevance: z.number().min(0).max(1),
  /** Specific passages cited from this document */
  passages: z.array(CitationPassageSchema).min(1).max(10),
});

/**
 * Complete citation result from RAG agent.
 * Includes _type discriminator for PRD-070 rendering framework.
 */
export const CitationResultSchema = z.object({
  _type: z.literal('citation_result'),
  /** Cited documents with their passages */
  documents: z.array(CitedDocumentSchema).min(1).max(20),
  /** AI-generated summary of findings */
  summary: z.string(),
  /** Total number of results found (before truncation) */
  totalResults: z.number(),
  /** Search query that produced these results */
  query: z.string(),
});

export type CitationPassage = z.infer<typeof CitationPassageSchema>;
export type CitedDocument = z.infer<typeof CitedDocumentSchema>;
export type CitationResult = z.infer<typeof CitationResultSchema>;
```

### 3.2 Modificacion de `knowledgeSearchTool`

El RAG agent tool (`knowledgeSearchTool`) debe ser modificado para:

1. Incluir `_type: 'citation_result'` en su output
2. Agrupar resultados por documento fuente
3. Incluir excerpts con offsets para cada passage
4. Preservar backward compatibility: si el frontend no tiene PRD-070, el `summary` field funciona como texto plano

```typescript
// Ejemplo de output modificado del knowledgeSearchTool
{
  _type: 'citation_result',
  documents: [
    {
      fileId: 'FILE-ID-001',
      fileName: 'Contract-2024-Acme.pdf',
      mimeType: 'application/pdf',
      sourceType: 'upload',
      isImage: false,
      documentRelevance: 0.92,
      passages: [
        {
          citationId: 'cit-001',
          excerpt: 'The payment terms shall be Net-30 from invoice date...',
          relevanceScore: 0.95,
          pageNumber: 3,
          startOffset: 1240,
          endOffset: 1310,
        },
        {
          citationId: 'cit-002',
          excerpt: 'Late payment penalties shall accrue at 1.5% per month...',
          relevanceScore: 0.87,
          pageNumber: 4,
          startOffset: 2100,
          endOffset: 2180,
        },
      ],
    },
    {
      fileId: 'FILE-ID-002',
      fileName: 'SLA-Agreement-v2.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sourceType: 'sharepoint',
      isImage: false,
      documentRelevance: 0.78,
      passages: [
        {
          citationId: 'cit-003',
          excerpt: 'Service availability guarantee of 99.9% uptime...',
          relevanceScore: 0.82,
          pageNumber: undefined,
          startOffset: 450,
          endOffset: 520,
        },
      ],
    },
  ],
  summary: 'Found 2 relevant documents regarding payment terms and SLA. The contract specifies Net-30 payment with 1.5% monthly late fees, and the SLA guarantees 99.9% uptime.',
  totalResults: 2,
  query: 'payment terms and SLA',
}
```

### 3.3 File Structure (Backend Changes)

```
backend/src/modules/agents/rag-knowledge/
├── tools/
│   └── knowledge-search.ts      # Modificar output format
└── ...existing files
```

Solo se modifica el output format del tool existente. No se crean nuevos tools.

---

## 4. Frontend: Citation UI Components

### 4.1 File Structure

```
frontend/src/components/chat/CitationRenderer/
├── CitationRenderer.tsx         # Main renderer (registered in PRD-070)
├── CitationCard.tsx             # Individual document card
├── CitationPassage.tsx          # Single passage excerpt
├── CitationList.tsx             # Collapsible list of documents
├── InlineCitation.tsx           # Superscript markers in text
├── CitationIcon.tsx             # File type icon helper
└── index.ts
```

### 4.2 CitationRenderer Component

```tsx
// CitationRenderer.tsx
// Registered as 'citation_result' in PRD-070 renderer registry
import type { CitationResult } from '@bc-agent/shared';
import { CitationList } from './CitationList';

interface CitationRendererProps {
  data: CitationResult;
}

export function CitationRenderer({ data }: CitationRendererProps) {
  return (
    <div className="mt-3 space-y-3">
      {/* Summary (always visible) */}
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {data.summary}
      </p>

      {/* Citation list (collapsible) */}
      <CitationList
        documents={data.documents}
        totalResults={data.totalResults}
        query={data.query}
      />
    </div>
  );
}
```

### 4.3 CitationCard Component

```tsx
// CitationCard.tsx
import { cn } from '@/lib/utils';
import { CitationIcon } from './CitationIcon';
import { CitationPassage } from './CitationPassage';
import type { CitedDocument } from '@bc-agent/shared';

interface CitationCardProps {
  document: CitedDocument;
  isExpanded: boolean;
  onToggle: () => void;
}

export function CitationCard({ document, isExpanded, onToggle }: CitationCardProps) {
  const relevancePercent = Math.round(document.documentRelevance * 100);

  return (
    <div className={cn(
      'border border-gray-200 dark:border-gray-700 rounded-lg',
      'hover:border-emerald-300 dark:hover:border-emerald-700',
      'transition-colors duration-150'
    )}>
      {/* Header (always visible) */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <CitationIcon mimeType={document.mimeType} isImage={document.isImage} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {document.fileName}
          </p>
          <p className="text-xs text-gray-500">
            {document.passages.length} passage{document.passages.length !== 1 ? 's' : ''}
            {' '} | Relevance: {relevancePercent}%
          </p>
        </div>

        {/* Relevance indicator */}
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold',
          relevancePercent >= 80 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
            : relevancePercent >= 60 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
        )}>
          {relevancePercent}
        </div>
      </button>

      {/* Expanded passages */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-2">
          {document.passages.map(passage => (
            <CitationPassage key={passage.citationId} passage={passage} />
          ))}
        </div>
      )}
    </div>
  );
}
```

### 4.4 CitationPassage Component

```tsx
// CitationPassage.tsx
import { cn } from '@/lib/utils';
import type { CitationPassage as CitationPassageType } from '@bc-agent/shared';

interface CitationPassageProps {
  passage: CitationPassageType;
}

export function CitationPassage({ passage }: CitationPassageProps) {
  return (
    <div className="pl-3 border-l-2 border-emerald-300 dark:border-emerald-700">
      <blockquote className="text-xs text-gray-600 dark:text-gray-400 italic">
        "{passage.excerpt}"
      </blockquote>
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
        {passage.pageNumber && (
          <span>Page {passage.pageNumber}</span>
        )}
        <span>Relevance: {Math.round(passage.relevanceScore * 100)}%</span>
      </div>
    </div>
  );
}
```

### 4.5 CitationList Component

```tsx
// CitationList.tsx
import { useState } from 'react';
import { CitationCard } from './CitationCard';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CitedDocument } from '@bc-agent/shared';

interface CitationListProps {
  documents: CitedDocument[];
  totalResults: number;
  query: string;
}

export function CitationList({ documents, totalResults, query }: CitationListProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());

  const toggleDoc = (fileId: string | null) => {
    const key = fileId ?? 'unknown';
    setExpandedDocIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-emerald-500">🧠</span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Sources ({totalResults})
          </span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {/* Document list */}
      {isOpen && (
        <div className="px-3 pb-3 space-y-2">
          {documents.map(doc => (
            <CitationCard
              key={doc.fileId ?? doc.fileName}
              document={doc}
              isExpanded={expandedDocIds.has(doc.fileId ?? 'unknown')}
              onToggle={() => toggleDoc(doc.fileId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

### 4.6 CitationIcon Helper

```tsx
// CitationIcon.tsx
import { FileText, FileSpreadsheet, Image, File, Globe } from 'lucide-react';

interface CitationIconProps {
  mimeType: string;
  isImage: boolean;
}

const iconMap: Record<string, typeof FileText> = {
  'application/pdf': FileText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FileText,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileSpreadsheet,
  'text/csv': FileSpreadsheet,
  'text/plain': FileText,
};

export function CitationIcon({ mimeType, isImage }: CitationIconProps) {
  if (isImage) {
    return <Image className="w-5 h-5 text-purple-500" />;
  }

  const Icon = iconMap[mimeType] ?? File;
  return <Icon className="w-5 h-5 text-gray-400" />;
}
```

### 4.7 InlineCitation (Future Enhancement)

```tsx
// InlineCitation.tsx
// Superscript markers in assistant text that link to specific citations.
// Implementation: post-process message content to find citation markers
// like [1], [2] and replace with interactive superscript links.
//
// This is a future enhancement that requires:
// 1. Backend to include citation markers in the AI response text
// 2. Frontend to parse and replace markers with interactive components
// 3. Click handler to scroll to/expand the corresponding CitationCard
//
// Not included in initial implementation.
```

---

## 5. Frontend Store

### 5.1 Citation State Management

```typescript
// Extend existing citationStore or create new one
// The existing citationStore in frontend/src/domains/chat/ can be extended:

interface CitationUIState {
  /** Expanded document IDs per message */
  expandedDocs: Record<string, Set<string>>;
  /** Whether citation panel is open per message */
  citationPanelOpen: Record<string, boolean>;

  toggleDocExpanded: (messageId: string, fileId: string) => void;
  toggleCitationPanel: (messageId: string) => void;
}
```

---

## 6. Tests Requeridos

### 6.1 Backend Tests

```typescript
describe('CitationResultSchema', () => {
  it('validates correct citation result');
  it('requires _type: citation_result');
  it('requires at least 1 document');
  it('requires at least 1 passage per document');
  it('rejects passage with relevanceScore > 1');
  it('rejects passage with relevanceScore < 0');
  it('limits excerpt to 500 characters');
  it('limits documents to 20 max');
  it('limits passages to 10 per document');
});

describe('knowledgeSearchTool (modified)', () => {
  it('returns _type: citation_result in output');
  it('groups results by source document');
  it('includes excerpt and relevance per passage');
  it('includes document-level relevance');
  it('preserves summary for backward compatibility');
});
```

### 6.2 Frontend Tests

```typescript
describe('CitationRenderer', () => {
  it('renders summary text');
  it('renders citation list with correct document count');
  it('toggles citation list open/closed');
});

describe('CitationCard', () => {
  it('shows file name and icon');
  it('shows passage count and relevance');
  it('expands to show passages on click');
  it('shows correct color for high relevance (>= 80%)');
  it('shows correct color for medium relevance (60-79%)');
});

describe('CitationPassage', () => {
  it('renders excerpt in blockquote');
  it('shows page number when available');
  it('shows relevance percentage');
});
```

---

## 7. Criterios de Aceptacion

- [ ] `CitationResultSchema` Zod schema exported from `@bc-agent/shared`
- [ ] `knowledgeSearchTool` returns `_type: 'citation_result'` in output
- [ ] Citation results grouped by document with per-passage excerpts
- [ ] `CitationRenderer` registered in PRD-070 renderer registry
- [ ] `CitationCard` shows file name, type icon, passage count, relevance
- [ ] `CitationPassage` shows excerpt and page number
- [ ] `CitationList` is collapsible with document count header
- [ ] Clicking document card expands/collapses passages
- [ ] Relevance score color-coded (green >= 80%, yellow >= 60%, gray < 60%)
- [ ] Backward compatible: `summary` field works as text if frontend lacks PRD-070
- [ ] `npm run verify:types` pasa
- [ ] `npm run -w backend test:unit` pasa
- [ ] `npm run -w bc-agent-frontend test` pasa

---

## 8. Archivos a Crear

### Shared Package

| # | Archivo | Descripcion |
|---|---------|-------------|
| 1 | `packages/shared/src/types/citation-result.types.ts` | TypeScript types |
| 2 | `packages/shared/src/schemas/citation-result.schema.ts` | Zod schemas |

### Frontend

| # | Archivo | Descripcion |
|---|---------|-------------|
| 3 | `frontend/src/components/chat/CitationRenderer/CitationRenderer.tsx` | Main renderer |
| 4 | `frontend/src/components/chat/CitationRenderer/CitationCard.tsx` | Document card |
| 5 | `frontend/src/components/chat/CitationRenderer/CitationPassage.tsx` | Passage excerpt |
| 6 | `frontend/src/components/chat/CitationRenderer/CitationList.tsx` | Collapsible list |
| 7 | `frontend/src/components/chat/CitationRenderer/CitationIcon.tsx` | File type icon |
| 8 | `frontend/src/components/chat/CitationRenderer/InlineCitation.tsx` | Future: inline markers |
| 9 | `frontend/src/components/chat/CitationRenderer/index.ts` | Barrel export |
| 10 | Tests correspondientes |

---

## 9. Archivos a Modificar

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `packages/shared/src/index.ts` | Export citation types and schemas |
| 2 | `backend/src/modules/agents/rag-knowledge/tools/knowledge-search.ts` | Add `_type: 'citation_result'`, group by document |
| 3 | `frontend/src/components/chat/AgentResultRenderer/rendererRegistry.ts` | Register `citation_result` renderer (if not already in PRD-070) |

---

## 10. Estimacion

| Componente | Dias |
|-----------|------|
| Shared package (types + schemas) | 0.5-1 |
| Backend tool modification | 1-2 |
| Frontend CitationRenderer + 5 components | 2-3 |
| Store integration | 0.5 |
| Testing | 1-2 |
| **Total** | **5-8 dias** |

---

## 11. Changelog

| Fecha | Version | Cambios |
|-------|---------|---------|
| 2026-02-09 | 1.0 | Draft inicial. Citation rendering con discriminador `_type: 'citation_result'` (PRD-070 pattern). Backend: `CitationResultSchema` con documents/passages agrupados, `knowledgeSearchTool` output enriquecido. Frontend: `CitationRenderer`, `CitationCard`, `CitationPassage`, `CitationList`, `CitationIcon`. Relevance color-coding. Backward compatible via `summary` field. `InlineCitation` marcado como future enhancement. |
| 2026-02-09 | 1.1 | Dependencia PRD-070 completada. `CitationRenderer` placeholder ya registrado en renderer registry de PRD-070 (`registerRenderer('citation_result', ...)`). Implementación real de componentes de citación pendiente. PRD desbloqueado. |
