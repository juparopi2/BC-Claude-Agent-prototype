# BC-Claude-Agent

Un sistema de agentes de inteligencia artificial diseñado para interactuar de manera inteligente y autónoma con Microsoft Business Central.

Inspirado en Claude Code, este proyecto combina la potencia de los Large Language Models (Claude) con la integración profunda a Business Central mediante Model Context Protocol (MCP).

## Visión

Crear una interfaz conversacional tipo Claude Code que permita a los usuarios:
- Ejecutar operaciones complejas en Business Central mediante lenguaje natural
- Visualizar progreso mediante to-do lists automáticos
- Aprobar cambios antes de su ejecución
- Trabajar con drag & drop de contextos (archivos, entities, datos)

## Características Principales

- 🤖 **Sistema de Agentes**: Orchestrator principal con subagentes especializados
- 💬 **Chat Interface**: UI tipo Claude Code con streaming en tiempo real
- ✅ **Human-in-the-Loop**: Sistema de aprobaciones para operaciones críticas
- 📋 **To-Do Lists**: Progreso visible y actualizado en tiempo real
- 🔌 **MCP Integration**: Conexión con MCP server potente pre-existente
- 🏢 **Business Central**: Integración completa con BC API (OData + REST)
- 🎨 **Modern Stack**: Next.js 15, React 19, TypeScript, Tailwind CSS
- ⚡ **Performance**: Prompt caching, parallel execution, token optimization

## Tech Stack

### Frontend
- **Next.js 15** - Framework React con App Router
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS 4** - Styling
- **Socket.IO** - Real-time communication

### Backend
- **Express.js** - API server
- **Next.js API Routes** - Edge functions
- **TypeScript** - Type safety
- **PostgreSQL** - Database
- **Redis** - Cache & queues

### AI & Integrations
- **Claude SDK** (@anthropic-ai/sdk) - LLM integration
- **MCP** - Model Context Protocol para BC
- **Business Central API** - OData v4 + REST

## Quick Start

### Prerequisites

- Node.js 20+ LTS
- PostgreSQL 15+
- Redis 7+
- Business Central access (API credentials)
- Claude API key
- MCP server running (your pre-built MCP)

### Installation

```bash
# Clone repository
git clone https://github.com/yourorg/BC-Claude-Agent-prototype.git
cd BC-Claude-Agent-prototype

# Install frontend dependencies
cd frontend
npm install

# Install backend dependencies
cd ../backend
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your credentials
```

### Configuration

#### Frontend `.env.local`
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

#### Backend `.env`
```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bcagent
REDIS_URL=redis://localhost:6379

# Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Business Central
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0
BC_TENANT_ID=your-tenant-id
BC_CLIENT_ID=your-client-id
BC_CLIENT_SECRET=your-client-secret

# MCP
MCP_SERVER_URL=http://localhost:3002
```

### Database Setup

```bash
cd backend
npm run migrate
npm run seed  # Optional: demo data
```

### Run Development

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: Your MCP Server
# Start your pre-built MCP server on port 3002
```

Visit: http://localhost:3000

## Project Structure

```
BC-Claude-Agent-prototype/
├── docs/                      # 📚 Comprehensive documentation
│   ├── 00-overview/          # Project vision, system overview
│   ├── 01-architecture/      # System architecture, patterns
│   ├── 02-core-concepts/     # Agents, LLM enhancements, patterns
│   ├── 03-agent-system/      # Agentic loops, orchestration
│   ├── 04-integrations/      # MCP, BC integration
│   ├── 05-control-flow/      # HITL, permissions, hooks
│   ├── 06-observability/     # Logging, tracing, monitoring
│   ├── 07-security/          # Security measures
│   ├── 08-state-persistence/ # Sessions, checkpoints
│   ├── 09-performance/       # Optimization strategies
│   ├── 10-ui-ux/            # UI/UX design, components
│   ├── 11-backend/          # Backend architecture
│   ├── 12-development/      # Setup, workflow, standards
│   └── 13-implementation-roadmap/  # MVP, phases, checklist
│
├── frontend/                 # Next.js 15 frontend
│   ├── app/                 # App router
│   ├── components/          # React components
│   ├── lib/                 # Utilities
│   └── public/              # Static assets
│
└── backend/                  # Express.js backend (to be created)
    ├── src/
    │   ├── agents/          # Agent system
    │   ├── api/             # API routes
    │   ├── integrations/    # MCP, BC clients
    │   └── services/        # Business logic
    └── tests/               # Tests
