# PRD-LP-003: Hero Section

**Estado**: ✅ Completado (2026-04-03)
**Fase**: 1 (Core Sections)
**Dependencias**: LP-001 (foundation), LP-002 (content)
**Bloquea**: LP-006 (scroll animations), LP-008 (remotion)

---

## 1. Objetivo

Construir el hero section de la landing page — la primera impresión del producto. Debe comunicar inmediatamente QUÉ es MyWorkMate, POR QUÉ importa, y guiar al usuario hacia la waitlist. Visualmente impactante con animaciones GSAP de entrada.

---

## 2. Estructura Visual

```
┌─────────────────────────────────────────────────────────────┐
│  [Header — sticky, from LP-001]                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│     [Badge: "AI-Powered Business Automation"]               │
│                                                             │
│     Your Business Runs on Data.                             │
│     Let AI Run With It.                ← SplitText animate  │
│                                                             │
│     [Subtitle — fade in with delay]                         │
│                                                             │
│     [CTA Primary]  [CTA Secondary]     ← staggered entry   │
│                                                             │
│     ┌──────┐  ┌──────┐  ┌──────┐                           │
│     │  5   │  │  3+  │  │  10  │       ← counter animate   │
│     │Agents│  │Integr│  │Charts│                            │
│     └──────┘  └──────┘  └──────┘                           │
│                                                             │
│  ┌───────────────────────────────────┐                      │
│  │                                   │                      │
│  │   [Chameleon Placeholder /        │   ← Espacio          │
│  │    Product Visual / Abstract      │     reservado para    │
│  │    Animation]                     │     LP-007 o visual   │
│  │                                   │                      │
│  └───────────────────────────────────┘                      │
│                                                             │
│  "Built for the Microsoft Ecosystem"                        │
│  [Microsoft logo badges: BC, OneDrive, SharePoint]          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Especificaciones

### 3.1 Layout

- Full viewport height (`min-h-screen`)
- Centrado vertical y horizontal
- Max-width container para contenido (`max-w-6xl`)
- Responsive: stack vertical en mobile, layout flexible en desktop

### 3.2 Componentes

```
frontend/src/domains/marketing/components/hero/
├── HeroSection.tsx           ← Container principal
├── HeroBadge.tsx             ← Pill animado "AI-Powered..."
├── HeroHeadline.tsx          ← Título con SplitText
├── HeroSubtitle.tsx          ← Subtítulo con fade-in
├── HeroCTA.tsx               ← Botones de acción
├── HeroStats.tsx             ← Contadores animados
├── HeroVisual.tsx            ← Placeholder para camaleón / visual
├── HeroMicrosoftBadges.tsx   ← Logos de Microsoft ecosystem
└── HeroBackground.tsx        ← Gradiente / efecto de fondo
```

### 3.3 Animaciones GSAP (entrada)

| Elemento | Animación | Timing |
|---|---|---|
| Badge | Fade in + slide down | 0.0s |
| Headline | SplitText word-by-word reveal | 0.2s |
| Subtitle | Fade in + slide up | 0.8s |
| CTA buttons | Stagger fade in from bottom | 1.0s |
| Stats counters | Count-up animation | 1.2s |
| Visual area | Scale in with spring | 1.4s |
| Microsoft badges | Stagger fade in | 1.6s |

**Timeline GSAP**:
```typescript
const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

tl.from('.hero-badge', { opacity: 0, y: -20, duration: 0.6 })
  .from('.hero-headline', { /* SplitText */ }, '-=0.3')
  .from('.hero-subtitle', { opacity: 0, y: 20, duration: 0.6 }, '-=0.2')
  .from('.hero-cta > *', { opacity: 0, y: 30, stagger: 0.15 }, '-=0.3')
  .from('.hero-stats > *', { opacity: 0, y: 20, stagger: 0.1 }, '-=0.2')
  .from('.hero-visual', { opacity: 0, scale: 0.95, duration: 0.8 }, '-=0.3')
  .from('.hero-badges > *', { opacity: 0, x: -20, stagger: 0.1 }, '-=0.4');
```

### 3.4 Background

- Gradiente radial sutil desde `--marketing-hero-gradient-start` a transparent
- Opción: grid pattern o noise texture muy sutil
- Dark mode: gradiente más tenue, fondo oscuro
- NO debe competir con el contenido

### 3.5 Hero Visual / Chameleon Placeholder

**Fase actual**: Placeholder visual. Opciones para el placeholder:
1. Abstract animated gradient blob (GSAP morphing shapes)
2. Stylized screenshot/mockup del producto (si existe)
3. Silueta del camaleón con efecto de partículas

**Fase futura (LP-007)**: Reemplazar con frames del camaleón animado.

El contenedor debe tener aspect-ratio definido y dimensiones fijas para evitar layout shift cuando se integre el contenido real.

### 3.6 Microsoft Ecosystem Badges

Logos/iconos de:
- Microsoft Dynamics 365 Business Central (color: `#0078D4`)
- OneDrive (color: `#0078D4`)
- SharePoint (color: `#038387`)

