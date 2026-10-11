import { defineModule } from "@ronde/module-sdk";
import { none } from "./shared";

// Async mode: the meeting runs without a live session. Everyone fills in their check-in and comments on the
// others' before the planned time; then the session is archived by itself and the digest goes out by email.
// Publishing early is a control-room operation ("meeting.publish"): it archives, which only the core does.
export const asyncMode = defineModule({
  id: "async",
  category: "formats",
  feature: "modules.formats",
  defaultEnabled: false,
  icon: "📨",
  config: { schema: none, defaults: {} },
  ops: [],
});
