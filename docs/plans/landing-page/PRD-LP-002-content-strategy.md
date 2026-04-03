# PRD-LP-002: Content Strategy

**Estado**: Pendiente
**Fase**: 0 (Foundation)
**Dependencias**: Ninguna (paralelo con LP-001)
**Bloquea**: LP-003, LP-004, LP-005, LP-010

---

## 1. Objetivo

Definir TODO el contenido de la landing page: copy, messaging, estructura de i18n keys, SEO metadata, y OG tags. Al completar este PRD, cada sección tiene su contenido definido en `en.json` y los meta tags están configurados. Este PRD es la **fuente de verdad** para qué dice la landing page.

---

## 2. Alcance

### En Scope
- Estructura completa de namespaces i18n en `en.json`
- Copy para todas las secciones P1: Hero, Features, Roadmap, Waitlist, Header, Footer
- Copy para secciones P2: Pricing (diseñado pero hidden)
- SEO: title, description, keywords, OG tags por página
- Agent descriptions adaptadas para marketing (basadas en `@bc-agent/shared` pero con tono marketing)
- Roadmap items (features actuales vs coming soon)

### Fuera de Scope
- Traducciones a otros idiomas (LP-010)
- Diseño visual de las secciones (LP-003+)
- OG images (requieren diseño)

---

## 3. Arquitectura de i18n

### 3.1 Estructura de Namespaces

```json
{
  "Marketing": {
    "meta": { ... },
    "header": { ... },
    "hero": { ... },
    "features": { ... },
    "agents": { ... },
    "roadmap": { ... },
    "waitlist": { ... },
    "pricing": { ... },
    "security": { ... },
    "footer": { ... }
  }
}
```

**Convención**: Todas las keys de marketing viven bajo el namespace `Marketing` para separación clara del namespace `onboarding` existente.

### 3.2 Uso en Componentes

```typescript
// En cualquier componente de marketing:
const t = useTranslations('Marketing.hero');
// Accede: t('title'), t('subtitle'), t('cta')
```

---

## 4. Contenido por Sección

### 4.1 Meta / SEO

```json
{
  "Marketing": {
    "meta": {
      "title": "MyWorkMate — AI-Powered Business Automation",
      "description": "Connect intelligent AI agents to Microsoft Dynamics 365 Business Central, OneDrive, and SharePoint. Automate operations, gain insights, and transform how your team works.",
      "ogTitle": "MyWorkMate — Your AI Business Command Center",
      "ogDescription": "Multi-agent AI platform that connects to your Microsoft ecosystem. Automate ERP queries, analyze documents, visualize data — all through natural conversation.",
      "keywords": "AI business assistant, Business Central AI, Dynamics 365 automation, Microsoft AI agent, ERP automation, knowledge base AI, multi-agent orchestration"
    }
  }
}
```

### 4.2 Header

```json
{
  "header": {
    "logo": "MyWorkMate",
    "nav": {
      "features": "Features",
      "agents": "Agents",
      "roadmap": "Roadmap",
      "pricing": "Pricing",
      "waitlist": "Get Early Access"
    },
    "cta": "Join Waitlist",
    "languageSwitch": {
      "en": "English",
      "es": "Español",
      "da": "Dansk"
    }
  }
}
```

### 4.3 Hero Section

**Tono**: Audaz, directo, orientado a transformación del negocio. NO genérico.

```json
{
  "hero": {
    "badge": "AI-Powered Business Automation",
    "title": "Your Business Runs on Data. Let AI Run With It.",
    "subtitle": "MyWorkMate connects intelligent agents to Microsoft Dynamics 365 Business Central, OneDrive, and SharePoint — turning natural conversations into real business actions.",
    "cta": {
      "primary": "Get Early Access",
      "secondary": "See How It Works"
    },
    "stats": {
      "agents": {
        "value": "5",
        "label": "Specialized Agents"
      },
      "integrations": {
        "value": "3+",
        "label": "Microsoft Integrations"
      },
      "chartTypes": {
        "value": "10",
        "label": "Visualization Types"
      }
    },
    "trustedBy": "Built for the Microsoft Ecosystem"
  }
}
```

**Nota**: El hero es la sección más crítica para conversión. El copy aquí puede iterar muchas veces. Estas son las versiones iniciales.

### 4.4 Features / Capabilities

