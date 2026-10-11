// Ronde editions. The Community edition is free and self-hosted; Team and Enterprise are paid, in the cloud
// or self-hosted with a license key. FEATURES is the single source of truth: app gating, the module
// catalog and the pricing page all read it.

export const EDITIONS = ["community", "team", "enterprise"] as const;
export type Edition = (typeof EDITIONS)[number];

/** What a feature is about, to group it on the pricing page */
export type FeatureArea =
  | "workspaces"
  | "identity"
  | "permissions"
  | "meetings"
  | "projects"
  | "scheduling"
  | "modules"
  | "integrations"
  | "reporting"
  | "branding"
  | "compliance";

export interface Feature {
  /** Lowest edition that includes the feature */
  edition: Edition;
  area: FeatureArea;
  /** Shipped in this version; false: announced on the pricing page, not usable yet */
  available: boolean;
  /** Only on a self-hosted server (its own app with a third party): the Ronde cloud does not offer it */
  selfHostedOnly?: true;
}

export const FEATURES = {
  // Community: everything a team needs to run its meetings
  "workspaces.unlimited": { edition: "community", area: "workspaces", available: true },
  "identity.local": { edition: "community", area: "identity", available: true },
  "identity.magicLink": { edition: "community", area: "identity", available: true },
  "identity.social": { edition: "community", area: "identity", available: true },
  "identity.oidc": { edition: "community", area: "identity", available: true },
  "identity.twoFactor": { edition: "community", area: "identity", available: true },
  "permissions.builtInRoles": { edition: "community", area: "permissions", available: true },
  "meetings.unlimited": { edition: "community", area: "meetings", available: true },
  "meetings.sectionRoles": { edition: "community", area: "meetings", available: true },
  "meetings.templates": { edition: "community", area: "meetings", available: true },
  "projects.portfolio": { edition: "community", area: "projects", available: true },
  "projects.round": { edition: "community", area: "projects", available: true },
  "projects.import": { edition: "community", area: "projects", available: true },
  "scheduling.recurrence": { edition: "community", area: "scheduling", available: true },
  "scheduling.ics": { edition: "community", area: "scheduling", available: true },
  "modules.facilitation": { edition: "community", area: "modules", available: true },
  "modules.notifications": { edition: "community", area: "modules", available: true },
  "modules.formats": { edition: "community", area: "modules", available: true },
  "integrations.gitlab": { edition: "community", area: "integrations", available: true },
  "integrations.github": { edition: "community", area: "integrations", available: true },
  "integrations.video": { edition: "community", area: "integrations", available: true },
  "integrations.api": { edition: "community", area: "integrations", available: false },
  "reporting.meeting": { edition: "community", area: "reporting", available: true },
  "reporting.export": { edition: "community", area: "reporting", available: true },
  // Team: depth (automation, cross-meeting analytics, two-way integrations)
  "scheduling.calendarSync": { edition: "team", area: "scheduling", available: true },
  "modules.workflows": { edition: "team", area: "modules", available: true },
  "modules.aiAssistant": { edition: "team", area: "modules", available: true },
  "modules.transcription": { edition: "team", area: "modules", available: true },
  "integrations.writeBack": { edition: "team", area: "integrations", available: true },
  "integrations.videoLinks": { edition: "team", area: "integrations", available: true },
  "integrations.sms": { edition: "team", area: "integrations", available: true },
  "integrations.slack": { edition: "team", area: "integrations", available: true },
  // Each server registers its own Teams bot in its Microsoft organization; the cloud has none
  "integrations.teams": { edition: "team", area: "integrations", available: true, selfHostedOnly: true },
  "integrations.wikis": { edition: "team", area: "integrations", available: true },
  "integrations.projectSync": { edition: "team", area: "integrations", available: true },
  "reporting.workspace": { edition: "team", area: "reporting", available: true },
  "reporting.scheduled": { edition: "team", area: "reporting", available: true },
  "reporting.portfolio": { edition: "team", area: "projects", available: true },
  "branding.customLogo": { edition: "team", area: "branding", available: true },
  // Enterprise: governance
  "identity.saml": { edition: "enterprise", area: "identity", available: true },
  "identity.ldap": { edition: "enterprise", area: "identity", available: true },
  "identity.scim": { edition: "enterprise", area: "identity", available: true },
  "identity.enforcedSso": { edition: "enterprise", area: "identity", available: true },
  "identity.domainCapture": { edition: "enterprise", area: "identity", available: true },
  "permissions.customRoles": { edition: "enterprise", area: "permissions", available: true },
  "projects.programs": { edition: "enterprise", area: "projects", available: true },
  "projects.permissions": { edition: "enterprise", area: "projects", available: true },
  "compliance.auditLog": { edition: "team", area: "compliance", available: true },
  "compliance.auditStream": { edition: "enterprise", area: "compliance", available: true },
  "compliance.retention": { edition: "enterprise", area: "compliance", available: false },
  "branding.whiteLabel": { edition: "enterprise", area: "branding", available: false },
} as const satisfies Record<string, Feature>;

export type FeatureId = keyof typeof FEATURES;

const RANK: Record<Edition, number> = { community: 0, team: 1, enterprise: 2 };

/** Whether an edition includes a feature (whether it is shipped yet is a separate question) */
export const includes = (edition: Edition, feature: FeatureId) => RANK[edition] >= RANK[FEATURES[feature].edition];

/** Whether a feature can be used on an instance running this edition */
export const hasFeature = (edition: Edition, feature: FeatureId) => FEATURES[feature].available && includes(edition, feature);

/** Features of one edition that the edition below does not have, for "what you get by upgrading" */
export const featuresAddedBy = (edition: Edition) => (Object.keys(FEATURES) as FeatureId[]).filter((f) => FEATURES[f].edition === edition);

export const isEdition = (v: unknown): v is Edition => typeof v === "string" && (EDITIONS as readonly string[]).includes(v);
