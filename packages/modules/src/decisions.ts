import { defineModule } from "@ronde/module-sdk";
import { none } from "./shared";

// Decision log: every "Decision: …" line of the notes, from every archived session, in one searchable list.
// Nothing to store: the log reads the archived records.
export const decisions = defineModule({
  id: "decisions",
  category: "organisation",
  feature: "modules.facilitation",
  defaultEnabled: true,
  icon: "⚖️",
  config: { schema: none, defaults: {} },
  ops: [],
});
