// Kinds of connectors, without the drivers: safe to import in the browser

export const CONNECTOR_KINDS = ["email", "matrix", "slack", "teams", "discord", "mattermost", "webhook", "sms", "whatsapp"] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export const isConnectorKind = (v: unknown): v is ConnectorKind =>
  typeof v === "string" && (CONNECTOR_KINDS as readonly string[]).includes(v);

/** Connectors that reach people on their phone, through Twilio (Team) */
export const PHONE_KINDS = ["sms", "whatsapp"] as const;
export const isPhoneKind = (kind: string): kind is (typeof PHONE_KINDS)[number] => (PHONE_KINDS as readonly string[]).includes(kind);

/** A mobile number in international form: +33612345678 */
export const PHONE_NUMBER = /^\+[1-9]\d{6,14}$/;
