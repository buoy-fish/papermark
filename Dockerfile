# Papermark (buoy.fish fork) — production image for the Services Host.
#
# Upstream is Vercel-first and ships no Dockerfile. Notes:
#   * Node >= 24 is required by mupdf@1.27 (engines in package.json). Bookworm
#     (glibc), not Alpine — mupdf ships WASM and Prisma needs OpenSSL; both are
#     happier on glibc.
#   * No `output: standalone` upstream (next.config.mjs only sets
#     outputFileTracingIncludes), so we ship the full build + node_modules and
#     run `next start`.
#   * Next INLINES NEXT_PUBLIC_* and reads the image distribution host at BUILD
#     time (see next.config.mjs prepareRemotePatterns + headers). Those are
#     baked here as build ARGs defaulting to the paper.buoy.fish target; the
#     S3/R2 *credentials* and DB URLs are runtime env (host .env via compose).
ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- deps: full install (build needs dev deps) ----
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
# The package.json `postinstall` runs `prisma generate`, which needs the schema
# folder present at install time (prismaSchemaFolder preview). Copy it first so
# `npm ci` succeeds (and other packages' install scripts still run normally).
COPY prisma ./prisma
# --legacy-peer-deps: Papermark's tree has peer-dep conflicts (React 18 vs deps
# that peer on 19, etc.); the lockfile is resolved this way, so match it here.
RUN npm ci --legacy-peer-deps

# ---- build: prisma generate + next build ----
FROM base AS build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time public config (inlined into the client bundle / next.config).
ARG NEXT_PUBLIC_BASE_URL=https://paper.buoy.fish
ARG NEXT_PUBLIC_MARKETING_URL=https://paper.buoy.fish
ARG NEXT_PUBLIC_APP_BASE_HOST=paper.buoy.fish
ARG NEXT_PUBLIC_UPLOAD_TRANSPORT=s3
# R2 host so the Next/Image remote pattern allows viewer page images.
# e.g. <ACCOUNT_ID>.r2.cloudflarestorage.com  (or a custom R2 domain)
ARG NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST=""
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_MARKETING_URL=$NEXT_PUBLIC_MARKETING_URL \
    NEXT_PUBLIC_APP_BASE_HOST=$NEXT_PUBLIC_APP_BASE_HOST \
    NEXT_PUBLIC_UPLOAD_TRANSPORT=$NEXT_PUBLIC_UPLOAD_TRANSPORT \
    NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST=$NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST
# Build-stage-only dummies: the EE AI model modules construct OpenAI/Vertex
# clients at import time (ee/features/ai/lib/models/*, lib/openai.ts), which throw
# without a key during `next build`'s page-data collection. These are NOT
# NEXT_PUBLIC, so they are not inlined into any bundle and never reach the runner
# stage — AI features stay disabled at runtime unless real keys are supplied.
ENV OPENAI_API_KEY=sk-build-time-placeholder \
    GOOGLE_VERTEX_API_KEY=build-time-placeholder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r nodejs && useradd -r -g nodejs -m nextjs
# COPY --chown, NOT a trailing `RUN chown -R /app`: chown-ing ~5GB of copied
# files in a RUN step duplicates every file into a second image layer (the
# image doubled to 11GB and the step alone took 8+ minutes per build).
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=build --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chown nextjs:nodejs /app
USER nextjs
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
