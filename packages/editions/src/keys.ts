// Public keys that sign Ronde license keys, by key id (Ed25519, the "x" of their JWK).
// Rotating: sign new keys with a new key id, add its public key here, keep the old one while its licenses last.
// The private keys never enter this repository.
export const LICENSE_PUBLIC_KEYS: Record<string, string> = {
  "ronde-2026-1": "CJWfXlcNRAW8npP_Fg71RyaueChPv3ehFSqNTnKpMdA",
};
