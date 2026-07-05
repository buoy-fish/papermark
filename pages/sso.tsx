import { useRouter } from "next/router";
import { useEffect } from "react";

import { signIn } from "next-auth/react";

// buoy fork: Cloudflare Access walk-in entry point (paper.buoy.fish/sso).
// Reaching this page means the visitor already cleared Cloudflare Access, so the
// Cf-Access-Authenticated-User-Email header rides every request. We immediately
// trigger the "cf-access" credentials sign-in, which reads that header
// server-side (lib/auth/cf-access.ts) and mints a Papermark session, then
// bounces to the app. Members never see Papermark's own login.
//
// AppMiddleware (lib/middleware/app.ts) redirects unauthenticated, behind-Access
// requests here automatically, so the bare https://paper.buoy.fish also walks in.
export default function SSO() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const next =
      typeof router.query.next === "string" ? router.query.next : "/dashboard";
    void signIn("cf-access", { callbackUrl: next });
  }, [router.isReady, router.query.next]);

  return null;
}
