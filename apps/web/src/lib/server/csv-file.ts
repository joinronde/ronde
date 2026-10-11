import "server-only";
import { type CsvCell, toCsv } from "@ronde/core/csv";
import type { Locale } from "@ronde/i18n";

/**
 * A CSV file to download, for a spreadsheet in the person's language. Its name may hold accents or another
 * script: browsers read it from filename*, older clients from the plain fallback.
 */
export function csvFile(rows: CsvCell[][], locale: Locale, name: string): Response {
  const file = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  const plain = file.normalize("NFD").replace(/[^\w.-]+/g, "-");
  return new Response(toCsv(rows, locale), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      "Cache-Control": "no-store",
    },
  });
}
