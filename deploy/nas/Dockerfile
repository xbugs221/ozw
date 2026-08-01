# PURPOSE: Build a production ozw image with the exact Node.js and pnpm
# versions required by the repository; runtime data stays outside the image.

FROM node:24-bookworm AS build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY

ENV COREPACK_HOME=/corepack \
    PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store \
    PATH=/pnpm:$PATH \
    HTTP_PROXY=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    ALL_PROXY=$ALL_PROXY

RUN corepack enable \
    && corepack prepare pnpm@11.10.0 --activate

RUN node_version=$(node -p "process.version") \
    && mkdir -p /opt/node-headers \
    && curl --fail --http1.1 --location --retry 8 --retry-all-errors --retry-delay 2 \
        --output /tmp/node-headers.tar.gz \
        "https://nodejs.org/download/release/${node_version}/node-${node_version}-headers.tar.gz" \
    && tar -xzf /tmp/node-headers.tar.gz --strip-components=1 -C /opt/node-headers \
    && rm -f /tmp/node-headers.tar.gz

ENV npm_config_nodedir=/opt/node-headers

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/fix-node-pty.ts ./scripts/fix-node-pty.ts
RUN --mount=type=cache,id=ozw-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

COPY . .
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

WORKDIR /app

COPY --from=build /app/package.json ./package.json
# Runtime still reads bundled SQL and built-in command alias assets from backend/.
COPY --from=build /app/backend ./backend
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-node ./dist-node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist-node/backend/index.js"]