Opciones: SVG icons propios o badges con texto. NO usar logos oficiales de Microsoft sin permiso — crear representaciones abstractas o usar solo texto.

### 3.7 Responsive

| Breakpoint | Cambios |
|---|---|
| Mobile (`< 640px`) | Stack vertical, headline más pequeño, 1 CTA, stats en row scroll |
| Tablet (`640-1024px`) | 2 columnas (content + visual), ambos CTAs |
| Desktop (`> 1024px`) | Layout completo como el wireframe |

---

## 4. Criterios de Aceptación

- [x] Hero ocupa viewport completo al cargar la página
- [x] Headline se anima con SplitText word-by-word
- [x] Stats counters se animan (0 → valor final)
- [x] CTA "Get Early Access" scrollea a la sección waitlist
- [x] CTA "See How It Works" scrollea a la sección features
- [x] Visual placeholder tiene dimensiones definidas (sin layout shift)
- [x] Responsive en mobile, tablet, desktop
- [x] Dark mode funcional
- [x] Todas las strings vienen de i18n (`useTranslations('Marketing.hero')`)
- [x] Performance: animaciones a 60fps

---

## 5. Archivos Nuevos

- `frontend/src/domains/marketing/components/hero/HeroSection.tsx`
- `frontend/src/domains/marketing/components/hero/HeroBadge.tsx`
- `frontend/src/domains/marketing/components/hero/HeroHeadline.tsx`
- `frontend/src/domains/marketing/components/hero/HeroSubtitle.tsx`
- `frontend/src/domains/marketing/components/hero/HeroCTA.tsx`
- `frontend/src/domains/marketing/components/hero/HeroStats.tsx`
- `frontend/src/domains/marketing/components/hero/HeroVisual.tsx`
- `frontend/src/domains/marketing/components/hero/HeroMicrosoftBadges.tsx`
- `frontend/src/domains/marketing/components/hero/HeroBackground.tsx`

---

## 6. Notas de Implementación (2026-04-03)

### Arquitectura

- **Single `'use client'` boundary**: `HeroSection` es el único componente con `useTranslations` y `useGSAP`. Los 8 hijos son presentacionales puros que reciben strings como props.
- **Container-presentational pattern**: HeroSection lee i18n, construye el array de stats, y orquesta el GSAP timeline.

### Archivos Modificados

- `frontend/src/domains/marketing/animations/gsap-config.ts` — Agregado `SplitText` al registro de plugins
- `frontend/src/domains/marketing/hooks/useScrollAnimation.ts` — Agregado `SplitText` al re-export
- `frontend/app/[locale]/(marketing)/page.tsx` — Stub de hero reemplazado con `<HeroSection />`

### Decisiones Técnicas

1. **SplitText type: 'words'** (no 'chars') — reveal por palabras, más legible y menos costoso en DOM
2. **`.to()` pattern** en vez de `.from()` — `gsap.set()` establece estados iniciales, timeline anima hacia el estado final
3. **Gradient blob como visual placeholder** — CSS + GSAP loops independientes del timeline principal
4. **Text badges** para Microsoft ecosystem — sin logos oficiales, colores de marca inline
5. **`parseStat()`** en HeroStats — extrae parte numérica y sufijo de strings como `"3+"` para count-up

### Gotchas Descubiertos

1. **Path alias**: `@/src/domains/marketing/...` (con `src/`), NO `@/domains/marketing/...`. El tsconfig mapea `@/*` → `frontend/*`.
2. **React 19**: No existe `JSX` global namespace — omitir tipos de retorno `JSX.Element` explícitos.
3. **`split.revert()`**: Obligatorio en cleanup de `useGSAP`. El hook limpia tweens automáticamente pero NO las mutaciones DOM de SplitText.

### Impacto en PRDs Futuros

- **LP-006**: ScrollTrigger ya registrado. Hero sections tienen clases GSAP estables para scroll animations.
- **LP-007**: `HeroVisual` tiene `aspect-ratio: 16/10` fijo — reemplazar contenido sin layout shift.
- **LP-008**: Hero visual puede ser target de Remotion overlay.
