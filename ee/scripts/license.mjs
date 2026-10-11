#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Ronde license keys: create a signing key pair, or sign a license.
//
//   node ee/scripts/license.mjs keygen <kid>
//     Writes the private key to .secrets/license-signing-<kid>.jwk.json (never commit it) and prints the
//     public key to add to packages/editions/src/keys.ts.
//
//   node ee/scripts/license.mjs sign --key .secrets/license-signing-<kid>.jwk.json --customer "Acme" \
//     --edition enterprise --seats 50 --expires 2027-12-31 [--id lic_123]
//     Prints the license key, to send to the customer (RONDE_LICENSE, or the instance administration page).

import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const [command, ...rest] = process.argv.slice(2);

if (command === "keygen") {
  const kid = rest[0];
  if (!kid || !/^[a-z0-9-]{3,40}$/.test(kid)) throw new Error("Usage: keygen <kid> (lowercase letters, digits, dashes)");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(".secrets", { recursive: true });
  const file = `.secrets/license-signing-${kid}.jwk.json`;
  writeFileSync(file, `${JSON.stringify({ kid, ...privateKey.export({ format: "jwk" }) }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Private key: ${file} (keep it out of the repository, in a password manager or a vault)`);
  console.log(`Public key, for packages/editions/src/keys.ts:\n  "${kid}": "${publicKey.export({ format: "jwk" }).x}",`);
} else if (command === "sign") {
  const { values: o } = parseArgs({
    args: rest,
    options: {
      key: { type: "string" },
      customer: { type: "string" },
      edition: { type: "string", default: "enterprise" },
      seats: { type: "string", default: "0" },
      expires: { type: "string" },
      id: { type: "string" },
    },
  });
  if (!o.key || !o.customer || !o.expires)
    throw new Error("Usage: sign --key <file> --customer <name> --expires <YYYY-MM-DD> [--edition team|enterprise] [--seats n]");
  if (o.edition !== "team" && o.edition !== "enterprise") throw new Error("--edition: team or enterprise");
  const jwk = JSON.parse(readFileSync(o.key, "utf8"));
  const payload = {
    kid: jwk.kid,
    id: o.id ?? `lic_${randomUUID().slice(0, 8)}`,
    customer: o.customer,
    edition: o.edition,
    seats: Number(o.seats),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(`${o.expires}T23:59:59Z`).toISOString(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const { kid: _kid, ...keyJwk } = jwk;
  const signature = sign(null, Buffer.from(`ronde_lic_v1.${body}`), createPrivateKey({ key: keyJwk, format: "jwk" })).toString("base64url");
  console.log(`ronde_lic_v1.${body}.${signature}`);
} else {
  console.log(
    "Usage: node ee/scripts/license.mjs keygen <kid> | sign --key <file> --customer <name> --expires <YYYY-MM-DD> [--edition] [--seats]",
  );
  process.exit(command ? 1 : 0);
}
