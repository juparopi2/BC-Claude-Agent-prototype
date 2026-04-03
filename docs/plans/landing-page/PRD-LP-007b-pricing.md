# PRD-LP-007b: Pricing (Hidden)

**Estado**: Pendiente
**Fase**: 2 (Polish & Enhancement)
**Dependencias**: LP-004 (features)
**Bloquea**: Ninguno

---

## 1. Objetivo

Diseñar e implementar la sección de pricing con 3 tiers. La sección se construye completa pero se oculta por defecto. Un feature flag controla su visibilidad para habilitarla cuando los precios sean finales.

---

## 2. Diseño

### 3 Tiers

| | Free | Starter | Professional |
|---|---|---|---|
| **Precio** | $0/mes | ~$25/mes | ~$199/mes |
| **Target** | Exploración | Usuarios regulares / PyMEs | Power users / empresas |
| **Highlight** | — | **Recommended** | — |
| **CTA** | "Get Started Free" | "Join Waitlist — Starter" | "Join Waitlist — Pro" |

El tier Starter es el **highlighted** (borde, tamaño, o elevación diferente).

### Layout

```
┌─────────────────────────────────────────────────────┐
│  [Badge: "Simple Pricing"]                           │
│  Plans That Scale With Your Business                 │
│                                                      │
│  [Monthly / Annual toggle]                           │
│                                                      │
│  ┌──────┐  ┌══════════┐  ┌──────┐                  │
│  │ Free │  ║ Starter  ║  │ Pro  │                   │
│  │      │  ║(popular) ║  │      │                   │
│  │ $0   │  ║  $25     ║  │ $199 │                   │
│  │      │  ║          ║  │      │                   │
│  │[feat]│  ║ [feat]   ║  │[feat]│                   │
│  │      │  ║          ║  │      │                   │
│  │[CTA] │  ║ [CTA]    ║  │[CTA] │                   │
│  └──────┘  └══════════┘  └──────┘                  │
│                                                      │
│  [FAQ Accordion]                                     │
└─────────────────────────────────────────────────────┘
```

---

## 3. Feature Flag

```typescript
// Simple boolean for now. Future: GrowthBook integration (see feature-flags/00-exploration.md)
const SHOW_PRICING = false;

// In LandingPage component:
{SHOW_PRICING && <PricingSection />}
```

Cuando el sistema de feature flags (GrowthBook) esté implementado, migrar a:
```typescript
const showPricing = useFeatureFlag('landing-page-pricing');
```

---

## 4. Componentes

```
frontend/src/domains/marketing/components/pricing/
├── PricingSection.tsx         ← Container (hidden by flag)
├── PricingToggle.tsx          ← Monthly/Annual switch
├── PricingCard.tsx            ← Card individual (reutilizable)
├── PricingFeatureList.tsx     ← Lista de features
├── PricingFAQ.tsx             ← Accordion de preguntas
└── PricingCTA.tsx             ← Botón con acción (waitlist scroll)
```

---

## 5. Notas

- **Precios son PRELIMINARES**. No publicar sin confirmación.
- El toggle Monthly/Annual puede tener un descuento placeholder del 20%.
- Los CTAs de pricing redirigen a la sección waitlist (no hay checkout).
- FAQ accordion usa shadcn `Collapsible` o un accordion component.

---

## 6. Criterios de Aceptación

- [ ] 3 pricing cards renderizadas correctamente
- [ ] Starter card visualmente destacada
- [ ] Monthly/Annual toggle funcional (recalcula precios)
- [ ] FAQ accordion funcional
- [ ] Sección oculta por defecto (`SHOW_PRICING = false`)
- [ ] Visible cuando flag es `true`
- [ ] CTAs scrollean a waitlist
- [ ] Responsive en mobile (stack vertical)
- [ ] Dark mode
- [ ] i18n: `useTranslations('Marketing.pricing')`
