# =============================================================================
# Backend Dockerfile - Express + TypeScript with Monorepo Support
# =============================================================================
# Multi-stage build for monorepo with @bc-agent/shared package dependency
# Uses npm workspaces for proper dependency resolution
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy workspace configuration files
COPY package.json package-lock.json ./

# Copy shared package configuration
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/tsup.config.ts ./packages/shared/

# Copy backend package configuration
COPY backend/package.json ./backend/

# Copy frontend package.json (required for npm workspaces to resolve all dependencies)
COPY frontend/package.json ./frontend/

# Install ALL workspace dependencies (needed for build)
# This resolves @bc-agent/shared as a workspace package
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
# Note: npm workspaces hoist most dependencies to root node_modules
# packages/shared has no local node_modules (all deps hoisted)
COPY --from=deps /app/node_modules ./node_modules

# Copy workspace configuration
COPY package.json package-lock.json ./

# Copy and build shared package first (backend depends on it)
COPY packages/shared ./packages/shared
RUN npm run -w @bc-agent/shared build

# Copy backend package.json (needed for npm run build)
COPY backend/package.json ./backend/

# Copy backend source code
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src

# Copy MCP server data files (vendored static data, no build needed)
COPY backend/mcp-server/data ./backend/mcp-server/data
COPY backend/mcp-server/bcoas1.0.yaml ./backend/mcp-server/bcoas1.0.yaml

# Build backend TypeScript using SWC
WORKDIR /app/backend
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: Production
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

# Copy workspace configuration for production install
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install production dependencies only
# --omit=dev excludes devDependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built shared package
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Copy built backend
COPY --from=builder /app/backend/dist ./backend/dist

# Copy MCP server data files
COPY --from=builder /app/backend/mcp-server/data ./backend/mcp-server/data
COPY --from=builder /app/backend/mcp-server/bcoas1.0.yaml ./backend/mcp-server/bcoas1.0.yaml

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the port the server runs on
EXPOSE 3001

# Health check for container orchestration
# Uses liveness endpoint which doesn't check external services (faster response)
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health/liveness', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Set working directory to backend for npm start
WORKDIR /app/backend

# Use dumb-init to handle signals properly (PID 1 issues)
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/server.js"]
