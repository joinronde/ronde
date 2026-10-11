/** URL-safe identifier from a name: "Équipe Produit" → "equipe-produit" */
export function slugify(name: string, max = 40): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "workspace";
}

/** Slugs that would clash with app routes or look official */
export const RESERVED_SLUGS = new Set([
  "new",
  "admin",
  "api",
  "app",
  "settings",
  "account",
  "onboarding",
  "invite",
  "ronde",
  "www",
  "help",
  "support",
]);

/** Lowercase letters, digits and dashes, 1 to 40, no dash at either end */
export const isSlugFormat = (slug: string) => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug);
export const isValidSlug = (slug: string) => isSlugFormat(slug) && !RESERVED_SLUGS.has(slug);

/** First free slug: "team", then "team-2", "team-3"… */
export function availableSlug(base: string, taken: ReadonlySet<string>): string {
  const root = RESERVED_SLUGS.has(base) ? `${base}-team` : base;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root.slice(0, 36)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Split a display name into first and last name: "Ada Lovelace" → ["Ada", "Lovelace"] */
export function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [parts[0] ?? "", ""];
  return [parts[0]!, parts.slice(1).join(" ")];
}
