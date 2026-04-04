# PRD-LP-004: Features & Agents Showcase

**Estado**: ✅ Completado (2026-04-03)
**Fase**: 1 (Core Sections)
**Dependencias**: LP-001 (foundation, GSAP, design tokens), LP-002 (content)
**Bloquea**: LP-006 (scroll animations), LP-007b (pricing)

---

## 1. Objetivo

Presentar las capacidades del producto y los 5 agentes especializados. Dos secciones complementarias: "Features" muestra QUÉ puede hacer la plataforma, "Agents" muestra QUIÉN lo hace. Incluye también la sección de seguridad/compliance.

---

## 2. Secciones

### 2.1 Features (Capabilities)

**Estructura**: Grid de 6 feature cards.

```
┌─────────────────────────────────────────────────────┐
│  [Badge: "Platform Capabilities"]                    │
│  Everything Your Business Needs,                     │
│  One Conversation Away                               │
│                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ ERP     │  │Knowledge│  │  Smart  │              │
│  │ Intel.  │  │  Base   │  │  Orch.  │              │
│  └─────────┘  └─────────┘  └─────────┘             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │  Data   │  │Research │  │  Cloud  │              │
│  │  Viz    │  │& Analys │  │  Sync   │              │
│  └─────────┘  └─────────┘  └─────────┘             │
└─────────────────────────────────────────────────────┘
```

**Feature Card**:
- Icono representativo (Lucide icons)
- Título
- Descripción (2-3 líneas)
- Highlight badge (e.g., "Read & Write to Dynamics 365")
- Hover effect: glow/elevation sutil con GSAP

### 2.2 Agents Showcase

**Estructura**: Bento grid con cards de tamaño variable por importancia del agente.

```
┌─────────────────────────────────────────────────────┐
│  [Badge: "Meet Your AI Team"]                        │
│  Specialized Agents That Work Together               │
│                                                      │
│  ┌──────────────────────┬───────────────────────┐   │
│  │ 🎯 Orchestrator      │ 🧠 KB Expert          │   │
│  │ [color: #8B5CF6]     │ [color: #10B981]      │   │
│  │ (2 cols, 2 rows)     ├───────────────────────┤   │
│  │                      │ 📈 Data Viz Expert    │   │
│  │                      │ [color: #F59E0B]      │   │
│  ├───────────┬──────────┴───────────────────────┤   │
│  │ 📊 BC     │ 🔬 Research & Analysis           │   │
│  │ Expert    │ [color: #6366F1]                  │   │
│  │ [#3B82F6] │ (2 cols)                          │   │
│  └───────────┴──────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Agent Card**:
- Agent icon (emoji o custom SVG)
- Agent name
- Role subtitle
- Description
- Left border accent usando agent color
- Background: `rgba(agentColor, 0.05)` en light, `rgba(agentColor, 0.1)` en dark
- Hover: glow sutil en el color del agente

**Agent Colors** (de `@bc-agent/shared`):
| Agent | Color |
|---|---|
| Orchestrator | `#8B5CF6` |
| BC Expert | `#3B82F6` |
| KB Expert | `#10B981` |
| Data Viz | `#F59E0B` |
| Research | `#6366F1` |

### 2.3 Security & Compliance

**Estructura**: Grid compacto de badges de seguridad.

```
┌─────────────────────────────────────────────────────┐
│  [Badge: "Enterprise-Ready Security"]                │
│  Built for Businesses That Take Security Seriously   │
│                                                      │
│  ┌───────┐ ┌───────┐ ┌───────┐                     │
│  │Encrypt│ │Tenant │ │Permis.│                      │
│  │AES-256│ │Isolat.│ │ 🔜   │                      │
│  └───────┘ └───────┘ └───────┘                     │
│  ┌───────┐ ┌───────┐ ┌───────┐                     │
│  │ GDPR  │ │ Audit │ │  MS   │                      │
│  │  🔜   │ │ Trail │ │  SSO  │                      │
│  └───────┘ └───────┘ └───────┘                     │
└─────────────────────────────────────────────────────┘
```

Items marcados con `comingSoon: true` muestran un badge "Coming Soon".

---

## 3. Componentes

