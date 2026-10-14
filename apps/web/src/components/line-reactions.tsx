"use client";

import * as Popover from "@radix-ui/react-popover";
import { LINE_REACTIONS } from "@ronde/core/types";
import { first } from "@ronde/core/util";
import { SmilePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRonde } from "./ronde-provider";

// Reactions on a line of a check-in (👍 🎉 ❤️ 💡 👀): the ones given, each with who gave it, and a button to
// add one. Read-only for those who cannot react (the shared screen, an observer)

export function LineReactions({ target }: { target: { ownerId: string; section: string; itemText: string; projectId: string | null } }) {
  const t = useTranslations("me");
  const { s, rpc, nameOf, host } = useRonde();
  const [open, setOpen] = useState(false);
  const me = s.viewer.memberId;
  const given = s.comments.filter(
    (c) =>
      !c.text &&
      c.ownerId === target.ownerId &&
      c.section === target.section &&
      c.itemText === target.itemText &&
      c.projectId === target.projectId,
  );
  const react = (emoji: (typeof LINE_REACTIONS)[number]) => rpc({ op: "comment.react", ...target, emoji });
  const who = (emoji: string) =>
    given
      .filter((c) => c.emoji === emoji)
      .map((c) => first(nameOf(c.byId)) || host)
      .join(", ");
  const shown = LINE_REACTIONS.filter((e) => given.some((c) => c.emoji === e));
  return (
    <span className="line-rx">
      {shown.map((emoji) => {
        const n = given.filter((c) => c.emoji === emoji).length;
        const mine = given.some((c) => c.emoji === emoji && c.byId === me);
        return me ? (
          <button
            key={emoji}
            type="button"
            className={`rx-chip${mine ? " mine" : ""}`}
            aria-pressed={mine}
            title={who(emoji)}
            onClick={() => react(emoji)}
          >
            <span aria-hidden="true">{emoji}</span> {n}
            <span className="sr-only">{who(emoji)}</span>
          </button>
        ) : (
          <span key={emoji} className="rx-chip" title={who(emoji)}>
            {emoji} {n}
          </span>
        );
      })}
      {me && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button type="button" className="rx-add" aria-label={t("react")} title={t("react")}>
              <SmilePlus size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="rx-pop" side="top" sideOffset={6} collisionPadding={8}>
              {LINE_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rx-pick"
                  aria-pressed={given.some((c) => c.emoji === emoji && c.byId === me)}
                  onClick={() => {
                    void react(emoji);
                    setOpen(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </span>
  );
}
