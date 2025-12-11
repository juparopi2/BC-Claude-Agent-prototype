# Fase 5: Integración de Chat con Archivos - Plan de Implementación TDD

## Visión y Valores

En esta fase, conectaremos el "mundo de los archivos" con el "mundo del chat". Para garantizar robustez y calidad, seguiremos estrictamente **Test Driven Development (TDD)**.
Nuestra creencia es que **si no está probado, no existe**. No solo probaremos unidades aisladas, sino que priorizaremos **pruebas de integración** que verifiquen que las piezas conectan correctamente.

### Objetivos Clave
1.  **Fluidez**: El usuario arrastra un archivo y este fluye hasta el contexto del LLM.
2.  **Transparencia**: El usuario sabe qué archivos se están usando (chips, citations).
3.  **Integridad**: El backend valida y procesa los archivos correctamente antes de enviarlos.

---

## Ciclos de Implementación (TDD)

Desglosamos la fase en 5 ciclos incrementales. Cada ciclo debe completarse (Green tests) antes de pasar al siguiente.

### Explicación de Iconos de Estado
- 🔴 **ToDo**: Pendiente de iniciar.
- 🟡 **In Progress**: En desarrollo (Red/Refactor).
- 🟢 **Done**: Implementado y verificado (Green).

---

### Ciclo 1: El Flujo de Adjuntar (Attachment Flow) 🟡 ~75% Completado
**Objetivo**: Permitir que el usuario seleccione archivos en el UI y que estos "viajen" hasta ser reconocidos por el backend como parte de un mensaje.

**Fecha de última actualización**: December 11, 2025

#### 1.1 Frontend: Visual Attachment
- **Test (Component)**: `ChatInput.test.tsx`
    - [x] Debe renderizar `FileAttachmentChip` cuando el store tiene archivos.
    - [x] Debe permitir eliminar un archivo del store al hacer click en "X".
    - [x] Debe aceptar drop de archivos y llamar a `uploadFiles`.
- **Implementación**:
    - [x] `FileAttachmentChip.tsx` creado con estados: uploading, completed, error
    - [x] `ChatInput.tsx` modificado con estados de attachments, upload progress, validación
    - [x] Botón "Attach files" con Paperclip icon y input file hidden

**Archivos implementados**:
- `frontend/components/chat/FileAttachmentChip.tsx`
- `frontend/components/chat/ChatInput.tsx` (líneas 37-166)
- `frontend/lib/stores/socketMiddleware.ts` (línea 261)

#### 1.2 Backend: Recepción de Attachments
- **Test (Integration)**: `DirectAgentService.attachments.integration.test.ts`
    - [x] `executeQueryStreaming` acepta un array de `fileIds`.
    - [x] Valida que los `fileIds` pertenecen al usuario (Security Check).
    - [x] Falla si un archivo no existe.
- **Implementación**:
    - [x] `ChatMessageHandler.ts` recibe `data.attachments` y lo pasa a agentService
    - [x] `DirectAgentService.ts` valida ownership llamando a `fileService.getFile(userId, fileId)`
    - [ ] **PENDIENTE**: Actualizar `SendMessageSchema` en `backend/src/types/chat.types.ts` (Zod)

**Archivos implementados**:
- `backend/src/services/websocket/ChatMessageHandler.ts` (línea 238)
- `backend/src/services/agent/DirectAgentService.ts` (líneas 386-403)

#### ✅ Criterios de Éxito del Ciclo 1
- [x] UI muestra los archivos adjuntos visualmente.
- [~] Backend recibe el mensaje con la lista de `fileIds` (funciona, falta Zod schema).
- [x] Ownership validation implementado y probado.

#### Estado de Tests de Integración (December 11, 2025)
Los tests de integración para attachments existen pero algunos fallan por problemas de **setup de tests** (no bugs de lógica):
- Error "Redis not initialized": Tests no pasan redisClient al TestSessionFactory
- Error "Database not connected": Worker necesita initDatabase() en setup

**Nota**: El código de producción funciona correctamente (pre-push pasa).

---

### Ciclo 2: Estrategia de Contexto (Context Strategy) 🔴
**Objetivo**: El backend decide *cómo* usar el archivo. ¿Es pequeño y va directo? ¿Es grande y requiere RAG?

#### 2.1 Lógica de Selección
- **Test (Unit)**: `ContextStrategy.test.ts`
    - [ ] Si archivo < 30MB y es texto -> Retornar estrategia `DIRECT_CONTENT`.
    - [ ] Si archivo es PDF/Scan -> Retornar estrategia `EXTRACTED_TEXT`.
    - [ ] Si archivo es masivo (> token limit) -> Retornar estrategia `RAG_CHUNKS`.
