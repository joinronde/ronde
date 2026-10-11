import { defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { str } from "./shared";

// GitHub: recent issues and pull requests of each person, imported into their check-in
const schema = z.object({
  /** Followed repositories, "owner/repo" or a whole "owner", separated by commas or lines (empty: all) */
  repos: z.string().max(20_000),
});

export const github = defineModule({
  id: "github",
  category: "integrations",
  feature: "integrations.github",
  defaultEnabled: false,
  icon: "🐙",
  config: { schema, defaults: { repos: "" } },
  ops: [
    defineOp({
      name: "github.configure",
      permission: "meeting.configure",
      /** token missing: unchanged; empty string: removed */
      input: z.object({ repos: str(20_000), token: str(500).optional() }),
      run: async ({ module }, o) => {
        if (!module) throw new OpError("notFound");
        await module.setConfig({ repos: o.repos });
        if (o.token !== undefined) await module.setSecret(o.token);
      },
    }),
  ],
});
