# Landing Page — Master Plan

**Proyecto**: MyWorkMate Landing Page
**Estado**: Planificación
**Inicio**: 2026-04-03
**Metodología**: Spec-Driven Development (SDD) con PRDs por fase

---

## 1. Vision

Crear una landing page de alto impacto para MyWorkMate que:
- Demuestre capacidad técnica y diseño moderno (la landing ES el primer producto que el usuario ve)
- Comunique la propuesta de valor: automatización de negocios con AI agents conectados a Microsoft ecosystem
- Genere conversiones via waitlist (campaña de expectativa)
- Muestre lo que YA existe y lo que VIENE (roadmap como herramienta de marketing)
- Tenga identidad visual propia: camaleón robótico como mascota, colores de agentes, animaciones cinematográficas

---

## 2. Decisiones de Arquitectura

### 2.1 Stack Técnico

| Tecnología | Versión | Rol |
|---|---|---|
| Next.js | 16.x | Framework (App Router) |
| React | 19.x | UI |
| GSAP | latest | **Todas** las animaciones (free, incluye plugins premium) |
| @gsap/react | latest | Hook `useGSAP` para integración React |
| Tailwind CSS | 4.x | Estilos |
| shadcn/ui | new-york | Componentes base |
| next-intl | 4.8.3 | Internacionalización |
| Geist / Geist Mono | — | Tipografía |
| Remotion | (deferred) | Video programático (Fase 3) |

### 2.2 Routing

**Estrategia: i18n solo para marketing** (el portal autenticado NO se toca).

```
frontend/app/
├── [locale]/                  ← NUEVO: solo marketing
│   └── (marketing)/
│       ├── layout.tsx         ← Layout público (sin auth, sin onboarding)
│       └── page.tsx           ← Landing page
├── layout.tsx                 ← Root layout existente (fonts, theme)
├── (authenticated)/           ← App existente (sin cambios)
│   └── ...
└── ...
```

**Middleware**: Intercepta solo rutas de marketing (`/en/`, `/es/`, `/da/`). Las rutas del portal (`/chat`, `/files`, etc.) pasan sin modificar.

### 2.3 Screaming Architecture

```
frontend/src/domains/marketing/
├── components/
│   ├── hero/                  ← Hero section
│   ├── features/              ← Agent showcase + capabilities
│   ├── roadmap/               ← Coming soon timeline
│   ├── pricing/               ← Pricing tiers (hidden initially)
│   ├── waitlist/              ← Email capture form
│   ├── chameleon/             ← Mascot animation section
│   └── shared/                ← Header, Footer, LanguageSwitcher
├── hooks/                     ← GSAP wrappers, form hooks
├── content/                   ← Re-exports de agent constants
└── animations/                ← GSAP configs, scroll triggers, chameleon frames
```

### 2.4 Design Tokens

Extiende el tema existente del portal. Reutiliza:
- **Primary**: `hsl(221.2 83.2% 53.3%)` — BC Blue
- **Agent colors**: `#3B82F6` (BC), `#10B981` (RAG), `#8B5CF6` (Supervisor), `#F59E0B` (Graphing), `#6366F1` (Research)
- **Fonts**: Geist Sans + Geist Mono
- **Dark mode**: Soportado via `next-themes` (ya configurado)

Agrega tokens específicos de marketing (gradientes hero, glow effects, etc.) en `globals.css` bajo un scope de clase o variables dedicadas.

### 2.5 21st.dev

Usado como **referencia e inspiración**, no copy-paste. Estudiamos sus patterns (spotlight effects, bento grids, gradient CTAs) y recreamos con GSAP + identidad propia.

---

## 3. Fases y PRDs

### Fase 0: Foundation (paralelo)

| PRD | Nombre | Estado | Descripción |
|---|---|---|---|
| [PRD-LP-001](./PRD-LP-001-foundation.md) | Foundation & Layout | ✅ 2026-04-03 | Route group, GSAP setup, i18n routing, design tokens, header/footer/nav, language switcher |
| [PRD-LP-002](./PRD-LP-002-content-strategy.md) | Content Strategy | ✅ 2026-04-03 | i18n keys en `en.json` (~200 keys), namespace migration, generateMetadata, marketing-flags.ts, es/da stubs |

### Fase 1: Core Sections (secuencial)

| PRD | Nombre | Deps | Estado |
|---|---|---|---|
| [PRD-LP-003](./PRD-LP-003-hero-section.md) | Hero Section | LP-001, LP-002 | ✅ 2026-04-03 |
| [PRD-LP-004](./PRD-LP-004-features-agents.md) | Features & Agents | LP-001, LP-002 | ✅ 2026-04-03 |
| [PRD-LP-005](./PRD-LP-005-roadmap-waitlist.md) | Roadmap + Waitlist | LP-001, LP-002 | ✅ 2026-04-03 |

