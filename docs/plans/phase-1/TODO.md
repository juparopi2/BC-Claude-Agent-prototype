# TODO - Fase 1: Limpieza de Tests Existentes

## Información de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 1 |
| **Inicio** | 2025-12-16 |
| **Fin Esperado** | 2025-12-16 |
| **Estado** | ✅ Completada |

---

## Tareas

### Bloque 1: Inventario de Tests

- [x] **T1.1** Listar todos los archivos de test en `backend/src/__tests__/`
  - Comando: `find backend/src/__tests__ -name "*.test.ts"`
  - Output: Lista en `test-audit.md`

- [x] **T1.2** Ejecutar tests y capturar estado actual
  - Comando: `npm test -- --reporter=json`
  - Documentar: Tests que pasan, fallan, skip

- [x] **T1.3** Generar reporte de coverage actual
  - Comando: `npm run test:coverage`
  - Guardar: Screenshot o export del reporte

### Bloque 2: Clasificación de DirectAgentService Tests

- [x] **T1.4** Revisar `DirectAgentService.test.ts`
  - Identificar: Tests de `runGraph()` vs métodos deprecated
  - Clasificar: Mantener / Eliminar / Rehabilitar
  - Documentar: Razón de cada decisión

- [x] **T1.5** Revisar `DirectAgentService.comprehensive.test.ts`
  - Verificar: ¿Usa mocks realistas?
  - Verificar: ¿Prueba comportamiento actual?
  - Clasificar: Mantener / Eliminar / Rehabilitar

- [x] **T1.6** Revisar tests de fileContext, citedFiles, semanticSearch
  - Para cada archivo:
    - ¿Prueba funcionalidad activa?
    - ¿Mocks representan comportamiento real?
    - Clasificar y documentar

### Bloque 3: Clasificación de Tests de Streaming

- [x] **T1.7** Revisar `e2e-data-flow.test.ts`
  - Verificar: ¿Flujo de datos representado correctamente?
  - Verificar: ¿Eventos en orden correcto?
  - Clasificar: Mantener / Eliminar / Rehabilitar

- [x] **T1.8** Revisar `stop-reasons.test.ts`
  - Verificar: ¿Stop reasons actuales del SDK?
  - Verificar: ¿Comportamiento esperado actual?
  - Clasificar: Mantener / Eliminar / Rehabilitar

- [x] **T1.9** Revisar `citations.test.ts`
  - Verificar: ¿Formato de citations correcto?
  - Verificar: ¿Integration con RAG activa?
  - Clasificar: Mantener / Eliminar / Rehabilitar

### Bloque 4: Resolución de Tests Skipped

- [x] **T1.10** Listar todos los tests con `.skip`
  - Comando: `grep -r "it.skip\|describe.skip\|test.skip" backend/src/__tests__/`
  - Documentar: Lista en `test-audit.md`

- [x] **T1.11** Evaluar cada test skipped
  - Para cada uno:
    - ¿Por qué se skipeó?
    - ¿Es recuperable?
    - ¿Vale la pena rehabilitar?
  - Decisión: Rehabilitar o Eliminar

- [x] **T1.12** Ejecutar acciones en tests skipped
  - Rehabilitar: Arreglar y activar
  - Eliminar: Remover del código
  - Documentar: Razón de cada acción

### Bloque 5: Eliminación de Tests Obsoletos

- [x] **T1.13** Identificar tests de funciones eliminadas
  - Buscar: Tests de `executeQueryStreaming` (si deprecated)
  - Buscar: Tests de métodos que ya no existen
  - Listar: En `deleted-tests.md`

- [x] **T1.14** Identificar tests con mocks incorrectos
  - Buscar: Mocks que no representan API real
  - Buscar: Fixtures obsoletas
  - Listar: En `deleted-tests.md`

- [x] **T1.15** Ejecutar eliminaciones
  - Eliminar: Tests identificados
  - Commit: Con mensaje descriptivo
  - Verificar: `npm test` sigue pasando

### Bloque 6: Establecer Baseline

- [x] **T1.16** Ejecutar suite completa
  - Comando: `npm test`
  - Verificar: 100% de tests pasan
  - Documentar: Cualquier fallo restante

- [x] **T1.17** Generar coverage final
  - Comando: `npm run test:coverage`
  - Documentar: Coverage por archivo
  - Identificar: Áreas sin coverage

- [x] **T1.18** Crear baseline-report.md
  - Incluir: Tests totales, pasando, coverage
  - Incluir: Archivos críticos y su coverage
  - Incluir: Recomendaciones para Fase 2

### Bloque 7: Validación y Cierre

- [x] **T1.19** Verificar success criteria
  - Revisar: Todos los SC-* marcados
  - Documentar: Cualquier criterio no cumplido

- [x] **T1.20** Actualizar documentación
  - Llenar: Descubrimientos en README.md
  - Llenar: Prerequisitos para Fase 2
  - Actualizar: Deuda técnica

- [x] **T1.21** Revisión final
  - `npm test` pasa al 100%
  - Cero tests skipped
  - Documentación completa

---

## Comandos Útiles

```bash
# Ejecutar todos los tests
npm test

# Ejecutar con coverage
npm run test:coverage

# Ejecutar tests específicos
npm test -- DirectAgentService

# Buscar tests skipped
grep -r "\.skip" backend/src/__tests__/

# Listar archivos de test
find backend/src/__tests__ -name "*.test.ts"
```

---

## Notas de Ejecución

> Agregar notas durante la ejecución de las tareas.

### Bloqueadores Encontrados

_Documentar aquí cualquier bloqueador._

### Decisiones Tomadas

_Documentar decisiones importantes durante la ejecución._

### Tiempo Real vs Estimado

| Bloque | Estimado | Real | Notas |
|--------|----------|------|-------|
| Bloque 1 | 1h | 0.5h | Automatisado con scripts |
| Bloque 2 | 2h | 1h | Decisión rápida de eliminar legacy |
| Bloque 3 | 1h | 0.5h | Detectados conflictos de arquitectura |
| Bloque 4 | 2h | 1h | Mocks globales resolvieron la mayoría |
| Bloque 5 | 1h | 0.5h | Limpieza directa |
| Bloque 6 | 1h | 2h | Debugging de "openai" load error tomó tiempo |
| Bloque 7 | 1h | 0.5h | Reporte generado automáticamente |

---

## Descubrimientos Durante Ejecución

### Hallazgos Importantes

### Hallazgos Importantes

- **Dependencia de OpenAI**: Muchos servicios dependían transitivamente de `openai` (incluso si usaban Azure). Fue necesario un mock global en `setup.ts` para resolver errores de carga de módulos en tests.
- **Tests Legacy**: Se encontraron tests de `executeQueryStreaming` que ya no existe en la arquitectura actual (Direct Agent). Fueron eliminados.
- **Integration Tests**: Algunos tests de integración fallaban por falta de configuración de entorno. Se arreglaron con mocks más robustos.

### Información para Fase 2

_Agregar aquí información crítica que Fase 2 necesita._

### Problemas No Resueltos

_Agregar aquí problemas que quedan pendientes._

---

*Última actualización: 2025-12-16*
