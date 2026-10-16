FROM node:20-alpine AS builder
# Prisma needs OpenSSL present so it selects the matching engine binary.
RUN apk add --no-cache openssl
WORKDIR /app
# The build context is the repository root (see render.yaml / docker-compose.yml),
# so package files come from backend/ while deployments/ stays reachable for the
# final stage below.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
# Match the builder so Prisma uses its bundled engine instead of downloading one.
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY backend/package.json ./
# The committed deploy record, so the API can compare its configured contract
# ids against the latest deploy at startup and warn when they are stale (issue
# #91). Copied from the context root, not the builder image.
COPY deployments ./deployments

# Drop root (CIS 4.1): the base image ships an unprivileged `node` user
# (uid 1000) that is never used otherwise. Nothing in this image is written at
# runtime — migrations are applied DB-side and the API only logs to stdout —
# so root-owned, world-readable files above are enough. The writable paths the
# process does use (`/tmp`, `/home/node`) are already owned by `node`.
USER node

EXPOSE 3000
# Apply committed migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
