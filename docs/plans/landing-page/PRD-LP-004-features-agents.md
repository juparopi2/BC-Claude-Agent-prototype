# PRD-LP-004: Features & Agents Showcase

**Estado**: Pendiente
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

**Estructura**: Cards horizontales con visual de cada agente y su color.

```
┌─────────────────────────────────────────────────────┐
│  [Badge: "Meet Your AI Team"]                        │
│  Specialized Agents That Work Together               │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ 🎯 Orchestrator          Routes & Coordinates│   │
│  │ [color: #8B5CF6]         [description]        │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │ 📊 BC Expert             ERP Operations      │   │
│  │ [color: #3B82F6]         [description]        │   │
│  └──────────────────────────────────────────────┘   │
│  │ 🧠 KB Expert   │ 📈 Data Viz  │ 🔬 Research │   │
│  └─────────────────┴──────────────┴─────────────┘   │
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

## 4. Animaciones GSAP

| Elemento | Animación | Trigger |
|---|---|---|
| Section titles | SplitText reveal | `whileInView` (ScrollTrigger) |
| Feature cards | Stagger fade-up from bottom | Scroll into view |
| Agent cards | Slide in from left, staggered | Scroll into view |
| Agent color glow | Pulse animation on hover | Mouse hover |
| Security badges | Stagger scale-in | Scroll into view |
| Coming Soon badge | Subtle pulse | Continuous |

**Nota**: Animaciones detalladas se refinan en LP-006. En LP-004 se construye la estructura con animaciones básicas de entrada (`whileInView` equivalente con ScrollTrigger).

---

## 5. Responsive

| Breakpoint | Features Grid | Agents | Security |
|---|---|---|---|
| Mobile | 1 col | Stack vertical | 2 col grid |
| Tablet | 2 col | Stack vertical | 3 col grid |
| Desktop | 3 col | Layout mixto (destacados + grid) | 3 col grid |

---

## 6. Criterios de Aceptación

- [ ] 6 feature cards renderizadas con contenido de i18n
- [ ] 5 agent cards con colores correctos de `@bc-agent/shared`
- [ ] Security section con badges, "Coming Soon" en items marcados
- [ ] Animaciones de entrada básicas al hacer scroll
- [ ] Agent colors visibles en bordes/fondos/glows
- [ ] Responsive en todos los breakpoints
- [ ] Dark mode correcto (colores de agentes legibles en ambos modos)
- [ ] Todo el contenido viene de `useTranslations('Marketing.features')`, `.agents`, `.security`

---

## 7. Archivos Nuevos

- `frontend/src/domains/marketing/components/features/FeaturesSection.tsx`
- `frontend/src/domains/marketing/components/features/FeatureCard.tsx`
- `frontend/src/domains/marketing/components/features/AgentsSection.tsx`
- `frontend/src/domains/marketing/components/features/AgentCard.tsx`
- `frontend/src/domains/marketing/components/features/SecuritySection.tsx`
- `frontend/src/domains/marketing/components/features/SecurityBadge.tsx`
- `frontend/src/domains/marketing/components/features/ComingSoonBadge.tsx`
