# PRD-LP-005: Roadmap + Waitlist

**Estado**: Pendiente
**Fase**: 1 (Core Sections)
**Dependencias**: LP-001 (foundation, GSAP, design tokens), LP-002 (content)
**Bloquea**: LP-006 (scroll animations)

---

## 1. Objetivo

Construir las dos secciones finales del flujo de conversión:
- **Roadmap**: Campaña de expectativa mostrando lo que ya está y lo que viene
- **Waitlist**: Formulario de captura de emails con CTA final

El Roadmap genera deseo y confianza ("esto crece rápido"), el Waitlist captura la conversión.

---

## 2. Roadmap Section

### 2.1 Estructura Visual

```
┌─────────────────────────────────────────────────────┐
│  [Badge: "What's Coming"]                            │
│  We're Just Getting Started                          │
│                                                      │
│  [Filter: All | Live | In Development | Planned]     │
│                                                      │
│  ┌──── Timeline / Grid ────────────────────────┐    │
│  │                                              │    │
│  │  ● Multi-Agent Orchestration      [LIVE]    │    │
│  │  ● Business Central Integration   [LIVE]    │    │
│  │  ● Knowledge Base (RAG)           [LIVE]    │    │
│  │  ● Data Visualization             [LIVE]    │    │
│  │  ● Cloud Sync                     [LIVE]    │    │
│  │  ● Web Research                   [LIVE]    │    │
│  │  ○ Granular Permissions      [IN DEV]       │    │
│  │  ○ Persistent Memory         [IN DEV]       │    │
│  │  ◌ Mobile App                [PLANNED]      │    │
│  │  ◌ Parallel Agents           [PLANNED]      │    │
│  │  ◌ Workflows                 [PLANNED]      │    │
│  │  ◌ Custom Agents             [PLANNED]      │    │
│  │  ◌ Environments              [PLANNED]      │    │
│  │  ◌ Deep Research             [PLANNED]      │    │
│  │                                              │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 2.2 Diseño

**Opción A — Timeline vertical**: Línea vertical con dots coloreados por status. Clean, fácil de escanear.

**Opción B — Bento Grid**: Cards de distintos tamaños. "Live" items son más grandes/prominentes. Más visual pero más complejo.

**Recomendación**: Timeline vertical para la primera iteración. Es más legible, más fácil de mantener, y se presta mejor para animación de scroll. Si se desea, se puede migrar a grid en una iteración posterior.

### 2.3 Status Colors

| Status | Color | Icono |
|---|---|---|
| Live | `#10B981` (green) | Círculo lleno |
| Beta | `#F59E0B` (amber) | Círculo semi-lleno |
| In Development | `#3B82F6` (blue) | Círculo outline animado |
| Planned | `#6b7280` (gray) | Círculo punteado |

### 2.4 Filtro Opcional

Tabs o toggle pills para filtrar por status. Si hay pocos items, mostrar todo sin filtro. Decisión en implementación basada en cantidad final de items.

---

## 3. Waitlist Section

### 3.1 Estructura Visual

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│  [Badge: "Early Access"]                             │
│                                                      │
│  Be First to Experience                              │
│  the Future of Business AI                           │
│                                                      │
│  [Subtitle]                                          │
│                                                      │
│  ┌──────────────────────────────────────┐           │
│  │  [Email input]        [Join Waitlist]│           │
│  └──────────────────────────────────────┘           │
│                                                      │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐          │
│  │Priority│ │Early  │ │Dev    │ │Shape  │           │
│  │Access  │ │Pricing│ │Updates│ │Product│           │
│  └───────┘ └───────┘ └───────┘ └───────┘          │
│                                                      │
│  "Join {count}+ others on the waitlist"              │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 Formulario

- **Input**: Email con validación client-side (formato email)
- **Button**: "Join Waitlist" con loading state
- **Success state**: Checkmark animation + message
- **Error state**: Message de error con retry
- **UnimplementedError**: Al hacer submit, la función lanza un error intencional:

```typescript
class WaitlistUnimplementedError extends Error {
  constructor() {
    super(
      'Waitlist service not yet implemented. ' +
      'See PRD-LP-005 section 5 for integration plan.'
    );
    this.name = 'WaitlistUnimplementedError';
  }
}

async function submitWaitlistEmail(email: string): Promise<void> {
  // TODO: Replace with actual service integration
  // See docs/plans/landing-page/PRD-LP-005-roadmap-waitlist.md#5
  throw new WaitlistUnimplementedError();
}
```

El error se captura en el UI y muestra el mensaje `waitlist.form.error.unimplemented` al usuario.

### 3.3 Benefits Grid

