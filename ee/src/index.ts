// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Copyright (c) Ronde. Use requires a valid Ronde license key: see ee/LICENSE.

import type { EnterpriseEdition } from "@ronde/editions/ee";
import { ai } from "./ai";
import { audit } from "./audit";
import { billing } from "./billing";
import { calendar } from "./calendar";
import { domains } from "./domains";
import { ldapAuthenticate, ldapPlugin, ldapTest } from "./identity/ldap";
import { listSso, resolveSsoUser, ssoPlugin, ssoRegistration } from "./identity/sso";
import { insights } from "./insights";
import { portfolio } from "./portfolio";
import { reports } from "./reports";
import { roles } from "./roles";
import { scim } from "./scim";
import { slack } from "./slack";
import { teams } from "./teams";
import { trackers } from "./trackers";
import { transcription } from "./transcription";
import { video } from "./video";
import { wikis } from "./wikis";
import { workflows } from "./workflows";

export const ee: EnterpriseEdition = {
  kind: "ee",
  label: "Ronde Enterprise Edition",
  audit,
  roles,
  identity: {
    authPlugins: (host) => [ssoPlugin(host), ldapPlugin(host)],
    ssoRegistration,
    listSso,
    resolveSsoUser,
    ldapAuthenticate,
    ldapTest,
  },
  ai,
  billing,
  insights,
  portfolio,
  reports,
  trackers,
  wikis,
  slack,
  teams,
  calendar,
  transcription,
  video,
  workflows,
  scim,
  domains,
};
