import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { str } from "./shared";

// GitLab: recent issues and merge requests of each person, imported into their check-in
const schema = z.object({
  /** Followed projects, full paths separated by commas (empty: all) */
  projects: z.string().max(20_000),
  /** Groups whose projects are offered in the settings */
  groups: z.string().max(500),
});

export const gitlab = defineModule({
  id: "gitlab",
  category: "integrations",
  feature: "integrations.gitlab",
  defaultEnabled: true,
  icon: "🦊",
  config: { schema, defaults: { projects: "", groups: "" } },
  ops: [
    defineOp({
      name: "gitlab.configure",
      permission: "meeting.configure",
      /** token missing: unchanged; empty string: removed */
      input: z.object({ projects: str(20_000), groups: str(500), token: str(500).optional() }),
      run: async ({ module }, o) => {
        if (!module) throw new OpError("notFound");
        await module.setConfig({ projects: o.projects, groups: o.groups });
        if (o.token !== undefined) await module.setSecret(o.token);
      },
    }),
  ],
});
