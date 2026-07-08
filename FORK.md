# buoy.fish fork of Papermark — deviations from upstream

This fork (`github.com/buoy-fish/papermark`) runs at **paper.buoy.fish** on the
buoy.fish Services Host. Per ADR-0002 (sign.buoy.fish), a fork carries a "rebase
tax": every upstream merge must re-apply the changes below. Keep this file the
single source of truth for *what* we changed and *why*, so rebases are mechanical.

Upstream remote: `git remote add upstream https://github.com/mfts/papermark`.

---

## 1. Containerization (additive — low rebase risk)

Upstream is Vercel-first and ships no container build. New files, no upstream
conflict:

- `Dockerfile` — multi-stage, `node:24-bookworm-slim` (mupdf@1.27 needs Node ≥24;
  glibc for mupdf WASM + Prisma OpenSSL). Bakes build-time `NEXT_PUBLIC_*` + the
  R2 image host as ARGs (Next inlines them). `deps` stage copies `prisma/` before
  `npm ci` because the `postinstall` runs `prisma generate`.
- `docker-entrypoint.sh` — `prisma migrate deploy` then `next start`.
- `.dockerignore`.
- `npm ci --legacy-peer-deps` (Dockerfile) — the dependency tree has peer
  conflicts (React 18 vs deps peering on 19); the lockfile is resolved this way.

### Added dependency

- `@react-email/components` (`^0.5.7`, the highest React-18-compatible `0.x`).
  The OSS tree imports it from the EE email templates but upstream never declares
  it (only `react-email` + `@react-email/ui`). Added to `package.json` + lock so
  `next build` resolves. On an upstream bump, check whether they've added it (then
  drop our entry) and whether the version should track React 19 (`1.x`).

## 2. next.config.mjs (patched — MEDIUM rebase risk, re-check on bumps)

- Added `typescript.ignoreBuildErrors` + `eslint.ignoreDuringBuilds`. Required
  because the OSS tree imports withheld EE modules we stub (§3) with loose `any`
  types; we verify correctness by running the app, not by `next build`.
- `/services/:path*` header rule: host `value` falls back to `"webhooks.invalid"`
  when `NEXT_PUBLIC_WEBHOOK_BASE_HOST` is unset (a host `has` rule needs a
  non-empty value or `next build` throws). `.invalid` (RFC 6761) never matches.

## 3. EE stubs (additive — these files do not exist upstream)

Papermark withholds 23 enterprise modules from the OSS tree but still imports
them, so `next build` fails with "module not found". We add no-op stubs so the
build resolves; the corresponding **paid-tier features are disabled** (acceptable
— our launch is PDF sharing with tracked links, not datarooms). If upstream ever
publishes these, DELETE our stub and take theirs.

- `ee/features/branding/**` (12) — dataroom custom branding (banner editor, layout
  presets, social preview, visitor language, logo tone, public-link meta).
- `ee/features/request-lists/**` (6) — dataroom request lists.
- `ee/features/permissions/components/confidential-view/**` (2) — confidential view.
- `ee/limits/can-create-premium-team.ts`, `can-create-unlimited-team.ts` — team
  limit checks (stubbed permissive-off; our walk-in shim creates the shared team
  directly via Prisma, bypassing these).
- `ee/features/billing/dataroom-trial/lib/trigger/send-scheduled-email.ts` —
  trial reminder trigger tasks (no-op).
- `lib/oauth/scopes.ts` — API-token scope catalog (empty; the tokens settings UI
  renders no granular scopes).

Two more **non-EE** modules are imported but unpublished upstream — same fix:

- `lib/api/auth/restricted-tokens.ts` — `revokeUserBoundTeamTokens` (API-token
  cleanup on teammate removal; no-op).
- `lib/trigger/send-scheduled-email.ts` — `sendUpgradeOneMonthCheckinEmailTask`
  (Stripe-webhook trigger task; no-op).

Each stub carries a `STUB (buoy fork)` header. To find them all after an upstream
bump, scan every `@/` import for a missing target (not just `ee/`), e.g.:
`grep -rhoE 'from "@/[^"]+"' --include='*.ts' --include='*.tsx' . | sed -E 's,from "@/(.*)",\1,' | sort -u`
then check each path exists (incl. `.svg`/asset extensions). Any miss is a new stub.

