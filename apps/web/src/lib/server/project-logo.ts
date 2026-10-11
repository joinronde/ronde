import "server-only";
import sharp from "sharp";
import type { WorkspaceContext } from "./authz";
import { publish } from "./bus";
import { OpError } from "./errors";
import { sniffImage } from "./images";
import { editableProject } from "./projects";

// A project's logo, beside its name in the portfolio and on its step of a meeting: uploaded on its page (cropped
// to a 256 px square by the browser), or brought by an import (a GitHub organization's avatar, a GitLab or Jira
// project's), made a 256 px square here

/** Uploaded: the browser has already made it a 256 px square */
export const LOGO_MAX_BYTES = 300_000;
const SIDE = 256;

/**
 * Sets the logo of a project the person may edit (null: removes it). The image is drawn again as a 256 px square
 * here: whatever it declared (its size, its metadata), what is kept and shown is that square.
 */
export async function setProjectLogo(ctx: WorkspaceContext, id: string, data: Uint8Array<ArrayBuffer> | null): Promise<void> {
  const p = await editableProject(ctx, id);
  if (data) {
    if (!data.length || data.length > LOGO_MAX_BYTES) throw new OpError("logoTooLarge", { max: LOGO_MAX_BYTES / 1000 });
    const square = await squareLogo(data);
    if (!square) throw new OpError("logoFormat");
    await ctx.db.projectLogo.upsert({
      where: { projectId: p.id },
      create: { projectId: p.id, workspaceId: ctx.workspace.id, ...square },
      update: square,
    });
  } else await ctx.db.projectLogo.deleteMany({ where: { projectId: p.id } });
  // Shown on the project's step in the meetings that follow it, and only there
  for (const m of await ctx.db.meetingProject.findMany({ where: { projectId: p.id }, select: { meetingId: true } }))
    await publish(m.meetingId, { kind: "state" });
}

/** An image from a tool, as a 256 px WebP square; null when it is not a PNG, JPEG or WebP image (SVG never is) */
export async function squareLogo(bytes: Uint8Array): Promise<{ data: Uint8Array<ArrayBuffer>; type: string } | null> {
  if (!sniffImage(bytes)) return null;
  try {
    // Fitted whole in the square, its transparency kept: a wide wordmark is not cut
    const out = await sharp(bytes, { limitInputPixels: 4096 * 4096 })
      .resize(SIDE, SIDE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85 })
      .toBuffer();
    return { data: new Uint8Array(out), type: "image/webp" };
  } catch {
    return null;
  }
}
