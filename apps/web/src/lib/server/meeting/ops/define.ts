import "server-only";
import { defineOp as defineAnyOp, type OpContext as SdkOpContext, type OpDef as SdkOpDef } from "@ronde/module-sdk";
import type { z } from "zod";
import type { MeetingCtx } from "../context";

// Core operations see the full meeting context of the app; module operations only see what the SDK exposes

export type OpContext = SdkOpContext<MeetingCtx>;
export type OpDef<N extends string = string, S extends z.ZodType = z.ZodType> = SdkOpDef<N, S, MeetingCtx>;
export const defineOp = <N extends string, S extends z.ZodType>(def: OpDef<N, S>) => defineAnyOp<N, S, MeetingCtx>(def);
