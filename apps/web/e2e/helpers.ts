import { createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";
import { type Browser, expect, type Page } from "@playwright/test";

// Steps shared by the specs that need a host, a workspace, people and a meeting before their own flow

export interface Who {
  name: string;
  email: string;
  password: string;
}

export async function signUp(page: Page, who: Who, path = "/sign-up") {
  await page.goto(path);
  await page.getByLabel("Full name").fill(who.name);
  // Opened from an invitation, the address is already filled in and locked
  if (await page.getByLabel("Email", { exact: true }).isEditable()) await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function signIn(page: Page, email: string, password: string, path = "/sign-in") {
  await page.goto(path);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** From the onboarding page: the workspace's address (absolute URL) */
export async function createWorkspace(page: Page, name: string): Promise<string> {
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create the workspace" }).click();
  await page.waitForURL(/\/w\/[^/]+$/);
  return page.url();
}

/** A host account with its workspace, ready on the workspace's home */
export async function hostWithWorkspace(page: Page, who: Who, workspace: string): Promise<string> {
  await signUp(page, who);
  return createWorkspace(page, workspace);
}

/** Invited from the directory: without a mail server the link is shown to share by hand */
export async function invite(page: Page, workspace: string, email: string, first: string, last: string): Promise<string> {
  await page.goto(`${workspace}/people?invite=1`);
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("First name").fill(first);
  await dialog.getByLabel("Last name").fill(last);
  await dialog.getByRole("button", { name: "Send the invitation" }).click();
  const link = await page.getByRole("dialog", { name: "Invitation link" }).getByRole("textbox").inputValue();
  await page.getByRole("button", { name: "Close" }).click();
  return link;
}

/** The invited person opens the link in their own browser, creates their account and joins */
export async function joinWithNewAccount(browser: Browser, link: string, who: Who): Promise<Page> {
  const page = await (await browser.newContext({ locale: "en-US" })).newPage();
  await page.goto(link);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.waitForURL(/\/sign-up\?/);
  await signUp(page, who, page.url());
  await page.getByRole("button", { name: /^Join / }).click();
  await page.waitForURL(/\/w\/[^/]+$/);
  return page;
}

/** A weekly sync with everyone of the workspace; the control room is open, its tour skipped. Returns its address */
export async function createMeeting(page: Page, workspace: string, name: string): Promise<string> {
  await page.goto(`${workspace}/meetings/new`);
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Create the meeting" }).click();
  await page.waitForURL(/\/m\/[^/]+\/control$/, { timeout: 120_000 });
  await page.getByRole("button", { name: "Skip the tour" }).click();
  return page.url().replace(/\/control$/, "");
}

/** Clicks a tab until it is selected: a click can be lost while the page settles after a live change */
export async function openTab(page: Page, name: RegExp | string) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass();
}

/** Writes items into the first fields of the check-in, one per section, then saves */
export async function fillCheckIn(page: Page, items: string[]) {
  const fields = page.getByPlaceholder(/Add an item/);
  for (const [i, item] of items.entries()) await fields.nth(i).fill(item);
  await page.getByRole("button", { name: "Save my check-in" }).click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
}

/** A small valid PNG (a red and blue square), built here so no binary file sits in the repository */
export function png(size = 8): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const rows: number[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push(...(x < size / 2 ? [220, 40, 40] : [40, 40, 220]));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The current code of an authenticator app for a base32 secret (RFC 6238: SHA-1, 6 digits, 30 seconds) */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
