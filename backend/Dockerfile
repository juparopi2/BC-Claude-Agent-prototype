# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install git for submodule operations
RUN apk add --no-cache git

# Copy package files for backend
COPY package*.json ./
COPY tsconfig.json ./

# Install backend dependencies
RUN npm ci --only=production && \
    npm ci --only=development

# Copy source code
COPY src ./src

# Copy .git and .gitmodules for submodule initialization
COPY .git ./.git
COPY .gitmodules ./.gitmodules

# Initialize and update git submodules to get MCP server code
RUN git submodule init && \
    git submodule update --remote

# Build MCP server
WORKDIR /app/mcp-server
RUN npm ci && npm run build

# Build backend TypeScript
WORKDIR /app
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy MCP server built files
COPY --from=builder /app/mcp-server/dist ./mcp-server/dist
COPY --from=builder /app/mcp-server/data ./mcp-server/data
COPY --from=builder /app/mcp-server/package*.json ./mcp-server/

# Install MCP server production dependencies
WORKDIR /app/mcp-server
RUN npm ci --only=production

# Go back to app root
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/server.js"]