### Fase 2: Polish & Enhancement

| PRD | Nombre | Deps |
|---|---|---|
| [PRD-LP-006](./PRD-LP-006-scroll-animations.md) | Scroll Animations | LP-003, LP-004, LP-005 |
| [PRD-LP-007](./PRD-LP-007-chameleon.md) | Chameleon Animation | LP-006 + assets |
| [PRD-LP-007b](./PRD-LP-007b-pricing.md) | Pricing (Hidden) | LP-004 |

### Fase 3: Deferred (Documented)

| PRD | Nombre | Deps |
|---|---|---|
| [PRD-LP-008](./PRD-LP-008-remotion.md) | Remotion Pipeline | LP-003 |
| [PRD-LP-009](./PRD-LP-009-interactive-demo.md) | Interactive Demo | LP-008 |
| [PRD-LP-010](./PRD-LP-010-translations.md) | Translations (es, da) | LP-002 |

### Dependency Graph

```
LP-001 ──┬──→ LP-003 ──┬──→ LP-006 ──→ LP-007 (chameleon)
         │             │
LP-002 ──┤   LP-004 ──┤   LP-007b (pricing)
         │             │
         └── LP-005 ──┘
         
LP-003 ──→ LP-008 (remotion) ──→ LP-009 (demo)
LP-002 ──→ LP-010 (translations)
```

---

## 4. Waitlist Backend Strategy

**Fase actual**: Frontend completo con formulario funcional. El submit lanza un `UnimplementedError` intencionalmente como recordatorio.

**Fase futura** (PRD por crear):
1. Investigación de proveedores (Mailchimp, Resend, ConvertKit, Loops, etc.)
2. Comparativa de features, pricing, y developer experience
3. Decisión de proveedor
4. Implementación: API endpoint + integración con servicio seleccionado

---

## 5. Chameleon Mascot Pipeline

**Estado**: Imagen preliminar generada. Video de prueba generado. Ambos requieren iteración.

### Pipeline de Producción

```
Paso 1: Imagen definitiva
├── Tool: Nano Banana Pro 2
├── Estilo: Camaleón robótico/futurista
└── Criterio: Coherente con branding MyWorkMate

Paso 2: Generación de video
├── Tool: VO3 / Higsfield
├── Secuencia:
│   ├── Camaleón camina
│   ├── Ilumina en colores de cada agente (secuencial)
│   │   ├── #3B82F6 → BC Agent (blue)
│   │   ├── #10B981 → RAG Agent (green)
│   │   ├── #8B5CF6 → Supervisor (violet)
│   │   ├── #F59E0B → Graphing (amber)
│   │   └── #6366F1 → Research (indigo)
│   └── Transición multicolor final (adaptabilidad)
└── Iteraciones: Múltiples generaciones hasta calidad óptima

Paso 3: Extracción de frames
├── Tool: ffmpeg
├── Output: PNG sequence (transparent background ideal)
└── Optimización: WebP para web, resolución 2x para retina

Paso 4: Integración web (PRD-LP-007)
├── GSAP ScrollTrigger
├── Canvas element o img swap frame-by-frame
├── Vinculado al scroll position
└── Transiciones de color sincronizadas con secciones de agentes
```

**Nota**: En Fase 1, la sección del camaleón se construye como placeholder con dimensiones y layout definidos. La integración real ocurre en Fase 2 cuando los assets estén listos.

---

## 6. SEO & Performance Goals

- **Lighthouse**: 90+ en todas las categorías
- **Core Web Vitals**: LCP < 2.5s, FID < 100ms, CLS < 0.1
- **SEO**: Meta tags, OG images, alternate links por locale, sitemap.xml
- **Accesibilidad**: WCAG 2.1 AA mínimo
- **Bundle**: GSAP tree-shake (solo plugins usados), lazy load secciones below-the-fold

---

## 7. Skills Relevantes

| Skill | Uso |
|---|---|
| `frontend-design` | Lineamientos de diseño de alta calidad, anti-generic-AI |
| `nextjs-best-practices` | App Router patterns, `(marketing)/` route group |
| `ui-ux-pro-max` | Paletas de color, font pairings, UX guidelines |
| `prompt-engineering` | Generación de assets con Nano Banana / VO3 |

---

## 8. Contenido del Producto (Source of Truth)

### Agentes (de `@bc-agent/shared`)

