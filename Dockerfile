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

COPY --chown=bun:bun index.ts storage.ts history.ts dashboard.ts render.ts submission.ts ./
COPY --chown=bun:bun dashboard ./dashboard
COPY --chown=bun:bun agents ./agents
COPY --chown=bun:bun validate ./validate
COPY --chown=bun:bun eval ./eval
COPY --chown=bun:bun generator ./generator
COPY --chown=bun:bun submission ./submission
COPY --chown=bun:bun tasks/final ./tasks/final
ENTRYPOINT ["bun", "run", "index.ts"]
