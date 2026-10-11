import "server-only";
import type { EnterpriseEdition } from "@ronde/editions/ee";
import { ee } from "@ronde/ee";

// The only door to the paid editions' code. A pure Community build (RONDE_PURE_CE=1) resolves @ronde/ee to
// @ronde/ee-stub; scripts/check-ee-boundary.mjs keeps every other file from importing it.
export const enterprise: EnterpriseEdition = ee;
