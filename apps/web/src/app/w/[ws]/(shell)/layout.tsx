import { AppShell } from "@/components/shell/app-shell";
import { currentUser } from "@/lib/server/authz";
import { shellData } from "@/lib/server/shell";

export const dynamic = "force-dynamic";

// The frame around a workspace's pages and its meetings' pages, one for both: it stays in place from one page to
// the next, so opening a meeting from the sidebar only changes the page, not the sidebar around it
export default async function ShellLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const user = await currentUser();
  // Signed out: the pages below send to the sign-in, with their own address to come back to
  if (!user) return children;
  return <AppShell data={await shellData(user, ws)}>{children}</AppShell>;
}
