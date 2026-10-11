"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { withBasePath } from "@/lib/shared/base-path";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";
import { squareImage } from "./square-image";
import { Avatar } from "./stage";

export { squareImage };

/** Photo of a person: click it to pick one, or remove it (the person themselves, the host or the admin) */
export function AvatarPicker({ memberId, sm }: { memberId: string; sm?: boolean }) {
  const t = useTranslations("avatar");
  const { members, toast, s } = useRonde();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const has = !!members[memberId]?.avatarVer;
  const send = async (method: "PUT" | "DELETE", body?: Blob) => {
    setBusy(true);
    try {
      // One's own photo is the account's, on one's card in every workspace; someone else's, this workspace's
      const own = memberId === s.viewer.personId && !s.viewer.userId.startsWith("guest:");
      const r = await fetch(own ? withBasePath("/api/account/avatar") : `${s.context.workspaceApi}/avatar/${memberId}`, {
        method,
        body,
        headers: body ? { "Content-Type": body.type } : undefined,
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? t("notSaved"));
      toast(method === "PUT" ? t("saved") : t("removed"));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="av-pick">
      <button
        type="button"
        className="av-btn"
        onClick={() => input.current?.click()}
        disabled={busy}
        title={has ? t("change") : t("add")}
        aria-label={has ? t("change") : t("add")}
      >
        <Avatar id={memberId} sm={sm} />
        <span className="av-edit" aria-hidden="true">
          <Icon name="camera" size={12} />
        </span>
      </button>
      {has && (
        <button type="button" className="linkbtn danger" disabled={busy} onClick={() => send("DELETE")}>
          {t("remove")}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            await send("PUT", await squareImage(file));
          } catch (err) {
            const message = (err as Error).message;
            toast(!message || message === "unreadable" ? t("unreadable") : message);
          }
        }}
      />
    </span>
  );
}
