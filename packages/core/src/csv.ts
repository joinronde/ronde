// Spreadsheet files: what a spreadsheet set to the person's language opens straight into columns, accents intact

export type CsvCell = string | number | boolean | null | undefined;

/** Languages whose spreadsheets write 3,5: they split a CSV file on ";" and read "3,5" as a number */
const DECIMAL_COMMA = new Set(["fr", "de", "es", "it", "pt", "ru"]);

/** A text a spreadsheet would run as a formula: it is kept as text */
const FORMULA = /^[=+\-@\t\r]/;

/** The separator a spreadsheet in this language expects between columns */
export const csvSeparator = (locale: string) => (DECIMAL_COMMA.has(locale.slice(0, 2)) ? ";" : ",");

/**
 * Rows as a CSV file for a spreadsheet: columns split and decimals written as the language's spreadsheets
 * expect, a byte order mark so Excel reads UTF-8, and texts that look like formulas defused.
 */
export function toCsv(rows: CsvCell[][], locale: string): string {
  const sep = csvSeparator(locale);
  const cell = (v: CsvCell) => {
    if (v === null || v === undefined) return "";
    let x: string;
    if (typeof v === "number") x = Number.isFinite(v) ? (sep === ";" ? String(v).replace(".", ",") : String(v)) : "";
    else if (typeof v === "boolean") x = v ? "1" : "0";
    else x = FORMULA.test(v) ? `'${v}` : v;
    return x.includes(sep) || /["\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  return `﻿${rows.map((r) => r.map(cell).join(sep)).join("\r\n")}\r\n`;
}

/** A share (0..1) as a whole percentage, for a column titled with "%" */
export const percent = (share: number | null | undefined) => (share === null || share === undefined ? null : Math.round(share * 100));

/** A figure rounded to two decimals */
export const round2 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
