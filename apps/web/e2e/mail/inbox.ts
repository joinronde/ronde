import { createServer, type Server, type Socket } from "node:net";
import { expect, type Page } from "@playwright/test";
import { simpleParser } from "mailparser";
import type { Who } from "../helpers";

// A fake mail server for the mail flows: it accepts every message the app sends through SMTP and keeps it in
// memory, so a spec can read the link in it. Just enough SMTP for nodemailer (no TLS, no authentication).

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2526);

export class Inbox {
  readonly mails: Mail[] = [];
  private server: Server | null = null;

  async start(port = SMTP_PORT): Promise<this> {
    this.server = createServer((socket) => this.session(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", resolve);
    });
    return this;
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** The first link of the latest message to this address whose subject matches, once it has arrived */
  async link(to: string, subject: RegExp): Promise<string> {
    let url = "";
    await expect(async () => {
      const mail = this.mails.findLast((m) => m.to.toLowerCase().includes(to.toLowerCase()) && subject.test(m.subject));
      url = /https?:\/\/[^\s<>")\]]+/.exec(mail?.text ?? "")?.[0] ?? "";
      expect(url, `a message to ${to} matching ${subject}`).not.toBe("");
    }).toPass({ timeout: 20_000 });
    return url;
  }

  /** How many messages this address received */
  count(to: string): number {
    return this.mails.filter((m) => m.to.toLowerCase().includes(to.toLowerCase())).length;
  }

  private session(socket: Socket) {
    let buffer = "";
    let data: string[] | null = null;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 localhost fake SMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (let at = buffer.indexOf("\r\n"); at >= 0; at = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (data) {
          if (line !== ".") {
            // Dot-stuffing: a leading dot was doubled by the sender
            data.push(line.startsWith("..") ? line.slice(1) : line);
            continue;
          }
          const raw = data.join("\r\n");
          data = null;
          void simpleParser(raw).then((parsed) => {
            const to = Array.isArray(parsed.to) ? parsed.to.map((a) => a.text).join(", ") : (parsed.to?.text ?? "");
            this.mails.push({ to, subject: parsed.subject ?? "", text: parsed.text ?? "" });
          });
          reply("250 OK: queued");
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") socket.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (verb === "DATA") {
          data = [];
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "QUIT") {
          reply("221 Bye");
          socket.end();
        } else reply("250 OK");
      }
    });
    socket.on("error", () => undefined);
  }
}

/** Signs up, then opens the link of the confirmation email: the account is signed in, on the onboarding page */
export async function signUpConfirmed(page: Page, inbox: Inbox, who: Who) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(who.name);
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(page.getByText(`We sent a confirmation link to ${who.email}`)).toBeVisible();
  await page.goto(await inbox.link(who.email, /^Confirm your email address/));
  await expect(page).toHaveURL(/\/onboarding$/);
}
