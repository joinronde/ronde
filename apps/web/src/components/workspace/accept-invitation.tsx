"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptInvitationAction } from "@/app/(auth)/invite/[token]/actions";
import { FormAlert } from "@/components/auth/fields";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/shared/track";

/** Joins the workspace, or signs out first to come back with the invited address */
export function AcceptInvitation({
  token,
  label,
  switchAccount,
  next,
}: {
  token: string;
  label: string;
  switchAccount?: boolean;
  next?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    if (switchAccount) {
      await authClient.signOut();
      router.replace(`/sign-in?next=${encodeURIComponent(next ?? "/")}`);
      router.refresh();
      return;
    }
    const res = await acceptInvitationAction(token);
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    track("invite_accepted");
    router.replace(`/w/${res.data.slug}`);
  };
  return (
    <>
      <FormAlert>{error}</FormAlert>
      <button type="button" className={`btn big ${switchAccount ? "" : "primary"}`} disabled={busy} aria-busy={busy} onClick={go}>
        {label}
      </button>
    </>
  );
}
