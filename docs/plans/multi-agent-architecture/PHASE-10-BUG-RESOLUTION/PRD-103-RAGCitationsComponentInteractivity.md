# PRD-103: Interactividad de Componentes de Citaciones RAG

**Estado**: 🔴 NO INICIADO
**Fecha**: 2026-02-13
**Fase**: 10 (Bug Resolution)
**Prioridad**: P1 - HIGH
**Dependencias**: Ninguna

---

## 1. Problema

El componente usado para mostrar archivos descubiertos/filtrados por el agente RAG en resultados de herramientas carece de características de interactividad que existen en otras partes de la aplicación.

### 1.1 Sin Handler de Click

Hacer click en una referencia de archivo en resultados de herramientas RAG no hace nada. Debería navegar a la ubicación del archivo o abrir una vista previa.

**Comportamiento actual**: Click → Sin acción
**Comportamiento esperado**: Click → Abre modal de vista previa con contenido del archivo

### 1.2 Sin Menú Contextual "Go to path"

El click derecho en una referencia de archivo debería mostrar una opción para navegar a la ubicación del archivo en el panel de archivos.

**Comportamiento actual**: Click derecho → Menú nativo del navegador
**Comportamiento esperado**: Click derecho → Menú contextual con "Go to path in files panel"

### 1.3 Sin Vista Previa de Miniaturas

Las referencias de archivos en resultados RAG no muestran vistas previas de miniaturas:
- Imágenes deberían mostrar una pequeña miniatura
- Documentos deberían mostrar un ícono apropiado (PDF, DOCX, XLSX, etc.)

**Comportamiento actual**: Sólo texto con nombre de archivo
**Comportamiento esperado**: Ícono/miniatura + nombre de archivo

### 1.4 Sin Modal de Vista Previa de Fuente

El componente existente `SourcePreviewModal` (usado en citaciones) no está integrado en la visualización de archivos de resultados de herramientas RAG. Los usuarios no pueden previsualizar contenidos de archivos.

**Componente existente**: `frontend/components/modals/SourcePreviewModal.tsx`
**Ubicación de uso actual**: Citaciones en mensajes de agentes
**Ubicación faltante**: Resultados de herramientas RAG

---

## 2. Evidencia

### 2.1 Comparación Visual

**Citaciones (FUNCIONA)**:
```
┌─────────────────────────────────────┐
│ [i] Sources (3)                     │
│                                     │
│ [📄] quarterly-report.pdf           │ ← Click abre modal
│      Page 3, Paragraph 2            │ ← Hover muestra tooltip
│                                     │
│ [📊] sales-data.xlsx                │ ← Right-click → "Go to path"
│      Sheet1                         │
└─────────────────────────────────────┘
```

**Resultados RAG (NO FUNCIONA)**:
```
┌─────────────────────────────────────┐
│ Tool Result: search_documents       │
│                                     │
│ Found 3 documents:                  │
│ - quarterly-report.pdf              │ ← Click no hace nada
│ - sales-data.xlsx                   │ ← Sin ícono
│ - meeting-notes.docx                │ ← Sin menú contextual
└─────────────────────────────────────┘
```

### 2.2 Código Actual

**Componente de citaciones** (frontend/src/presentation/chat/MessageCitations.tsx):
```typescript
function MessageCitations({ citations }: Props) {
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

  return (
    <div>
      {citations.map(citation => (
        <CitationCard
          key={citation.id}
          citation={citation}
          onClick={() => setSelectedCitation(citation)}  // ✅ FUNCIONA
        />
      ))}

      {selectedCitation && (
        <SourcePreviewModal
          citation={selectedCitation}
          onClose={() => setSelectedCitation(null)}
        />
      )}
    </div>
  );
}
```

**Componente de resultados RAG** (hipótesis: ToolResultDisplay.tsx):
```typescript
function ToolResultDisplay({ result }: Props) {
  if (result.tool === 'search_documents') {
    const files = result.output.files;

    return (
      <div>
        {files.map(file => (
          <div key={file.id}>
            {file.name}  {/* ❌ Sin interactividad */}
          </div>
        ))}
      </div>
    );
  }
}
```

---

## 3. Análisis de Causa Raíz

### 3.1 Componentes Separados Sin Unificación

