# PRD-LP-006: Scroll Animations

**Estado**: Pendiente
**Fase**: 2 (Polish & Enhancement)
**Dependencias**: LP-003, LP-004, LP-005 (todas las secciones core construidas)
**Bloquea**: LP-007 (chameleon)

---

## 1. Objetivo

Elevar la landing page de funcional a cinematográfica. Aplicar animaciones GSAP avanzadas a las secciones ya construidas: ScrollTrigger con pinning, parallax, scrub, SplitText en headers, y transiciones fluidas entre secciones.

---

## 2. Alcance

### En Scope
- ScrollSmoother (smooth scrolling global)
- ScrollTrigger para cada sección (reveal, pin, scrub)
- SplitText en todos los títulos de sección
- Parallax en backgrounds y elementos decorativos
- Transiciones entre secciones (color shifts, overlay effects)
- Snap scrolling opcional (snap a secciones)
- Performance optimization (will-change, GPU layers)

### Fuera de Scope
- Chameleon frame-by-frame (LP-007)
- Nuevos componentes o contenido
- Mobile-specific gesture animations

---

## 3. Animation Map

### 3.1 Global

| Feature | Implementación |
|---|---|
| Smooth scroll | `ScrollSmoother.create({ smooth: 1.5, effects: true })` |
| Section snap (opcional) | ScrollTrigger `snap` config con `snapTo: 'labels'` |
| Progress indicator | Barra de progreso top vinculada a scroll position |

### 3.2 Per-Section Animations

#### Hero (LP-003 enhancement)
- Background gradient: parallax shift al hacer scroll (se mueve más lento que el contenido)
- Microsoft badges: slight parallax (se mueven a velocidad diferente)
- Hero visual: scale down + fade al salir del viewport
- Pin opcional: hero se queda fijo brevemente mientras el badge animado entra

#### Features (LP-004 enhancement)
- Section title: SplitText word-by-word con scroll scrub
- Feature cards: stagger reveal vinculado al scroll (scrub: 1)
- Cards hover: GSAP-powered glow que sigue el mouse position (`quickTo`)
- Background: gradiente sutil que cambia de color según qué card está "active"

#### Agents (LP-004 enhancement)
- Agent cards: slide in from alternating sides (izq, der, izq...)
- Agent color: al entrar en viewport, un glow en el color del agente ilumina sutilmente el fondo
- Orchestrator card: especial — "conecta" visualmente a los otros agents con líneas SVG animadas (DrawSVG)

#### Security (LP-004 enhancement)
- Badges: stagger scale-in con rebote (ease: 'elastic.out')
- Shield icon: DrawSVG progresivo al entrar en viewport

#### Roadmap (LP-005 enhancement)
- Timeline line: DrawSVG progresivo al hacer scroll
- Items: appear secuencialmente conforme la línea los "alcanza"
- Status dots: scale + color fill sincronizado con el scroll
- "Live" items: glow verde constante

#### Waitlist (LP-005 enhancement)
- Background: gradiente que intensifica al acercarse (scroll-driven)
- Title: SplitText reveal
- Form: elevation animation (sube desde el fondo con spring)
- Benefits: stagger con slight rotation

---

## 4. Performance

### Guidelines
- `will-change: transform, opacity` en elementos animados
- Usar `gsap.set()` para valores iniciales (evitar FOUC)
- `ScrollTrigger.batch()` para elementos repetidos (cards)
- Lazy init: solo activar animaciones cuando la sección está cerca del viewport
- Disable ScrollSmoother en mobile si causa lag (`ScrollSmoother.matchMedia`)
- Test en dispositivos reales (no solo DevTools throttling)

### Targets
- 60fps constante en desktop
- 30fps mínimo en mobile
- No jank visible durante scroll rápido

---

## 5. Implementación

### Archivos Nuevos/Modificados

```
frontend/src/domains/marketing/animations/
├── gsap-config.ts              ← Ya existe (LP-001), agregar ScrollSmoother init
├── scroll-triggers.ts          ← NUEVO: configuración de ScrollTrigger por sección
├── section-animations.ts       ← NUEVO: animaciones específicas por sección
├── parallax.ts                 ← NUEVO: efectos parallax
└── text-animations.ts          ← NUEVO: SplitText wrappers reutilizables
```

### Pattern

```typescript
// text-animations.ts
export function animateSectionTitle(element: string, trigger: string) {
  const split = new SplitText(element, { type: 'words' });
  
  gsap.from(split.words, {
    opacity: 0,
    y: 30,
    stagger: 0.05,
    duration: 0.6,
    ease: 'power3.out',
    scrollTrigger: {
      trigger,
      start: 'top 80%',
      toggleActions: 'play none none reverse',
    },
  });
}
```

---

## 6. Criterios de Aceptación

- [ ] ScrollSmoother activo en desktop, desactivado en mobile
- [ ] Todos los títulos de sección usan SplitText
- [ ] Feature cards se revelan con stagger al scroll
- [ ] Agent cards entran desde lados alternados
- [ ] Roadmap timeline se dibuja progresivamente
- [ ] Parallax visible en hero background
- [ ] 60fps en desktop (medido con Chrome DevTools Performance)
- [ ] No layout shift al activar/desactivar animaciones
- [ ] Animaciones se revierten correctamente al salir del viewport
- [ ] `prefers-reduced-motion` respetado: animaciones deshabilitadas

---

## 7. Riesgo: Accesibilidad

`prefers-reduced-motion: reduce` debe desactivar:
- ScrollSmoother
- SplitText animations (mostrar texto directamente)
- Parallax
- Scrub effects

Mantener: fade-in básico de secciones (más sutil).

```typescript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion) {
  // Initialize all scroll animations
}
```
