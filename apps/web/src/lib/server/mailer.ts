import "server-only";
import path from "node:path";
import { REMINDER_LOGO_CID } from "@ronde/core/notifications";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { env } from "./env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Mail.Attachment[];
}

/** Ronde's logo, embedded in the email (its layouts show it as cid:ronde-logo when the workspace has none) */
export const rondeLogo = (): Mail.Attachment => ({
  filename: "ronde.png",
  path: path.join(process.cwd(), "public", "icon.png"),
  cid: REMINDER_LOGO_CID,
  contentType: "image/png",
  contentDisposition: "inline",
});

/** An address of the reserved .invalid domain (RFC 2606), the one of the fictitious people of a sample meeting */
export const isSampleAddress = (email: string) => /\.invalid$/i.test(email.trim());

/** Whether emails can actually be delivered (otherwise they are written to the server log) */
export const canSendEmail = () => !!env.smtpUrl();

/**
 * Sends an email through SMTP_URL. Without a mail server (local development), the message, its links
 * included, is written to the server log instead, so sign-in links still work.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  // The fictitious people of a sample meeting (lib/server/sample.ts) are on a reserved domain: never written to
  if (isSampleAddress(mail.to)) return;
  if (!canSendEmail()) {
    console.log(`[mail] (no SMTP_URL) to ${mail.to}: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  await nodemailer.createTransport(env.smtpUrl()).sendMail({ from: env.mailFrom(), ...mail });
}
