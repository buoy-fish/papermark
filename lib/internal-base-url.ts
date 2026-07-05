/**
 * Base URL for server-to-self (and task-to-app) API calls.
 *
 * On this self-host the public hostname sits behind Cloudflare Access, so a
 * server-side fetch to `${NEXT_PUBLIC_BASE_URL}/api/...` bounces off the
 * Access login page (HTML → "Unexpected token '<'" JSON errors). Machine
 * traffic must use the internal docker name instead (ADR-0002); set
 * INTERNAL_BASE_URL=http://papermark:3000 in the app env AND the trigger.dev
 * project env. Falls back to the public base for Vercel-style deployments.
 */
export const INTERNAL_BASE_URL =
  process.env.INTERNAL_BASE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXTAUTH_URL;
