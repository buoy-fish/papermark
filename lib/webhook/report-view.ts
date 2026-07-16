import { createWebhookSignature } from "./signature";

/**
 * Fire-and-forget signed webhook to app.buoy.fish when a tracked report link is
 * viewed (buoy.fish fork — ADR-0012). Distinct from the built-in per-team
 * webhook pipeline (QStash-delivered, plan-gated, DB-configured): this is a
 * single global endpoint set by env with a direct fetch, so an efficacy
 * report's opens always reach the app regardless of team plan or QStash.
 *
 * Disabled unless BOTH REPORT_WEBHOOK_URL and REPORT_WEBHOOK_SECRET are set.
 * The signature is HMAC-SHA256 over the exact request body, sent as
 * `X-Papermark-Signature: sha256=<hex>` — the shape app.buoy.fish verifies.
 */
export async function sendReportViewWebhook({
  viewId,
  linkId,
  documentId,
  viewerEmail,
  viewedAt,
}: {
  viewId: string;
  linkId: string;
  documentId?: string | null;
  viewerEmail?: string | null;
  viewedAt?: Date | null;
}): Promise<void> {
  const url = process.env.REPORT_WEBHOOK_URL;
  const secret = process.env.REPORT_WEBHOOK_SECRET;
  if (!url || !secret) return;

  const payload = {
    event: "link_viewed",
    view_external_id: viewId,
    link_id: linkId,
    document_id: documentId ?? null,
    viewer_email: viewerEmail ?? null,
    viewed_at: (viewedAt ?? new Date()).toISOString(),
  };
  // Sign and send the SAME string — createWebhookSignature hashes
  // JSON.stringify(payload), and that must equal the request body byte-for-byte.
  const body = JSON.stringify(payload);

  try {
    const signature = await createWebhookSignature(secret, payload);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Papermark-Signature": `sha256=${signature}`,
      },
      body,
    });
    if (!res.ok) {
      console.error(`report view webhook -> ${url} responded ${res.status}`);
    }
  } catch (err) {
    console.error("report view webhook failed (non-fatal):", err);
  }
}