| Agente | Nombre | Color | Descripción |
|---|---|---|---|
| 📊 | Business Central Expert | `#3B82F6` | Specialist in Microsoft Business Central ERP. Queries customers, vendors, invoices, sales orders, inventory. |
| 🧠 | Knowledge Base Expert | `#10B981` | Searches and analyzes uploaded documents using semantic search. |
| 🎯 | Orchestrator | `#8B5CF6` | Automatically routes questions to the best specialist agent. |
| 📈 | Data Visualization Expert | `#F59E0B` | Creates charts, dashboards from structured data. Bar, line, area, donut, combo, KPIs. |
| 🔬 | Research & Analysis | `#6366F1` | Web research, data analysis, code execution, document generation. |

### Pricing (preliminar, de 99-FUTURE-DEVELOPMENT.md)

| Plan | Precio | Perfil |
|---|---|---|
| Free | $0/mes | Exploración, pruebas |
| Starter | ~$20-30/mes | Usuarios regulares / PyMEs |
| Professional | ~$200/mes | Power users, empresas medianas |

### Features Actuales vs Coming Soon

**Actuales**:
- Portal web con chat AI
- Agente Business Central (queries + mutations)
- Knowledge Base con RAG (upload, semantic search)
- Multi-agent orchestration (supervisor routing)
- Data visualization (10 chart types)
- Research agent (web search + code execution)
- Microsoft OAuth authentication
- File management (OneDrive/SharePoint sync)

**Coming Soon**:
- Aplicación móvil
- Permisos granulares (always-allow vs require-approval)
- Memory y contexto persistente
- Paralelismo de agentes y tareas background
- Workflows automatizados (event-driven / command-driven)
- Agentes custom creados por el usuario (MCP / skills)
- Environments para organizaciones
- Billing y usage tracking
- Compliance: regulaciones europeas (GDPR)
- Deep Research mode
- Artifacts UI

---

## 9. Protocolo de Colaboración

### 9.1 Mentalidad: Owner Integrado

El owner del producto (Juan) NO es un receptor pasivo de entregas. Es un participante activo en cada decisión. El workflow de cada PRD sigue este ciclo:

```
ANTES de implementar cada PRD:
┌─────────────────────────────────────────────────────────────┐
│  1. CONTEXTO: ¿Qué se va a hacer y por qué?                │
│     - Qué PRD se está ejecutando                            │
│     - Qué entrega produce                                   │
│     - Cómo encaja en el plan general                        │
│                                                              │
│  2. IMPACTO: ¿Qué afecta?                                  │
│     - Qué archivos se crean o modifican                     │
│     - Qué funcionalidades existentes podrían verse afectadas│
│     - Qué dependencias técnicas se introducen               │
│                                                              │
│  3. DECISIONES: ¿Qué está resuelto y qué no?               │
│     - Decisiones YA tomadas (con referencia a dónde)        │
│     - Decisiones pendientes que necesitan input del owner   │
│     - Alternativas con tradeoffs claros                     │
│                                                              │
│  4. PRERREQUISITOS: ¿Qué necesito del owner?                │
│     - Assets que deben estar listos                         │
│     - Aprobaciones necesarias                               │
│     - Tareas que solo el owner puede hacer                  │
│                                                              │
│  5. VALIDACIÓN: ¿Cómo verificamos juntos?                   │
│     - Criterios de aceptación del PRD                       │
│     - Puntos de checkpoint durante la implementación        │
│     - Review final antes de marcar como completado          │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Principios de Decisión del Owner

Extraídos de las decisiones tomadas durante la planificación. Estos principios guían futuras decisiones:

**P1: Identidad propia > Velocidad de entrega**
- No copy-paste de componentes genéricos (21st.dev = referencia, no fuente)
- La landing ES el primer producto — debe demostrar capacidad
- Recrear patterns con nuestro stack (GSAP) y nuestra identidad visual

**P2: Funcionalidad completa en frontend, integración diferida en backend**
- El formulario de waitlist se construye COMPLETO (diseño, validación, estados)
- El backend lanza `UnimplementedError` como recordatorio explícito
- La integración con servicios externos requiere investigación independiente antes de decidir

**P3: Documentar todo, implementar por fases**
- Todo feature futuro queda documentado en un PRD aunque sea diferido
- Nada se implementa "a medias" — cada PRD produce un entregable funcional
- Lo diferido tiene un path claro de activación (feature flags, PRDs pendientes)

**P4: No tocar lo que funciona**
- i18n solo para marketing, portal autenticado sin cambios
- Middleware diseñado para NO interceptar rutas existentes
- Extensión de tokens, no reemplazo

**P5: Stack unificado > Poder individual**
- Full GSAP (no GSAP + Motion.dev) = un solo modelo mental
- Un solo sistema de i18n (next-intl), no fragmentación
- Consistencia entre el portal y la landing (mismos fonts, base colors, shadcn)

**P6: Preparar el terreno para el futuro sin construirlo ahora**
- Placeholder del camaleón con dimensiones fijas (sin layout shift cuando se integre)
- Pricing diseñado pero oculto (feature flag)
- Remotion documentado pero no instalado
- i18n keys desde day 1, traducciones después

**P7: El owner decide sobre marca, contenido, y dirección creativa**
- Copy, precios, legal, branding = decisiones del owner
- Patterns técnicos, implementación, optimización = decisiones del desarrollador
- Diseño visual = decisión conjunta (propuesta técnica + aprobación del owner)

### 9.3 Reglas de Comunicación

1. **Nunca empezar un PRD sin el briefing de contexto** (sección 9.1)
2. **Preguntar siempre, nunca asumir** en decisiones de contenido o marca
3. **Proponer alternativas con tradeoffs** cuando haya más de un camino
4. **Mostrar resultados intermedios** — no esperar al final para validar
5. **Marcar explícitamente** qué es decisión técnica (ya tomada) vs decisión del owner (pendiente)

---

## 10. Lecciones de Implementación

### LP-001 (2026-04-03)

**Correcciones al plan original:**

1. **Layout standalone → nested**: Next.js App Router solo permite un root layout con `<html>`/`<body>`. El marketing layout es nested, no standalone. Se usa `HtmlLangSync` (client component con useEffect) para sincronizar `<html lang>` dinámicamente.

2. **AuthProvider como gatekeeper**: El root layout envuelve TODO con AuthProvider, que redirige a `/login` si no está autenticado. Las rutas marketing necesitan ser marcadas como públicas explícitamente via regex.

3. **next-intl v4 requiere `createNavigation`**: Para hooks de navegación client-side (useRouter, usePathname) se necesita crear helpers via `createNavigation(routing)` en un archivo dedicado (`i18n/navigation.ts`).

4. **GSAP: registro mínimo**: Solo registrar los plugins que se usan inmediatamente (ScrollTrigger). Los premium (SplitText, ScrollSmoother) se agregan en LP-006 cuando se activen.

**Impacto en PRDs futuros:**
- LP-003+: Los componentes de sección se renderizan dentro del marketing layout nested. No necesitan providers propios.
- LP-006: ScrollSmoother divs ya están en el layout (`#smooth-wrapper`, `#smooth-content`). Solo necesita activar el JS.
- LP-007: Canvas/img para chameleon va dentro de `#smooth-content`.

