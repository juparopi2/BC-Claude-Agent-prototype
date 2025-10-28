# Technology Stack

## Stack Completo

### Frontend

| Tecnología | Versión | Propósito | Justificación |
|------------|---------|-----------|---------------|
| **Next.js** | 15.0.0 | Framework React | App Router, SSR, API Routes, optimización automática |
| **React** | 19.2.0 | UI Library | Última versión con Server Components y mejoras de performance |
| **TypeScript** | 5.x | Lenguaje | Type safety, mejor DX, refactoring seguro |
| **Tailwind CSS** | 4.x | Styling | Utility-first, rápido desarrollo, consistencia |
| **Geist Font** | Latest | Tipografía | Fuente moderna de Vercel, optimizada para UI |

### Backend

| Tecnología | Versión | Propósito | Justificación |
|------------|---------|-----------|---------------|
| **Express.js** | Latest | API Server | Flexible, maduro, gran ecosistema |
| **Next.js API** | 15.0.0 | API Routes | Integrado con frontend, edge functions |
| **TypeScript** | 5.x | Lenguaje | Coherencia con frontend, type safety |
| **Node.js** | 20+ LTS | Runtime | Última versión LTS con mejor performance |

### AI & Agents

| Tecnología | Versión | Propósito | Justificación |
|------------|---------|-----------|---------------|
| **Claude SDK** | Latest | LLM Integration | SDK oficial de Anthropic, soporte completo |
| **Anthropic API** | Latest | Claude Models | Acceso a Claude Sonnet, Opus, Haiku |
| **MCP SDK** | Latest | Model Context Protocol | Protocolo estándar para tools y contexto |

### Integraciones

| Tecnología | Versión | Propósito | Justificación |
|------------|---------|-----------|---------------|
| **MCP Server (Custom)** | Pre-built | BC Integration | Ya construido, potente, específico para BC |
| **BC OData API** | v4 | BC Queries | API estándar de Business Central |
| **BC REST API** | Latest | BC Operations | Operaciones que OData no cubre |
| **OAuth 2.0** | - | Authentication | Estándar de seguridad para BC |

### Database & Storage

| Tecnología | Versión | Propósito | Justificación |
|------------|---------|-----------|---------------|
| **PostgreSQL** | 15+ | Relational DB | Robusto, JSONB para datos flexibles, full-text search |
| **Redis** | 7+ | Cache & Queue | Cache de prompts, session store, message queue |
| **File System** | - | Local Storage | CloudMD files, uploaded files, checkpoints |

### Development Tools

| Tecnología | Versión | Propósito | Justificación |
|------------|---------|-----------|---------------|
| **ESLint** | 9+ | Linting | Code quality, consistencia |
| **Prettier** | Latest | Formatting | Code formatting automático |
| **Jest** | Latest | Testing | Unit tests, integration tests |
| **Playwright** | Latest | E2E Testing | Tests end-to-end |
| **Husky** | Latest | Git Hooks | Pre-commit hooks |

### Deployment & Infrastructure

| Tecnología | Versión | Propósito | Justificación |
|------------|---------|-----------|---------------|
| **Docker** | Latest | Containerization | Reproducibilidad, fácil deployment |
| **Docker Compose** | Latest | Local Dev | Ambiente local completo |
| **Vercel** | - | Frontend Hosting | Hosting optimizado para Next.js |
| **AWS/Azure** | - | Backend Hosting | Escalabilidad, proximity a BC (Azure) |

## Justificación de Decisiones Clave

### ¿Por qué Next.js 15?

**Ventajas**:
- App Router maduro con React Server Components
- API Routes para backend ligero
- Edge functions para baja latencia
- Optimización automática de imágenes y fuentes
- Streaming SSR para respuestas progresivas
- Coherencia: mismo stack frontend y API

**Trade-offs**:
- Learning curve de Server Components
- Menos flexible que backend separado puro

**Decisión**: Los beneficios de un stack unificado superan los trade-offs.

### ¿Por qué Express además de Next.js API?

**Razones**:
- **Separación de Concerns**: Next.js API para rutas simples, Express para lógica compleja
- **WebSockets**: Express facilita WebSocket para streaming
- **Middleware Ecosystem**: Gran cantidad de middleware disponible
- **Escalabilidad**: Separar backend permite escalar independientemente

**Arquitectura**:
```
Next.js App (Frontend + API Routes ligeras)
        ↓
Express Server (Lógica de negocio pesada)
        ↓
Agents & Integrations
```

### ¿Por qué TypeScript en todo?

**Beneficios**:
- **Type Safety**: Detectar errores en compile time
- **Autocomplete**: Mejor DX con IntelliSense
- **Refactoring**: Cambios seguros a gran escala
- **Documentación**: Los tipos son documentación viva
- **Coherencia**: Compartir types entre frontend y backend

**Ejemplo**:
```typescript
// Tipos compartidos entre frontend y backend
interface BCUser {
  id: string;
  name: string;
  email: string;
  role: BCUserRole;
  createdAt: Date;
}

type BCUserRole = 'admin' | 'vendedor' | 'comprador' | 'viewer';
```

### ¿Por qué PostgreSQL?

**Comparación con Alternativas**:

| Feature | PostgreSQL | MongoDB | MySQL |
|---------|-----------|---------|-------|
| JSONB | ✅ Sí | ✅ Nativo | ❌ No |
| Full-text search | ✅ Sí | ⚠️ Limitado | ⚠️ Limitado |
| Transactions | ✅ ACID | ⚠️ Limitado | ✅ ACID |
| Complex queries | ✅ Excelente | ❌ Limitado | ✅ Bueno |
| Type safety | ✅ Fuerte | ❌ Schema-less | ✅ Fuerte |

