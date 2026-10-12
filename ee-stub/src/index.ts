// SPDX-License-Identifier: AGPL-3.0-only
// Pure Community build: the same contract as @ronde/ee, with the Community behaviour and no paid code.

import type { EnterpriseEdition } from "@ronde/editions/ee";

export const ee: EnterpriseEdition = {
  kind: "stub",
  label: "Ronde Community Edition",
  audit: {
    record: async () => null,
    list: async () => ({ rows: [], next: null }),
    toCsv: () => "",
    stream: async () => {},
  },
  roles: {
    list: async () => [],
    save: async () => {
      throw new Error("Custom roles are not part of the Community edition");
    },
    remove: async () => {},
    assign: async () => {},
  },
  identity: {
    authPlugins: () => [],
    ssoRegistration: () => {
      throw new Error("Single sign-on per workspace is not part of the Community edition");
    },
    listSso: async () => [],
    resolveSsoUser: async () => ({ action: "reject", code: "SSO_NOT_IN_PLAN" }),
    ldapAuthenticate: async () => null,
    ldapTest: async () => ({ ok: false, error: "Company directories are not part of the Community edition" }),
  },
  billing: {
    customer: async () => {
      throw new Error("Billing is part of the Ronde cloud only");
    },
    checkout: async () => {
      throw new Error("Billing is part of the Ronde cloud only");
    },
    closeCheckout: async () => "closed",
    subscription: async () => null,
    liveSubscriptions: async () => [],
    cancel: async () => {
      throw new Error("Billing is part of the Ronde cloud only");
    },
    portal: async () => {
      throw new Error("Billing is part of the Ronde cloud only");
    },
    event: () => null,
    setSeats: async (_account, _subscriptionId, seats) => seats,
  },
  transcription: {
    transcribe: async () => {
      throw new Error("Transcription is not part of the Community edition");
    },
  },
  calendar: {
    upsert: async () => {
      throw new Error("Calendar sync is not part of the Community edition");
    },
    remove: async () => {},
    read: async () => {
      throw new Error("Calendar sync is not part of the Community edition");
    },
    busy: async () => ({}),
    test: async () => ({ ok: false, error: "Calendar sync is not part of the Community edition" }),
  },
  video: {
    createRoom: async () => {
      throw new Error("Video links are not part of the Community edition");
    },
    test: async () => ({ ok: false, error: "Video links are not part of the Community edition" }),
  },
  // Without the paid edition, conditions never hold back a message and the default words are used
  workflows: { matches: () => true, render: (template) => template },
  trackers: {
    create: async () => {
      throw new Error("Issue trackers are not part of the Community edition");
    },
    closed: async () => false,
    test: async () => ({ ok: false, error: "Issue trackers are not part of the Community edition" }),
  },
  wikis: {
    publish: async () => {
      throw new Error("Publishing to a wiki is not part of the Community edition");
    },
    test: async () => ({ ok: false, code: "answer", detail: "Publishing to a wiki is not part of the Community edition" }),
  },
  slack: {
    verify: () => false,
    authorizeUrl: () => {
      throw new Error("The Slack app is not part of the Community edition");
    },
    exchange: async () => {
      throw new Error("The Slack app is not part of the Community edition");
    },
    call: async () => {
      throw new Error("The Slack app is not part of the Community edition");
    },
  },
  teams: {
    verify: async () => false,
    call: async () => {
      throw new Error("The Microsoft Teams app is not part of the Community edition");
    },
    appPackage: () => {
      throw new Error("The Microsoft Teams app is not part of the Community edition");
    },
  },
  ai: {
    summarize: async () => {
      throw new Error("The AI assistant is not part of the Community edition");
    },
    suggestActions: async () => {
      throw new Error("The AI assistant is not part of the Community edition");
    },
  },
  insights: {
    compute: async (_db, period) => ({
      ...period,
      totals: {
        sessions: 0,
        meetings: 0,
        attendance: null,
        onTime: null,
        followThrough: null,
        mood: null,
        actionsCreated: 0,
        actionsDone: 0,
        medianDays: null,
        engagement: null,
      },
      weeks: [],
      meetings: [],
    }),
  },
  portfolio: {
    compute: async (_db, period) => ({ ...period, weeks: [], projects: [] }),
  },
  reports: {
    email: () => ({ subject: "", text: "", html: "" }),
    due: () => null,
  },
  scim: {
    handle: async () => ({ status: 404 }),
  },
  domains: {
    list: async () => [],
    add: async () => {
      throw new Error("Domains are not part of the Community edition");
    },
    verify: async () => false,
    update: async () => {},
    remove: async () => {},
  },
};