### LP-002 (2026-04-03)

**Correcciones al plan original:**

1. **Namespace case collision**: LP-001 creó las keys bajo `marketing` (lowercase) pero el PRD especificaba `Marketing` (PascalCase). Se migró todo a `Marketing` en un commit atómico (3 JSONs + 3 componentes).

2. **`comingSoon` booleans no van en JSON**: next-intl trata todos los valores como strings. Los booleans (`comingSoon: true` en security items) y arrays (`features` en pricing plans) se movieron a `marketing-flags.ts` como constantes TypeScript con `as const`.

3. **`generateMetadata` requiere `params` como Promise**: En Next.js 16, `params` es `Promise<{ locale: string }>` — requiere `await params` antes de acceder al locale.

4. **Stubs es/da con prefijo visual**: En vez de copiar el inglés tal cual, se prefijaron los strings con `[ES]`/`[DA]` para hacer visualmente obvio qué está sin traducir durante desarrollo.

5. **MarketingFooter key paths rotos**: El componente de LP-001 usaba paths planos (`t('privacy')`) que no coincidían con la nueva estructura nested (`sections.legal.links.privacy`). Corregido en commit separado.

**Impacto en PRDs futuros:**
- LP-003+: Usar `useTranslations('Marketing.hero')` → `t('title')`, `t('subtitle')`, etc.
- LP-004: Agents en `Marketing.agents.items.*`, features en `Marketing.features.items.*`
- LP-005: Roadmap items en `Marketing.roadmap.items.*`, status es string que mapea a `statusLabels.*`
- LP-007b: Pricing features NO están en JSON — importar `PLAN_FEATURES` de `marketing/content`
- LP-010: Reemplazar strings con `[ES]`/`[DA]` prefix por traducciones reales

### LP-004 (2026-04-03)

**Correcciones al plan original:**

1. **Bento grid en vez de highlighted+grid**: El PRD proponía 2 agent cards full-width + 3 en grid. El owner prefirió un bento grid asimétrico: Orchestrator (2 cols, 2 rows), KB y DataViz (1x1 cada uno), BC Expert (1x1), Research (2 cols). Más visualmente interesante.

2. **Coming Soon removido**: El PRD incluía badges "Coming Soon" en permissions y GDPR. El owner decidió presentar todas las features como habilitadas — es la promesa de lanzamiento.

3. **SplitText en todas las secciones**: El PRD original solo usaba SplitText en el hero. Se unificó el patrón: FeaturesSection, AgentsSection, y SecuritySection ahora usan SplitText para títulos con la misma animación.

