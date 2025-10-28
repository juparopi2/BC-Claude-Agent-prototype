# Express Server Setup

## Project Structure

```
backend/
├── src/
│   ├── server.ts              # Entry point
│   ├── api/
│   │   ├── agent/
│   │   ├── session/
│   │   └── approval/
│   ├── agents/
│   ├── middleware/
│   ├── services/
│   └── utils/
├── tsconfig.json
└── package.json
```

## Installation

```bash
cd backend
npm install express socket.io cors helmet
npm install -D @types/express @types/node typescript ts-node nodemon
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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes
import agentRoutes from './api/agent';
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
