# syntax=docker/dockerfile:1
# Multi-stage build (dev doc §15.1). Zero native addons, so no build toolchain is needed.
# Podman: pass --format docker to keep the HEALTHCHECK (OCI format drops it).

FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace=packages/shared --workspace=server \
 && npm cache clean --force

FROM node:26-bookworm-slim
ARG VERSION=0.0.0
LABEL org.opencontainers.image.title="Production Line Web" \
      org.opencontainers.image.description="Self-hosted, LAN-only scheduling for shared 3D printers" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/TheGraysonHarbison/production-line-web"
# TZ is left unset (UTC) for log timestamps; set it in compose.yaml / the Quadlet unit. The app's
# own timezone is chosen in Settings → General. DATA_DIR is the /data volume.
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations
COPY --from=build /app/server/public ./server/public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/meta').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
