import { createHmac, timingSafeEqual } from "crypto";

/**
 * buoy fork (ADR-0012 slice 4): verify the emailed-view token that
 * app.buoy.fish embeds as `?vt=` in a tracked report link. Possession of the
 * token proves the link reached the recipient's inbox — the same trust the OTP
 * gives (a string that only ever existed in that inbox) — so the viewer can
 * skip the code on first open.
 *
 * Format (must match the app's minter, CargoElixir.Papermark.mint_view_token):
 *   base64url(JSON{e,l,exp,n}) + "." + hex(HMAC-SHA256(secret, base64url))
 * The signature is over the base64 STRING, so there is no JSON canonicalization
 * to keep byte-identical across the two languages.
 *
 * Returns the bound email on success, null on ANY failure (bad shape, bad
 * signature, wrong link, expired) so the caller falls back to the OTP flow.
 * Disabled (returns null) unless VIEW_TOKEN_SECRET is set.
 */
export function verifyEmailedViewToken(
  vt: string | undefined | null,
  linkId: string,
): { email: string } | null {
  const secret = process.env.VIEW_TOKEN_SECRET;
  if (!secret || !vt) return null;

  const parts = vt.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;

  const expected = createHmac("sha256", secret).update(b64).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  let payload: { e?: unknown; l?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (payload.l !== linkId) return null;
  if (
    typeof payload.exp !== "number" ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  if (typeof payload.e !== "string" || !payload.e) return null;

  return { email: payload.e };
}
