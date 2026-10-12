import { createHmac } from "node:crypto";
import { prisma } from "@ronde/db";
import { createEmailVerificationToken } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/server/auth";

// Signing in without a company provider: an email link, a forgotten password, and the second factor that an
// account turns on (asked after the password, and not to be got around with an email link)

// The emails sent, read as the person would: the links' tokens are only in them (kept hashed in the database)
const sent = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock("@/lib/server/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/server/mailer")>()),
  sendEmail: async (mail: { to: string; text: string }) => {
    sent.push(mail);
  },
}));

// Anyone may create an account here: the accounts of these tests are not invited
process.env.SIGNUP_POLICY = "open";
const run = Date.now().toString(36);
let n = 0;
const PASSWORD = "first-password-123";

/** A new account, signed in: its address and its session cookie */
async function account() {
  const email = `person-${run}-${++n}@sign-in.test`;
  const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Lena Fischer" }, returnHeaders: true });
  return { email, cookie: cookieOf(res.headers) };
}

const cookieOf = (headers: Headers) =>
  new Headers({
    cookie: headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });

/** The code an authenticator app would show now (RFC 6238: 30 seconds, 6 digits, SHA-1) */
function totp(base32: string, at = Date.now()) {
  const bits = [...base32.replace(/=+$/, "").toUpperCase()]
    .map((c) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** The token of the last email of that kind sent to the address, as the person would click its link */
async function lastToken(kind: "magic-link" | "reset-password", email: string, _userId?: string) {
  const pattern = kind === "magic-link" ? /magic-link\/verify\?token=([\w-]+)/ : /reset-password\/([\w-]+)/;
  const mail = sent.findLast((m) => m.to === email && pattern.test(m.text));
  if (!mail) throw new Error(`no ${kind} email to ${email}`);
  return pattern.exec(mail.text)![1]!;
}

const get = (path: string) => auth.handler(new Request(`http://localhost:3000/api/auth${path}`));

describe("signing in", () => {
  it("opens a session from an email link, once", async () => {
    const { email } = await account();
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: new Headers() });
    const token = await lastToken("magic-link", email);
    const res = await get(`/magic-link/verify?token=${token}&callbackURL=/`);
    expect(res.status).toBe(302);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("ronde.session_token="))).toBe(true);
    // The same link again: expired
    const again = await get(`/magic-link/verify?token=${token}&callbackURL=/`);
    expect(again.headers.get("location")).toMatch(/error=INVALID_TOKEN/);
  });

  it("changes a forgotten password with the emailed link: the old one stops working", async () => {
    const { email } = await account();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    const token = await lastToken("reset-password", email, user.id);
    await auth.api.resetPassword({ body: { token, newPassword: "second-password-456" } });
    await expect(auth.api.signInEmail({ body: { email, password: PASSWORD } })).rejects.toMatchObject({
      body: { code: "INVALID_EMAIL_OR_PASSWORD" },
    });
    expect(await auth.api.signInEmail({ body: { email, password: "second-password-456" } })).toMatchObject({ user: { email } });
  });

  it("asks for the second factor after the password once it is on, and accepts the authenticator's code", async () => {
    const { email, cookie } = await account();
    const setup = (await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: cookie })) as { totpURI: string };
    const secret = new URL(setup.totpURI).searchParams.get("secret")!;
    await auth.api.verifyTOTP({ body: { code: totp(secret) }, headers: cookie });
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).twoFactorEnabled).toBe(true);

    // The password alone opens no session: the code is asked
    const first = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
    expect(first.response).toMatchObject({ twoFactorRedirect: true });
    expect(first.headers.getSetCookie().some((c) => c.startsWith("ronde.session_token=") && !c.includes("Max-Age=0"))).toBe(false);
    const pending = cookieOf(first.headers);
    await expect(auth.api.verifyTOTP({ body: { code: "000000" }, headers: pending })).rejects.toMatchObject({
      body: { code: "INVALID_CODE" },
    });
    const done = await auth.api.verifyTOTP({ body: { code: totp(secret) }, headers: pending, returnHeaders: true });
    expect(done.headers.getSetCookie().some((c) => c.startsWith("ronde.session_token="))).toBe(true);
  });

  it("does not let an email link get around the second factor", async () => {
    const { email } = await account();
    // A link asked for before the second factor was turned on
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: new Headers() });
    const token = await lastToken("magic-link", email);
    const user = await prisma.user.update({ where: { email }, data: { twoFactorEnabled: true } });
    await prisma.authSession.deleteMany({ where: { userId: user.id } });

    await expect(auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: new Headers() })).rejects.toMatchObject({
      body: { code: "TWO_FACTOR_REQUIRED" },
    });
    const res = await get(`/magic-link/verify?token=${token}&callbackURL=/`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/sign-in\?error=TWO_FACTOR_REQUIRED$/);
    expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it("does not let an email confirmation link get around the second factor either", async () => {
    const { email } = await account();
    const user = await prisma.user.update({ where: { email }, data: { twoFactorEnabled: true, emailVerified: false } });
    await prisma.authSession.deleteMany({ where: { userId: user.id } });
    const token = await createEmailVerificationToken(auth.options.secret ?? "", email);
    const res = await get(`/verify-email?token=${token}&callbackURL=/`);
    expect(res.headers.get("location")).toMatch(/\/sign-in\?error=TWO_FACTOR_REQUIRED$/);
    expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);
  });
});
