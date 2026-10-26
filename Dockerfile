# Production container. Uses PostgreSQL Prisma client and migrations.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx prisma generate --schema prisma/schema.postgresql.prisma
RUN npm run typecheck && npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
EXPOSE 3000
# Migrations must run in a single release job, not on every concurrent app container.
CMD ["npm","run","start"]
