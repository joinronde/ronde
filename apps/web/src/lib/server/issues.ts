import "server-only";
import { type Locale, translator } from "@ronde/i18n";

/** What a validation issue says, read loosely: zod's issues differ in shape from one code to the other */
interface Issue {
  code: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  /** Where in the input: "announcements.3" */
  path?: readonly PropertyKey[];
}

/**
 * Input refused by a schema, said in the reader's language: "at least 2", "60 characters at most"… rather than
 * zod's English ("Too small: expected number to be >=2"), each thing said once
 */
export function issuesText(issues: readonly Issue[], locale: Locale): string {
  const t = translator(locale, "issues");
  const what = (i: Issue): string => {
    const min = Number(i.minimum ?? 0);
    const max = Number(i.maximum ?? 0);
    if (i.code === "too_small")
      return i.origin === "string"
        ? t("tooShort", { min })
        : i.origin === "array" || i.origin === "set"
          ? t("tooFew", { min })
          : t("tooSmall", { min });
    if (i.code === "too_big")
      return i.origin === "string"
        ? t("tooLong", { max })
        : i.origin === "array" || i.origin === "set"
          ? t("tooMany", { max })
          : t("tooBig", { max });
    if (i.code === "invalid_format") return t("format");
    if (i.code === "invalid_type") return t("missing");
    return t("invalid");
  };
  // The field it is about, when there is one: in a long form, the limit alone does not say where
  const said = issues.map((i) => (i.path?.length ? t("at", { field: i.path.map(String).join("."), problem: what(i) }) : what(i)));
  // Each said once, joined the way the reader's language joins a list
  return new Intl.ListFormat(locale, { style: "long", type: "unit" }).format([...new Set(said)]);
}
