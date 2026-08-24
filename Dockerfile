FROM node:22-alpine AS client-build
WORKDIR /app/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /app/server

RUN apk add --no-cache python3 make g++

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/ ./
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/app/data

WORKDIR /app

RUN addgroup -S app \
  && adduser -S -G app app \
  && mkdir -p /app/data \
  && chown -R app:app /app

COPY --from=server-build --chown=app:app /app/server/node_modules ./node_modules
COPY --from=server-build --chown=app:app /app/server/dist ./dist
COPY --from=client-build --chown=app:app /app/client/dist ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(4000) }).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

USER app:app

CMD ["node", "dist/index.js"]
