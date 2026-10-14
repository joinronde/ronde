import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { str } from "./shared";

// GitHub: recent issues and pull requests of each person, imported into their check-in, through the GitHub
// connections the meeting uses (the workspace's, its own, or the instance's, which reads public repositories)
const source = z.object({
  /** A connection of the workspace or of the meeting, or "instance" */
  connection: str(60),
  /** Followed repositories, "owner/repo" or a whole "owner", separated by commas or lines (empty: all) */
  repos: str(20_000),
});

const schema = z.object({
  /** false: the workspace's connections (with the filters of `sources`); true: those of `sources` only */
  picked: z.boolean(),
  sources: z.array(source).max(10),
});

export const github = defineModule({
  id: "github",
  category: "integrations",
  feature: "integrations.github",
  defaultEnabled: false,
  icon: "🐙",
  config: { schema, defaults: { picked: false, sources: [] } },
  ops: [
    defineOp({
      name: "github.configure",
      permission: "meeting.configure",
      input: z.object({ sources: schema.shape.sources }),
      run: async ({ module }, o) => {
        if (!module) throw new OpError("notFound");
        await module.setConfig({ picked: true, sources: o.sources });
      },
    }),
  ],
});
