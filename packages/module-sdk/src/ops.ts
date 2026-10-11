import type { Permission } from "@ronde/core/permissions";
import type { Viewer } from "@ronde/core/types";
import type { Meeting, ScopedTx, Session } from "@ronde/db";
import type { z } from "zod";
import type { BusEvent } from "./events";

/** What an operation knows about the meeting it runs on and the person running it */
export interface OpHost {
  meeting: Meeting;
  viewer: Viewer;
  /** Permission on this meeting (workspace role and meeting role combined) */
  can: (permission: Permission) => boolean;
  workspace: { id: string; slug: string; locale: string; timezone: string };
}

/** Settings of the module an operation belongs to, read and written within the operation's transaction */
export interface ModuleHandle {
  id: string;
  /** Saved configuration, merged over the module defaults (not validated: modules parse it) */
  config: unknown;
  setConfig: (config: unknown) => Promise<void>;
  /** Encrypted secret of the module (token…); empty string to remove it */
  setSecret: (secret: string) => Promise<void>;
  hasSecret: boolean;
}

export interface OpContext<H extends OpHost = OpHost> {
  m: H;
  /** Transaction confined to the workspace */
  db: ScopedTx;
  meetingId: string;
  workspaceId: string;
  /** Current session: locked for the whole transaction with `session: "lock"`, read with `session: "read"` */
  session: Session | null;
  /** The current session, or a "no meeting" error */
  requireSession: () => Session;
  /** Event for the browsers of the meeting, sent once the transaction is committed */
  emit: (event: BusEvent) => void;
  /** Work done once the transaction is committed (messages to other services…) */
  after: (fn: () => Promise<unknown> | unknown) => void;
  /** Personal change: other browsers have nothing to reload */
  quiet: () => void;
  /** The module of the operation (null for core operations) */
  module: ModuleHandle | null;
}

export interface OpDef<N extends string = string, S extends z.ZodType = z.ZodType, H extends OpHost = OpHost> {
  name: N;
  /** Permission checked before anything else; finer checks (own items…) are made by `run` */
  permission: Permission;
  /** "lock": runs with the current session locked (FOR UPDATE), so two changes never interleave */
  session?: "lock" | "read";
  input: S;
  /**
   * Kept in the audit log (Enterprise). By default, the operations that change how a meeting is set up
   * (meeting.configure, participants.manage, minutes.edit, meeting.delete); live interactions are not kept.
   */
  audit?: boolean;
  run: (ctx: OpContext<H>, input: z.output<S>) => Promise<unknown>;
}

export const defineOp = <N extends string, S extends z.ZodType, H extends OpHost = OpHost>(def: OpDef<N, S, H>) => def;