## 4. Cloudflare Access walk-in shim (added — Trusted-Header tier, ADR-0002)

Turns the verified Cloudflare Access identity into a Papermark session so
@buoy.fish Members never see Papermark's own login. Identity comes ONLY from the
`Cf-Access-Authenticated-User-Email` header, trustworthy because the Services
Host origin is tunnel-only (ADR-0001) — nothing but Cloudflare can set it.

- `lib/auth/cf-access.ts` (new) — header normalize, domain gate
  (`PAPERMARK_SSO_ALLOWED_DOMAIN`), and `provisionAccessUser` (auto-provision into
  a single shared team, slug `buoy`, role MEMBER). **Open decision**: shared team
  vs per-user vs match-only — currently shared.
- `lib/auth/auth-options.ts` (patched) — adds a `cf-access` CredentialsProvider
  that reads the header server-side and ignores client-supplied credentials.
- `pages/sso.tsx` (new) — client entry that triggers `signIn("cf-access")`.
- `lib/middleware/app.ts` (patched) — unauthenticated requests carrying the Access
  header redirect to `/sso` instead of `/login`.

Config: `PAPERMARK_SSO_ALLOWED_DOMAIN=buoy.fish` (and optional
`PAPERMARK_SHARED_TEAM_SLUG` / `PAPERMARK_SHARED_TEAM_NAME`).

> NOT YET VERIFIED end-to-end (needs the live stack): confirm the Access header
> reaches the NextAuth callback POST, the session cookie name/secure flags match
> what `getToken` expects, and there's no `/sso` ↔ middleware redirect loop.

## 4b. Disabled-integration patches (build + runtime safety)

Some optional integrations construct clients / throw at MODULE LOAD when their env
is unset. Because `auth-options.ts` and route collection import these, an unset
key breaks `next build` AND runtime auth — not just the feature. Fixes:

- `lib/hanko.ts` (patched) — removed the top-level `throw` when `HANKO_*` is unset;
  feeds non-empty `"disabled"` sentinels to `tenant()` instead (it rejects an empty
  tenantId with "No tenant ID provided"). Passkeys stay disabled; the walk-in flow
  never exercises them.
- `lib/integrations/slack/client.ts` (patched) — `SlackClient`'s constructor no
  longer throws when `SLACK_CLIENT_ID/SECRET` are unset. It is constructed on
  import paths reaching core routes (`/api/views`), so the throw broke those at
  build + runtime. Slack is unused; real API calls would fail later if ever made.
- Dockerfile **build-stage-only** dummies `OPENAI_API_KEY`, `GOOGLE_VERTEX_API_KEY`
  — the EE AI model modules do `new OpenAI()` at import (strict SDK throws on a
  missing key). Build-only, not inlined, absent from the runner; AI stays disabled.
  (Stripe uses `?? ""` and tolerates an empty key, so it needs no dummy.)

## 4c. EE pages forced dynamic (build prerender safety)

