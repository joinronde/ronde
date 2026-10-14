import "server-only";
import { type Locale, translator } from "@ronde/i18n";

/** What a validation issue says, read loosely: zod's issues differ in shape from one code to the other */
interface Issue {
  code: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
}

/**
 * Input refused by a schema, said in the reader's language: "at least 2", "60 characters at most"… rather than
 * zod's English ("Too small: expected number to be >=2"), each thing said once
 */
export function issuesText(issues: readonly Issue[], locale: Locale): string {
  const t = translator(locale, "issues");
  const said = issues.map((i) => {
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
  });
  return [...new Set(said)].join(" ; ");
}
