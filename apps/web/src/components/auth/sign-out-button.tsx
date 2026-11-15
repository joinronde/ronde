"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { withBasePath } from "@/lib/shared/base-path";

/** Signs out and opens the sign-in page: the way out of a page with nothing else to do (wrong account) */
export function SignOutButton({ label, className = "btn" }: { label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut().catch(() => undefined);
        window.location.assign(withBasePath("/sign-in"));
      }}
    >
      {label}
    </button>
  );
}