Three EE **branding/preview** UI pages render the stubbed EE branding modules
(`ee/features/branding/lib/*`, which really export Zod schemas + layout-inference
fns we don't reproduce), so they crash during static prerender. Appended a minimal
`getServerSideProps` to each to skip build-time prerender (they're not part of the
shipped feature set; a real EE branding impl would replace the stubs):
`pages/branding.tsx`, `pages/room_ppreview_demo.tsx`,
`pages/datarooms/[id]/branding/index.tsx`.

## 5. Analytics → self-hosted ClickHouse (done — Phase 3)

Tinybird is proprietary (TSML); its engine is ClickHouse (Apache 2.0). The analytics
layer now targets a self-hosted ClickHouse over its HTTP interface (no SDK dep):

- `lib/tinybird/clickhouse.ts` (new) — a drop-in `Tinybird` class (`buildIngestEndpoint`
  + `buildPipe`) backed by `fetch` to ClickHouse. Ingest writes JSONEachRow (booleans
  coerced to 0/1 for UInt8). Read pipes hold the SQL from `endpoints/*.pipe` with
  Tinybird `{{ Type(x) }}` rewritten to ClickHouse `{x:Type}`.
- `lib/tinybird/publish.ts` + `pipes.ts` (patched) — import `Tinybird` from
  `./clickhouse` instead of `@chronark/zod-bird`; all endpoint definitions unchanged.
- Schema: `sign.buoy.fish/papermark/clickhouse/init/01-schema.sql` (5 tables matching
  the `.datasource` files); env `CLICKHOUSE_URL/USER/PASSWORD/DB`.

**Coverage:** all 5 ingest datasources write; the 10 document/page/team analytics
read pipes are ported (the shipped PDF analytics). The 6 dataroom/video/in-doc-click/
webhook read pipes return empty (`PIPE_SQL[...] = null`) until ported against a live
ClickHouse — they're unshipped features. `get_useragent_per_view__v2` has no `.pipe`
in the repo and is approximated from v3. NOT yet verified end-to-end (needs a running
ClickHouse + real events).

---

## Middleware host routing — `isCustomDomain` app-host guard

`middleware.ts` `isCustomDomain()` upstream returns **true for every host except
localhost/papermark.io/papermark.com/*.vercel.app**. On our single self-hosted host
(`paper.buoy.fish`) that means every request is routed to `DomainMiddleware` — the
`/view/domains/<host>/…` customer-custom-domain viewer — so the dashboard and the
Cloudflare Access walk-in (`AppMiddleware`) are **never reached** and the app renders
blank (200, empty body). Patched to treat the `NEXT_PUBLIC_APP_BASE_HOST` value (and
its `www.`) as the app host (`isCustomDomain` returns false for it). `NEXT_PUBLIC_
APP_BASE_HOST` is a Docker **build arg** (inlined into the edge middleware bundle), so
changing this requires an image rebuild, not just a restart.

## NextAuth secure-cookie naming on a non-Vercel HTTPS host

`lib/auth/auth-options.ts` upstream gates the session-cookie name/secure flag on
`VERCEL_DEPLOYMENT` (`!!process.env.VERCEL_URL`). On our self-host that is false, so
the session cookie is written as the **non-secure** `next-auth.session-token`, while
`getToken()` in the middleware — seeing `NEXTAUTH_URL=https://…` — reads
`__Secure-next-auth.session-token`. The names never match, so the Cloudflare Access
walk-in mints a session the middleware can't see and loops `/sso` forever (browser
shows a login loop + a 403 from piled-up stale CSRF cookies). Fixed with a
`USE_SECURE_COOKIES = NEXTAUTH_URL.startsWith("https://")` flag driving the session
cookie name + `secure`; `domain: .papermark.com` stays Vercel-only. Build-compiled →
needs an image rebuild.

## Unconfigured-integration & billing UX (self-host quiet-downs)

- `pages/api/teams/[teamId]/integrations/slack/index.ts` — `handleGet` called
  `getSlackEnv()` (which throws when the `SLACK_*` env is absent) before its
  try/catch, so the dashboard's load-time Slack probe returned **500**. Wrapped it
  to return 404 "not configured" when Slack env is missing (Slack is out of scope).
- `components/billing/pro-banner.tsx` — the "✨ Papermark Business ✨" upsell banner
  (`ProBanner`, shown in the sidebar on the free plan) returns `null`; a self-host
  has no Stripe billing/plan tiers so the upgrade nudge is never relevant.

## Redis — self-hosted Upstash-compatible (SRH), not Upstash SaaS

`lib/redis.ts` uses `@upstash/redis` + `@upstash/ratelimit` for middleware rate-limiting,
the download-job store, and the tus upload locker. Upstash is proprietary SaaS; left
unconfigured the client builds a relative `/pipeline` URL and **throws inside the edge
middleware** (`Invalid URL: /pipeline`), blanking the app. No fork code change — we
self-host a plain `redis:7` fronted by **serverless-redis-http (SRH, MIT)**, which speaks
the Upstash REST protocol, and point `UPSTASH_REDIS_REST_URL`/`_TOKEN` (+ `_LOCKER_`
variants) at `http://srh:80`. Containers live in `sign.buoy.fish/compose.yaml`
(`redis` + `srh` on `papermark_internal`); token is `UPSTASH_SRH_TOKEN` in `.env`.

## trigger.dev unavailability must not fail uploads

`lib/api/documents/process-document.ts` and
`pages/api/teams/[teamId]/documents/[id]/versions/index.ts` trigger conversion
tasks (pdf→image, docs→pdf, keynote, video) via the trigger.dev SDK *after* the
document/version row is persisted. With the jobs stack not yet deployed the SDK
throws `TriggerApiError: Connection error.`, which 500'd the whole request and
made the UI report "Error uploading file" even though the file was in R2 and the
document row existed. Both conversion-trigger sections are now wrapped in
try/catch: the failure is logged (`[trigger.dev] failed to trigger …`) and the
request succeeds — the version simply stays "processing" until trigger.dev is
live and the conversion is re-triggered.

## Server-to-self API calls ride INTERNAL_BASE_URL (ADR-0002)

Upstream builds server-side fetches to its own API from `NEXT_PUBLIC_BASE_URL` /
`NEXTAUTH_URL` — the public hostname. Behind Cloudflare Access those calls get
the login page instead of JSON ("Unexpected token '<'"), which 500'd `/api/views`
(viewer → getFile → `/api/file/s3/get-presigned-get-url`) and silently broke
view-notification emails, revalidation, and webhook callbacks. New
`lib/internal-base-url.ts` exports `INTERNAL_BASE_URL`
(`process.env.INTERNAL_BASE_URL` → falls back to the public base for
Vercel-style deploys); all server/task self-fetch sites now use it: get-file,
notification-helper (×2), process-document + pdf-to-image-route +
convert-pdf-direct revalidate, mupdf get-pages/convert-page,
send-webhooks callback, dataroom notification tasks (×2). Set
`INTERNAL_BASE_URL=http://papermark:3000` in the app env AND the trigger.dev
project env (runners join `buoy_proxy` so the name resolves).

## trigger.dev task discovery + task-runtime env (self-host)

- `trigger.config.ts`: `dirs` is `["./lib/trigger"]` only (upstream also scans
  `ee/**/lib/trigger`); the EE AI tasks construct OpenAI clients at import and
  abort deploy indexing without `OPENAI_API_KEY`. Project ref points at the
  self-hosted jobs.buoy.fish "papermark" project.
- Task runtime env lives in the trigger project's prod environment (imported
  from the host `.env`), with two deliberate differences from the app's env:
  `NEXT_PUBLIC_BASE_URL=http://papermark:3000` (tasks call back into the app —
  presigned-URL API — over the internal docker net; the public name is behind
  CF Access and machine calls bounce, ADR-0002) and NO
  `NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST` (see below).
