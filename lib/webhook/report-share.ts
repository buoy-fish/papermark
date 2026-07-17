import { createWebhookSignature } from "./signature";

/**
 * Signed webhook to app.buoy.fish when a report viewer shares their tracked
 * link with a new recipient (buoy.fish fork — ADR-0012 slice 3). The app mints
 * a fresh per-recipient tracked link on the same report document and emails it,
 * carrying the sharer's note. Rides the SAME signed channel as the view webhook
 * (REPORT_WEBHOOK_URL/SECRET), discriminated by `event`.
 *
 * Awaited (not fire-and-forget): the caller wants to tell the viewer whether the
 * share landed. Returns true on a 2xx ack. Disabled (returns false) unless both
 * env vars are set.
 */
export async function sendReportShareWebhook({
  linkId,
  documentId,
  viewId,
  sharerEmail,
  recipientEmail,
  message,
}: {
  linkId: string;
  documentId?: string | null;
  viewId?: string | null;
  sharerEmail?: string | null;
  recipientEmail: string;
  message?: string | null;
}): Promise<boolean> {
  const url = process.env.REPORT_WEBHOOK_URL;
  const secret = process.env.REPORT_WEBHOOK_SECRET;
  if (!url || !secret) return false;

  const payload = {
    event: "share_requested",
    link_id: linkId,
    document_id: documentId ?? null,
    view_id: viewId ?? null,
    sharer_email: sharerEmail ?? null,
    recipient_email: recipientEmail,
    message: message ?? null,
  };
  // Sign and send the SAME string (byte-for-byte) the app verifies over.
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
      console.error(`report share webhook -> ${url} responded ${res.status}`);
    }
    return res.ok;
  } catch (err) {
    console.error("report share webhook failed:", err);
    return false;
  }
}
