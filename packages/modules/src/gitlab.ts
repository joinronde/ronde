import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { str } from "./shared";

// GitLab: recent issues and merge requests of each person, imported into their check-in, through the GitLab
// connections the meeting uses (the workspace's, its own, or the instance's)
const source = z.object({
  /** A connection of the workspace or of the meeting, or "instance" */
  connection: str(60),
  /** Groups whose projects are offered in the settings */
  groups: str(500),
  /** Followed projects, full paths separated by commas (empty: all) */
  projects: str(20_000),
});

const schema = z.object({
  /** false: the workspace's connections (with the filters of `sources`); true: those of `sources` only */
  picked: z.boolean(),
  sources: z.array(source).max(10),
});

export const gitlab = defineModule({
  id: "gitlab",
  category: "integrations",
  feature: "integrations.gitlab",
  defaultEnabled: true,
  icon: "🦊",
  config: { schema, defaults: { picked: false, sources: [] } },
  ops: [
    defineOp({
      name: "gitlab.configure",
      permission: "meeting.configure",
      input: z.object({ sources: schema.shape.sources }),
      run: async ({ module }, o) => {
        if (!module) throw new OpError("notFound");
        await module.setConfig({ picked: true, sources: o.sources });
      },
    }),
  ],
});