4. **Descender clipping fix**: SplitText envuelve palabras en `overflow-hidden`, lo cual corta descenders (g, y, p). Se agregó `pb-[0.15em]` a las word classes en HeroSection, FeaturesSection, AgentsSection y SecuritySection.

5. **"Charts on Demand"**: El highlight de Data Visualization cambió de "10 Chart Types" a "Charts on Demand" por decisión del owner.

6. **Container-presentational pattern**: Los componentes leaf (FeatureCard, AgentCard, SecurityBadge) son presentacionales puros — no usan `useTranslations`. Los containers resuelven las props y las pasan. Esto facilita testing y reutilización.

7. **GSAP hover listeners con cleanup**: Los event listeners de hover en AgentsSection se registran en el scope de `useGSAP` y se limpian explícitamente en el return del cleanup.

**Archivos creados:**
- `frontend/src/domains/marketing/components/features/ComingSoonBadge.tsx` — CSS @keyframes pulse
- `frontend/src/domains/marketing/components/features/FeatureCard.tsx` — Lucide icon, CSS hover
- `frontend/src/domains/marketing/components/features/AgentCard.tsx` — color accent, bento-ready h-full
- `frontend/src/domains/marketing/components/features/SecurityBadge.tsx` — shield icon, ComingSoon conditional
- `frontend/src/domains/marketing/components/features/SecuritySection.tsx` — own useGSAP, SplitText, 3-col grid
- `frontend/src/domains/marketing/components/features/FeaturesSection.tsx` — SplitText, 6-card grid, renders SecuritySection
- `frontend/src/domains/marketing/components/features/AgentsSection.tsx` — bento grid, GSAP hover glows, SplitText

**Archivos modificados:**
- `frontend/app/[locale]/(marketing)/page.tsx` — stubs reemplazados por componentes reales
- `frontend/app/globals.css` — `@keyframes coming-soon-pulse`
- `frontend/src/domains/marketing/content/marketing-flags.ts` — `COMING_SOON_FEATURES = {}`
- `frontend/src/domains/marketing/components/hero/HeroSection.tsx` — `pb-[0.15em]` fix
- `frontend/messages/en.json` — "Charts on Demand"
- `frontend/messages/es.json` — "[ES] Charts on Demand"
- `frontend/messages/da.json` — "[DA] Charts on Demand"

**Impacto en PRDs futuros:**
- LP-005: Seguir el mismo patrón de animaciones (SplitText title, fade-up stagger, ScrollTrigger once:true)
- LP-006: ScrollSmoother se activa sin cambios — las secciones ya tienen IDs y están dentro de `#smooth-content`
- LP-007: Las secciones de agentes tienen `id="agents"` para chameleon color sync
- LP-007b: ComingSoonBadge reutilizable si se necesita en pricing

### lp-foundation-gaps batch (2026-04-03)

Batch de corrección que resolvió 13 gaps huérfanos identificados en la auditoría post LP-001/LP-002/LP-003.

**Archivos creados:**
- `frontend/app/robots.ts` — robots.txt generation
- `frontend/app/sitemap.ts` — sitemap.xml con hreflang para 3 locales + legal pages
- `frontend/src/domains/marketing/content/agents.ts` — re-exports de `@bc-agent/shared`
- `frontend/app/[locale]/(marketing)/privacy/page.tsx` — placeholder
- `frontend/app/[locale]/(marketing)/terms/page.tsx` — placeholder

**Archivos modificados:**
- `frontend/app/[locale]/(marketing)/layout.tsx` — metadata completa (og:url, og:locale, Twitter Cards, canonical, JSON-LD Organization)
- `frontend/app/[locale]/(marketing)/page.tsx` — JSON-LD SoftwareApplication, #agents stub section
- `frontend/src/domains/marketing/components/shared/MarketingFooter.tsx` — `Link` de next-intl en vez de `<a href="#">`
- `frontend/src/domains/marketing/content/index.ts` — barrel export de agents
- `frontend/messages/en.json` — `Marketing.legal` namespace
- `frontend/messages/es.json` — `Marketing.legal` namespace con `[ES]` prefix
- `frontend/messages/da.json` — `Marketing.legal` namespace con `[DA]` prefix

**Impacto en PRDs futuros:**
- LP-004: `agents.ts` y `AGENT_I18N_KEY_MAP` listos para consumir. Section `#agents` ya tiene stub.
- LP-006: JSON-LD no necesita tocarse a menos que se quieran agregar más schemas (BreadcrumbList, etc.)
- Owner: Proveer OG image (1200×630), contenido legal, y social links cuando estén listos

### LP-005 (2026-04-03)

**Correcciones al plan original:**

