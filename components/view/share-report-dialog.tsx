import { useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * buoy.fish fork (ADR-0012 slice 3): a report viewer forwards their report to a
 * colleague. Collects the recipient's email and a short note (pre-drafted and
 * editable, like the sender's own delivery flow). On send, app.buoy.fish mints a
 * fresh per-recipient tracked link and emails it — the sharer never handles the
 * link directly, so the new viewer verifies as themselves.
 */
export default function ShareReportDialog({
  open,
  onOpenChange,
  linkId,
  viewId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkId: string;
  viewId?: string;
}) {
  const { t } = useTranslation("viewer");
  const defaultMessage = t(
    "share.defaultMessage",
    "I wanted to share this efficacy report with you — I thought you'd find it worth a look.",
  );

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!viewId) return;
    setSending(true);
    try {
      const res = await fetch("/api/links/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId, viewId, email, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("share.failed", "Could not send the report"));
      }
      toast.success(t("share.sent", "Report sent — they'll get their own secure link"));
      setEmail("");
      setMessage(defaultMessage);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || t("share.failed", "Could not send the report"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("share.title", "Share this report")}</DialogTitle>
          <DialogDescription>
            {t(
              "share.description",
              "They'll receive their own secure link and confirm their email to open it.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="share-email">{t("share.emailLabel", "Their email")}</Label>
            <Input
              id="share-email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-message">{t("share.messageLabel", "Message")}</Label>
            <Textarea
              id="share-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={sending}>
            {t("share.cancel", "Cancel")}
          </Button>
          <Button onClick={send} disabled={sending || !email.trim()} loading={sending}>
            {t("share.send", "Send report")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
