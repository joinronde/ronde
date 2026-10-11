// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Email domains of a workspace: verified by a DNS TXT record, then capturing new accounts and requiring SSO.

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { DomainView, EnterpriseEdition, TxtResolver } from "@ronde/editions/ee";
import { OpError } from "@ronde/module-sdk";

type Db = ScopedClient | ScopedTx;

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "Acme.COM", "@acme.com" or "https://acme.com/" become "acme.com"; null when it is not a domain */
export function cleanDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  return DOMAIN.test(d) ? d : null;
}

const recordOf = (domain: string, token: string) => ({ name: `_ronde-challenge.${domain}`, value: `ronde-verification=${token}` });

const toView = (d: {
  id: string;
  domain: string;
  token: string;
  verifiedAt: Date | null;
  capture: boolean;
  enforceSso: boolean;
}): DomainView => ({
  id: d.id,
  domain: d.domain,
  record: recordOf(d.domain, d.token),
  verified: !!d.verifiedAt,
  capture: d.capture,
  enforceSso: d.enforceSso,
});

async function list(db: Db) {
  return (await db.workspaceDomain.findMany({ orderBy: { domain: "asc" } })).map(toView);
}

async function add(db: Db, workspaceId: string, input: string) {
  const domain = cleanDomain(input);
  if (!domain) throw new OpError("domainInvalid");
  if (await db.workspaceDomain.findFirst({ where: { domain }, select: { id: true } })) throw new OpError("domainExists");
  const row = await db.workspaceDomain.create({ data: { workspaceId, domain, token: randomBytes(16).toString("hex") } });
  return toView(row);
}

const systemResolve: TxtResolver = (name) => resolveTxt(name).catch(() => []);

async function verify(db: Db, id: string, resolve: TxtResolver = systemResolve) {
  const row = await db.workspaceDomain.findFirst({ where: { id } });
  if (!row) throw new OpError("notFound");
  if (row.verifiedAt) return true;
  const { name, value } = recordOf(row.domain, row.token);
  // The record may sit on the challenge name or on the domain itself
  const records = [...(await resolve(name)), ...(await resolve(row.domain))].map((chunks) => chunks.join(""));
  if (!records.includes(value)) return false;
  await db.workspaceDomain.update({ where: { id }, data: { verifiedAt: new Date() } });
  return true;
}

async function update(db: Db, id: string, patch: { capture?: boolean; enforceSso?: boolean }) {
  const row = await db.workspaceDomain.findFirst({ where: { id }, select: { verifiedAt: true } });
  if (!row) throw new OpError("notFound");
  if (!row.verifiedAt) throw new OpError("domainNotVerified");
  await db.workspaceDomain.update({ where: { id }, data: patch });
}

async function remove(db: Db, id: string) {
  const { count } = await db.workspaceDomain.deleteMany({ where: { id } });
  if (!count) throw new OpError("notFound");
}

export const domains: EnterpriseEdition["domains"] = { list, add, verify, update, remove };
