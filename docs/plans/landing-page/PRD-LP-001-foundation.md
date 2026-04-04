# PRD-LP-001: Foundation & Layout

**Estado**: ✅ Completado (2026-04-03)
**Fase**: 0 (Foundation)
**Dependencias**: Ninguna
**Bloquea**: LP-003, LP-004, LP-005
**SDD Change**: `lp-001-foundation` (archived)

---

## 1. Objetivo

Establecer la infraestructura técnica completa para la landing page: routing, GSAP, i18n, layout compartido (header/footer), y design tokens específicos de marketing. Al completar este PRD, debe ser posible renderizar una página vacía en `/{locale}/` con header, footer, y language switcher funcional.

---

## 2. Alcance

### En Scope
- Route group `(marketing)/` bajo `[locale]/`
- Middleware de next-intl para negociación de locale (solo rutas marketing)
- Instalación y configuración de GSAP + plugins + @gsap/react
- Layout de marketing (header con nav + language switcher, footer, ScrollSmoother wrappers)
- Design tokens extendidos para marketing (gradientes, glows, etc.)
- Estructura de carpetas `src/domains/marketing/`
- SEO base (favicon, meta tags, viewport)
- `robots.txt` (permitir marketing, bloquear app)
- `sitemap.xml` base (páginas marketing con alternates por locale)
- Placeholders para páginas legales (privacy, terms — contenido provisto por el owner)

### Fuera de Scope
- Contenido de secciones (LP-002+)
- Animaciones específicas (LP-006)
- Traducciones más allá de inglés (LP-010)
- Cambios al portal autenticado existente

---

## 3. Especificaciones Técnicas

### 3.1 Instalación de Dependencias

```bash
npm install -w bc-agent-frontend gsap @gsap/react
```

**Nota**: GSAP es 100% gratuito desde 2024-2025 (sponsorship de Webflow). Todos los plugins (ScrollTrigger, SplitText, MorphSVG, DrawSVG, MotionPath, ScrollSmoother) están incluidos sin costo para uso comercial.

### 3.2 Estructura de Archivos

```
frontend/
├── app/
│   ├── [locale]/
│   │   └── (marketing)/
│   │       ├── layout.tsx        ← Marketing layout (público)
│   │       └── page.tsx          ← Landing page entry point
│   └── layout.tsx                ← Root layout (existente, sin cambios)
├── middleware.ts                  ← NUEVO o MODIFICADO: next-intl routing
├── i18n/
│   ├── routing.ts                ← NUEVO: locale definitions
│   └── request.ts                ← MODIFICADO: dynamic locale
├── messages/
│   └── en.json                   ← MODIFICADO: namespaces de marketing
└── src/
    └── domains/
        └── marketing/
            ├── components/
            │   └── shared/
            │       ├── MarketingHeader.tsx
            │       ├── MarketingFooter.tsx
            │       ├── LanguageSwitcher.tsx
            │       └── MarketingNav.tsx
            ├── hooks/
            │   └── useScrollAnimation.ts
            ├── content/
            │   └── agents.ts
            └── animations/
                └── gsap-config.ts
```

### 3.3 i18n Routing Configuration

**`frontend/i18n/routing.ts`** (NUEVO):
```typescript
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'es', 'da'],
  defaultLocale: 'en',
  localePrefix: 'always', // /en/, /es/, /da/
});
```

**`frontend/middleware.ts`** (NUEVO o MODIFICAR existente):
```typescript
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // SOLO procesar rutas con prefijo de locale para marketing
  // Las rutas del portal (/chat, /files, etc.) pasan sin modificar
  if (pathname.match(/^\/(en|es|da)(\/|$)/)) {
    return intlMiddleware(request);
  }

  // Redirect root "/" → "/en/" (landing page default)
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/en/', request.url));
  }

  // Todo lo demás (portal autenticado) pasa sin tocar
  return NextResponse.next();
}

export const config = {
  // Solo matchear: root, locale prefixes, y excluir assets/api
  matcher: ['/', '/(en|es|da)/:path*']
};
```

**CRITICO**: Este middleware SOLO intercepta rutas con prefijo de locale (`/en/`, `/es/`, `/da/`) y el root (`/`). Las rutas del portal (`/chat`, `/files`, `/settings`, etc.) NO son interceptadas. Verificar con tests manuales que todas las rutas existentes siguen funcionando.

