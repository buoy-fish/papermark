import { tenant } from "@teamhanko/passkeys-next-auth-provider";

// buoy fork: passkeys are disabled in self-host. Upstream throws at module load
// when HANKO_* is unset — but auth-options.ts imports this, so that throw would
// kill ALL auth at runtime (and breaks `next build` page-data collection), not
// just passkeys. Construct with whatever is configured (empty when disabled) and
// never throw; the passkey provider simply isn't exercised by the walk-in flow.
// Non-empty placeholders: tenant() throws "No tenant ID provided" on an empty
// id, so we feed a sentinel when unconfigured. Passkeys are never exercised.
const hanko = tenant({
  apiKey: process.env.HANKO_API_KEY ?? "disabled",
  tenantId: process.env.NEXT_PUBLIC_HANKO_TENANT_ID ?? "disabled",
});

export default hanko;
