# --- Stage 1: Build the frontend ---
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- Stage 2: Build the backend ---
FROM node:22-alpine AS server-build
WORKDIR /app/server
RUN apk add --no-cache python3 make g++
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# --- Stage 3: Final runtime image ---
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++

# Copy backend's compiled output + production deps
COPY server/package*.json ./
RUN npm install --omit=dev
COPY --from=server-build /app/server/dist ./dist

# Copy frontend's built static files into a "public" folder next to dist
COPY --from=client-build /app/client/dist ./public

EXPOSE 3000
CMD ["node", "dist/index.js"]