import { NextRequest, NextResponse } from "next/server";

import { getToken } from "next-auth/jwt";

import { CF_ACCESS_EMAIL_HEADER } from "@/lib/auth/cf-access";

const LOGIN_PATH = "/login";
// buoy fork: Cloudflare Access walk-in entry (see pages/sso.tsx + lib/auth/cf-access.ts).
const WALKIN_PATH = "/sso";
const DEFAULT_AUTH_REDIRECT_PATH = "/dashboard";

function isProtocolRelativePath(path: string) {
  return path[1] === "/" || path[1] === "\\";
}

function normalizeNextPath(nextPath: string | null, requestUrl: string): string {
  if (!nextPath) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  let normalized = nextPath;

  // Handle already-encoded and double-encoded `next` values.
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) {
        break;
      }
      normalized = decoded;
    } catch {
      break;
    }
  }

  if (!normalized.startsWith("/") || isProtocolRelativePath(normalized)) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  try {
    const targetUrl = new URL(normalized, requestUrl);
    const requestOrigin = new URL(requestUrl).origin;

    if (targetUrl.origin !== requestOrigin) {
      return DEFAULT_AUTH_REDIRECT_PATH;
    }

    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }
}

export default async function AppMiddleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;
  const isInvited = url.searchParams.has("invitation");
  const token = (await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  })) as {
    email?: string;
    user?: {
      createdAt?: string;
    };
  };

  // UNAUTHENTICATED if there's no token and the path isn't /login or /sso
  if (!token?.email && path !== LOGIN_PATH && path !== WALKIN_PATH) {
    // buoy fork: behind Cloudflare Access the request carries a verified email
    // header (the Services Host origin is tunnel-only, so only Cloudflare can
    // set it — ADR-0001). Walk the Member straight in via /sso instead of
    // showing Papermark's own /login. With no header (local dev, or a public
    // path that slipped through) fall back to the normal /login redirect.
    if (req.headers.get(CF_ACCESS_EMAIL_HEADER)) {
      const ssoUrl = new URL(WALKIN_PATH, req.url);
      if (path !== "/") {
        ssoUrl.searchParams.set("next", `${path}${url.search}`);
      }
      return NextResponse.redirect(ssoUrl);
    }
    const loginUrl = new URL(LOGIN_PATH, req.url);
    // Append "next" parameter only if not navigating to the root
    if (path !== "/") {
      // Some destinations carry meaningful query params (e.g. the allow-list
      // action link identifies the link and visitor email). Preserve the full
      // search string for those so it survives the login round-trip.
      const preserveSearch =
        path === "/auth/confirm-email-change" || path.startsWith("/access/");
      const nextPath = preserveSearch ? `${path}${url.search}` : path;

      loginUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (!token?.email && path === LOGIN_PATH) {
    // buoy fork: a CF-verified Member stranded on /login (e.g. after a
    // transient walk-in failure) gets walked in again via /sso. Skip when the
    // URL carries an "error" param — /sso's own failure screen links here as
    // /login?error=walkin_failed (and redirect-mode NextAuth flows land on
    // /login?error=...), so re-walking those would loop.
    if (
      req.headers.get(CF_ACCESS_EMAIL_HEADER) &&
      !url.searchParams.has("error")
    ) {
      const ssoUrl = new URL(WALKIN_PATH, req.url);
      const loginNextPath = url.searchParams.get("next");
      if (loginNextPath) {
        // Same-origin-validate before forwarding — /login?next=<external>
        // must not become an /sso open redirect.
        ssoUrl.searchParams.set(
          "next",
          normalizeNextPath(loginNextPath, req.url),
        );
      }
      return NextResponse.redirect(ssoUrl);
    }

    const rawNextPath = url.searchParams.get("next");

    if (rawNextPath) {
      const normalizedNextPath = normalizeNextPath(rawNextPath, req.url);
      const canonicalLoginUrl = new URL(LOGIN_PATH, req.url);
      canonicalLoginUrl.searchParams.set("next", normalizedNextPath);

      if (canonicalLoginUrl.search !== url.search) {
        return NextResponse.redirect(canonicalLoginUrl, { status: 308 });
      }

      // Keep the base /login URL indexable for now, but deindex parameterized variants.
      const response = NextResponse.next();
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      return response;
    }

    return NextResponse.next();
  }

  // AUTHENTICATED if the user was created in the last 10 seconds, redirect to "/welcome"
  if (
    token?.email &&
    token?.user?.createdAt &&
    new Date(token?.user?.createdAt).getTime() > Date.now() - 10000 &&
    path !== "/welcome" &&
    !isInvited
  ) {
    return NextResponse.redirect(new URL("/welcome", req.url));
  }

  // AUTHENTICATED if the path is /login, redirect to the next path
  if (token?.email && path === LOGIN_PATH) {
    const nextPath = normalizeNextPath(url.searchParams.get("next"), req.url);
    return NextResponse.redirect(new URL(nextPath, req.url));
  }

  return NextResponse.next();
}