**`frontend/i18n/request.ts`** (MODIFICAR):
```typescript
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

### 3.4 Marketing Layout

**`frontend/app/[locale]/(marketing)/layout.tsx`**:

Debe incluir:
- `<html lang={locale}>` dinámico
- ThemeProvider (dark mode support)
- NextIntlClientProvider
- MarketingHeader
- MarketingFooter
- ScrollSmoother wrapper divs (requerido por LP-006)
- NO incluir: AuthProvider, OnboardingProvider, ServiceWorkerProvider, GlobalBanners

```typescript
// Estructura conceptual
export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <ThemeProvider>
        <MarketingHeader locale={locale} />
        {/* ScrollSmoother requires these wrapper divs (LP-006) */}
        <div id="smooth-wrapper">
          <div id="smooth-content">
            <main>{children}</main>
            <MarketingFooter />
          </div>
        </div>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
```

**Nota**: Los divs `smooth-wrapper` y `smooth-content` son requeridos por GSAP ScrollSmoother (LP-006). Se incluyen desde el inicio para evitar refactor del layout después.
```

### 3.5 Marketing Header

- Logo de MyWorkMate (usar ThemeLogo existente de `public/branding/`)
- Navegación: links de scroll a secciones (Features, Roadmap, Pricing, Waitlist)
- Language Switcher: dropdown o toggle para `en` / `es` / `da`
- CTA button: "Join Waitlist" (scroll to waitlist section)
- Sticky on scroll con backdrop-blur
- Responsive: hamburger menu en mobile

### 3.6 Marketing Footer

- Logo + tagline
- Links: Privacy Policy, Terms of Service (pueden ser placeholders)
- Social links (placeholders)
- "Built with" tech badges (opcional)
- Copyright year dinámico

### 3.7 GSAP Configuration

**`frontend/src/domains/marketing/animations/gsap-config.ts`**:

```typescript
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

// Register all plugins once
gsap.registerPlugin(
  ScrollTrigger,
  SplitText,
  ScrollSmoother,
  DrawSVGPlugin,
  MorphSVGPlugin,
  MotionPathPlugin,
);

export { gsap, ScrollTrigger, SplitText, ScrollSmoother };
```

**Hook wrapper** — `useScrollAnimation.ts`:
```typescript
import { useGSAP } from '@gsap/react';
import { gsap, ScrollTrigger } from '../animations/gsap-config';

// Re-export for consistent imports across marketing domain
export { useGSAP, gsap, ScrollTrigger };
```

### 3.8 Design Tokens (Extensión)

Agregar en `globals.css` variables específicas para marketing:

```css
/* Marketing-specific tokens */
:root {
  --marketing-hero-gradient-start: hsl(221.2 83.2% 53.3%);
  --marketing-hero-gradient-end: hsl(250 80% 60%);
  --marketing-glow-blue: rgba(59, 130, 246, 0.4);
  --marketing-glow-violet: rgba(139, 92, 246, 0.3);
  --marketing-section-gap: 6rem;
}

.dark {
  --marketing-hero-gradient-start: hsl(221.2 83.2% 45%);
  --marketing-hero-gradient-end: hsl(250 80% 50%);
  --marketing-glow-blue: rgba(96, 165, 250, 0.3);
  --marketing-glow-violet: rgba(167, 139, 250, 0.25);
}
```

**Nota**: Estos valores son iniciales. Se refinan durante el desarrollo de LP-003 (Hero).

### 3.9 Landing Page Entry Point

**`frontend/app/[locale]/(marketing)/page.tsx`**:

Inicialmente renderiza un placeholder con header y footer funcionales:

```typescript
export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Sections will be added by LP-003 through LP-005 */}
      <section id="hero" className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Hero Section — PRD-LP-003</p>
      </section>
    </div>
  );
}
```

---

## 4. SEO Base

### Meta Tags

```typescript
export const metadata: Metadata = {
  title: 'MyWorkMate — AI-Powered Business Automation',
  description: 'Connect AI agents to Microsoft Dynamics 365, OneDrive, and SharePoint. Automate your business operations with intelligent orchestration.',
  openGraph: {
    title: 'MyWorkMate — AI-Powered Business Automation',
    description: 'Multi-agent AI platform for Microsoft ecosystem.',
    type: 'website',
    locale: 'en',
    // OG image: to be created in LP-002
  },
  alternates: {
    languages: {
      en: '/en',
      es: '/es',
      da: '/da',
    },
  },
};
```

---

## 5. Criterios de Aceptación

- [x] `/{locale}/` renderiza la landing page con header y footer
- [x] Language switcher navega entre `/en/`, `/es/`, `/da/` (content en inglés para todos por ahora)
- [x] Header es sticky con backdrop-blur, responsive con hamburger en mobile
- [x] Footer renderiza con placeholders para links legales
- [x] GSAP está instalado y los plugins se registran sin errores en consola
- [x] Las rutas del portal existente (`/chat`, `/files`, etc.) NO se ven afectadas por el middleware de i18n
- [x] Dark mode funciona en la landing page
- [ ] Lighthouse: 90+ en Performance para la página placeholder (pendiente medición)
- [x] No errores de TypeScript ni ESLint
- [x] Estructura de carpetas `src/domains/marketing/` creada

