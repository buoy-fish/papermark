import { NextApiRequest, NextApiResponse } from "next";

import { LinkType } from "@prisma/client";

import { verifyLinkSessionInPagesRouter } from "@/lib/auth/link-session";
import prisma from "@/lib/prisma";
import { sendReportShareWebhook } from "@/lib/webhook/report-share";

/**
 * buoy.fish fork (ADR-0012 slice 3): a report viewer forwards their tracked
 * link to a colleague. We don't hand the sharer's link over — the app mints a
 * FRESH per-recipient tracked link and emails it, so the new viewer verifies as
 * themselves and their opens attribute separately. This route only verifies the
 * sharer's own link session (same gate as the download route) and relays a
 * signed request to app.buoy.fish over the report webhook channel.
 */
export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { linkId, viewId, email, message } = req.body as {
    linkId: string;
    viewId: string;
    email: string;
    message?: string;
  };

  if (!linkId || !viewId || !email) {
    return res.status(400).json({ error: "Missing linkId, viewId, or email" });
  }

  // Basic shape check; the app validates authoritatively before sending.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }

  try {
    const view = await prisma.view.findUnique({
      where: { id: viewId, linkId },
      select: {
        id: true,
        viewerEmail: true,
        link: { select: { linkType: true, emailAuthenticated: true } },
        document: { select: { id: true } },
      },
    });

    if (!view || view.link.linkType !== LinkType.DOCUMENT_LINK) {
      return res.status(404).json({ error: "Link not found" });
    }

    const session = await verifyLinkSessionInPagesRouter(req, linkId);
    if (
      !session ||
      session.linkType !== LinkType.DOCUMENT_LINK ||
      session.viewId !== view.id ||
      session.documentId !== view.document?.id
    ) {
      return res.status(401).json({ error: "Session required to share" });
    }

    if (view.link.emailAuthenticated && !session.verified) {
      return res.status(403).json({ error: "Verify your email before sharing" });
    }

    const ok = await sendReportShareWebhook({
      linkId,
      documentId: view.document?.id,
      viewId: view.id,
      sharerEmail: view.viewerEmail,
      recipientEmail: email,
      message: message ?? null,
    });

    if (!ok) {
      return res.status(502).json({ error: "Could not send the report right now" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("share link error:", err);
    return res.status(500).json({ error: "Could not share the report" });
  }
}