1. **ScrollTrigger import no necesario explícitamente**: `gsap-config.ts` registra ScrollTrigger globalmente al importar el barrel `useScrollAnimation`. FeaturesSection y AgentsSection tampoco lo importan explícitamente. Importar `ScrollTrigger` como named import causa warnings de ESLint (`no-unused-vars`). Solución: no importar, confiar en el registro global.

2. **`'All'` filter label necesita i18n**: El PRD no especificaba i18n para el label "All" del filtro. Se agregó `statusLabels.all` a los 3 JSONs (en/es/da) y se reemplazó el string hardcoded por `t('statusLabels.all')`.

3. **Simplificación de componentes**: El PRD proponía `WaitlistSuccess.tsx` y `WaitlistError.tsx` como archivos separados. Se simplificó: los estados de éxito/error son inline dentro de `WaitlistForm.tsx` (~80 líneas total). Menos indirección, misma funcionalidad.

4. **RoadmapFilter sin `beta`**: El PRD incluía 4 status (live, beta, development, planned) pero no hay items beta en los datos. El filtro solo muestra `[All, Live, In Development, Planned]` — beta se agrega automáticamente si se añaden items beta a `ROADMAP_ITEMS`.

5. **`useWaitlist` hook con sentinels de i18n**: El hook retorna keys de i18n como sentinels (`'form.error.unimplemented'` o `'form.error.message'`), NO strings traducidos. Esto mantiene el hook testeable sin mocking de next-intl. `WaitlistForm` resuelve los sentinels a texto traducido.

**Archivos creados:**
- `frontend/src/domains/marketing/components/roadmap/StatusBadge.tsx` — 4-state badge (live/beta/dev/planned)
- `frontend/src/domains/marketing/components/roadmap/RoadmapItem.tsx` — timeline entry con dot + connector
- `frontend/src/domains/marketing/components/roadmap/RoadmapFilter.tsx` — tablist filter (All/Live/Dev/Planned)
- `frontend/src/domains/marketing/components/roadmap/RoadmapTimeline.tsx` — vertical timeline + line div
- `frontend/src/domains/marketing/components/roadmap/RoadmapSection.tsx` — container, GSAP, filter state
- `frontend/src/domains/marketing/components/waitlist/WaitlistBenefits.tsx` — 4 benefit badges (Zap/Tag/Bell/MessageSquare)
- `frontend/src/domains/marketing/components/waitlist/WaitlistForm.tsx` — email form + inline success/error states
- `frontend/src/domains/marketing/components/waitlist/WaitlistSection.tsx` — container, GSAP, social proof count
- `frontend/src/domains/marketing/hooks/useWaitlist.ts` — state machine (idle/submitting/success/error)
- `frontend/src/domains/marketing/errors/WaitlistUnimplementedError.ts` — custom error class

**Archivos modificados:**
- `frontend/app/[locale]/(marketing)/page.tsx` — stubs reemplazados, pricing stub preservado
- `frontend/src/domains/marketing/content/marketing-flags.ts` — `ROADMAP_ITEMS`, `ROADMAP_STATUS_COLORS`, `WAITLIST_ENABLED`, `WAITLIST_MOCK_COUNT`
- `frontend/src/domains/marketing/content/index.ts` — barrel re-exports
- `frontend/messages/en.json` — `statusLabels.all`
- `frontend/messages/es.json` — `statusLabels.all` con `[ES]` prefix
- `frontend/messages/da.json` — `statusLabels.all` con `[DA]` prefix

**Impacto en PRDs futuros:**
- LP-006: Ambas secciones tienen IDs (`#roadmap`, `#waitlist`) dentro de `#smooth-content`. ScrollSmoother se activa sin cambios.
- LP-007: Sección `#roadmap` tiene items con `data-status` para posible sync de colores con chameleon.
- LP-007b: Pricing stub preservado entre roadmap y waitlist — LP-007b solo reemplaza ese stub.
- Waitlist backend: Cuando se implemente, cambiar `WAITLIST_ENABLED = true` y agregar `fetch` real en `useWaitlist.ts` dentro del `try` block.
- LP-010: `statusLabels.all` ya tiene stubs `[ES]`/`[DA]` — traducir junto con el resto.

---

## 11. Auditoría de PRDs (2026-04-03)

### 10.1 Correcciones Aplicadas

#### Dependencias incompletas
- **LP-004** y **LP-005**: Agregan LP-001 como dependencia (necesitan GSAP config, design tokens, hooks). El dependency graph se actualiza.
- **LP-007b**: La dependencia con LP-004 es de ORDEN, no de código. Se aclara.

#### Dependency Graph Corregido