```json
{
  "features": {
    "badge": "Platform Capabilities",
    "title": "Everything Your Business Needs, One Conversation Away",
    "subtitle": "From ERP queries to document analysis, data visualization to web research — MyWorkMate brings the power of specialized AI agents to your daily operations.",
    "items": {
      "erp": {
        "title": "ERP Intelligence",
        "description": "Query customers, vendors, invoices, sales orders, and inventory directly from Business Central. Create and modify records through natural language.",
        "highlight": "Read & Write to Dynamics 365"
      },
      "knowledge": {
        "title": "Knowledge Base",
        "description": "Upload documents and let AI understand them. Semantic search finds answers across your entire document library — PDFs, spreadsheets, presentations.",
        "highlight": "Semantic Search with RAG"
      },
      "orchestration": {
        "title": "Smart Orchestration",
        "description": "Ask anything. The Orchestrator automatically routes your question to the right specialist agent, combining their capabilities when needed.",
        "highlight": "Multi-Agent Routing"
      },
      "visualization": {
        "title": "Data Visualization",
        "description": "Transform raw data into clear insights. Bar charts, line graphs, KPI dashboards, combo charts — generated from your data in seconds.",
        "highlight": "10 Chart Types"
      },
      "research": {
        "title": "Research & Analysis",
        "description": "Real-time web search, data analysis with Python execution, and document generation. Your personal research assistant for complex questions.",
        "highlight": "Web + Code Execution"
      },
      "files": {
        "title": "Cloud File Sync",
        "description": "Connect OneDrive and SharePoint libraries. Your cloud documents become instantly searchable and available to AI agents.",
        "highlight": "OneDrive & SharePoint"
      }
    }
  }
}
```

### 4.5 Agents Showcase

```json
{
  "agents": {
    "badge": "Meet Your AI Team",
    "title": "Specialized Agents That Work Together",
    "subtitle": "Each agent is an expert in its domain. The Orchestrator coordinates them seamlessly, so you just ask — and the right expert answers.",
    "items": {
      "supervisor": {
        "name": "Orchestrator",
        "role": "Routes & Coordinates",
        "description": "Analyzes your question and automatically selects the best specialist. Combines multiple agents when complex tasks require it."
      },
      "bcAgent": {
        "name": "Business Central Expert",
        "role": "ERP Operations",
        "description": "Direct access to Dynamics 365 Business Central. Query financial data, manage inventory, process sales orders — all through conversation."
      },
      "ragAgent": {
        "name": "Knowledge Base Expert",
        "role": "Document Intelligence",
        "description": "Searches your uploaded documents using semantic understanding. Finds precise answers across thousands of pages instantly."
      },
      "graphingAgent": {
        "name": "Data Visualization Expert",
        "role": "Charts & Insights",
        "description": "Transforms numbers into visual stories. From simple bar charts to complex KPI dashboards — all generated from your data."
      },
      "researchAgent": {
        "name": "Research & Analysis",
        "role": "Web Research & Code",
        "description": "Searches the web, analyzes data with Python, and generates comprehensive reports. Your research team, available 24/7."
      }
    },
    "cta": "See All Agents in Action"
  }
}
```

### 4.6 Security & Compliance

```json
{
  "security": {
    "badge": "Enterprise-Ready Security",
    "title": "Built for Businesses That Take Security Seriously",
    "subtitle": "Your data stays yours. Every interaction is secured, every action is auditable, every access is controlled.",
    "items": {
      "encryption": {
        "title": "Encrypted at Rest & Transit",
        "description": "AES-256-GCM encryption for stored tokens. TLS for all communications."
      },
      "tenantIsolation": {
        "title": "Tenant Isolation",
        "description": "Strict data separation. Your documents, sessions, and AI interactions are invisible to other users."
      },
      "permissions": {
        "title": "Granular Permissions",
        "description": "Control what agents can do. Some actions always require your approval — you decide which.",
        "comingSoon": true
      },
      "gdpr": {
        "title": "GDPR Compliant",
        "description": "Full data portability and right to deletion. Cascade delete removes all PII on request.",
        "comingSoon": true
      },
      "audit": {
        "title": "Full Audit Trail",
        "description": "Every agent action, every tool call, every decision — logged and traceable."
      },
      "oauth": {
        "title": "Microsoft SSO",
        "description": "Sign in with your existing Microsoft account. No new passwords to manage."
      }
    }
  }
}
```

