import "server-only";
import nodemailer from "nodemailer";
import { env } from "./env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

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
