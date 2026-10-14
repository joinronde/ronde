"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MORE_STEP } from "@/lib/shared/show-more";

/** How many items of a long list show: the first ones, more at each click */
export function useShowMore(step = MORE_STEP) {
  const [limit, setLimit] = useState(step);
  return { limit, more: () => setLimit((l) => l + step), reset: () => setLimit(step), step };
}

/** "Show more" under a long list, saying how many come next and how many are left */
export function ShowMore({ hidden, step = MORE_STEP, onMore }: { hidden: number; step?: number; onMore: () => void }) {
  const t = useTranslations("common");
  if (hidden <= 0) return null;
  return (
    <button type="button" className="btn show-more" onClick={onMore}>
      <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
      {t("showMore", { count: Math.min(step, hidden), total: hidden })}
    </button>
  );
}
