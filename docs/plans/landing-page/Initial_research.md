# Landing Page — Initial Research

**Fecha**: 2026-04-03
**Estado**: Completado → Ver [00-MASTER-PLAN.md](./00-MASTER-PLAN.md)

---

## Herramientas Investigadas

### Librerías de Animación

| Herramienta | Decisión | Razón |
|---|---|---|
| **GSAP** | **SELECCIONADA** | Animaciones avanzadas (ScrollTrigger, SplitText, MorphSVG, DrawSVG, ScrollSmoother). 100% gratuito desde 2024-2025 (sponsorship Webflow). React integration via `@gsap/react` con `useGSAP` hook. Score context7: 88/100. |
| Motion.dev | Descartada | Capaz pero redundante con GSAP. Más React-idiomatic pero menos potente para scroll storytelling. Decidimos full GSAP para un solo modelo mental. |

### Componentes UI

| Herramienta | Decisión | Razón |
|---|---|---|
| **21st.dev** | **Referencia** | 17,646 componentes comunitarios. Hero sections, pricing cards, animated buttons. Usamos como inspiración y referencia de patterns, NO copy-paste. Muchos usan Framer Motion (incompatible con nuestra decisión GSAP). Score: 88/100. |
| shadcn/ui | Ya instalado | Base components. Estilo `new-york`. Se extiende para marketing. |

### i18n

| Herramienta | Decisión | Razón |
|---|---|---|
| **next-intl** | **Ya instalado (v4.8.3)** | App Router compatible, `[locale]` routing, middleware, `useTranslations`. Solo inglés inicialmente, i18n keys desde day 1. Score: 88/100. |

### Video Programático

| Herramienta | Decisión | Razón |
|---|---|---|
| **Remotion** | **Diferido (Fase 3)** | Poderoso para videos programáticos en React. `<Player>` component para embeber. Render a MP4. Score: 89/100. Se implementa después de core sections. |
| **Kite** | **Complementario (Fase 3)** | Para videos basados en screenshots del producto. Complementa Remotion. |

### Generación de Assets AI

| Herramienta | Uso | Estado |
|---|---|---|
| **Nano Banana Pro 2** | Imagen del camaleón mascota | Imagen preliminar generada, requiere iteración |
| **VO3 / Higsfield** | Video del camaleón animado | Video de prueba generado, requiere iteración |
| **Google Stitch** | Prototyping de diseño | Disponible para uso futuro si se necesita |

---

## Investigación Técnica (context7)

### GSAP — Capacidades Confirmadas
- `ScrollTrigger`: pin, scrub, snap, start/end, toggleActions
- `useGSAP` hook: cleanup automático en React, scoped animations
- `SplitText`: animación word-by-word, char-by-char (gratis)
- `DrawSVGPlugin`: dibujar SVGs progresivamente (gratis)
- `MorphSVGPlugin`: transformar formas SVG (gratis)
- `ScrollSmoother`: smooth scrolling nativo (gratis)
- Timeline chaining con labels y offsets
- `gsap.registerPlugin()` para inicialización centralizada

### Remotion — Capacidades Confirmadas
- `useCurrentFrame()` + `interpolate()` para control frame-by-frame
- `spring()` para física de animación
- `<Player>` component para embeber en React apps (Next.js compatible)
- `Sequence` + `AbsoluteFill` para composición de capas
- Server-side rendering a MP4 via `@remotion/renderer`
- Parametrizable con `inputProps`

### next-intl — Capacidades Confirmadas
- `[locale]` dynamic segments en App Router
- `createMiddleware(routing)` para negociación de locale
- `getRequestConfig` para server-side i18n
- `useTranslations` hook para client y server components
- ICU message format (plurales, interpolación)
- Alternate links automáticos para SEO

---

## Siguiente Paso

Toda la planificación está documentada en los PRDs:

- [00-MASTER-PLAN.md](./00-MASTER-PLAN.md) — Plan maestro
- [PRD-LP-001](./PRD-LP-001-foundation.md) — Foundation & Layout
- [PRD-LP-002](./PRD-LP-002-content-strategy.md) — Content Strategy
- [PRD-LP-003](./PRD-LP-003-hero-section.md) — Hero Section
- [PRD-LP-004](./PRD-LP-004-features-agents.md) — Features & Agents
- [PRD-LP-005](./PRD-LP-005-roadmap-waitlist.md) — Roadmap + Waitlist
- [PRD-LP-006](./PRD-LP-006-scroll-animations.md) — Scroll Animations
- [PRD-LP-007](./PRD-LP-007-chameleon.md) — Chameleon Animation
- [PRD-LP-007b](./PRD-LP-007b-pricing.md) — Pricing (Hidden)
- [PRD-LP-008](./PRD-LP-008-remotion.md) — Remotion Pipeline (Deferred)
- [PRD-LP-009](./PRD-LP-009-interactive-demo.md) — Interactive Demo (Deferred)
- [PRD-LP-010](./PRD-LP-010-translations.md) — Translations (Deferred)