---

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Middleware de i18n intercepta rutas del portal | Matcher explícito con exclusiones. Test manual de todas las rutas existentes. |
| Conflicto entre root layout y marketing layout | Marketing layout NO duplica providers del root. Solo agrega lo específico de marketing. |
| GSAP SSR compatibility | GSAP animations solo en client components. `useGSAP` maneja cleanup. |
| next-intl v4 breaking changes con locale routing | Verificar docs de context7 antes de implementar. |

---

## 7. Archivos Afectados (Resultado Final)

### Creados (14)
- `frontend/middleware.ts` — next-intl middleware con allowlist matcher
- `frontend/i18n/routing.ts` — defineRouting config
- `frontend/i18n/navigation.ts` — createNavigation exports (Link, useRouter, usePathname)
- `frontend/messages/es.json` — traducciones marketing español
- `frontend/messages/da.json` — traducciones marketing danés
- `frontend/app/[locale]/(marketing)/layout.tsx` — marketing layout (nested bajo root)
- `frontend/app/[locale]/(marketing)/page.tsx` — landing page placeholder con section anchors
- `frontend/src/domains/marketing/animations/gsap-config.ts` — registro de plugins GSAP
- `frontend/src/domains/marketing/hooks/useScrollAnimation.ts` — re-export hook GSAP
- `frontend/src/domains/marketing/components/shared/MarketingHeader.tsx` — header sticky responsive
- `frontend/src/domains/marketing/components/shared/MarketingFooter.tsx` — footer con legal links
- `frontend/src/domains/marketing/components/shared/MarketingNav.tsx` — smooth-scroll navigation
- `frontend/src/domains/marketing/components/shared/LanguageSwitcher.tsx` — locale switcher dropdown
- `frontend/src/domains/marketing/components/shared/HtmlLangSync.tsx` — sync `<html lang>` via useEffect

### Modificados (4)
- `frontend/i18n/request.ts` — locale dinámico via requestLocale + fallback
- `frontend/app/globals.css` — marketing design tokens (light + dark)
- `frontend/messages/en.json` — namespace `marketing` agregado
- `frontend/components/providers/AuthProvider.tsx` — rutas marketing como públicas

### No creados (diferidos)
- `frontend/src/domains/marketing/content/agents.ts` — diferido a LP-004
- `robots.txt` / `sitemap.xml` — diferidos, baja prioridad

---

## 8. Notas de Implementación

### Descubrimientos Arquitectónicos

**Next.js App Router: un solo root layout con `<html>`/`<body>`**
El diseño original (ADR-001) asumía que el marketing layout podía ser un document shell independiente con su propio `<html>` y `<body>`. Esto es **incorrecto** — Next.js requiere un único root layout con tags de documento. Los route groups (`(marketing)`) crean layouts *nested*, no *standalone*. Solución: marketing layout es un fragment wrapper; `HtmlLangSync` client component sincroniza `<html lang>` via useEffect.

**AuthProvider bloquea rutas marketing**
El `AuthProvider` del root layout redirige a `/login` cualquier ruta que no esté en `PUBLIC_ROUTES`. Las rutas `/en/`, `/es/`, `/da/` no estaban incluidas. Solución: regex `MARKETING_LOCALE_PREFIX` agregada al check de rutas públicas.

**next-intl v4 requiere `createNavigation`**
Para navegación client-side typed (useRouter, usePathname), next-intl v4 requiere crear helpers via `createNavigation(routing)`. No existía en el PRD original. Se creó `i18n/navigation.ts`.

**GSAP: registro mínimo de plugins**
Solo se registran `useGSAP` y `ScrollTrigger` (necesarios para LP-003+). Los plugins premium (SplitText, ScrollSmoother, DrawSVG, MorphSVG, MotionPath) se difieren a LP-006 cuando se usen, manteniendo el bundle más pequeño.

### Items Diferidos (Decisión Consciente)
| Item | Razón | Cuándo |
|------|-------|--------|
| `--marketing-font-display` token | No requerido por spec; decidir con hero design | LP-003 |
| Split `components/shared/` → `layout/` + `ui/` | 4 componentes no justifican el split | LP-004+ si crece |
| Tokens en `@theme inline` | `var()` syntax es funcional | Solo si se necesitan utilities Tailwind |
| Scoping de messages por namespace | Root provider pattern es correcto | No requerido |