**Problema**: La funcionalidad de vista previa de archivos está implementada SÓLO en el componente de citaciones, pero NO en el componente de visualización de resultados de herramientas.

**Arquitectura actual**:
```
MessageCitations.tsx
  ├── CitationCard (con onClick)
  ├── SourcePreviewModal
  └── citationsStore (estado de citaciones)

ToolResultDisplay.tsx
  ├── ResultCard (SIN onClick)  ← PROBLEMA
  └── Sin modal de vista previa  ← PROBLEMA
```

**Arquitectura deseada**:
```
Shared/FileReference.tsx  ← NUEVO componente compartido
  ├── FileIcon/Thumbnail
  ├── onClick handler
  ├── Context menu
  └── Integración con SourcePreviewModal

MessageCitations.tsx → usa FileReference
ToolResultDisplay.tsx → usa FileReference
```

### 3.2 Falta de Abstracción de Datos

**Problema**: Los datos de citaciones y archivos RAG tienen estructuras diferentes, pero representan el mismo concepto (referencia a un archivo).

**Estructura de Citation**:
```typescript
interface Citation {
  id: string;
  fileId: string;
  fileName: string;
  fileType: string;
  pageNumber?: number;
  snippet: string;
}
```

**Estructura de RAG Result File**:
```typescript
interface RAGResultFile {
  id: string;
  name: string;
  path: string;
  relevanceScore: number;
}
```

**Necesidad**: Interfaz unificada `FileReference` que ambas estructuras puedan implementar.

---

## 4. Componentes Existentes que Pueden Reutilizarse

| Componente | Ubicación | Funcionalidad | Reutilizable |
|------------|-----------|---------------|--------------|
| `SourcePreviewModal` | `frontend/components/modals/SourcePreviewModal.tsx` | Modal de vista previa de contenido | ✅ Sí |
| `CitationCard` | `frontend/src/presentation/chat/MessageCitations.tsx` | Card con onClick, hover | ✅ Parcial |
| `FilePreview` | `frontend/components/files/FilePreview.tsx` | Renderizado de miniaturas | ✅ Sí |
| `FileIcon` | `frontend/components/files/FileIcon.tsx` | Íconos por tipo | ✅ Sí |
| `citationsStore` | `frontend/src/domains/chat/stores/citationsStore.ts` | Estado de citaciones | ❌ No (específico) |

---

## 5. Archivos a Investigar

| Archivo | Investigación | Prioridad |
|---------|---------------|-----------|
| `frontend/src/presentation/chat/` | Identificar componente que renderiza resultados de archivos RAG | P0 |
| `frontend/components/modals/SourcePreviewModal.tsx` | Cómo se invoca, qué props requiere, si puede recibir datos RAG | P0 |
| `frontend/src/domains/chat/stores/citationsStore.ts` | Si puede extenderse para manejar referencias RAG, o crear store separado | P1 |
| `frontend/components/files/FilePreview.tsx` | Cómo renderiza miniaturas, si acepta URLs o fileIds | P1 |
| `frontend/components/files/FileIcon.tsx` | Mapeo de extensiones a íconos | P1 |
| `backend/src/modules/agents/rag-knowledge/` | Qué datos retorna el agente RAG en resultados de herramientas | P1 |
| `frontend/src/domains/files/stores/` | Si hay store de archivos que puede proporcionar metadatos | P2 |

---

## 6. Soluciones Propuestas

### 6.1 Componente Compartido FileReference (RECOMENDADO)

**Paso 1: Crear interfaz unificada**
```typescript
// frontend/src/domains/files/types.ts
export interface IFileReference {
  id: string;
  name: string;
  path?: string;
  type: string;
  metadata?: {
    pageNumber?: number;
    snippet?: string;
    relevanceScore?: number;
  };
}
```

**Paso 2: Componente compartido**
```typescript
// frontend/components/files/FileReference.tsx
interface FileReferenceProps {
  file: IFileReference;
  showThumbnail?: boolean;
  onClick?: (file: IFileReference) => void;
  onContextMenu?: (file: IFileReference, event: React.MouseEvent) => void;
}

export function FileReference({
  file,
  showThumbnail = true,
  onClick,
  onContextMenu
}: FileReferenceProps) {
  const handleClick = () => onClick?.(file);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu?.(file, e);
  };

  return (
    <div
      className="file-reference"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {showThumbnail && (
        <FileThumbnail fileId={file.id} fileType={file.type} />
      )}
      <span className="file-name">{file.name}</span>
      {file.metadata?.pageNumber && (
        <span className="file-page">Page {file.metadata.pageNumber}</span>
      )}
    </div>
  );
}
```

