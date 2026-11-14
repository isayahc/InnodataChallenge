FROM oven/bun:1.4.4

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown bun:bun /app
USER bun

COPY --chown=bun:bun package.json package-lock.json ./
RUN bun install --production --frozen-lockfile

COPY --chown=bun:bun index.ts storage.ts history.ts dashboard.ts render.ts ./
COPY --chown=bun:bun dashboard ./dashboard
COPY --chown=bun:bun agents ./agents
ENTRYPOINT ["bun", "run", "index.ts"]
