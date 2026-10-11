import { getTranslations } from "next-intl/server";

/** Shown while a page loads: the shape of the page, and the word for screen readers */
export async function PageSkeleton({ blocks = 3 }: { blocks?: number }) {
  const t = await getTranslations("states");
  return (
    <div className="page skeleton" aria-busy="true">
      <p className="sr-only" role="status">
        {t("loading")}
      </p>
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk-grid">
        {Array.from({ length: blocks }, (_, i) => (
          <div key={i} className="sk sk-block" />
        ))}
      </div>
    </div>
  );
}
