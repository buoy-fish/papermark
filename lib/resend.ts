import { JSXElementConstructor, ReactElement } from "react";

import { render, toPlainText } from "react-email";
import { Resend } from "resend";

import prisma from "@/lib/prisma";
import { log, nanoid } from "@/lib/utils";

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export const sendEmail = async ({
  to,
  subject,
  react,
  from,
  marketing,
  system,
  verify,
  test,
  cc,
  replyTo,
  scheduledAt,
  unsubscribeUrl,
}: {
  to: string;
  subject: string;
  react: ReactElement<any, string | JSXElementConstructor<any>>;
  from?: string;
  marketing?: boolean;
  system?: boolean;
  verify?: boolean;
  test?: boolean;
  cc?: string | string[];
  replyTo?: string;
  scheduledAt?: string;
  unsubscribeUrl?: string;
}) => {
  if (!resend) {
    // Throw an error if resend is not initialized
    throw new Error("Resend not initialized");
  }

  const html = await render(react);
  const plainText = toPlainText(html);

  // buoy.fish fork: every upstream fallback here was a papermark.com address —
  // `system@verify.papermark.com` for verification codes, and `marc@papermark.com`
  // (upstream's founder, personally) for everything else. A self-hosted instance
  // must not send mail as a domain it does not own. Resend refuses to anyway
  // ("The verify.papermark.com domain is not verified"), and because that refusal
  // is only logged, the email-verification gate became a locked door with no key:
  // a viewer entered their address and no code could ever arrive.
  //
  // One env-driven sender, defaulting to our verified domain — same shape as
  // NEXT_PUBLIC_APP_BASE_HOST (see FORK.md). Upstream's marketing/system/verify
  // split assumes several verified domains; a self-host has one.
  const fromAddress = from ?? (process.env.EMAIL_FROM || "Buoy.Fish <noreply@buoy.fish>");

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: test ? "delivered@resend.dev" : to,
      cc: cc,
      // buoy.fish fork: upstream forced replyTo to `marc@papermark.com` (its
      // founder) for marketing sends. On a self-host that would point a
      // recipient's reply at another company. Callers pass their own replyTo;
      // absent one, Resend falls back to the From above.
      replyTo: replyTo,
      subject,
      react,
      scheduledAt,
      text: plainText,
      headers: {
        "X-Entity-Ref-ID": nanoid(),
        ...(unsubscribeUrl
          ? {
              "List-Unsubscribe": `<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            }
          : {}),
      },
    });

    // Check if the email sending operation returned an error and throw it
    if (error) {
      log({
        message: `Resend returned error when sending email: ${error.name} \n\n ${error.message}`,
        type: "error",
        mention: true,
      });
      throw error;
    }

    // If there's no error, return the data
    return data;
  } catch (exception) {
    // Log and rethrow any caught exceptions for upstream handling
    log({
      message: `Unexpected error when sending email: ${exception}`,
      type: "error",
      mention: true,
    });
    throw exception; // Rethrow the caught exception
  }
};

export const subscribe = async (email: string): Promise<void> => {
  if (!resend) {
    console.error("RESEND_API_KEY is not set in the .env. Skipping.");
    return;
  }

  const { data, error } = await resend.contacts.create({
    email,
  });

  if (error || !data?.id) {
    console.error("Failed to create contact:", error);
    return;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.RESEND_MARKETING_SEGMENT_ID
  ) {
    await resend.contacts.segments.add({
      contactId: data.id,
      segmentId: process.env.RESEND_MARKETING_SEGMENT_ID as string,
    });
  }
};

export const unsubscribe = async (email: string): Promise<void> => {
  if (!resend) {
    console.error("RESEND_API_KEY is not set in the .env. Skipping.");
    return;
  }

  if (!email) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { email: true },
  });

  if (!user || !user.email) {
    return;
  }

  await resend.contacts.update({
    email: user.email,
    unsubscribed: true,
  });
};
