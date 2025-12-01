# Frontend Architecture

## Overview

The frontend is a Next.js 15 application using the App Router, React 19, and TypeScript. It communicates with the backend via REST API (for CRUD operations) and WebSocket (for real-time streaming).

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.0.6 | React framework with App Router |
| React | 19.2.0 | UI library |
| TypeScript | 5.x | Type safety |
| Zustand | 5.0.2 | State management |
| Socket.IO Client | 4.8.1 | WebSocket communication |
| Zod | 3.25.76 | Runtime validation |
| Tailwind CSS | 4.x | Styling |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          Frontend                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Next.js App Router                        ││
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐               ││
│  │  │  /login   │  │   /new    │  │ /chat/:id │               ││
│  │  └───────────┘  └───────────┘  └───────────┘               ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Zustand Stores                            ││
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐        ││
│  │  │  authStore  │  │ sessionStore │  │  chatStore │        ││
│  │  └─────────────┘  └──────────────┘  └────────────┘        ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     Services Layer                           ││
│  │  ┌──────────────────┐      ┌───────────────────┐           ││
│  │  │    ApiClient     │      │   SocketService   │           ││
│  │  │   (REST API)     │      │   (WebSocket)     │           ││
│  │  └──────────────────┘      └───────────────────┘           ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                  @bc-agent/shared                            ││
│  │            (Types, Schemas, Constants)                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Backend                                 │
│              (Express + Socket.IO + Claude API)                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### REST API Flow (Sessions, Messages)

```
User Action → Store Action → ApiClient → Backend API → Response → Store Update → UI Update
```

### WebSocket Flow (Real-time Events)

```
User Message → SocketService.sendMessage() → Backend
                                                │
Backend Processing ──────────────────────────────┘
    │
    ▼
agent:event ─────────► SocketService ─────────► chatStore.handleAgentEvent()
                                                       │
                                                       ▼
                                               UI Update (streaming)
```

## Key Design Decisions

### 1. Shared Type Package

All types are defined in `@bc-agent/shared` and imported by both frontend and backend. This ensures:
- Compile-time type safety across the full stack
- Single source of truth for API contracts
- CI/CD verification of type compatibility

### 2. Singleton Services

Both `ApiClient` and `SocketService` use singleton patterns:
- Ensures consistent state across the application
- Prevents multiple WebSocket connections
- Easy to mock in tests

### 3. Zustand for State Management

Chosen over Redux/Context for:
- Minimal boilerplate
- Built-in TypeScript support
- `subscribeWithSelector` for efficient subscriptions
- Easy testing with direct state manipulation

### 4. Event Sourcing in Chat Store

Messages are ordered by `sequence_number` (from backend's Event Store):
- Guarantees correct message ordering
- Supports optimistic updates with eventual consistency
- Handles out-of-order event delivery

## File Organization

```
lib/
├── config/
│   └── env.ts              # Environment configuration
├── services/
│   ├── api.ts              # REST API client
│   ├── socket.ts           # WebSocket client
│   └── index.ts            # Barrel export
└── stores/
    ├── authStore.ts        # Authentication state
    ├── sessionStore.ts     # Session management
    ├── chatStore.ts        # Chat/message state
    ├── socketMiddleware.ts # WebSocket + Zustand integration
    └── index.ts            # Barrel export
```