### 4.7 Roadmap / Coming Soon

```json
{
  "roadmap": {
    "badge": "What's Coming",
    "title": "We're Just Getting Started",
    "subtitle": "MyWorkMate is evolving fast. Here's what's live today and what's on the horizon.",
    "statusLabels": {
      "live": "Live",
      "beta": "Beta",
      "development": "In Development",
      "planned": "Planned"
    },
    "items": {
      "multiAgent": {
        "title": "Multi-Agent Orchestration",
        "description": "Supervisor routes to 5 specialized agents automatically",
        "status": "live"
      },
      "bcIntegration": {
        "title": "Business Central Integration",
        "description": "Full read & write access to Dynamics 365 Business Central",
        "status": "live"
      },
      "knowledgeBase": {
        "title": "Knowledge Base (RAG)",
        "description": "Upload, search, and analyze documents with AI",
        "status": "live"
      },
      "dataViz": {
        "title": "Data Visualization",
        "description": "10 chart types generated from structured data",
        "status": "live"
      },
      "cloudSync": {
        "title": "OneDrive & SharePoint Sync",
        "description": "Connect cloud libraries for seamless document access",
        "status": "live"
      },
      "webResearch": {
        "title": "Web Research & Code Execution",
        "description": "Real-time web search and Python sandbox",
        "status": "live"
      },
      "mobileApp": {
        "title": "Mobile Application",
        "description": "Full MyWorkMate experience on your phone",
        "status": "planned"
      },
      "granularPermissions": {
        "title": "Granular Permissions",
        "description": "Always-allow vs require-approval per action",
        "status": "development"
      },
      "agentMemory": {
        "title": "Persistent Memory",
        "description": "Agents remember context across conversations",
        "status": "development"
      },
      "parallelAgents": {
        "title": "Parallel Agent Execution",
        "description": "Multiple agents working simultaneously on complex tasks",
        "status": "planned"
      },
      "workflows": {
        "title": "Automated Workflows",
        "description": "Create repeatable tasks triggered by events or commands",
        "status": "planned"
      },
      "customAgents": {
        "title": "Custom Agent Builder",
        "description": "Create your own agents with custom skills and MCP tools",
        "status": "planned"
      },
      "environments": {
        "title": "Organization Environments",
        "description": "Team management, billing controls, and usage tracking",
        "status": "planned"
      },
      "deepResearch": {
        "title": "Deep Research Mode",
        "description": "Autonomous multi-step research with source synthesis",
        "status": "planned"
      }
    }
  }
}
```

### 4.8 Waitlist

```json
{
  "waitlist": {
    "badge": "Early Access",
    "title": "Be First to Experience the Future of Business AI",
    "subtitle": "Join the waitlist for priority access. We'll notify you as new features launch and you'll get exclusive early-bird pricing.",
    "form": {
      "emailPlaceholder": "your@email.com",
      "submit": "Join the Waitlist",
      "submitting": "Joining...",
      "success": {
        "title": "You're on the list!",
        "message": "We'll reach out soon with updates and early access details."
      },
      "error": {
        "title": "Something went wrong",
        "message": "Please try again later. We're working on it.",
        "unimplemented": "Waitlist service is being set up. Check back soon!"
      }
    },
    "benefits": {
      "earlyAccess": "Priority access to new features",
      "pricing": "Exclusive early-bird pricing",
      "updates": "Regular development updates",
      "feedback": "Shape the product with your feedback"
    },
    "count": "Join {count}+ others on the waitlist"
  }
}
```

### 4.9 Pricing (Hidden Initially)

