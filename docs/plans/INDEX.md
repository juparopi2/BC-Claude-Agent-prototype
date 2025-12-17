# Índice de Planificación del Backend

## Estructura de Archivos

```
docs/plans/
├── INDEX.md                    # Este archivo - guía de navegación
├── 00-PRINCIPLES.md            # Principios y lineamientos (LEER PRIMERO)
│
├── phase-0/                    # Diagnóstico y Análisis
│   ├── README.md               # Descripción, success criteria, filosofía
│   └── TODO.md                 # Tareas granulares
│
├── phase-0.5/                  # Abstracción de Provider (Multi-Provider)
│   ├── README.md               # Interfaces, arquitectura de capas
│   └── TODO.md                 # 33 tareas en 8 bloques
│
├── phase-1/                    # Limpieza de Tests
│   ├── README.md
│   └── TODO.md
│
├── phase-2/                    # Tests Unitarios
│   ├── README.md
│   └── TODO.md
│
├── phase-3/                    # Tests de Integración
│   ├── README.md
│   └── TODO.md
│
├── phase-4/                    # Tests E2E con Postman
│   ├── README.md
│   └── TODO.md
│
├── phase-5/                    # Refactoring Estructural
│   ├── README.md
│   └── TODO.md
│
└── phase-6/                    # Documentación
    ├── README.md
    └── TODO.md
```

---

## Cómo Usar Estos Archivos

### Para Claude Code / Agentes AI

Al iniciar cualquier tarea de una fase:

1. **Siempre leer primero**: `00-PRINCIPLES.md`
2. **Leer la fase actual**: `phase-X/README.md`
3. **Si aplica, leer fase anterior**: `phase-(X-1)/README.md` (sección "Descubrimientos")
4. **Ejecutar tareas de**: `phase-X/TODO.md`
5. **Documentar descubrimientos** en la sección correspondiente

### Prompt Sugerido para Claude Code

```
Por favor lee los siguientes archivos antes de comenzar:
1. docs/plans/00-PRINCIPLES.md
2. docs/plans/phase-0/README.md
3. docs/plans/phase-0/TODO.md

Luego ejecuta las tareas del TODO en orden, siguiendo los principios establecidos.
```

### Para Desarrolladores Humanos

1. **Revisar principios** antes de escribir código
2. **Marcar tareas completadas** en TODO.md con [x]
3. **Documentar descubrimientos** en README.md de la fase
4. **Actualizar prerequisitos** para la siguiente fase

---

## Resumen de Fases

| Fase | Nombre | Objetivo Principal |
|------|--------|-------------------|
| 0 | Diagnóstico | Entender respuesta cruda de Claude |
| **0.5** | **Abstracción Provider** | **Normalizar eventos para multi-provider** |
| 1 | Limpieza Tests | Establecer baseline de tests |
| 2 | Tests Unitarios | Coverage del pipeline |
| 3 | Tests Integración | Validar servicios juntos |
| 4 | Tests E2E | Postman/Newman collection |
| 5 | Refactoring | Separar responsabilidades |
| 6 | Documentación | Documentar el sistema |

---

## Problemas Prioritarios

Identificados en el diagnóstico inicial:

1. **Thinking Events** - Orden incorrecto, transición thinking→text
2. **Tool Events** - Deduplicación, IDs inconsistentes

Estos problemas deben resolverse en las Fases 2 y 5.

---

## Flujo de Información Entre Fases

```
Fase 0 ──diagnóstico Claude──▶ Fase 0.5 (interfaces normalizadas)
   │
   └──descubrimientos────────▶ Fase 1

Fase 0.5 ──interfaces/adapters──▶ Fase 1 (tests contra nueva arquitectura)
    │
    └──AnthropicStreamAdapter──▶ Fase 2 (tests unitarios)

Fase 1 ──baseline tests────▶ Fase 2

Fase 2 ──coverage report───▶ Fase 3

Fase 3 ──gaps de integración──▶ Fase 4

Fase 4 ──validación E2E────▶ Fase 5 (safety net para refactor)

Fase 5 ──nueva arquitectura──▶ Fase 6 (documentar)
```

---

## Plantilla de Sección "Descubrimientos"

Cada fase debe llenar esta sección en su README.md:

```markdown
## Descubrimientos y Notas

### Descubrimientos de Fase Anterior

_Información relevante de la fase anterior que afecta esta fase._

### Descubrimientos de Esta Fase

_Hallazgos importantes durante la ejecución._

### Prerequisitos para Siguiente Fase

_Información crítica que la siguiente fase necesita saber._

### Deuda Técnica Identificada

_Problemas que no se resuelven en esta fase pero deben documentarse._
```

---

## Validación de Fase Completa

Antes de pasar a la siguiente fase, verificar:

- [ ] Todos los success criteria marcados
- [ ] TODO.md completado (no items pendientes)
- [ ] Sección "Descubrimientos" llenada
- [ ] Prerequisitos para siguiente fase documentados

---

*Última actualización: 2025-12-16*
