import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

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
//
// The sign-in runs with redirect: false and fires exactly once: on success we
// replace to `next`; on failure we show a manual "Try again" link instead of
// auto-retrying, so a transient failure never loops or burns rate-limit tokens.
export default function SSO() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!router.isReady || attempted.current) return;
    attempted.current = true;
    // Same-origin only: a next like "https://evil.example" or "//evil.example"
    // would hard-navigate off-host (open redirect on the host that mails
    // funder links). redirect: false bypasses NextAuth's own redirect
    // validation, so validate here.
    const rawNext =
      typeof router.query.next === "string" ? router.query.next : "";
    const next =
      rawNext.startsWith("/") &&
      !rawNext.startsWith("//") &&
      !rawNext.startsWith("/\\")
        ? rawNext
        : "/dashboard";
    signIn("cf-access", { redirect: false })
      .then((res) => {
        // A signIn-callback throw still yields ok: true with error set —
        // treating that as success would loop /sso ↔ middleware at machine
        // speed. Only a clean ok counts.
        if (res?.ok && !res.error) {
          void router.replace(next);
        } else {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.next]);

  if (!failed) return null;

  const retryHref =
    typeof router.query.next === "string"
      ? `/sso?next=${encodeURIComponent(router.query.next)}`
      : "/sso";

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <p className="text-sm text-muted-foreground">Automatic sign-in failed.</p>
      <div className="flex gap-4 text-sm">
        <a href={retryHref} className="underline">
          Try again
        </a>
        {/* error param tells AppMiddleware not to walk this visit back to
            /sso — without it a CF-verified Member can never reach /login. */}
        <a href="/login?error=walkin_failed" className="underline">
          Go to login
        </a>
      </div>
    </div>
  );
}
