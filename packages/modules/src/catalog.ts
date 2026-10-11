import type { FeatureId } from "@ronde/editions";
import type { ModuleCategory, ModuleInfo } from "@ronde/module-sdk";

// What the browser needs to show the module catalog: no server code, no configuration schema.
// A test checks it against the module definitions.

export const CATALOG: readonly ModuleInfo[] = [
  { id: "icebreaker", category: "facilitation", feature: "modules.facilitation", defaultEnabled: false, icon: "🧊" },
  { id: "mood", category: "facilitation", feature: "modules.facilitation", defaultEnabled: false, icon: "🌤️" },
  { id: "rating", category: "facilitation", feature: "modules.facilitation", defaultEnabled: true, icon: "⭐" },
  { id: "reactions", category: "facilitation", feature: "modules.facilitation", defaultEnabled: true, icon: "👏" },
  { id: "hands", category: "facilitation", feature: "modules.facilitation", defaultEnabled: true, icon: "✋" },
  { id: "kudos", category: "facilitation", feature: "modules.facilitation", defaultEnabled: true, icon: "💜" },
  { id: "spotlight", category: "facilitation", feature: "modules.facilitation", defaultEnabled: false, icon: "🔦" },
  { id: "random", category: "facilitation", feature: "modules.facilitation", defaultEnabled: false, icon: "🎡" },
  { id: "birthdays", category: "facilitation", feature: "modules.facilitation", defaultEnabled: false, icon: "🎂" },
  { id: "sounds", category: "facilitation", feature: "modules.facilitation", defaultEnabled: false, icon: "🔊" },
  { id: "ambience", category: "facilitation", feature: "modules.facilitation", defaultEnabled: false, icon: "🍂" },
  { id: "rotation", category: "organisation", feature: "modules.facilitation", defaultEnabled: false, icon: "🔄" },
  { id: "timebox", category: "organisation", feature: "modules.facilitation", defaultEnabled: true, icon: "⏳" },
  { id: "polls", category: "organisation", feature: "modules.facilitation", defaultEnabled: false, icon: "📊" },
  { id: "parking", category: "organisation", feature: "modules.facilitation", defaultEnabled: false, icon: "🅿️" },
  { id: "decisions", category: "organisation", feature: "modules.facilitation", defaultEnabled: true, icon: "⚖️" },
  { id: "retro", category: "formats", feature: "modules.formats", defaultEnabled: false, icon: "🔍" },
  { id: "poker", category: "formats", feature: "modules.formats", defaultEnabled: false, icon: "🃏" },
  { id: "async", category: "formats", feature: "modules.formats", defaultEnabled: false, icon: "📨" },
  { id: "gitlab", category: "integrations", feature: "integrations.gitlab", defaultEnabled: true, icon: "🦊" },
  { id: "github", category: "integrations", feature: "integrations.github", defaultEnabled: false, icon: "🐙" },
  { id: "video", category: "integrations", feature: "integrations.video", defaultEnabled: true, icon: "🎥" },
];

/** Paid modules announced in the catalog (shown locked to admins, never during a meeting) */
export const PAID_MODULES: readonly { id: string; category: ModuleCategory; feature: FeatureId; icon: string }[] = [
  { id: "workflows", category: "notifications", feature: "modules.workflows", icon: "⚙️" },
  { id: "aiAssistant", category: "formats", feature: "modules.aiAssistant", icon: "✨" },
  { id: "writeBack", category: "integrations", feature: "integrations.writeBack", icon: "🔁" },
  { id: "calendarSync", category: "integrations", feature: "scheduling.calendarSync", icon: "📅" },
  { id: "analytics", category: "reporting", feature: "reporting.workspace", icon: "📊" },
  { id: "scheduledReports", category: "reporting", feature: "reporting.scheduled", icon: "📨" },
];
