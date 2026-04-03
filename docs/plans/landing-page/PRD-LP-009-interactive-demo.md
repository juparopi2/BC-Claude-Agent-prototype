# PRD-LP-009: Interactive Demo (Deferred)

**Estado**: Diferido — Fase 3
**Fase**: 3 (Deferred)
**Dependencias**: LP-008 (Remotion pipeline)
**Bloquea**: Ninguno

---

## 1. Objetivo

Crear una demo interactiva del producto embebida en la landing page donde los usuarios pueden experimentar la interfaz sin registrarse. Puede ser un video interactivo (Remotion Player) o un sandbox limitado.

**Este PRD se DOCUMENTA ahora pero se IMPLEMENTA después de LP-008.**

---

## 2. Opciones de Implementación

### 2.1 Remotion Player Demo (Recomendada para inicio)
- Video programático mostrando flujos del producto
- Usuario puede pausar, rebobinar, controlar
- No requiere backend
- Rápido de implementar sobre LP-008

### 2.2 Sandbox Limitado
- iframe con una versión read-only del producto
- Datos mockeados
- Requiere despliegue separado
- Alto esfuerzo pero máximo impacto

### 2.3 Guided Tour Animado
- Secuencia de screenshots/mockups con transiciones GSAP
- Hotspots interactivos que explican features
- Menor esfuerzo, buen impacto

---

## 3. Decisión

Se define al momento de implementar, basándose en:
- Disponibilidad de assets (screenshots, mockups)
- Estado de LP-008 (Remotion ready?)
- Prioridad del negocio vs otras features

---

## 4. Criterios de Aceptación (para cuando se implemente)

- [ ] Demo embebida en landing page
- [ ] Funcional sin registro/autenticación
- [ ] Muestra al menos 3 flujos principales del producto
- [ ] Responsive
- [ ] Carga lazy (no impacta LCP de la landing)
