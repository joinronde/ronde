import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceTopBar } from "@/components/shell/workspace-top-bar";
import { pageWorkspace } from "@/lib/server/authz";
import { shellData } from "@/lib/server/shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const ctx = await pageWorkspace(ws);
  return (
    <AppShell data={await shellData(ctx.user, ctx.workspace.slug)}>
      <WorkspaceTopBar workspace={{ slug: ctx.workspace.slug, name: ctx.workspace.name }} />
      <main id="main" className="page-main">
        {children}
      </main>
    </AppShell>
  );
}
