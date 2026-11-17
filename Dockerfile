# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.28.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.server.json vite.config.ts tsup.config.ts index.html tailwind.config.js postcss.config.js ./
COPY src ./src
COPY vendor ./vendor
COPY public ./public
COPY migrations ./migrations
COPY config ./config
COPY scripts ./scripts
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data
RUN groupadd --gid 1001 relaycheck && useradd --uid 1001 --gid relaycheck --shell /usr/sbin/nologin --create-home relaycheck \
    && mkdir -p /data && chown relaycheck:relaycheck /data
COPY --from=build --chown=relaycheck:relaycheck /app/package.json ./package.json
COPY --from=build --chown=relaycheck:relaycheck /app/node_modules ./node_modules
COPY --from=build --chown=relaycheck:relaycheck /app/dist ./dist
COPY --from=build --chown=relaycheck:relaycheck /app/vendor ./vendor
COPY --from=build --chown=relaycheck:relaycheck /app/migrations ./migrations
COPY --from=build --chown=relaycheck:relaycheck /app/config ./config
USER relaycheck
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]