```json
{
  "pricing": {
    "badge": "Simple Pricing",
    "title": "Plans That Scale With Your Business",
    "subtitle": "Start free. Upgrade when you need more power.",
    "toggle": {
      "monthly": "Monthly",
      "annual": "Annual",
      "annualDiscount": "Save 20%"
    },
    "plans": {
      "free": {
        "name": "Free",
        "price": "$0",
        "period": "/month",
        "description": "Explore and test the platform",
        "features": [
          "Basic agent access",
          "Limited queries per day",
          "1 GB Knowledge Base storage",
          "Community support"
        ],
        "cta": "Get Started Free",
        "highlighted": false
      },
      "starter": {
        "name": "Starter",
        "price": "$25",
        "period": "/month",
        "description": "For regular users and small teams",
        "features": [
          "All 5 specialized agents",
          "Unlimited queries",
          "10 GB Knowledge Base storage",
          "OneDrive & SharePoint sync",
          "Email support",
          "Data visualization"
        ],
        "cta": "Join Waitlist — Starter",
        "highlighted": true
      },
      "professional": {
        "name": "Professional",
        "price": "$199",
        "period": "/month",
        "description": "For power users and growing businesses",
        "features": [
          "Everything in Starter",
          "Custom agent builder",
          "Automated workflows",
          "Priority support",
          "Advanced analytics",
          "API access",
          "Organization environments",
          "Granular permissions"
        ],
        "cta": "Join Waitlist — Professional",
        "highlighted": false
      }
    },
    "faq": {
      "title": "Frequently Asked Questions",
      "items": {
        "trial": {
          "question": "Is there a free trial for paid plans?",
          "answer": "Yes, all paid plans include a 14-day free trial. No credit card required."
        },
        "cancel": {
          "question": "Can I cancel anytime?",
          "answer": "Absolutely. Cancel anytime with no fees. Your data remains accessible for 30 days after cancellation."
        },
        "enterprise": {
          "question": "Do you offer enterprise plans?",
          "answer": "Yes. Contact us for custom pricing, dedicated support, and on-premise deployment options."
        }
      }
    }
  }
}
```

**Nota**: Precios son preliminares (de 99-FUTURE-DEVELOPMENT.md). El pricing section se oculta con feature flag hasta que los precios sean finales.

### 4.10 Footer

```json
{
  "footer": {
    "tagline": "AI-Powered Business Automation",
    "sections": {
      "product": {
        "title": "Product",
        "links": {
          "features": "Features",
          "agents": "Agents",
          "pricing": "Pricing",
          "roadmap": "Roadmap"
        }
      },
      "company": {
        "title": "Company",
        "links": {
          "about": "About",
          "blog": "Blog",
          "careers": "Careers",
          "contact": "Contact"
        }
      },
      "legal": {
        "title": "Legal",
        "links": {
          "privacy": "Privacy Policy",
          "terms": "Terms of Service",
          "gdpr": "GDPR"
        }
      }
    },
    "copyright": "© {year} MyWorkMate. All rights reserved.",
    "builtWith": "Built for the Microsoft Ecosystem"
  }
}
```

---

## 5. SEO Checklist

- [ ] `<title>` tag con nombre de producto + propuesta de valor
- [ ] `<meta name="description">` descriptivo (150-160 chars)
- [ ] Open Graph tags: `og:title`, `og:description`, `og:image`, `og:type`, `og:url`
- [ ] Twitter Card tags: `twitter:card`, `twitter:title`, `twitter:description`
- [ ] `<link rel="alternate" hreflang="x">` para cada locale
- [ ] `<link rel="canonical">` apuntando al locale default
- [ ] Structured data (JSON-LD): Organization, WebSite, SoftwareApplication
- [ ] `robots.txt` — permitir indexación de marketing, bloquear app
- [ ] `sitemap.xml` — incluir todas las páginas marketing con alternates

---

## 6. Criterios de Aceptación

- [ ] `messages/en.json` contiene todos los namespaces documentados en este PRD
- [ ] Todas las keys son accesibles via `useTranslations('Marketing.*')`
- [ ] SEO meta tags renderizados correctamente (verificar con view-source)
- [ ] OG tags validados (usar og debugger de Facebook o similar)
- [ ] Ningún string hardcoded en componentes de marketing — todo viene de i18n
- [ ] Copy es coherente en tono: profesional, directo, orientado a negocio
- [ ] Agent descriptions son consistentes con `@bc-agent/shared` pero adaptadas a marketing

---

## 7. Archivos Afectados

### Modificados
- `frontend/messages/en.json` — expansión con namespace `Marketing`

### Nuevos (futuros, creados por LP-010)
- `frontend/messages/es.json`
- `frontend/messages/da.json`

---

## 8. Notas

- El copy en este PRD es la **versión inicial**. Se espera iteración durante el desarrollo de cada sección.
- Los precios en la sección de pricing son **preliminares** y se confirmarán antes de hacer visible la sección.
- Las keys marcadas con `"comingSoon": true` se renderizan con un badge visual en la UI.
- El copy debe evitar jerga técnica excesiva. El público objetivo es **decision makers de negocio**, no necesariamente técnicos.
