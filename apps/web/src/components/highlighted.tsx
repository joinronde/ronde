import { matchRanges } from "@/lib/shared/select-search";

/** A label with what was typed in a search marked in it (accents and separators read as the search reads them) */
export function Highlighted({ text, query, anywhere = false }: { text: string; query: string; anywhere?: boolean }) {
  const ranges = matchRanges(text, query, { anywhere });
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="hit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