**Decisión**: PostgreSQL ofrece lo mejor de ambos mundos (relacional + JSONB para flexibilidad).

### ¿Por qué Redis?

**Casos de Uso**:
1. **Prompt Caching**: Cache de prompts para Claude (reducción de costos)
2. **Session Store**: Sessions de chat en memoria rápida
3. **Rate Limiting**: Contadores de requests por usuario
4. **Message Queue**: Queue de tareas asíncronas
5. **Pub/Sub**: Notificaciones en tiempo real

**Alternativas Consideradas**:
- **Memcached**: Menos features que Redis
- **In-Memory Node**: No persiste, no distribuido
- **Database**: Demasiado lento para cache

## Dependencias Principales

### Frontend (package.json)

```json
{
  "dependencies": {
    "next": "15.0.0",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "@anthropic-ai/sdk": "^0.x.x",
    "tailwindcss": "^4.x.x",
    "zustand": "^4.x.x",           // State management
    "react-query": "^5.x.x",       // Data fetching
    "socket.io-client": "^4.x.x",  // WebSocket
    "react-beautiful-dnd": "^13.x", // Drag & drop
    "monaco-editor": "^0.x.x",     // Code editor
    "lucide-react": "^0.x.x"       // Icons
  },
  "devDependencies": {
    "typescript": "^5.x.x",
    "eslint": "^9.x.x",
    "eslint-config-next": "15.0.0",
    "@types/react": "^19.x.x",
    "@types/node": "^20.x.x",
    "prettier": "^3.x.x"
  }
}
```

### Backend (package.json)

```json
{
  "dependencies": {
    "express": "^4.x.x",
    "@anthropic-ai/sdk": "^0.x.x",
    "socket.io": "^4.x.x",
    "pg": "^8.x.x",                // PostgreSQL client
    "redis": "^4.x.x",             // Redis client
    "ioredis": "^5.x.x",           // Redis alternativo
    "jsonwebtoken": "^9.x.x",      // JWT
    "bcrypt": "^5.x.x",            // Password hashing
    "zod": "^3.x.x",               // Schema validation
    "winston": "^3.x.x",           // Logging
    "express-rate-limit": "^7.x.x" // Rate limiting
  },
  "devDependencies": {
    "typescript": "^5.x.x",
    "ts-node": "^10.x.x",
    "nodemon": "^3.x.x",
    "@types/express": "^4.x.x",
    "jest": "^29.x.x",
    "@types/jest": "^29.x.x"
  }
}
```

## Arquitectura de Carpetas

### Frontend

```
frontend/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Auth group
│   │   ├── login/
│   │   └── register/
│   ├── (main)/              # Main app group
│   │   ├── chat/
│   │   ├── sources/
│   │   └── settings/
│   ├── api/                 # API Routes
│   │   ├── auth/
│   │   ├── session/
│   │   └── health/
│   ├── layout.tsx
│   └── page.tsx
├── components/              # React components
│   ├── ui/                 # Base UI components
│   ├── chat/               # Chat components
│   ├── sources/            # Source explorer
│   └── approvals/          # Approval system
├── lib/                    # Utilities
│   ├── api-client.ts
│   ├── socket.ts
│   └── utils.ts
├── hooks/                  # Custom hooks
├── stores/                 # Zustand stores
├── types/                  # TypeScript types
└── public/                 # Static assets
```

### Backend

```
backend/
├── src/
│   ├── api/                # Express routes
│   │   ├── agent/
│   │   ├── session/
│   │   └── bc/
│   ├── agents/             # Agent system
│   │   ├── orchestrator/
│   │   ├── subagents/
│   │   └── tools/
│   ├── integrations/       # External integrations
│   │   ├── mcp/
│   │   ├── bc/
│   │   └── claude/
│   ├── persistence/        # Database & storage
│   │   ├── postgres/
│   │   ├── redis/
│   │   └── filesystem/
│   ├── middleware/         # Express middleware
│   │   ├── auth.ts
│   │   ├── permissions.ts
│   │   └── logging.ts
│   ├── utils/             # Utilities
│   ├── types/             # TypeScript types
│   └── server.ts          # Entry point
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── scripts/               # Build & deploy scripts
```

## Variables de Entorno

### Frontend (.env.local)

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001

# Feature Flags
NEXT_PUBLIC_ENABLE_THINKING_MODE=true
NEXT_PUBLIC_ENABLE_CHAT_FORK=true

# Analytics (opcional)
NEXT_PUBLIC_ANALYTICS_ID=
```

### Backend (.env)

```bash
# Server
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bcagent
REDIS_URL=redis://localhost:6379

# Claude API
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-3-5-sonnet-20241022

# Business Central
BC_API_URL=https://api.businesscentral.dynamics.com
BC_TENANT_ID=
BC_CLIENT_ID=
BC_CLIENT_SECRET=

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRY=24h

# MCP
MCP_SERVER_URL=http://localhost:3002

# Logging
LOG_LEVEL=debug
```

## Scripts de Desarrollo

### package.json (Root)

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:frontend\" \"npm run dev:backend\"",
    "dev:frontend": "cd frontend && npm run dev",
    "dev:backend": "cd backend && npm run dev",
    "build": "npm run build:frontend && npm run build:backend",
    "test": "npm run test:frontend && npm run test:backend",
    "lint": "npm run lint:frontend && npm run lint:backend",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down"
  }
}
```

## Próximos Pasos

1. Instalar dependencias base
2. Configurar TypeScript paths
3. Setup de base de datos
4. Configurar Claude SDK
5. Integrar MCP server existente

Ver:
- [Setup Guide](../12-development/01-setup-guide.md)
- [Development Workflow](../12-development/02-development-workflow.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
**Autor**: BC-Claude-Agent Team