**Paso 3: Hook de vista previa compartido**
```typescript
// frontend/src/domains/files/hooks/useFilePreview.ts
export function useFilePreview() {
  const [previewFile, setPreviewFile] = useState<IFileReference | null>(null);

  const openPreview = (file: IFileReference) => {
    setPreviewFile(file);
  };

  const closePreview = () => {
    setPreviewFile(null);
  };

  return { previewFile, openPreview, closePreview };
}
```

**Paso 4: Integración en ToolResultDisplay**
```typescript
// frontend/src/presentation/chat/ToolResultDisplay.tsx
function ToolResultDisplay({ result }: Props) {
  const { previewFile, openPreview, closePreview } = useFilePreview();
  const { navigateToFile } = useFileNavigation();

  if (result.tool === 'search_documents') {
    const files: IFileReference[] = result.output.files.map(f => ({
      id: f.id,
      name: f.name,
      path: f.path,
      type: inferFileType(f.name),
      metadata: { relevanceScore: f.relevanceScore }
    }));

    return (
      <div>
        {files.map(file => (
          <FileReference
            key={file.id}
            file={file}
            onClick={openPreview}
            onContextMenu={(file, e) => {
              showContextMenu(e, [
                { label: 'Go to path', onClick: () => navigateToFile(file.path) }
              ]);
            }}
          />
        ))}

        {previewFile && (
          <SourcePreviewModal file={previewFile} onClose={closePreview} />
        )}
      </div>
    );
  }
}
```

### 6.2 Adaptadores para Citation y RAG Result

**Adaptador de Citation**:
```typescript
function citationToFileReference(citation: Citation): IFileReference {
  return {
    id: citation.fileId,
    name: citation.fileName,
    type: citation.fileType,
    metadata: {
      pageNumber: citation.pageNumber,
      snippet: citation.snippet
    }
  };
}
```

**Adaptador de RAG Result**:
```typescript
function ragResultToFileReference(ragFile: RAGResultFile): IFileReference {
  return {
    id: ragFile.id,
    name: ragFile.name,
    path: ragFile.path,
    type: inferFileType(ragFile.name),
    metadata: {
      relevanceScore: ragFile.relevanceScore
    }
  };
}
```

---

## 7. Criterios de Éxito

### 7.1 Funcionales

- [ ] Click en referencia de archivo RAG abre `SourcePreviewModal`
- [ ] Modal muestra contenido del archivo (texto, PDF, imagen)
- [ ] Right-click muestra menú contextual con "Go to path"
- [ ] "Go to path" navega al archivo en el panel de archivos
- [ ] Archivos de imagen muestran miniatura
- [ ] Archivos de documento muestran ícono apropiado
- [ ] Comportamiento consistente entre citaciones y resultados RAG

### 7.2 Validación Visual

**Test Manual**:
1. Ejecutar query RAG que retorna archivos
2. Verificar que resultados muestran íconos/miniaturas
3. Click en archivo → Modal se abre con vista previa
4. Right-click en archivo → Menú contextual aparece
5. Click "Go to path" → Panel de archivos navega al archivo
6. Repetir para citaciones → Mismo comportamiento

### 7.3 Validación de Código

```typescript
// Test: FileReference renderiza correctamente
it('should render file with thumbnail and name', () => {
  const file: IFileReference = {
    id: '123',
    name: 'report.pdf',
    type: 'application/pdf'
  };

  const { getByText, getByRole } = render(<FileReference file={file} />);

  expect(getByText('report.pdf')).toBeInTheDocument();
  expect(getByRole('img')).toHaveAttribute('alt', 'PDF icon');
});

// Test: Click abre vista previa
it('should open preview modal on click', () => {
  const file: IFileReference = { id: '123', name: 'report.pdf', type: 'pdf' };
  const onClickMock = vi.fn();

  const { getByText } = render(
    <FileReference file={file} onClick={onClickMock} />
  );

  fireEvent.click(getByText('report.pdf'));

  expect(onClickMock).toHaveBeenCalledWith(file);
});
```

