"use client";

import { type CsvCell, toCsv } from "@ronde/core/csv";
import { useLocale, useTranslations } from "next-intl";
import { withBasePath } from "@/lib/shared/base-path";
import { downloadBlob } from "./common";
import { Icon } from "./shell/icons";

/** Today's date, local, for the name of a file */
const today = () => new Date().toLocaleDateString("sv-SE");

/**
 * "Export as CSV": a file for a spreadsheet, built here from what the page holds (`rows`), or by the server
 * when it holds more than the page (`href`).
 */
export function ExportCsv({
  name,
  rows,
  href,
  title,
  className = "btn",
}: {
  name: string;
  rows?: () => CsvCell[][];
  href?: string;
  title?: string;
  className?: string;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const label = (
    <>
      <Icon name="download" size={16} /> {t("exportCsv")}
    </>
  );
  if (href)
    return (
      <a className={`${className} export-csv`} href={withBasePath(href)} download title={title}>
        {label}
      </a>
    );
  const save = () => downloadBlob(`${name}-${today()}.csv`, new Blob([toCsv(rows?.() ?? [], locale)], { type: "text/csv;charset=utf-8" }));
  return (
    <button type="button" className={`${className} export-csv`} onClick={save} title={title}>
      {label}
    </button>
  );
}
