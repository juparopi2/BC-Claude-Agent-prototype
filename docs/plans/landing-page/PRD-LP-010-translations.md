# PRD-LP-010: Translations (Deferred)

**Estado**: Diferido — Fase 3
**Fase**: 3 (Deferred)
**Dependencias**: LP-002 (content strategy — all keys defined in en.json)
**Bloquea**: Ninguno

---

## 1. Objetivo

Traducir todo el contenido de la landing page a español (`es`) y danés (`da`). Opcionalmente agregar idiomas adicionales.

**Este PRD se DOCUMENTA ahora pero se IMPLEMENTA después de que el contenido en inglés esté estabilizado.**

---

## 2. Alcance

### Archivos a crear
- `frontend/messages/es.json` — Español
- `frontend/messages/da.json` — Danés

### Contenido a traducir
Todo el namespace `Marketing` de `en.json`:
- `Marketing.meta` — SEO metadata (title, description, OG tags)
- `Marketing.header` — Navigation
- `Marketing.hero` — Hero section
- `Marketing.features` — Feature descriptions
- `Marketing.agents` — Agent names and descriptions
- `Marketing.security` — Security badges
- `Marketing.roadmap` — Roadmap items
- `Marketing.waitlist` — Waitlist form
- `Marketing.pricing` — Pricing tiers
- `Marketing.footer` — Footer

### NO traducir
- Agent technical identifiers (AGENT_ID)
- URLs
- Nombres propios (MyWorkMate, Dynamics 365, Business Central, etc.)

---

## 3. Proceso

### 3.1 Traducción
- Traducción profesional o asistida por AI + revisión humana
- Mantener tono de marketing (profesional, directo, orientado a negocio)
- Adaptar expresiones culturalmente (no traducción literal)

### 3.2 SEO por Idioma
Cada locale necesita sus propios meta tags optimizados para SEO en ese idioma:
- `Marketing.meta.title` — Adaptado al idioma
- `Marketing.meta.description` — Optimizado para keywords en el idioma
- `Marketing.meta.keywords` — Keywords relevantes en el idioma

### 3.3 Verificación
- Todas las keys presentes en todos los archivos (script de validación)
- No strings hardcoded en componentes
- Language switcher funciona correctamente entre todos los locales
- OG tags correctos por locale
- Alternate links en sitemap

---

## 4. Idiomas Adicionales (Futuro)

Potenciales idiomas a considerar según mercado:
- Alemán (`de`) — DACH market (Austria, Switzerland)
- Francés (`fr`) — Mercado europeo
- Noruego (`no`) / Sueco (`sv`) — Mercado nórdico
- Portugués (`pt`) — Brasil / Portugal

Decisión basada en análisis de mercado post-launch.

---

## 5. Criterios de Aceptación

- [ ] `es.json` completo con todas las keys del namespace Marketing
- [ ] `da.json` completo con todas las keys del namespace Marketing
- [ ] Language switcher navega entre /en/, /es/, /da/ correctamente
- [ ] SEO meta tags correctos por locale
- [ ] Sin strings faltantes (validación automática)
- [ ] Traducciones revisadas por hablante nativo (o usuario)
