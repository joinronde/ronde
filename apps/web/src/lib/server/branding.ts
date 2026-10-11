import "server-only";
import type { EmailBrand } from "@ronde/core/notifications";
import { prisma } from "@ronde/db";
import { featureOn, type PlanScope } from "./license";
import { publicUrl } from "./public-url";

// The workspace's own logo (Team): in the app, on the shared screen, in emails and minutes, instead of Ronde's

export const brandingOn = (ws: PlanScope) => featureOn("branding.customLogo", ws);

export interface Brand {
  /** Version of the logo, for cache busting */
  logo: number;
  name: string;
}

/** The brand of a workspace, when the license has it and a logo was uploaded */
export async function workspaceBrand(workspaceId: string): Promise<Brand | null> {
  const w = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, plan: true, logo: { select: { updatedAt: true } } },
  });
  if (!w || !brandingOn(w)) return null;
  return w?.logo ? { logo: w.logo.updatedAt.getTime(), name: w.name } : null;
}

/** Where emails load the logo from: an absolute address */
export const logoPath = (slug: string, version: number) => `/api/w/${slug}/logo?v=${version}`;
export const logoUrl = async (slug: string, version: number) => publicUrl(logoPath(slug, version));

/** The logo and name emails show for a workspace; null: Ronde's */
export async function emailBrand(workspaceId: string): Promise<EmailBrand | null> {
  const w = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { slug: true, name: true, plan: true, logo: { select: { updatedAt: true } } },
  });
  return w?.logo && brandingOn(w) ? { name: w.name, logo: await logoUrl(w.slug, w.logo.updatedAt.getTime()) } : null;
}
