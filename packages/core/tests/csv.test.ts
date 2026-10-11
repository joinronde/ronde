import { csvSeparator, percent, round2, toCsv } from "@ronde/core/csv";
import { describe, expect, it } from "vitest";

const BOM = "﻿";

describe("CSV files for a spreadsheet", () => {
  it("splits columns and writes decimals as the language's spreadsheets expect", () => {
    const rows = [
      ["Réunion", "Humeur"],
      ["Point hebdo", 3.25],
    ];
    expect(toCsv(rows, "en")).toBe(`${BOM}Réunion,Humeur\r\nPoint hebdo,3.25\r\n`);
    expect(toCsv(rows, "fr")).toBe(`${BOM}Réunion;Humeur\r\nPoint hebdo;3,25\r\n`);
    expect(csvSeparator("de")).toBe(";");
    expect(csvSeparator("zh")).toBe(",");
  });

  it("quotes what would break a column, and leaves empty cells empty", () => {
    expect(toCsv([['Say "yes", then go', "two\nlines", null, undefined, true, false]], "en")).toBe(
      `${BOM}"Say ""yes"", then go","two\nlines",,,1,0\r\n`,
    );
    // With ";" between columns, a comma inside a text needs no quotes
    expect(toCsv([["a, b", "c; d"]], "fr")).toBe(`${BOM}a, b;"c; d"\r\n`);
  });

  it("keeps a text that looks like a formula as text, but not a negative number", () => {
    expect(toCsv([['=HYPERLINK("http://x")', "+1", "@SUM(A1)", "-2 days", -2]], "en")).toBe(
      `${BOM}"'=HYPERLINK(""http://x"")",'+1,'@SUM(A1),'-2 days,-2\r\n`,
    );
  });

  it("writes shares as percentages and figures with two decimals", () => {
    expect([percent(0.876), percent(null), round2(3.14159), round2(undefined)]).toEqual([88, null, 3.14, null]);
  });
});