- `NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST` must be UNSET on R2 self-host —
  everywhere, app and tasks. It means "CloudFront distribution": if present,
  `/api/file/s3/get-presigned-get-url` takes the CloudFront-signing branch
  (needs a CF key pair; fails `ERR_OSSL_UNSUPPORTED` with none) instead of
  plain S3 presigning, breaking every file fetch. It was mistakenly set to the
  R2 endpoint host during initial provisioning.

## Stub runtime-shape fixes (post plan-unlock)

Setting the team to a paid plan made previously-gated pages reachable and
exposed EE stubs whose exports didn't match what the OSS tree value-imports
(`ignoreBuildErrors` hides this class until runtime):

- `ee/features/branding/lib/dataroom-viewer-layout.ts` — now exports the real
  consts/functions AND the three zod schemas (`DataroomCardLayoutSchema`,
  `DataroomViewerHeaderStyleSchema`, `DataroomViewerLayoutPresetSchema`); the
  types-only stub crashed `/branding` client-side and 500'd
  `/api/teams/:id/branding` (`undefined.optional()`).
- `ee/features/branding/lib/dataroom-banner.ts` — `classifyDataroomBanner`
  returns the real `{kind, src, youtubeId?}` shape (callers do `.kind`).
- `lib/api/auth/restricted-tokens.ts` — real
  `RestrictedTokenSubjectTypeSchema` (`user | machine`) +
  `parseRestrictedTokenSubjectType`; the tokens API calls both.

## Dockerfile: COPY --chown, not RUN chown -R

`RUN chown -R nextjs:nodejs /app` duplicated ~5GB of copied files into a second
image layer — 11GB images and an 8-minute chown per build. The runner stage now
uses `COPY --chown` (and `--chmod` for the entrypoint); image is ~5.7GB.

## Tus upload endpoint (`/api/file/tus`) — R2 fixes

