// PDF export of the minutes, generated in the browser from the Markdown.
import { isMarkdownTableSeparator, listItemOf, markdownPlain, markdownTableCells } from "@ronde/core/markdown";

// Standard PDF fonts only cover Latin-1: replace the rest
const clean = (s: string) =>
  markdownPlain(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/[  ]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/[^\x00-\xFFŒœ…€]/g, "");

/** The logo as a data URL with its size, or null when it cannot be loaded */
async function loadLogo(src: string): Promise<{ url: string; w: number; h: number } | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const img = new Image();
    img.src = url;
    await img.decode();
    // Redrawn as PNG: the PDF library reads no WebP
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return { url: canvas.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

/** The minutes as a PDF; with the workspace logo on top when it has one (Team) */
export async function markdownToPdf(md: string, logo?: string | null): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 50;
  let y = M;
  const image = logo ? await loadLogo(logo) : null;
  if (image) {
    const h = 34;
    const w = Math.min(160, (image.w / image.h) * h);
    doc.addImage(image.url, "PNG", M, y, w, (w / image.w) * image.h);
    y += h + 16;
  }
  const put = (
    t: string,
    { size = 10, bold = false, color = [43, 29, 14] as [number, number, number], before = 0, after = 3, indent = 0, bullet = "" } = {},
  ) => {
    y += before;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const pad = bullet ? 6 + doc.getTextWidth(bullet) : 0;
    const ls = doc.splitTextToSize(clean(t), W - 2 * M - indent - pad) as string[];
    ls.forEach((l, i) => {
      if (y + size > H - M) {
        doc.addPage();
        y = M;
      }
      if (bullet && i === 0) doc.text(bullet, M + indent, y + size);
      doc.text(l, M + indent + pad, y + size);
      y += size * 1.38;
    });
    y += after;
  };
  for (const raw of md.split("\n")) {
    const l = raw.trim();
    const li = listItemOf(raw);
    if (!l) {
      y += 4;
      continue;
    }
    if (l.startsWith("# ")) put(l.slice(2), { size: 17, bold: true, after: 6 });
    else if (l.startsWith("## ")) put(l.slice(3), { size: 13, bold: true, before: 8, color: [181, 59, 10] });
    else if (l.startsWith("### ")) put(l.slice(4), { size: 11, bold: true, before: 4 });
    else if (li) put(li.text, { indent: 6 + li.level * 14, bullet: li.ordered ? li.marker : "-", after: 1 });
    else if (isMarkdownTableSeparator(l)) continue;
    else if (l.startsWith("|")) put(markdownTableCells(l).join("   ·   "), { indent: 6, after: 1 });
    else {
      const b = /^\*\*.*\*\*$/.test(l);
      put(l, { bold: b, before: b ? 2 : 0 });
    }
  }
  return doc.output("blob");
}