4 badges con iconos mostrando qué obtiene el usuario al unirse:
1. Priority access to new features
2. Exclusive early-bird pricing
3. Regular development updates
4. Shape the product with your feedback

### 3.4 Social Proof (futuro)

`"Join {count}+ others"` — El count es placeholder (hardcoded inicialmente). Cuando el backend de waitlist esté implementado, se reemplaza por un count real vía API.

---

## 4. Componentes

```
frontend/src/domains/marketing/components/roadmap/
├── RoadmapSection.tsx         ← Container
├── RoadmapTimeline.tsx        ← Timeline vertical
├── RoadmapItem.tsx            ← Item individual con status
├── RoadmapFilter.tsx          ← Tabs de filtro (opcional)
└── StatusBadge.tsx            ← Badge de status (Live, Planned, etc.)

frontend/src/domains/marketing/components/waitlist/
├── WaitlistSection.tsx        ← Container
├── WaitlistForm.tsx           ← Form con email + submit
├── WaitlistBenefits.tsx       ← Grid de beneficios
├── WaitlistSuccess.tsx        ← Estado de éxito
└── WaitlistError.tsx          ← Estado de error
```

---

## 5. Waitlist Backend — Fase Futura (No en scope)

Documentación para el futuro PRD de integración:

### 5.1 Investigación Requerida

Comparar proveedores:

| Proveedor | Pros | Contras |
|---|---|---|
| Resend | Dev-friendly, API moderna, React email templates | Joven, menos analytics |
| Mailchimp | Maduro, templates, analytics, automaciones | API compleja, más caro |
| ConvertKit | Orientado a creadores, automaciones simples | Menos enterprise |
| Loops | Moderno, orientado a SaaS, event-driven | Pequeño, menos features |
| SendGrid | Robusto, alto volumen, analytics | Complejo para empezar |

### 5.2 Requisitos del Servicio

- Capturar email + locale + timestamp
- Double opt-in (requerido para GDPR)
- Flujo de bienvenida automático
- Capacidad de enviar updates de desarrollo
- Analytics: open rate, click rate
- Exportar lista en CSV

### 5.3 Implementación

- API endpoint: `POST /api/marketing/waitlist`
- Validación: email format, rate limiting, honeypot anti-spam
- Almacenamiento: servicio externo (decisión pendiente) + backup en DB propia (opcional)
- Respuesta: `201 Created` con mensaje de confirmación

---

## 6. Animaciones GSAP

| Elemento | Animación | Trigger |
|---|---|---|
| Roadmap title | SplitText reveal | Scroll into view |
| Timeline items | Stagger slide-in from left | Scroll, secuencial |
| Status dots | Scale-in + color fill | Con el item |
| Waitlist title | SplitText reveal | Scroll into view |
| Email form | Fade up | Scroll into view |
| Benefits | Stagger fade-up | Scroll into view |
| Success checkmark | Draw SVG (futuro: DrawSVGPlugin) | On submit success |

---

## 7. Criterios de Aceptación

### Roadmap
- [ ] Todos los items de roadmap renderizados con status correcto
- [ ] Status badges con colores apropiados
- [ ] "Live" items visualmente prominentes
- [ ] Responsive: timeline se adapta a mobile
- [ ] Contenido de `useTranslations('Marketing.roadmap')`

### Waitlist
- [ ] Formulario con validación de email client-side
- [ ] Submit lanza `WaitlistUnimplementedError`
- [ ] Error se muestra como mensaje user-friendly (no crash)
- [ ] Success state diseñado (se muestra en tests manuales / storybook)
- [ ] Benefits grid responsive
- [ ] Contenido de `useTranslations('Marketing.waitlist')`
- [ ] CTA en el header ("Join Waitlist") scrollea a esta sección

---

## 8. Archivos Nuevos

- `frontend/src/domains/marketing/components/roadmap/RoadmapSection.tsx`
- `frontend/src/domains/marketing/components/roadmap/RoadmapTimeline.tsx`
- `frontend/src/domains/marketing/components/roadmap/RoadmapItem.tsx`
- `frontend/src/domains/marketing/components/roadmap/StatusBadge.tsx`
- `frontend/src/domains/marketing/components/waitlist/WaitlistSection.tsx`
- `frontend/src/domains/marketing/components/waitlist/WaitlistForm.tsx`
- `frontend/src/domains/marketing/components/waitlist/WaitlistBenefits.tsx`
- `frontend/src/domains/marketing/components/waitlist/WaitlistSuccess.tsx`
- `frontend/src/domains/marketing/components/waitlist/WaitlistError.tsx`
- `frontend/src/domains/marketing/hooks/useWaitlist.ts`