---

## 8. Plan de Implementación

### Fase 1: Investigación (2h)
- [ ] Identificar componente exacto que renderiza resultados RAG
- [ ] Analizar estructura de datos retornada por herramientas RAG
- [ ] Verificar que `SourcePreviewModal` puede recibir datos RAG
- [ ] Documentar API de `FilePreview` y `FileIcon`

### Fase 2: Interfaz Unificada (1h)
- [ ] Crear `IFileReference` en `frontend/src/domains/files/types.ts`
- [ ] Crear adaptadores `citationToFileReference` y `ragResultToFileReference`
- [ ] Test unitario: verificar conversiones correctas

### Fase 3: Componente FileReference (3h)
- [ ] Implementar `FileReference` con thumbnail, onClick, onContextMenu
- [ ] Crear hook `useFilePreview`
- [ ] Crear hook `useFileNavigation` para "Go to path"
- [ ] Implementar menú contextual (puede usar librería como `react-contexify`)
- [ ] Test: renderizado, interacciones

### Fase 4: Integración en ToolResultDisplay (2h)
- [ ] Modificar `ToolResultDisplay` para usar `FileReference`
- [ ] Integrar `SourcePreviewModal`
- [ ] Agregar menú contextual
- [ ] Test: ejecución de herramienta RAG, verificar UI

### Fase 5: Refactor de MessageCitations (1h)
- [ ] Refactorizar `MessageCitations` para usar `FileReference` compartido
- [ ] Verificar que funcionalidad existente no se rompe
- [ ] Test regresión: citaciones siguen funcionando

### Fase 6: Testing E2E (2h)
- [ ] Caso 1: Query RAG → Click archivo → Modal abre
- [ ] Caso 2: Right-click → "Go to path" → Navegación funciona
- [ ] Caso 3: Citaciones → Mismo flujo
- [ ] Caso 4: Diferentes tipos de archivo (PDF, imagen, DOCX)

---

## 9. Riesgos y Mitigación

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| SourcePreviewModal no compatible con datos RAG | Media | Alto | Investigar props, refactorizar modal si necesario |
| Estructura de datos RAG inconsistente | Media | Medio | Normalizar en adaptador, logging detallado |
| Navegación a archivo no implementada | Alta | Medio | Implementar `useFileNavigation` hook |
| Miniaturas causan lag en UI | Baja | Medio | Lazy loading, virtualización para listas largas |

---

## 10. Consideraciones Adicionales

### 10.1 Permisos de Archivo

Si el sistema tiene permisos de archivo, la vista previa debe verificar que el usuario tiene acceso antes de mostrar contenido.

**Validación**:
```typescript
async function openPreview(file: IFileReference) {
  const hasAccess = await checkFilePermission(file.id);

  if (!hasAccess) {
    showError('You do not have permission to view this file');
    return;
  }

  setPreviewFile(file);
}
```

### 10.2 Carga de Vista Previa

Para archivos grandes, la vista previa debe tener estados de carga:

```typescript
function SourcePreviewModal({ file }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFileContent(file.id)
      .then(setContent)
      .finally(() => setLoading(false));
  }, [file.id]);

  if (loading) return <Spinner />;
  if (!content) return <ErrorMessage />;

  return <FileContentRenderer content={content} type={file.type} />;
}
```

### 10.3 Tipos de Archivo Soportados

**Vista previa soportada**:
- Texto plano (.txt, .md, .log)
- PDF (via PDF.js)
- Imágenes (.png, .jpg, .gif, .svg)
- JSON, XML

**Vista previa NO soportada** (mostrar mensaje):
- Binarios (.exe, .dll)
- Archivos de Office (.docx, .xlsx) sin conversor

---

## 11. Mejoras Futuras (Fuera de Scope)

- [ ] Vista previa inline (sin modal) para imágenes pequeñas
- [ ] Búsqueda dentro del contenido del archivo en el modal
- [ ] Anotaciones en archivos (highlight, comentarios)
- [ ] Compartir enlace directo a archivo con anchor a página/línea específica

---

## 12. Changelog

| Fecha | Autor | Cambios |
|-------|-------|---------|
| 2026-02-13 | Juan Pablo | Creación inicial del PRD |