```
frontend/src/domains/marketing/components/features/
├── FeaturesSection.tsx        ← Container features
├── FeatureCard.tsx            ← Card individual
├── AgentsSection.tsx          ← Container agents
├── AgentCard.tsx              ← Card de agente con color
├── SecuritySection.tsx        ← Container security
├── SecurityBadge.tsx          ← Badge individual
└── ComingSoonBadge.tsx        ← Badge "Coming Soon" reutilizable
```

---

## 4. Animaciones GSAP (implementadas)

| Elemento | Animación | Trigger | Implementación |
|---|---|---|---|
| Section titles (features, agents, security) | SplitText word reveal + `pb-[0.15em]` | ScrollTrigger `once:true`, start `top 75-80%` | Patrón unificado en las 3 secciones |
| Feature cards (6) | Stagger fade-up (`y:30→0`, `opacity:0→1`) | ScrollTrigger | `stagger: 0.1`, `power3.out` |
| Agent bento items (5) | Stagger fade-up + scale (`scale:0.96→1`) | ScrollTrigger | `stagger: 0.12`, `back.out(1.2)` |
| Agent card glow | Dynamic box-shadow in agent color | Mouse hover/leave | GSAP `power2.out`, listeners con cleanup |
| Security badges (6) | Stagger fade-up (`y:30→0`) | ScrollTrigger | `stagger: 0.1`, `power3.out` |
| Coming Soon badge | CSS pulse (`opacity 1↔0.6`) | Continuous | `@keyframes coming-soon-pulse` en globals.css |
| Feature card hover | Y lift + scale + shadow | CSS transitions | `hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg` |

**Todas** las animaciones gated por `prefers-reduced-motion`. SplitText con `revert()` cleanup en todos los containers.

---

## 5. Responsive

| Breakpoint | Features Grid | Agents | Security |
|---|---|---|---|
| Mobile | 1 col | Stack vertical | 2 col grid |
| Tablet | 2 col | Stack vertical | 3 col grid |
| Desktop | 3 col | Layout mixto (destacados + grid) | 3 col grid |

---

## 6. Criterios de Aceptación

- [x] 6 feature cards renderizadas con contenido de i18n
- [x] 5 agent cards con colores correctos de `@bc-agent/shared`
- [x] Security section con badges (Coming Soon removido por decisión del owner — todas las features habilitadas)
- [x] Animaciones de entrada con SplitText + stagger fade-up al hacer scroll (patrón unificado)
- [x] Agent colors visibles en bordes/fondos/glows (GSAP hover glow dinámico)
- [x] Responsive en todos los breakpoints
- [x] Dark mode correcto (colores de agentes con rgba, legibles en ambos modos)
- [x] Todo el contenido viene de `useTranslations('Marketing.features')`, `.agents`, `.security`
- [x] Bento grid para agents (Orchestrator 2x2, Research 2-col) — cambio post-implementación
- [x] aria-label en secciones, heading hierarchy correcta, prefers-reduced-motion

---

## 7. Archivos

### Creados
- `frontend/src/domains/marketing/components/features/FeaturesSection.tsx` — Container, SplitText, 6-card grid
- `frontend/src/domains/marketing/components/features/FeatureCard.tsx` — Presentational, Lucide icon, CSS hover
- `frontend/src/domains/marketing/components/features/AgentsSection.tsx` — Bento grid, GSAP hover glows, SplitText
- `frontend/src/domains/marketing/components/features/AgentCard.tsx` — Presentational, color accent, h-full for bento
- `frontend/src/domains/marketing/components/features/SecuritySection.tsx` — Own useGSAP, SplitText, 3-col grid
- `frontend/src/domains/marketing/components/features/SecurityBadge.tsx` — Presentational, optional ComingSoon
- `frontend/src/domains/marketing/components/features/ComingSoonBadge.tsx` — CSS @keyframes pulse

### Modificados
- `frontend/app/[locale]/(marketing)/page.tsx` — stubs → componentes reales
- `frontend/app/globals.css` — `@keyframes coming-soon-pulse`
- `frontend/src/domains/marketing/content/marketing-flags.ts` — `COMING_SOON_FEATURES = {}`
- `frontend/src/domains/marketing/components/hero/HeroSection.tsx` — `pb-[0.15em]` descender fix
- `frontend/messages/en.json` — "Charts on Demand"
- `frontend/messages/es.json`, `da.json` — prefixed "Charts on Demand"