```

## Documentation

📖 **[Start Here: Project Vision](./docs/00-overview/01-project-vision.md)**

### Key Documents

- **Getting Started**
  - [Project Vision](./docs/00-overview/01-project-vision.md)
  - [System Overview](./docs/00-overview/02-system-overview.md)
  - [Technology Stack](./docs/00-overview/03-technology-stack.md)

- **Architecture**
  - [System Architecture](./docs/01-architecture/01-system-architecture.md)
  - [Distributed Patterns](./docs/01-architecture/02-distributed-patterns.md)
  - [Fault Tolerance](./docs/01-architecture/03-fault-tolerance.md)
  - [ACI Principles](./docs/01-architecture/04-aci-principles.md)

- **Implementation**
  - [MVP Definition](./docs/13-implementation-roadmap/01-mvp-definition.md)
  - [Phase 1: Foundation](./docs/13-implementation-roadmap/02-phase-1-foundation.md)
  - [Implementation Checklist](./docs/13-implementation-roadmap/06-iteration-checklist.md)

- **Development**
  - [Setup Guide](./docs/12-development/01-setup-guide.md)
  - [Development Workflow](./docs/12-development/02-development-workflow.md)
  - [Coding Standards](./docs/12-development/03-coding-standards.md)

## MVP Roadmap

### Phase 1: Foundation (Weeks 1-3)
- ✅ Project setup (frontend already done)
- Backend infrastructure
- Database schema
- MCP integration
- Authentication
- Basic agent system

### Phase 2: MVP Core (Weeks 4-7)
- Subagents (Query, Write)
- Chat interface
- Approval system
- To-do lists
- Source panel
- End-to-end integration

### Phase 3: Polish & Test (Weeks 8-9)
- Testing (unit, integration, E2E)
- Bug fixes
- Documentation
- Performance optimization
- Demo preparation

**Total MVP Timeline**: 6-9 weeks

See: [Implementation Roadmap](./docs/13-implementation-roadmap/) for details.

## Core Principles

### 1. Human-in-the-Loop
El usuario mantiene control total con aprobaciones antes de operaciones críticas.

### 2. Transparency
Todo lo que el agente hace es visible mediante to-do lists y logs.

### 3. Robustness
Checkpoints, rollbacks, y error recovery automático.

### 4. Efficiency
Prompt caching, token optimization, y ejecuciones paralelas.

### 5. Extensibility
Arquitectura modular que permite agregar nuevas capacidades fácilmente.

## MCP Integration

Este proyecto utiliza un **MCP server potente pre-construido** que expone:

- **Tools**: `bc_query_entity`, `bc_create_entity`, `bc_update_entity`, `bc_delete_entity`, `bc_batch_operation`
- **Resources**: Entity schemas, API docs, company info
- **Prompts**: Query builder, data validator

Ver: [MCP Overview](./docs/04-integrations/01-mcp-overview.md)

## Example Usage

```
User: "Create a customer named Acme Corp with email acme@example.com"

Agent:
📋 To-Do:
 ⚙ Validating customer data...
 □ Request approval
 □ Create customer in BC
 □ Confirm creation

Agent: "I've validated the data. Ready to create?"

[Approval Dialog appears]
→ Create Customer
   - Name: Acme Corp
   - Email: acme@example.com

[User clicks "Approve"]

Agent:
📋 To-Do:
 ☑ Validating customer data
 ☑ Request approval
 ☑ Create customer in BC
 ☑ Confirm creation

Agent: "✅ Customer 'Acme Corp' created successfully with ID CUS-001"
```

## Contributing

Este es un prototipo privado. Para contribuir:

1. Crear feature branch desde `develop`
2. Seguir [Coding Standards](./docs/12-development/03-coding-standards.md)
3. Crear Pull Request
4. Esperar code review

## License

Private - All Rights Reserved

## Support

Para preguntas o issues:
- 📧 Email: your-email@company.com
- 📝 Docs: [./docs/](./docs/)

---

**Status**: 🚧 In Development (MVP Phase)

**Version**: 0.1.0

**Last Updated**: 2025-10-28