- `ee/features/storage/s3-store.ts` (`MultiRegionS3Store`, the tus datastore) built
  its S3 clients from `getStorageConfig()` but **dropped `config.endpoint`**, so the
  AWS SDK synthesized `<bucket>.s3.auto.amazonaws.com` → DNS `ENOTFOUND` → every tus
  upload 500'd. Now forwards `endpoint` (when set) via a shared `toS3ClientConfig()`,
  matching `lib/files/aws-client.ts`.
- Same file: passed `useTags: false` to `S3Store` — R2 has no S3 object-tagging
  support and rejects the `x-amz-tagging` header the store sends by default on its
  `.info` metadata writes (only used for expiration-cleanup markers).
- `pages/api/file/tus/[[...file]].ts` — `getFileIdFromRequest` crashed with
  `Buffer.from(undefined)` (500) on requests with no id segment (e.g. plain
  `GET /api/file/tus`); now returns `undefined` so @tus/server answers 404.

## Custom domains on self-host (Vercel-free verification)

Upstream attaches custom domains to a Vercel project and verifies them via the
Vercel API (`lib/domains.ts` → `api.vercel.com`). Self-hosting there is no Vercel
project, so those calls error and a domain is stuck **Invalid / "not verified yet"**
forever — including `paper.buoy.fish` itself if it's added as a custom domain.

- `lib/domains.ts` — added `isVercelConfigured()` (`PROJECT_ID_VERCEL` &&
  `TEAM_ID_VERCEL` && `AUTH_BEARER_TOKEN`). When unset (our case) the four Vercel
  helpers short-circuit to "healthy" shapes instead of calling Vercel:
  `addDomainToVercel`/`getDomainResponse`/`verifyDomain` → `{ verified: true }`,
  `getConfigResponse` → `{ misconfigured: false, conflicts: [] }`. This makes every
  caller pass with **no per-caller edits**: the `/verify` endpoint, the add-domain
  endpoint, and the daily re-check cron (`app/api/cron/domains/route.ts`) all read
  these and mark the domain verified. On self-host a custom domain is served the
  moment its DNS + tunnel + Caddy route exists, so "verified" is the truth.
- Rationale: the domain is real infra (Cloudflare Tunnel → Caddy), not a Vercel
  attachment. No DNS-record proof step is meaningful here.

## `papermark.com` label vs. the internal default-domain sentinel

`"papermark.com"` is overloaded upstream: (a) an **internal sentinel** meaning
"default domain / no custom domain" (compared as `domain === "papermark.com"`;
the real link URL is built from `NEXT_PUBLIC_MARKETING_URL`), and (b) a **shown
label**. We change only the *visible* strings to the actual deployment host, and
keep the sentinel string untouched (renaming it risks breaking default-vs-custom
detection across the API/webhook/cron contract). Visible strings now read
`process.env.NEXT_PUBLIC_APP_BASE_HOST || "papermark.com"` (env-driven, portable):

- `components/links/link-sheet/domain-section.tsx` — default `<SelectItem>` label
  (kept `value="papermark.com"`; `SelectValue` mirrors the child into the trigger).
- `ee/features/workflows/pages/workflow-new.tsx` — same default `<SelectItem>` label.
- `components/settings/og-preview.tsx` — the social-card `hostname`.
- `lib/api/views/send-webhook-event.ts` + `lib/webhook/triggers/link-created.ts` —
  the webhook `url` (was hardcoded `https://www.papermark.com/view/...`, now
  `NEXT_PUBLIC_MARKETING_URL`) and `domain` fields for default-domain links.

Left as `"papermark.com"` on purpose: all sentinel comparisons, the cron skip-list
`["papermark.io","papermark.com"]`, `middleware.ts` `isCustomDomain`, external
`www.papermark.com/help/...` links, `@papermark.com` placeholder emails, and email
template default props.

---

## Runtime services this fork expects (self-host)

Postgres · Cloudflare R2 (S3 transport) · Resend · self-hosted Redis via SRH
(rate-limit / job store / tus locker) · self-hosted trigger.dev v4
(PDF→image conversion) · self-hosted ClickHouse (analytics) · Gotenberg
(DOCX/PPTX/XLSX). See `sign.buoy.fish/compose.yaml` + `.env.example`.