```
LP-001 ──┬──→ LP-003 ──┬──→ LP-006 ──→ LP-007 (chameleon)
         │             │
LP-002 ──┤             │
         │             │
LP-001 ──┼── LP-004 ──┤   LP-007b (pricing, orden: después de LP-004)
         │             │
LP-001 ──┼── LP-005 ──┘
         │
LP-003 ──→ LP-008 (remotion) ──→ LP-009 (demo)
LP-002 ──→ LP-010 (translations)
```

#### Middleware matcher (CRÍTICO)
El catch-all en el matcher de LP-001 interceptaría rutas del portal. **Corrección**: el matcher debe ser SOLO `['/(en|es|da)/:path*']` sin catch-all. Se agrega redirect de `/` → `/en/` por separado.

#### ScrollSmoother wrapper divs
LP-006 requiere `<div id="smooth-wrapper"><div id="smooth-content">` en el marketing layout. Se agrega a LP-001 como requisito del layout.

#### Canvas memory para chameleon
LP-007 estimaba ~50MB para 150 frames. Cada frame decodificado a 1920x1080 RGBA = ~8MB. 150 frames = ~1.2GB. **Corrección**: reducir a 60-80 frames con resolución 960x540 (~2MB/frame = ~120-160MB). Sprite sheet como alternativa preferida.

### 10.2 Gaps Identificados y Resolución

#### Resueltos — lp-foundation-gaps batch (2026-04-03)

| Gap | Severidad | Resolución |
|---|---|---|
| **robots.txt** | Media | ✅ Creado `frontend/app/robots.ts` — permite locales, bloquea rutas internas |
| **sitemap.xml** | Media | ✅ Creado `frontend/app/sitemap.ts` — 3 locales + legal pages con hreflang |
| **Twitter Cards** | Media | ✅ Agregado `twitter` a `generateMetadata` en layout.tsx |
| **Canonical link** | Media | ✅ Agregado `alternates.canonical` con URL absoluta por locale |
| **og:url** | Baja | ✅ Agregado `openGraph.url` con locale |
| **og:locale** | Baja | ✅ Mapping en→en_US, es→es_ES, da→da_DK |
| **JSON-LD Organization** | Media | ✅ Script en layout.tsx (schema.org/Organization) |
| **JSON-LD SoftwareApplication** | Media | ✅ Script en page.tsx con descripción i18n |
| **Legal pages** (privacy, terms) | Baja | ✅ Rutas placeholder creadas, contenido pendiente del owner |
| **Footer dead links** | Baja | ✅ `href="#"` → `Link` de next-intl apuntando a `/privacy`, `/terms` |
| **`agents.ts` content file** | Baja | ✅ Re-exports de `@bc-agent/shared` + `AGENT_I18N_KEY_MAP`. LP-004 lo consume |
| **#agents section stub** | Baja | ✅ `<section id="agents">` en page.tsx entre features y roadmap |
| **i18n legal keys** | Baja | ✅ `Marketing.legal.privacy/terms` en en/es/da.json |

#### Pendientes — con dueño asignado

| Gap | Severidad | Dueño | Notas |
|---|---|---|---|
| **OG image** | Media | Owner (asset) + LP-003 addendum | Requiere imagen 1200×630. Metadata ya soporta `openGraph.image` cuando se provea |
| **Section IDs para chameleon sync** | Baja | ✅ LP-004 | `id="features"` y `id="agents"` con `aria-label` en secciones reales |
| **DrawSVG checkmark en waitlist** | Baja | LP-006 | Animación de polish |
| **Lighthouse 90+** | Media | Post-LP-006 | Medición transversal, no un PRD específico. Medir después de Fase 2 |
| **Legal page content** | Baja | Owner | Placeholders listos, contenido real cuando el owner lo provea |
| **Social links (footer)** | Baja | Owner | Footer social section tiene href="#", requiere URLs reales |

### 10.3 Prerrequisitos del Owner

Tareas que SOLO el owner puede completar, organizadas por cuándo se necesitan:

#### Antes de Fase 1 (ahora / pronto)
| Tarea | Bloquea | Urgencia |
|---|---|---|
| Revisar y aprobar copy del hero (LP-002) | LP-003 | Alta |
| Revisar descripciones de agentes para marketing | LP-004 | Alta |
| Definir social links (Twitter, LinkedIn, etc.) | LP-001 footer | Baja |

#### Antes de Fase 2
| Tarea | Bloquea | Urgencia |
|---|---|---|
| Generar imagen final del camaleón (Nano Banana) | LP-007 | Alta |
| Generar video final del camaleón (VO3/Higsfield) | LP-007 | Alta |
| Extraer frames del video (ffmpeg) | LP-007 | Alta |
| Confirmar precios finales (Free/Starter/Pro) | LP-007b go-live | Media |
| Decidir placement del camaleón (floating/section/hero) | LP-007 | Media |

