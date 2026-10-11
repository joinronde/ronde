import { defineModule } from "@ronde/module-sdk";
import { none } from "./shared";

// Holiday and season ambience of the waiting screen (decorations, tagline)
export const ambience = defineModule({
  id: "ambience",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🍂",
  config: { schema: none, defaults: {} },
  ops: [],
});
