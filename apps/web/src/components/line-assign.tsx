"use client";

import type { Snapshot } from "@ronde/core/types";
import { plainItem } from "@ronde/core/util";
import { useTranslations } from "next-intl";
import { joinedOf } from "@/lib/shared/stage";
import { useRonde } from "./ronde-provider";
import { Select } from "./select";

/**
 * Whether the viewer may put others on a line: the hosts on any line, the people working on the project (its lead,
 * its members) on its lines
 */
export function canAssign(s: Pick<Snapshot, "viewer" | "projects">, projectId: string | null): boolean {
  if (s.viewer.isHost) return true;
  if (!projectId || !s.viewer.memberId) return false;
  const p = s.projects.find((x) => x.id === projectId);
  return !!p && (p.leadId === s.viewer.personId || p.memberIds.includes(s.viewer.personId));
}

/** Puts a person on a line someone wrote, or takes them off (the ones on it are ticked): their face shows on it */
export function LineAssign({
  ownerId,
  projectId,
  section,
  text,
}: {
  ownerId: string;
  projectId: string | null;
  section: string;
  text: string;
}) {
  const t = useTranslations("me");
  const { s, members, rpc } = useRonde();
  if (!plainItem(text).trim() || !canAssign(s, projectId)) return null;
  const joined = joinedOf(s, { ownerId, projectId, section, text });
  // Those who take part, not its author
  const people = Object.values(members)
    .filter((p) => p.active && p.role !== "observer" && p.id !== ownerId)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!people.length) return null;
  return (
    <Select
      className="compact line-assign"
      aria-label={t("assignLine", { text: plainItem(text) })}
      title={t("assignHint")}
      value=""
      onChange={(e) => {
        const personId = e.target.value;
        if (personId) void rpc({ op: "item.with", ownerId, section, itemText: text, projectId, on: !joined.includes(personId), personId });
      }}
    >
      {/* The list's title: the button itself shows only its icon */}
      <option value="" disabled>
        {t("assign")}
      </option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {joined.includes(p.id) ? `✓ ${p.name}` : p.name}
        </option>
      ))}
    </Select>
  );
}