#### Antes de Fase 3
| Tarea | Bloquea | Urgencia |
|---|---|---|
| Seleccionar proveedor de waitlist email | Waitlist funcional | Alta |
| Proveer traducciones es/da (o aprobar AI-generated) | LP-010 | Media |
| Proveer contenido legal (privacy policy, terms) | Footer real | Baja |
| Decidir approach del interactive demo | LP-009 | Baja |
| Decidir sobre uso de logos Microsoft (legal) | LP-003 badges | Media |

### 10.4 Decisiones Ya Tomadas

| # | Decisión | Referencia | Dónde aplicar |
|---|---|---|---|
| D1 | Full GSAP, sin Motion.dev | Conversación + Master Plan 2.1 | Todo el proyecto |
| D2 | `(marketing)/` route group dentro del frontend | Conversación + Master Plan 2.2 | LP-001 |
| D3 | i18n solo para marketing, portal sin tocar | Conversación + Master Plan 2.2 | LP-001 middleware |
| D4 | i18n keys desde day 1, solo inglés inicialmente | Conversación + LP-002 | LP-002 |
| D5 | Ruta `/{locale}/` para landing | Conversación + LP-001 | LP-001 routing |
| D6 | 21st.dev como referencia, no copy-paste | Conversación + Master Plan 2.5 | Todo el proyecto |
| D7 | Waitlist frontend completo, backend `UnimplementedError` | Conversación + LP-005 | LP-005 |
| D8 | Remotion diferido a Fase 3 | Conversación + LP-008 | LP-008 |
| D9 | Roadmap en primera iteración (obligatorio) | Conversación + LP-005 | LP-005 |
| D10 | Pricing diseñado pero oculto con flag | Conversación + LP-007b | LP-007b |
| D11 | Timeline vertical para roadmap (no bento grid) | LP-005 2.2 | LP-005 |
| D12 | Naming PRD-LP-NNN | Conversación | Todos |
| D13 | LP-001 + LP-002 en paralelo, luego secuencial | Conversación | Ejecución |
| D14 | Agents en bento grid (no highlighted+grid) | LP-004 implementación | LP-004 |
| D15 | Coming Soon badges removidos de security (permissions, gdpr habilitados) | LP-004 owner decision | LP-004 |
| D16 | Agent colors via inline styles desde `AGENT_COLOR`, no CSS custom properties | LP-004 design | LP-004 |
| D17 | Animaciones consistentes: SplitText + fade-up stagger en todas las secciones | LP-004 owner decision | LP-004+ |
| D18 | Filter tabs incluidos en roadmap, default "All", sin tab "Beta" (no hay items beta) | LP-005 implementación | LP-005 |
| D19 | Inline form states en WaitlistForm (no archivos separados WaitlistSuccess/Error) | LP-005 propuesta | LP-005 |
| D20 | WAITLIST_MOCK_COUNT = 247 (número realista pre-lanzamiento) | LP-005 implementación | LP-005 |
| D21 | WAITLIST_ENABLED = false con WaitlistUnimplementedError graceful | LP-005 implementación | LP-005 |
| D22 | ROADMAP_ITEMS como array estático en marketing-flags.ts (status programático, no derivado de i18n) | LP-005 propuesta | LP-005 |
| D23 | useWaitlist retorna sentinels de i18n, no strings traducidos (testeable sin mocking next-intl) | LP-005 implementación | LP-005 |
| D24 | ScrollTrigger no se importa explícitamente — registro global via gsap-config.ts es suficiente | LP-005 verify | LP-005+ |

### 10.5 Decisiones Pendientes (Requieren Input del Owner)

| # | Decisión | Cuándo se necesita | PRD |
|---|---|---|---|
| P1 | Hero visual placeholder (gradient blob / mockup / silueta camaleón) | Al implementar LP-003 | LP-003 |
| P2 | Placement del camaleón (floating / section / hero) | Al implementar LP-007 | LP-007 |
| ~~P3~~ | ~~Roadmap filter~~ → D18: Incluido, default "All" | ✅ Resuelto LP-005 | LP-005 |
| P4 | Snap scrolling (activar / desactivar) | Al implementar LP-006 | LP-006 |
| P5 | Uso de logos Microsoft (legal) | Al implementar LP-003 | LP-003 |
| ~~P6~~ | ~~Waitlist counter inicial~~ → D20: WAITLIST_MOCK_COUNT = 247 | ✅ Resuelto LP-005 | LP-005 |
| P7 | Proveedor de email para waitlist | Antes de ir a producción | Future PRD |
| P8 | Precios finales | Antes de activar pricing flag | LP-007b |
| P9 | Approach del interactive demo | Antes de LP-009 | LP-009 |
| P10 | Idiomas adicionales post-launch | Post-launch | LP-010 |
