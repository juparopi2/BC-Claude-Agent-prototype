# Tests Eliminados - Fase 1

Este documento lista los archivos de test que fueron eliminados durante la Fase 1 y la justificación técnica para su eliminación.

## Contexto
El backend migró de usar el SDK de Agentes de Anthropic a una implementación directa (`DirectAgentService`) usando la API de Anthropic. Esto hizo que muchos tests diseñados para la abstracción anterior quedaran obsoletos.

## Archivos Eliminados

| Archivo | Razón |
| :--- | :--- |
| `src/__tests__/unit/services/agent/DirectAgentService.test.ts` | Testeaba implementación antigua basada en grafos/SDK. |
| `src/__tests__/unit/services/agent/DirectAgentService.comprehensive.test.ts` | Mocks complejos atados a la arquitectura anterior. |
| `src/__tests__/unit/services/agent/DirectAgentService.fileContext.test.ts` | Funcionalidad movida a nuevos servicios o testeada diferente. |
| `src/__tests__/unit/services/agent/DirectAgentService.citedFiles.test.ts` | Lógica de citación cambió con la nueva implementación de streaming. |
| `src/__tests__/unit/services/agent/DirectAgentService.semanticSearch.test.ts` | Dependía de mocks de herramientas antiguas. |
| `src/__tests__/unit/agent/e2e-data-flow.test.ts` | Test de flujo e2e que asumía eventos del SDK antiguo. |
| `src/__tests__/unit/agent/stop-reasons.test.ts` | Manejo de stop reasons es diferente en la API directa. |
| `src/__tests__/unit/agent/citations.test.ts` | Reemplazado por validación de estructura de mensaje en `AnthropicStreamAdapter`. |

## Validación
Todos los flujos críticos cubiertos por estos tests eliminados deben estar cubiertos por:
1.  **Nuevos Unit Tests**: Tests específicos para componentes individuales.
2.  **Integration Tests**: Tests como `DirectAgentService.integration.test.ts` (si existe/se crea) o tests de `server.comprehensive.test.ts`.

_Nota: La eliminación fue aprobada como parte del plan de la Fase 1 para limpiar deuda técnica._
