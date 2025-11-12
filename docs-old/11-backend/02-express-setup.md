# Express Server Setup

## Project Structure

```
backend/
├── src/
│   ├── server.ts              # Entry point
│   ├── api/
│   │   ├── auth/              # Microsoft OAuth routes (NEW)
│   │   ├── agent/
│   │   ├── session/
│   │   └── approval/
│   ├── agents/
│   ├── middleware/
│   │   └── auth-microsoft.ts  # OAuth session validation (NEW)
│   ├── services/
│   │   └── auth/              # OAuth services (NEW)
│   │       ├── MicrosoftOAuthService.ts
│   │       ├── BCTokenManager.ts
│   │       └── EncryptionService.ts
│   └── utils/
├── tsconfig.json
└── package.json
```

## Installation

```bash
cd backend

# Core dependencies
npm install express socket.io cors helmet

# Microsoft OAuth & session management (NEW)
npm install express-session @azure/msal-node

# Development dependencies
npm install -D @types/express @types/node @types/express-session typescript ts-node nodemon
```

## Configuration

```typescript
// src/server.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true  // Allow cookies for session management
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management (for Microsoft OAuth)
import session from 'express-session';
app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000')  // 24 hours
  }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes
import authRoutes from './api/auth';  // Microsoft OAuth routes
import agentRoutes from './api/agent';

app.use('/api/auth', authRoutes);  // OAuth endpoints (login, callback, logout, etc.)
app.use('/api/agent', agentRoutes);

// Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Scripts

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  }
}
```

---

**Versión**: 1.0
