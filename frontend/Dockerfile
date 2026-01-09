# =============================================================================
# Frontend Dockerfile - Next.js with Standalone Output
# =============================================================================
# Multi-stage build for monorepo with @bc-agent/shared package dependency
# Produces a minimal ~100MB image using Next.js standalone output mode
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy workspace configuration files
COPY package.json package-lock.json ./

# Copy shared package files
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/tsup.config.ts ./packages/shared/

# Copy backend package.json (required for npm workspaces to resolve all dependencies)
COPY backend/package.json ./backend/

# Copy frontend package.json
COPY frontend/package.json ./frontend/

# Install ALL workspace dependencies (needed for build)
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

# Copy and build shared package
COPY packages/shared ./packages/shared
RUN npm run -w @bc-agent/shared build

# Copy frontend source
COPY frontend ./frontend

# Copy frontend-specific node_modules (npm workspaces creates nested deps)
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules

# Build arguments for Next.js public environment variables
# These are baked into the build at compile time
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_ENV=production

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_ENV=$NEXT_PUBLIC_ENV
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build Next.js application with standalone output
WORKDIR /app/frontend
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: Production Runner
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build output
# The standalone output includes a minimal Node.js server
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./

# Copy static assets (CSS, JS, images)
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static

# Copy public assets if they exist (favicon, robots.txt, etc.)
# Using a workaround since COPY fails if directory doesn't exist
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public* ./frontend/public/

# Switch to non-root user
USER nextjs

# Expose the port Next.js runs on
EXPOSE 3000

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start the Next.js standalone server
CMD ["node", "frontend/server.js"]