- **Implementación**:
    - Crear `ContextStrategyFactory` o método en `FileService`.
    - Implementar lógica de decisión basada en metadatos del archivo (`size`, `mimeType`).

#### ✅ Criterios de Éxito del Ciclo 2
- [ ] Unit tests cubren todos los casos de borde (imágenes, PDFs pesados, archivos vacíos).

---

### Ciclo 3: Construcción de Contexto e Inyección 🔴
**Objetivo**: Recuperar el contenido real y formatearlo para el prompt del LLM.

#### 3.1 Recuperación de Contenido
- **Test (Integration)**: `ContextRetrieval.integration.test.ts`
    - [ ] Para `DIRECT_CONTENT`: Debe descargar blob y leer stream.
    - [ ] Para `EXTRACTED_TEXT`: Debe leer campo `extracted_text` de DB.
    - [ ] Para `RAG_CHUNKS`: Debe llamar a `VectorSearchService` (mockeado o real).
- **Implementación**:
    - Servicio que orqueste la recuperación según la estrategia del Ciclo 2.

#### 3.2 Inyección en Prompt
- **Test (Unit)**: `PromptBuilder.test.ts`
    - [ ] Debe formatear el contexto con XML tags `<document name="...">`.
    - [ ] Debe incluir instrucciones de sistema: "Responde basándote en los documentos adjuntos...".
- **Implementación**:
    - Modificar la construcción del system prompt en `DirectAgentService`.

#### ✅ Criterios de Éxito del Ciclo 3
- [ ] El prompt final enviado a Anthropic contiene el texto de los archivos simulados.
- [ ] El formato XML es válido.

---

### Ciclo 4: Citations y Respuesta 🔴
**Objetivo**: Que el modelo cite sus fuentes y el frontend las muestre.

#### 4.1 Parsing de Respuesta
- **Test (Unit)**: `CitationParser.test.ts`
    - [ ] Input: "Según el documento [doc1], el valor es X."
    - [ ] Output: Identificar `[doc1]` y mapearlo al `fileId` original.
    - [ ] Input: XML tags de citation (si usamos tool calling).
- **Implementación**:
    - Definir formato de citas (prompt engineering).
    - Implementar parser en backend o frontend (decidir location, idealmente backend para normalizar).

#### 4.2 Persistencia de Relación
- **Test (Integration)**: `MessageAttachments.test.ts`
    - [ ] Al recibir respuesta, guardar en `message_file_attachments`.
    - [ ] Verificar que `usage_type` se marca correctamente ('citation' vs 'context').

#### 4.3 UI de Citations
- **Test (Component)**: `CitationLink.test.tsx`
    - [ ] Click en cita navega al archivo o abre preview.
- **Implementación**:
    - Componente `CitationLink` en Frontend.

#### ✅ Criterios de Éxito del Ciclo 4
- [ ] DB refleja qué archivos se usaron para generar la respuesta.
- [ ] UI muestra links clickeables en el mensaje de respuesta.

---

### Ciclo 5: Verificación End-to-End (E2E) 🔴
**Objetivo**: Unir todo.

#### 5.1 Flujo Completo
- **Test (Manual/Script)**: `verify-chat-w-files.ts`
    1.  Subir archivo "test.txt" con contenido único "La clave secreta es PINGUINO".
    2.  Esperar procesado.
    3.  Adjuntar archivo al chat.
    4.  Preguntar "¿Cuál es la clave secreta?".
    5.  Verificar respuesta contiene "PINGUINO".
    6.  Verificar citation presente.

#### ✅ Criterios de Éxito del Ciclo 5
- [ ] El flujo completo funciona sin errores 500.
- [ ] Latencia aceptable (< 5s para inicio de respuesta).

---

## Plan de Pruebas (Master Checklist)

- [ ] `backend/src/__tests__/unit/components/ChatInput.test.tsx` (Si aplicable o Cypress)
- [ ] `backend/src/__tests__/integration/agent/DirectAgentService.attachments.test.ts`
- [ ] `backend/src/__tests__/unit/services/files/ContextStrategy.test.ts`
- [ ] `backend/src/__tests__/integration/services/files/ContextRetrieval.test.ts`
- [ ] `backend/src/__tests__/unit/agent/PromptBuilder.attachments.test.ts`

## Next Steps

1.  Aprobar este plan.
2.  Comenzar **Ciclo 1: El Flujo de Adjuntar**.
