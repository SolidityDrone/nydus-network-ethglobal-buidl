# Build stage
ARG TARGETPLATFORM
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* ./

# Install dependencies (use --immutable if yarn.lock exists, otherwise regular install)
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile; else yarn install; fi

# Copy source code
COPY . .

# Build TypeScript
RUN yarn build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* ./

# Install only production dependencies
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile --production; else yarn install --production; fi

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/circuits ./circuits

# Expose port
EXPOSE 3001

# Run the application
CMD ["node", "dist/index.js"]
