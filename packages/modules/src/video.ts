import { AccessError, defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { str } from "./shared";

// Video call of the meeting: a free link (any tool), a Jitsi room, or a BigBlueButton room that Ronde opens
// and joins with each person's name (hosts as moderators), on a server of the workspace or the meeting's own.

const url = z.union([z.literal(""), z.string().trim().url().max(300)]);
const schema = z.object({
  provider: z.enum(["link", "jitsi", "bbb"]),
  /** Jitsi server, meet.jit.si by default */
  jitsiUrl: url,
  /** A BigBlueButton server of the workspace (a video account); empty: the meeting's own, below */
  bbbAccount: z.string().max(60),
  /** The meeting's own BigBlueButton server, e.g. https://bbb.example.com/bigbluebutton (its shared secret is kept as the module secret) */
  bbbUrl: url,
  /** Random room name, drawn once: hard to guess, the same for every session */
  room: z.string().max(40),
});
export type VideoConfig = z.infer<typeof schema>;

const defaults: VideoConfig = { provider: "link", jitsiUrl: "", bbbAccount: "", bbbUrl: "", room: "" };

export const DEFAULT_JITSI = "https://meet.jit.si";

/** A random room name: 20 letters and digits */
export function newRoom(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Link to join the call: the free link, the Jitsi room, or Ronde's BigBlueButton entry (`joinPath`), which
 * opens the room and signs the person in. Empty when nothing is set.
 */
export function videoLink(config: VideoConfig, freeLink: string, joinPath: string): string {
  if (config.provider === "jitsi" && config.room) return `${(config.jitsiUrl || DEFAULT_JITSI).replace(/\/$/, "")}/Ronde${config.room}`;
  if (config.provider === "bbb") return (config.bbbAccount || config.bbbUrl) && config.room ? joinPath : "";
  return freeLink;
}

export const video = defineModule({
  id: "video",
  category: "integrations",
  feature: "integrations.video",
  defaultEnabled: true,
  icon: "🎥",
  config: { schema, defaults },
  ops: [
    defineOp({
      name: "video.configure",
      permission: "meeting.configure",
      /** secret missing: unchanged; empty string: removed */
      input: z.object({
        provider: z.enum(["link", "jitsi", "bbb"]),
        link: z.union([z.literal(""), z.string().trim().url().max(500)]),
        jitsiUrl: url,
        bbbAccount: z.string().trim().max(60).default(""),
        bbbUrl: url,
        secret: str(200).optional(),
      }),
      run: async ({ db, m, meetingId, module }, o) => {
        if (!module) throw new OpError("notFound");
        const current = module.config as Partial<VideoConfig>;
        if (o.provider === "bbb") {
          if (o.bbbAccount) {
            // A server of this workspace (the transaction is confined to it)
            const account = await db.videoAccount.findFirst({ where: { id: o.bbbAccount, kind: "bbb" }, select: { id: true } });
            if (!account) throw new OpError("notFound");
          } else if (!o.bbbUrl) throw new OpError("videoBbbUrl");
          // A server of the meeting's own is reached from Ronde's network: a new one is for administrators
          else if (o.bbbUrl !== current.bbbUrl && !m.can("connectors.manage"))
            throw new AccessError(403, "videoServerAdminOnly", { host: new URL(o.bbbUrl).host });
        }
        await module.setConfig({
          provider: o.provider,
          jitsiUrl: o.jitsiUrl,
          bbbAccount: o.bbbAccount,
          bbbUrl: o.bbbUrl,
          room: current.room || newRoom(),
        });
        if (o.secret !== undefined) await module.setSecret(o.secret);
        await db.meeting.update({ where: { id: meetingId }, data: { videoUrl: o.link } });
      },
    }),
  ],
});
