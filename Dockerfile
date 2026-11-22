FROM node:20-bookworm-slim

# Native build tools for better-sqlite3 fallback
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install frontend dependencies and build
COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci

COPY . .
RUN npm run build

# Ensure runtime directories exist
RUN mkdir -p /app/uploads /app/backups

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
