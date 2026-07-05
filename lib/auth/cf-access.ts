// Cloudflare Access → Papermark walk-in shim (buoy.fish fork deviation).
//
// A request that has cleared Cloudflare Access at paper.buoy.fish arrives with
// the visitor's verified email in a header. Because the Services Host origin is
// tunnel-only (no published host port — ADR-0001), ONLY Cloudflare can set that
// header, so it is unspoofable and usable as the sole credential. This turns the
// Access identity into a NextAuth session so Members never see Papermark's own
// login (Trusted-Header integration tier, ADR-0002).
//
// The header-reading + domain-check logic lives here as pure functions so it can
// be reasoned about and unit-tested in isolation; the NextAuth wiring is in
// lib/auth/auth-options.ts (provider id "cf-access") and the walk-in is initiated
// from middleware (lib/middleware/app.ts) + pages/sso.tsx.

import type { PrismaClient } from "@prisma/client";

// Node lowercases header keys. Cloudflare also exposes the raw value at
// `cf-access-authenticated-user-email`.
export const CF_ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";

/** Normalize a raw header value to a lowercased email, or null if unusable. */
export function normalizeAccessEmail(
  raw: string | string[] | undefined | null,
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.includes("@") ? email : null;
}

/**
 * Gate provisioning to the configured domain. With no domain configured we fall
 * back to "any email Access let through" — but in production
 * PAPERMARK_SSO_ALLOWED_DOMAIN should always be set so an External Collaborator
 * policy on another app can never mint a Papermark account here.
 */
export function isAllowedAccessEmail(
  email: string | null,
  allowedDomain: string | undefined,
): email is string {
  if (!email) return false;
  const domain = allowedDomain?.trim().toLowerCase().replace(/^@/, "");
  if (!domain) return true;
  return email.endsWith(`@${domain}`);
}

const SHARED_TEAM_SLUG = process.env.PAPERMARK_SHARED_TEAM_SLUG || "buoy";
const SHARED_TEAM_NAME = process.env.PAPERMARK_SHARED_TEAM_NAME || "Buoy";

/**
 * Auto-provision a walked-in Member: upsert the user, ensure the single shared
 * team exists, and ensure membership. Idempotent — safe to call on every login.
 *
 * NOTE (open decision, see plan): this puts every @buoy.fish Member into ONE
 * shared team, so the team's documents/datarooms are collaboratively visible.
 * Switch SHARED_TEAM_* / this logic if per-user teams or match-only is wanted.
 */
export async function provisionAccessUser(
  prisma: PrismaClient,
  email: string,
): Promise<{ id: string; email: string; name: string | null }> {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0] },
  });

  const team = await prisma.team.upsert({
    where: { slug: SHARED_TEAM_SLUG },
    update: {},
    create: { name: SHARED_TEAM_NAME, slug: SHARED_TEAM_SLUG },
  });

  await prisma.userTeam.upsert({
    where: { userId_teamId: { userId: user.id, teamId: team.id } },
    update: {},
    create: { userId: user.id, teamId: team.id, role: "MEMBER" },
  });

  return { id: user.id, email: user.email, name: user.name };
}
